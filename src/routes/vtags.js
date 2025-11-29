const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vtags = getModelForRequest(req, 'Vtags');
        const records = await Vtags.findAll({ limit: 100, order: [['vtag_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list vtags', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vtags = getModelForRequest(req, 'Vtags');
        const record = await Vtags.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch vtag', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Vtags = getModelForRequest(req, 'Vtags');
        // vtags는 (vtag_id, sucursal) 복합 primary key를 사용
        const compositePrimaryKey = ['vtag_id', 'sucursal'];
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // utime 비교 + 복합 primary key 우선 순서 적용
            const result = await handleUtimeComparisonArrayData(req, res, Vtags, compositePrimaryKey, 'Vtags');
            await notifyBatchSync(req, Vtags, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleUtimeComparisonArrayData(req, res, Vtags, compositePrimaryKey, 'Vtags');
            await notifyBatchSync(req, Vtags, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 utime 비교 로직으로 처리
            req.body.data = rawData;
            const result = await handleUtimeComparisonArrayData(req, res, Vtags, compositePrimaryKey, 'Vtags');
            await notifyBatchSync(req, Vtags, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청도 utime 비교 + 복합 primary key 우선 순서 적용
        req.body.data = [rawData];
        const result = await handleUtimeComparisonArrayData(req, res, Vtags, compositePrimaryKey, 'Vtags');

        const first = result.results && result.results[0];
        const action = first?.action || 'created';
        const data = first?.data || rawData;

        if (action === 'skipped') {
            // 중복(unique) 또는 FK 문제로 스킵된 경우도 에러가 아닌 정상 응답으로 처리
            await notifyDbChange(req, Vtags, 'skip', data);
            return res.status(200).json(first);
        }

        await notifyDbChange(req, Vtags, action === 'created' ? 'create' : 'update', data);
        res.status(action === 'created' ? 201 : 200).json(data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Vtags', 'vtag_id', 'vtags');
        res.status(400).json({ 
            error: 'Failed to create vtag', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vtags = getModelForRequest(req, 'Vtags');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, Vtags, 'vtag_id', 'Vtags');
            await notifyBatchSync(req, Vtags, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vtags, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vtags.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Vtags.update(dataToUpdate, { where: { vtag_id: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Vtags.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Vtags, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update vtag', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vtags = getModelForRequest(req, 'Vtags');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vtags.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Vtags.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Vtags.destroy({ where: { vtag_id: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Vtags, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vtag', details: err.message });
    }
});

module.exports = router;

