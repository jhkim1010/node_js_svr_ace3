const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Tipos = getModelForRequest(req, 'Tipos');
        const records = await Tipos.findAll({ limit: 100, order: [['id_tipo', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list tipos', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Tipos = getModelForRequest(req, 'Tipos');
        const record = await Tipos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch tipo', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Tipos = getModelForRequest(req, 'Tipos');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // tipos는 tpcodigo만 기본 키로 사용
            const result = await handleBatchSync(req, res, Tipos, 'tpcodigo', 'Tipos');
            await notifyBatchSync(req, Tipos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Tipos, 'tpcodigo', 'Tipos');
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Tipos, 'tpcodigo', 'Tipos');
            await notifyBatchSync(req, Tipos, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Tipos, 'tpcodigo', 'Tipos');
        await notifyDbChange(req, Tipos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        console.error('\nERROR: Tipos creation error:', err);
        res.status(400).json({ 
            error: 'Failed to create tipo', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Tipos = getModelForRequest(req, 'Tipos');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Tipos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Tipos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Tipos.update(dataToUpdate, { where: { tpcodigo: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Tipos.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Tipos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update tipo', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Tipos = getModelForRequest(req, 'Tipos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Tipos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Tipos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Tipos.destroy({ where: { tpcodigo: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Tipos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete tipo', details: err.message });
    }
});

module.exports = router;

