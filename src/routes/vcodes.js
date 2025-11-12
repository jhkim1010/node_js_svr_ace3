const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, handleBatchSync } = require('../utils/batch-sync-handler');

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
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        // new_data가 있으면 그것을 사용하고, 없으면 req.body를 직접 사용
        const rawData = req.body.new_data || req.body;
        // b_sincronizado_node_svr 필드 제거
        const dataToCreate = removeSyncField(rawData);
        console.log('Received data:', req.body);
        console.log('Data to create:', dataToCreate);
        const created = await Vcode.create(dataToCreate);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Vcode 생성 에러:');
        console.error('   에러 타입:', err.constructor.name);
        console.error('   에러 메시지:', err.message);
        console.error('   전체 에러:', err);
        if (err.original) {
            console.error('   원본 에러:', err.original);
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
        const dataToUpdate = removeSyncField(req.body);
        const [count] = await Vcode.update(dataToUpdate, { where: { vcode_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Vcode.findByPk(id);
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
        const count = await Vcode.destroy({ where: { vcode_id: id } });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vcode', details: err.message });
    }
});

module.exports = router;


