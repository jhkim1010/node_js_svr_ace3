const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
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
        
        // BATCH_SYNC 작업 처리
        // gastos 테이블은 id_ga에 unique 제약 조건이 없으므로 primary key를 unique key로 사용하지 않음
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // gastos는 항상 INSERT만 수행 (id_ga는 sequence로 자동 생성)
            const sequelize = Gastos.sequelize;
            const transaction = await sequelize.transaction();
            const results = [];
            let createdCount = 0;
            
            try {
                for (let i = 0; i < req.body.data.length; i++) {
                    const item = req.body.data[i];
                    const cleanedItem = removeSyncField(item);
                    const filteredItem = filterModelFields(Gastos, cleanedItem);
                    // id_ga는 sequence로 자동 생성되므로 제거
                    delete filteredItem.id_ga;
                    const created = await Gastos.create(filteredItem, { transaction });
                    results.push({ index: i, action: 'created', data: created });
                    createdCount++;
                }
                await transaction.commit();
                
                const result = {
                    success: true,
                    message: `Processing complete: ${results.length} created`,
                    processed: results.length,
                    failed: 0,
                    total: req.body.data.length,
                    created: createdCount,
                    updated: 0,
                    results: results
                };
                
                req._processingStats = {
                    total: req.body.data.length,
                    created: createdCount,
                    updated: 0,
                    deleted: 0,
                    failed: 0
                };
                
                await notifyBatchSync(req, Gastos, result);
                return res.status(200).json(result);
            } catch (err) {
                await transaction.rollback();
                throw err;
            }
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            // gastos는 항상 INSERT만 수행 (id_ga는 sequence로 자동 생성)
            const sequelize = Gastos.sequelize;
            const transaction = await sequelize.transaction();
            const results = [];
            let createdCount = 0;
            
            try {
                for (let i = 0; i < req.body.data.length; i++) {
                    const item = req.body.data[i];
                    const cleanedItem = removeSyncField(item);
                    const filteredItem = filterModelFields(Gastos, cleanedItem);
                    // id_ga는 sequence로 자동 생성되므로 제거
                    delete filteredItem.id_ga;
                    const created = await Gastos.create(filteredItem, { transaction });
                    results.push({ index: i, action: 'created', data: created });
                    createdCount++;
                }
                await transaction.commit();
                
                const result = {
                    success: true,
                    message: `Processing complete: ${results.length} created`,
                    processed: results.length,
                    failed: 0,
                    total: req.body.data.length,
                    created: createdCount,
                    updated: 0,
                    results: results
                };
                
                req._processingStats = {
                    total: req.body.data.length,
                    created: createdCount,
                    updated: 0,
                    deleted: 0,
                    failed: 0
                };
                
                await notifyBatchSync(req, Gastos, result);
                return res.status(200).json(result);
            } catch (err) {
                await transaction.rollback();
                throw err;
            }
        }
        
        // 일반 단일 생성 요청 처리 (gastos는 항상 INSERT만 수행)
        const rawData = req.body.new_data || req.body;
        const cleanedData = removeSyncField(rawData);
        const filteredItem = filterModelFields(Gastos, cleanedData);
        // id_ga는 sequence로 자동 생성되므로 제거
        delete filteredItem.id_ga;
        
        const created = await Gastos.create(filteredItem);
        await notifyDbChange(req, Gastos, 'create', created);
        const result = { action: 'created', data: created };
        await notifyDbChange(req, Gastos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
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

