const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        const records = await Codigos.findAll({ limit: 100, order: [['id_codigo', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list codigos', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        const record = await Codigos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch codigo', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // codigos는 codigo만 기본 키로 사용
            const result = await handleBatchSync(req, res, Codigos, 'codigo', 'Codigos');
            // WebSocket 알림 전송
            await notifyBatchSync(req, Codigos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Codigos, 'codigo', 'Codigos');
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Codigos, 'codigo', 'Codigos');
            // WebSocket 알림 전송
            await notifyBatchSync(req, Codigos, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Codigos, 'codigo', 'Codigos');
        // WebSocket 알림 전송
        await notifyDbChange(req, Codigos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Codigos', 'codigo', 'codigos');
        res.status(400).json({ 
            error: 'Failed to create codigo', 
            details: err.message,
            errorType: err.constructor.name,
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Codigos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Codigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Codigos.update(dataToUpdate, { where: { id_codigo: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Codigos.findByPk(id, { transaction });
            await transaction.commit();
            // WebSocket 알림 전송
            await notifyDbChange(req, Codigos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update codigo', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Codigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            // 삭제 전에 데이터 가져오기
            const toDelete = await Codigos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Codigos.destroy({ where: { id_codigo: id }, transaction });
            await transaction.commit();
            // WebSocket 알림 전송
            await notifyDbChange(req, Codigos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete codigo', details: err.message });
    }
});

module.exports = router;

