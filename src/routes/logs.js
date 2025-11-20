const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Logs = getModelForRequest(req, 'Logs');
        const records = await Logs.findAll({ limit: 100, order: [['id_log', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list logs', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Logs = getModelForRequest(req, 'Logs');
        const record = await Logs.findOne({ where: { id_log: id } });
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch log', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Logs = getModelForRequest(req, 'Logs');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // logs는 복합 기본 키 (fecha, hora, evento, progname) 사용
            const result = await handleBatchSync(req, res, Logs, ['fecha', 'hora', 'evento', 'progname'], 'Logs');
            await notifyBatchSync(req, Logs, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Logs, ['fecha', 'hora', 'evento', 'progname'], 'Logs');
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Logs, ['fecha', 'hora', 'evento', 'progname'], 'Logs');
            await notifyBatchSync(req, Logs, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리
        const cleanedData = removeSyncField(rawData);
        const dataToCreate = filterModelFields(Logs, cleanedData);
        const created = await Logs.create(dataToCreate);
        await notifyDbChange(req, Logs, 'create', created);
        res.status(201).json(created);
    } catch (err) {
        console.error('\n❌ Logs creation error:', err);
        res.status(400).json({ 
            error: 'Failed to create log', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Logs = getModelForRequest(req, 'Logs');
        // id_log로 먼저 찾기
        const existing = await Logs.findOne({ where: { id_log: id } });
        if (!existing) return res.status(404).json({ error: 'Not found' });
        
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Logs, cleanedData);
        const [count] = await Logs.update(dataToUpdate, { 
            where: { 
                fecha: existing.fecha,
                hora: existing.hora,
                evento: existing.evento,
                progname: existing.progname
            } 
        });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        const updated = await Logs.findOne({ 
            where: { 
                fecha: existing.fecha,
                hora: existing.hora,
                evento: existing.evento,
                progname: existing.progname
            } 
        });
        await notifyDbChange(req, Logs, 'update', updated);
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update log', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Logs = getModelForRequest(req, 'Logs');
        // id_log로 먼저 찾기
        const existing = await Logs.findOne({ where: { id_log: id } });
        if (!existing) return res.status(404).json({ error: 'Not found' });
        
        const count = await Logs.destroy({ 
            where: { 
                fecha: existing.fecha,
                hora: existing.hora,
                evento: existing.evento,
                progname: existing.progname
            } 
        });
        if (count === 0) return res.status(404).json({ error: 'Not found' });
        await notifyDbChange(req, Logs, 'delete', existing);
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete log', details: err.message });
    }
});

module.exports = router;

