const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, logTableError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Logs = getModelForRequest(req, 'Logs');
        const records = await Logs.findAll({ limit: 100, order: [['id_log', 'DESC']] });
        res.json(records);
    } catch (err) {
        logTableError('logs', 'list logs', err, req);
        res.status(500).json({
            error: 'Failed to list logs',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
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
        logTableError('logs', 'fetch log', err, req);
        res.status(500).json({
            error: 'Failed to fetch log',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
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
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Logs, ['fecha', 'hora', 'evento', 'progname'], 'Logs');
        await notifyDbChange(req, Logs, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        logTableError('logs', 'create/update log', err, req);
        handleInsertUpdateError(err, req, 'Logs', ['fecha', 'hora', 'evento', 'progname'], 'logs');
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
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, Logs, ['fecha', 'hora', 'evento', 'progname'], 'Logs');
            await notifyBatchSync(req, Logs, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const sequelize = Logs.sequelize;
        const transaction = await sequelize.transaction();
        try {
            // id_log로 먼저 찾기
            const existing = await Logs.findOne({ where: { id_log: id }, transaction });
            if (!existing) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            
            const cleanedData = removeSyncField(req.body);
            const dataToUpdate = filterModelFields(Logs, cleanedData);
            const [count] = await Logs.update(dataToUpdate, { 
                where: { 
                    fecha: existing.fecha,
                    hora: existing.hora,
                    evento: existing.evento,
                    progname: existing.progname
                },
                transaction
            });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Logs.findOne({ 
                where: { 
                    fecha: existing.fecha,
                    hora: existing.hora,
                    evento: existing.evento,
                    progname: existing.progname
                },
                transaction
            });
            await transaction.commit();
            await notifyDbChange(req, Logs, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        logTableError('logs', 'update log', err, req);
        res.status(400).json({
            error: 'Failed to update log',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Logs = getModelForRequest(req, 'Logs');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Logs.sequelize;
        const transaction = await sequelize.transaction();
        try {
            // id_log로 먼저 찾기
            const existing = await Logs.findOne({ where: { id_log: id }, transaction });
            if (!existing) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            
            const count = await Logs.destroy({ 
                where: { 
                    fecha: existing.fecha,
                    hora: existing.hora,
                    evento: existing.evento,
                    progname: existing.progname
                },
                transaction
            });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            await transaction.commit();
            await notifyDbChange(req, Logs, 'delete', existing);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        logTableError('logs', 'delete log', err, req);
        res.status(400).json({
            error: 'Failed to delete log',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

module.exports = router;

