const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        const records = await Gastos.findAll({ limit: 100, order: [['id_ga', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error('\nERROR: Gastos fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list gastos');
        res.status(500).json(errorResponse);
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
        // Gastos 동기화 로직에서는 (id_ga, sucursal) 복합 키를 기본 식별자로 사용
        const compositePrimaryKey = ['id_ga', 'sucursal'];
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleUtimeComparisonArrayData(req, res, Gastos, compositePrimaryKey, 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            // utime 비교 + primary key 우선 순서 적용
            const result = await handleUtimeComparisonArrayData(req, res, Gastos, compositePrimaryKey, 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // 단일 생성/업데이트 요청도 utime 비교 + primary key 우선 순서 적용
        const rawData = req.body.new_data || req.body;
        req.body.data = Array.isArray(rawData) ? rawData : [rawData];

        const result = await handleUtimeComparisonArrayData(req, res, Gastos, compositePrimaryKey, 'Gastos');

        // 첫 번째 결과를 기반으로 응답 구성
        const first = result.results && result.results[0];
        const action = first?.action || 'created';
        const data = first?.data || rawData;

        if (action === 'skipped') {
            // 중복(unique) 또는 FK 문제로 스킵된 경우도 에러가 아닌 정상 응답으로 처리
            await notifyDbChange(req, Gastos, 'skip', data);
            return res.status(200).json(first);
        }

        await notifyDbChange(req, Gastos, action === 'created' ? 'create' : 'update', data);
        res.status(action === 'created' ? 201 : 200).json(data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Gastos', 'id_ga', 'gastos');
        res.status(400).json({ 
            error: 'Failed to create gasto', 
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
        const Gastos = getModelForRequest(req, 'Gastos');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, Gastos, 'id_ga', 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Gastos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Gastos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Gastos.update(dataToUpdate, { where: { id_ga: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Gastos.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Gastos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
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
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Gastos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Gastos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Gastos.destroy({ where: { id_ga: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Gastos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete gasto', details: err.message });
    }
});

module.exports = router;

