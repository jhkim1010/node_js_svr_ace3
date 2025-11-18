const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        const records = await OnlineVentas.findAll({ limit: 100, order: [['online_venta_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list online_ventas', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        const record = await OnlineVentas.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch online_venta', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // online_ventas는 online_venta_id만 기본 키로 사용
            const result = await handleBatchSync(req, res, OnlineVentas, 'online_venta_id', 'OnlineVentas');
            await notifyBatchSync(req, OnlineVentas, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, OnlineVentas, 'online_venta_id', 'OnlineVentas');
            await notifyBatchSync(req, OnlineVentas, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(OnlineVentas, cleanedData);
        const created = await OnlineVentas.create(dataToCreate);
        await notifyDbChange(req, OnlineVentas, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ OnlineVentas creation error:', err);
        res.status(400).json({ 
            error: 'Failed to create online_venta', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(OnlineVentas, cleanedData);
        const [count] = await OnlineVentas.update(dataToUpdate, { where: { online_venta_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await OnlineVentas.findByPk(id);
        await notifyDbChange(req, OnlineVentas, 'update', updated);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update online_venta', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        const toDelete = await OnlineVentas.findByPk(id);
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await OnlineVentas.destroy({ where: { online_venta_id: id } });
        await notifyDbChange(req, OnlineVentas, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete online_venta', details: err.message });
    }
});

module.exports = router;

