const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync } = require('../utils/batch-sync-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        const records = await Gastos.findAll({ limit: 100, order: [['id_ga', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error('\n❌ Gastos 조회 에러:');
        console.error('   에러 타입:', err.constructor.name);
        console.error('   에러 메시지:', err.message);
        console.error('   전체 에러:', err);
        if (err.original) {
            console.error('   원본 에러:', err.original);
        }
        console.error('');
        res.status(500).json({ 
            error: 'Failed to list gastos', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        const record = await Gastos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gasto', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Gastos, 'id_ga', 'Gastos');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        // new_data가 있으면 그것을 사용하고, 없으면 req.body를 직접 사용
        const rawData = req.body.new_data || req.body;
        // b_sincronizado_node_svr 필드 제거
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Gastos, cleanedData);
        const created = await Gastos.create(dataToCreate);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Gastos 생성 에러:');
        console.error('   에러 타입:', err.constructor.name);
        console.error('   에러 메시지:', err.message);
        console.error('   전체 에러:', err);
        if (err.original) {
            console.error('   원본 에러:', err.original);
        }
        console.error('');
        res.status(400).json({ 
            error: 'Failed to create gasto', 
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
        const Gastos = getModelForRequest(req, 'Gastos');
        // b_sincronizado_node_svr 필드 제거
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Gastos, cleanedData);
        const [count] = await Gastos.update(dataToUpdate, { where: { id_ga: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Gastos.findByPk(id);  
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update gasto', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        const count = await Gastos.destroy({ where: { id_ga: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete gasto', details: err.message });
    }
});

module.exports = router;

