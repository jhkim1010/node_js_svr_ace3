const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, handleBatchSync } = require('../utils/batch-sync-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const records = await Vdetalle.findAll({ limit: 100, order: [['id_vdetalle', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list vdetalle', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const record = await Vdetalle.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch vdetalle', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        
        console.log('\n📥 Vdetalle POST 요청 수신');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            console.log(`🔄 BATCH_SYNC 처리 시작: ${req.body.data.length}개 항목`);
            const result = await handleBatchSync(req, res, Vdetalle, 'id_vdetalle', 'Vdetalle');
            console.log('✅ BATCH_SYNC 처리 완료:', JSON.stringify(result, null, 2));
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const rawData = req.body.new_data || req.body;
        console.log('Raw data:', JSON.stringify(rawData, null, 2));
        const dataToCreate = removeSyncField(rawData);
        console.log('Data to create:', JSON.stringify(dataToCreate, null, 2));
        
        const created = await Vdetalle.create(dataToCreate);
        console.log('✅ Vdetalle 생성 성공:', JSON.stringify(created.toJSON(), null, 2));
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Vdetalle 생성 에러:');
        console.error('   에러 타입:', err.constructor.name);
        console.error('   에러 메시지:', err.message);
        console.error('   전체 에러:', err);
        if (err.errors && Array.isArray(err.errors)) {
            console.error('   Validation 에러:');
            err.errors.forEach((validationError) => {
                console.error(`     - 필드: ${validationError.path}, 값: ${validationError.value}, 메시지: ${validationError.message}`);
            });
        }
        if (err.original) {
            console.error('   원본 에러:', err.original);
        }
        console.error('');
        res.status(400).json({ 
            error: 'Failed to create vdetalle', 
            details: err.message,
            errorType: err.constructor.name,
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined,
            originalError: err.original ? err.original.message : null
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const dataToUpdate = removeSyncField(req.body);
        const [count] = await Vdetalle.update(dataToUpdate, { where: { id_vdetalle: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Vdetalle.findByPk(id);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update vdetalle', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const count = await Vdetalle.destroy({ where: { id_vdetalle: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vdetalle', details: err.message });
    }
});

module.exports = router;


