const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        const records = await Creditoventas.findAll({ limit: 100, order: [['creditoventa_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list creditoventas', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        const record = await Creditoventas.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch creditoventa', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        
        // BATCH_SYNC 또는 배열 데이터 처리 (utime 비교를 통한 개별 처리)
        // creditoventas는 creditoventa_id만 기본 키로 사용
        if ((req.body.operation === 'BATCH_SYNC' || Array.isArray(req.body.data)) && Array.isArray(req.body.data) && req.body.data.length > 0) {
            // 50개를 넘으면 배치로 나눠서 처리 (연결 풀 효율적 사용)
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Creditoventas, 'creditoventa_id', 'Creditoventas');
            await notifyBatchSync(req, Creditoventas, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 utime 비교를 통한 개별 처리
            req.body.data = rawData;
            req.body.operation = req.body.operation || 'BATCH_SYNC';
            const result = await handleUtimeComparisonArrayData(req, res, Creditoventas, 'creditoventa_id', 'Creditoventas');
            await notifyBatchSync(req, Creditoventas, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Creditoventas, 'creditoventa_id', 'Creditoventas');
        await notifyDbChange(req, Creditoventas, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Creditoventas', 'creditoventa_id', 'creditoventas');
        res.status(400).json({ 
            error: 'Failed to create creditoventa', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우) - utime 비교를 통한 개별 처리
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Creditoventas, 'creditoventa_id', 'Creditoventas');
            await notifyBatchSync(req, Creditoventas, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Creditoventas, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Creditoventas.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Creditoventas.update(dataToUpdate, { where: { creditoventa_id: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Creditoventas.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Creditoventas, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update creditoventa', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Creditoventas = getModelForRequest(req, 'Creditoventas');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Creditoventas.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Creditoventas.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Creditoventas.destroy({ where: { creditoventa_id: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Creditoventas, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete creditoventa', details: err.message });
    }
});

module.exports = router;

