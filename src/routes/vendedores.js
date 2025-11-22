const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vendedores = getModelForRequest(req, 'Vendedores');
        const records = await Vendedores.findAll({ limit: 100, order: [['vnombre', 'ASC']] });
        res.json(records);
    } catch (err) {
        console.error('\nERROR: Vendedores fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        res.status(500).json({ 
            error: 'Failed to list vendedores', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vendedores = getModelForRequest(req, 'Vendedores');
        // vnombre이 primary key이므로 vnombre으로 조회
        const record = await Vendedores.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch vendedor', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Vendedores = getModelForRequest(req, 'Vendedores');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Vendedores, 'vnombre', 'Vendedores');
            await notifyBatchSync(req, Vendedores, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Vendedores, 'vnombre', 'Vendedores');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Vendedores, 'vnombre', 'Vendedores');
        await notifyDbChange(req, Vendedores, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Vendedores', 'vnombre', 'vendedores');
        res.status(400).json({ 
            error: 'Failed to create vendedor', 
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
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vendedores = getModelForRequest(req, 'Vendedores');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vendedores, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vendedores.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Vendedores.update(dataToUpdate, { where: { vnombre: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Vendedores.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Vendedores, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update vendedor', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vendedores = getModelForRequest(req, 'Vendedores');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vendedores.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Vendedores.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Vendedores.destroy({ where: { vnombre: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Vendedores, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vendedor', details: err.message });
    }
});

module.exports = router;

