const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, handleBatchSync } = require('../utils/batch-sync-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const records = await Ingresos.findAll({ limit: 100, order: [['ingreso_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list ingresos', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const record = await Ingresos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch ingreso', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Ingresos, 'ingreso_id', 'Ingresos');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const rawData = req.body.new_data || req.body;
        const dataToCreate = removeSyncField(rawData);
        const created = await Ingresos.create(dataToCreate);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Ingresos 생성 에러:', err);
        res.status(400).json({ 
            error: 'Failed to create ingreso', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const dataToUpdate = removeSyncField(req.body);
        const [count] = await Ingresos.update(dataToUpdate, { where: { ingreso_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Ingresos.findByPk(id);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update ingreso', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const count = await Ingresos.destroy({ where: { ingreso_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete ingreso', details: err.message });
    }
});

module.exports = router;

