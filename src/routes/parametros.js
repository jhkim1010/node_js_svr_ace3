const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const records = await Parametros.findAll({ limit: 100 });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list parametros', details: err.message });
    }
});

router.get('/:progname/:pname/:opcion', async (req, res) => {
    const { progname, pname, opcion } = req.params;
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const record = await Parametros.findOne({ where: { progname, pname, opcion } });
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch parametro', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        
        // BATCH_SYNC 작업 처리 (복합키: progname, pname, opcion)
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Parametros, ['progname', 'pname', 'opcion'], 'Parametros');
            await notifyBatchSync(req, Parametros, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const rawData = req.body.new_data || req.body;
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Parametros, cleanedData);
        const created = await Parametros.create(dataToCreate);
        await notifyDbChange(req, Parametros, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Parametros 생성 에러:', err);
        res.status(400).json({ 
            error: 'Failed to create parametro', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:progname/:pname/:opcion', async (req, res) => {
    const { progname, pname, opcion } = req.params;
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Parametros, cleanedData);
        const [count] = await Parametros.update(dataToUpdate, { where: { progname, pname, opcion } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Parametros.findOne({ where: { progname, pname, opcion } });
        await notifyDbChange(req, Parametros, 'update', updated);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update parametro', details: err.message });
    }
});

router.delete('/:progname/:pname/:opcion', async (req, res) => {
    const { progname, pname, opcion } = req.params;
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const toDelete = await Parametros.findOne({ where: { progname, pname, opcion } });
        if (!toDelete) return res.status(404).json({ error: 'Not found' });
        const count = await Parametros.destroy({ where: { progname, pname, opcion } });
        await notifyDbChange(req, Parametros, 'delete', toDelete);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete parametro', details: err.message });
    }
});

module.exports = router;


