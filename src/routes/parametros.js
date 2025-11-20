const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const records = await Parametros.findAll({ limit: 100 });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list parametros', details: err.message });
    }
});

router.get('/:progname/:pname/:opcion', async (req, res) => {
    const { progname, pname, opcion } = req.params;
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const record = await Parametros.findOne({ where: { progname, pname, opcion } });
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch parametro', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        
        // BATCH_SYNC 작업 처리 (복합키: progname, pname, opcion)
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Parametros, ['progname', 'pname', 'opcion'], 'Parametros');
            await notifyBatchSync(req, Parametros, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Parametros, ['progname', 'pname', 'opcion'], 'Parametros');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Parametros, ['progname', 'pname', 'opcion'], 'Parametros');
        await notifyDbChange(req, Parametros, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        console.error('\n❌ Parametros creation error:', err);
        res.status(400).json({ 
            error: 'Failed to create parametro', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:progname/:pname/:opcion', async (req, res) => {
    const { progname, pname, opcion } = req.params;
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Parametros, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Parametros.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Parametros.update(dataToUpdate, { where: { progname, pname, opcion }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Parametros.findOne({ where: { progname, pname, opcion }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Parametros, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update parametro', details: err.message });
    }
});

router.delete('/:progname/:pname/:opcion', async (req, res) => {
    const { progname, pname, opcion } = req.params;
    try {
        const Parametros = getModelForRequest(req, 'Parametros');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Parametros.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Parametros.findOne({ where: { progname, pname, opcion }, transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Parametros.destroy({ where: { progname, pname, opcion }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Parametros, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete parametro', details: err.message });
    }
});

module.exports = router;


