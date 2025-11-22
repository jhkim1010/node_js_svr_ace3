const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { classifyError } = require('../utils/error-classifier');

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
        res.status(500).json({ 
            error: 'Failed to list gastos', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
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
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Gastos, 'id_ga', 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Gastos, 'id_ga', 'Gastos');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Gastos, 'id_ga', 'Gastos');
        await notifyDbChange(req, Gastos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        const errorMsg = err.original ? err.original.message : err.message;
        const errorClassification = classifyError(err);
        
        // Primary key 또는 unique constraint 위반인 경우 더 명확한 메시지 표시
        const isConstraintError = err.constructor.name.includes('UniqueConstraintError') || 
                                   errorMsg.includes('duplicate key') || 
                                   errorMsg.includes('unique constraint');
        
        if (isConstraintError) {
            // constraint 이름에서 실제 위반된 컬럼 파악
            const constraintMatch = errorMsg.match(/constraint "([^"]+)"/);
            const constraintName = constraintMatch ? constraintMatch[1] : null;
            
            // primary key 제약 조건인 경우
            if (constraintName === 'gastos.pr' || errorMsg.includes('gastos.pr')) {
                console.error(`ERROR: Gastos INSERT/UPDATE failed [${errorClassification.source}]: Primary key (id_ga) duplicate`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: The id_ga value already exists in the database. Use UPDATE instead of INSERT, or use a different id_ga value.`);
                if (req.body && req.body.id_ga !== undefined) {
                    console.error(`   Attempted id_ga value: ${req.body.id_ga}`);
                }
            } else {
                console.error(`ERROR: Gastos INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
                if (constraintName) {
                    console.error(`   Constraint Name: ${constraintName}`);
                }
            }
        } else if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            // Validation error인 경우 상세 정보 표시
            console.error(`ERROR: Gastos INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
            err.errors.forEach((validationError, index) => {
                console.error(`   [${index + 1}] Column: ${validationError.path}`);
                console.error(`       Value: ${validationError.value !== undefined && validationError.value !== null ? JSON.stringify(validationError.value) : 'null'}`);
                console.error(`       Error Type: ${validationError.type || 'N/A'}`);
                console.error(`       Validator: ${validationError.validatorKey || validationError.validatorName || 'N/A'}`);
                console.error(`       Message: ${validationError.message}`);
                if (validationError.validatorArgs && validationError.validatorArgs.length > 0) {
                    console.error(`       Validator Args: ${JSON.stringify(validationError.validatorArgs)}`);
                }
            });
        } else {
            console.error(`ERROR: Gastos INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
        }
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
        // b_sincronizado_node_svr 필드 제거
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

