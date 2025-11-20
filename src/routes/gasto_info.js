const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

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
        
        // 일반 단일 생성 요청 처리
        const rawData = req.body.new_data || req.body;
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(GastoInfo, cleanedData);
        const created = await GastoInfo.create(dataToCreate);
        await notifyDbChange(req, GastoInfo, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ GastoInfo creation error:', err);
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
        const [count] = await GastoInfo.update(dataToUpdate, { where: { id_gasto: id, codigo } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await GastoInfo.findOne({ where: { id_gasto: id, codigo } });
        await notifyDbChange(req, GastoInfo, 'update', updated);
        res.json(updated);
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
        const toDelete = await GastoInfo.findOne({ where: { id_gasto: id, codigo } });
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await GastoInfo.destroy({ where: { id_gasto: id, codigo } });
        await notifyDbChange(req, GastoInfo, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete gasto_info', details: err.message });
    }
});

module.exports = router;

