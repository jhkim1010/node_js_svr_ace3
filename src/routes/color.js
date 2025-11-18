const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Color = getModelForRequest(req, 'Color');
        const records = await Color.findAll({ limit: 100, order: [['id_color', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list colors', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Color = getModelForRequest(req, 'Color');
        const record = await Color.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch color', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Color = getModelForRequest(req, 'Color');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // color는 idcolor만 기본 키로 사용
            const result = await handleBatchSync(req, res, Color, 'idcolor', 'Color');
            await notifyBatchSync(req, Color, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Color, 'idcolor', 'Color');
            await notifyBatchSync(req, Color, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Color, cleanedData);
        const created = await Color.create(dataToCreate);
        await notifyDbChange(req, Color, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Color 생성 에러:', err);
        res.status(400).json({ 
            error: 'Failed to create color', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Color = getModelForRequest(req, 'Color');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Color, cleanedData);
        const [count] = await Color.update(dataToUpdate, { where: { idcolor: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Color.findByPk(id);
        await notifyDbChange(req, Color, 'update', updated);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update color', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Color = getModelForRequest(req, 'Color');
        const toDelete = await Color.findByPk(id);
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await Color.destroy({ where: { idcolor: id } });
        await notifyDbChange(req, Color, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete color', details: err.message });
    }
});

module.exports = router;

