const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleVcodesBatchSync, handleVcodesArrayData } = require('../utils/vcodes-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const records = await Vcode.findAll({ limit: 100, order: [['vcode_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list vcodes', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const record = await Vcode.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch vcode', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // BATCH_SYNC 작업 처리 (Vcodes 전용 핸들러 사용)
        // vcodes는 vcode_id와 sucursal의 복합 unique key를 사용
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleVcodesBatchSync(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도) (Vcodes 전용 핸들러 사용)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleVcodesArrayData(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (복합 unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
        await notifyDbChange(req, Vcode, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Vcode', ['vcode_id', 'sucursal'], 'vcodes');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create vcode');
        
        // 외래키 제약 조건 위반 감지 및 정보 추가
        const errorMsg = err.original ? err.original.message : err.message;
        const isForeignKeyError = err.constructor.name.includes('ForeignKeyConstraintError') ||
                                 errorMsg.includes('foreign key constraint') ||
                                 errorMsg.includes('violates foreign key') ||
                                 errorMsg.includes('is not present in table');
        
        if (isForeignKeyError) {
            const keyMatch = errorMsg.match(/Key \(([^)]+)\)=\(([^)]+)\)/i);
            const tableMatch = errorMsg.match(/is not present in table ['"]([^'"]+)['"]/i) ||
                              errorMsg.match(/table ['"]([^'"]+)['"]/i);
            const constraintMatch = errorMsg.match(/constraint ['"]([^'"]+)['"]/i);
            
            if (keyMatch && tableMatch) {
                errorResponse.foreignKeyError = {
                    column: keyMatch[1].trim(),
                    value: keyMatch[2].trim(),
                    referencedTable: tableMatch[1],
                    constraintName: constraintMatch ? constraintMatch[1] : null
                };
            }
        }
        
        // Validation 에러인 경우 상세 정보 추가
        if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            errorResponse.validationErrors = err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message,
                type: e.type,
                validator: e.validatorKey || e.validatorName
            }));
            
            // 누락된 필수 컬럼 목록 추가
            const missingColumns = err.errors
                .filter(e => e.type === 'notNull Violation' || 
                           e.message?.toLowerCase().includes('cannot be null'))
                .map(e => e.path);
            if (missingColumns.length > 0) {
                errorResponse.missingColumns = missingColumns;
            }
        }
        
        res.status(400).json(errorResponse);
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우) - Vcodes 전용 핸들러 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleVcodesArrayData, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vcode, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vcode.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Vcode.update(dataToUpdate, { where: { vcode_id: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Vcode.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Vcode, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update vcode', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vcode.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Vcode.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Vcode.destroy({ where: { vcode_id: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Vcode, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete vcode', details: err.message });
    }
});

module.exports = router;


