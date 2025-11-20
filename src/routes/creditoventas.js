const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        const records = await Creditoventas.findAll({ limit: 100, order: [['creditoventa_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list creditoventas', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        const record = await Creditoventas.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch creditoventa', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // creditoventas는 creditoventa_id만 기본 키로 사용
            const result = await handleBatchSync(req, res, Creditoventas, 'creditoventa_id', 'Creditoventas');
            await notifyBatchSync(req, Creditoventas, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Creditoventas, 'creditoventa_id', 'Creditoventas');
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Creditoventas, 'creditoventa_id', 'Creditoventas');
            await notifyBatchSync(req, Creditoventas, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Creditoventas, cleanedData);
        const created = await Creditoventas.create(dataToCreate);
        await notifyDbChange(req, Creditoventas, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Creditoventas creation error:', err);
        res.status(400).json({ 
            error: 'Failed to create creditoventa', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Creditoventas, cleanedData);
        const [count] = await Creditoventas.update(dataToUpdate, { where: { creditoventa_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Creditoventas.findByPk(id);
        await notifyDbChange(req, Creditoventas, 'update', updated);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update creditoventa', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        const toDelete = await Creditoventas.findByPk(id);
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await Creditoventas.destroy({ where: { creditoventa_id: id } });
        await notifyDbChange(req, Creditoventas, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete creditoventa', details: err.message });
    }
});

module.exports = router;

