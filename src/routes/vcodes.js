const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

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
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Vcode, 'vcode_id', 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Vcode, 'vcode_id', 'Vcode');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        // new_data가 있으면 그것을 사용하고, 없으면 req.body를 직접 사용
        const rawData = req.body.new_data || req.body;
        // b_sincronizado_node_svr 필드 제거
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Vcode, cleanedData);
        const created = await Vcode.create(dataToCreate);
        await notifyDbChange(req, Vcode, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Vcode creation error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        res.status(400).json({ 
            error: 'Failed to create vcode', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        // b_sincronizado_node_svr 필드 제거
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vcode, cleanedData);
        const [count] = await Vcode.update(dataToUpdate, { where: { vcode_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Vcode.findByPk(id);
        await notifyDbChange(req, Vcode, 'update', updated);
        res.json(updated);
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
        const toDelete = await Vcode.findByPk(id);
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await Vcode.destroy({ where: { vcode_id: id } });
        await notifyDbChange(req, Vcode, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vcode', details: err.message });
    }
});

module.exports = router;


