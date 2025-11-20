const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const records = await Todocodigos.findAll({ limit: 100, order: [['id_todocodigo', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list todocodigos', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const record = await Todocodigos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch todocodigo', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
            await notifyBatchSync(req, Todocodigos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
        await notifyDbChange(req, Todocodigos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        const errorMsg = err.original ? err.original.message : err.message;
        if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            // Validation error인 경우 상세 정보 표시
            console.error(`ERROR: Todocodigos INSERT/UPDATE failed: ${errorMsg}`);
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
            console.error(`ERROR: Todocodigos INSERT/UPDATE failed: ${errorMsg}`);
        }
        res.status(400).json({ 
            error: 'Failed to create todocodigo', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Todocodigos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Todocodigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Todocodigos.update(dataToUpdate, { where: { id_todocodigo: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Todocodigos.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Todocodigos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update todocodigo', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Todocodigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Todocodigos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Todocodigos.destroy({ where: { id_todocodigo: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Todocodigos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete todocodigo', details: err.message });
    }
});

module.exports = router;

