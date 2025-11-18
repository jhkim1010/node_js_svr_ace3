const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        const records = await Clientes.findAll({ limit: 100, order: [['id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list clientes', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        const record = await Clientes.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch cliente', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // clientes는 dni만 기본 키로 사용
            const result = await handleBatchSync(req, res, Clientes, 'dni', 'Clientes');
            await notifyBatchSync(req, Clientes, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Clientes, 'dni', 'Clientes');
            await notifyBatchSync(req, Clientes, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Clientes, cleanedData);
        const created = await Clientes.create(dataToCreate);
        await notifyDbChange(req, Clientes, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Clientes 생성 에러:', err);
        res.status(400).json({ 
            error: 'Failed to create cliente', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Clientes, cleanedData);
        const [count] = await Clientes.update(dataToUpdate, { where: { dni: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Clientes.findByPk(id);
        await notifyDbChange(req, Clientes, 'update', updated);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update cliente', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        const toDelete = await Clientes.findByPk(id);
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await Clientes.destroy({ where: { dni: id } });
        await notifyDbChange(req, Clientes, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete cliente', details: err.message });
    }
});

module.exports = router;

