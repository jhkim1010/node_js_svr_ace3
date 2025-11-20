const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleVdetalleBatchSync, handleVdetalleArrayData } = require('../utils/vdetalle-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

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
        
        // BATCH_SYNC 작업 처리 (Vdetalle 전용 핸들러 사용)
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleVdetalleBatchSync(req, res, Vdetalle, 'id_vdetalle', 'Vdetalle');
            await notifyBatchSync(req, Vdetalle, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도) (Vdetalle 전용 핸들러 사용)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleVdetalleArrayData(req, res, Vdetalle, 'id_vdetalle', 'Vdetalle');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Vdetalle, 'id_vdetalle', 'Vdetalle');
        await notifyDbChange(req, Vdetalle, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        const errorMsg = err.original ? err.original.message : err.message;
        if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            // Validation error인 경우 상세 정보 표시
            console.error(`ERROR: Vdetalle INSERT/UPDATE failed: ${errorMsg}`);
            err.errors.forEach((validationError) => {
                console.error(`   Column: ${validationError.path} | Value: ${validationError.value || 'null'} | Error: ${validationError.message}`);
            });
        } else {
            console.error(`ERROR: Vdetalle INSERT/UPDATE failed: ${errorMsg}`);
        }
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
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vdetalle, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vdetalle.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Vdetalle.update(dataToUpdate, { where: { id_vdetalle: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Vdetalle.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Vdetalle, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
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
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vdetalle.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Vdetalle.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Vdetalle.destroy({ where: { id_vdetalle: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Vdetalle, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vdetalle', details: err.message });
    }
});

module.exports = router;


