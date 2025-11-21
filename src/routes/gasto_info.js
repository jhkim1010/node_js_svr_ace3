const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { classifyError } = require('../utils/error-classifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const GastoInfo = getModelForRequest(req, 'GastoInfo');
        const records = await GastoInfo.findAll({ limit: 100, order: [['id_gasto', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list gasto_info', details: err.message });
    }
});

router.get('/:id_gasto/:codigo', async (req, res) => {
    const { id_gasto, codigo } = req.params;
    const id = parseInt(id_gasto, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id_gasto' });
    try {
        const GastoInfo = getModelForRequest(req, 'GastoInfo');
        const record = await GastoInfo.findOne({ where: { id_gasto: id, codigo } });
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gasto_info', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const GastoInfo = getModelForRequest(req, 'GastoInfo');
        
        // BATCH_SYNC 작업 처리 (복합키: id_gasto, codigo)
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, GastoInfo, ['id_gasto', 'codigo'], 'GastoInfo');
            await notifyBatchSync(req, GastoInfo, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, GastoInfo, ['id_gasto', 'codigo'], 'GastoInfo');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, GastoInfo, ['id_gasto', 'codigo'], 'GastoInfo');
        await notifyDbChange(req, GastoInfo, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        const errorMsg = err.original ? err.original.message : err.message;
        const errorClassification = classifyError(err);
        
        if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            // Validation error인 경우 상세 정보 표시
            console.error(`ERROR: GastoInfo INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
            err.errors.forEach((validationError, index) => {
                console.error(`   [${index + 1}] Column: ${validationError.path}`);
                console.error(`       Value: ${validationError.value !== undefined && validationError.value !== null ? JSON.stringify(validationError.value) : 'null'}`);
                console.error(`       Error Type: ${validationError.type || 'N/A'}`);
                console.error(`       Validator: ${validationError.validatorKey || validationError.validatorName || 'N/A'}`);
                console.error(`       Message: ${validationError.message}`);
                if (validationError.validatorArgs && validationError.validatorArgs.length > 0) {
                    console.error(`       Validator Args: ${JSON.stringify(validationError.validatorArgs)}`);
                }
            });
        } else {
            console.error(`ERROR: GastoInfo INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
        }
        res.status(400).json({ 
            error: 'Failed to create gasto_info', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id_gasto/:codigo', async (req, res) => {
    const { id_gasto, codigo } = req.params;
    const id = parseInt(id_gasto, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id_gasto' });
    try {
        const GastoInfo = getModelForRequest(req, 'GastoInfo');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(GastoInfo, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = GastoInfo.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await GastoInfo.update(dataToUpdate, { where: { id_gasto: id, codigo }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await GastoInfo.findOne({ where: { id_gasto: id, codigo }, transaction });
            await transaction.commit();
            await notifyDbChange(req, GastoInfo, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update gasto_info', details: err.message });
    }
});

router.delete('/:id_gasto/:codigo', async (req, res) => {
    const { id_gasto, codigo } = req.params;
    const id = parseInt(id_gasto, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id_gasto' });
    try {
        const GastoInfo = getModelForRequest(req, 'GastoInfo');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = GastoInfo.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await GastoInfo.findOne({ where: { id_gasto: id, codigo }, transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await GastoInfo.destroy({ where: { id_gasto: id, codigo }, transaction });
            await transaction.commit();
            await notifyDbChange(req, GastoInfo, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete gasto_info', details: err.message });
    }
});

module.exports = router;

