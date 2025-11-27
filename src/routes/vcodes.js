const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleVcodesBatchSync, handleVcodesArrayData } = require('../utils/vcodes-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const records = await Vcode.findAll({ limit: 100, order: [['vcode_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list vcodes', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const record = await Vcode.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch vcode', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // BATCH_SYNC 작업 처리 (Vcodes 전용 핸들러 사용)
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleVcodesBatchSync(req, res, Vcode, 'vcode_id', 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도) (Vcodes 전용 핸들러 사용)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleVcodesArrayData(req, res, Vcode, 'vcode_id', 'Vcode');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Vcode, 'vcode_id', 'Vcode');
        await notifyDbChange(req, Vcode, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Vcode', 'vcode_id', 'vcodes');
        res.status(400).json({ 
            error: 'Failed to create vcode', 
            details: err.message,
            errorType: err.constructor.name,
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined,
            originalError: err.original ? err.original.message : null
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우) - Vcodes 전용 핸들러 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleVcodesArrayData, Vcode, 'vcode_id', 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vcode, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vcode.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Vcode.update(dataToUpdate, { where: { vcode_id: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Vcode.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Vcode, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update vcode', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vcode.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Vcode.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Vcode.destroy({ where: { vcode_id: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Vcode, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vcode', details: err.message });
    }
});

module.exports = router;


