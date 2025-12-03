const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const records = await Ingresos.findAll({ limit: 100, order: [['ingreso_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list ingresos', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const record = await Ingresos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch ingreso', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        
        // BATCH_SYNC 또는 배열 데이터 처리 (utime 비교를 통한 UPDATE/SKIP 결정)
        // Ingresos는 복합 unique key ['ingreso_id', 'sucursal'] 사용
        if ((req.body.operation === 'BATCH_SYNC' || Array.isArray(req.body.data)) && Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleUtimeComparisonArrayData(req, res, Ingresos, ['ingreso_id', 'sucursal'], 'Ingresos');
            await notifyBatchSync(req, Ingresos, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (배열로 변환하여 utime 비교 핸들러 사용)
        const singleItem = req.body.new_data || req.body;
        req.body.data = [singleItem];
        req.body.operation = req.body.operation || 'BATCH_SYNC';
        const result = await handleUtimeComparisonArrayData(req, res, Ingresos, ['ingreso_id', 'sucursal'], 'Ingresos');
        
        if (result.results && result.results.length > 0) {
            const firstResult = result.results[0];
            await notifyDbChange(req, Ingresos, firstResult.action === 'created' ? 'create' : (firstResult.action === 'updated' ? 'update' : 'skip'), firstResult.data);
            res.status(firstResult.action === 'created' ? 201 : 200).json(firstResult.data);
        } else {
            throw new Error('Failed to process ingreso');
        }
    } catch (err) {
        handleInsertUpdateError(err, req, 'Ingresos', ['ingreso_id', 'sucursal'], 'ingresos');
        
        // 더 상세한 오류 정보 추출
        const errorMsg = err.original ? err.original.message : err.message;
        const errorCode = err.original ? err.original.code : err.code;
        const constraintMatch = errorMsg ? errorMsg.match(/constraint "([^"]+)"/) : null;
        const constraintName = constraintMatch ? constraintMatch[1] : null;
        
        // 요청 데이터에서 primary key 값 추출
        const bodyData = req.body.new_data || req.body.data || req.body;
        let attemptedKeys = null;
        if (bodyData) {
            const dataToCheck = Array.isArray(bodyData) ? bodyData[0] : bodyData;
            if (dataToCheck && typeof dataToCheck === 'object') {
                attemptedKeys = {
                    ingreso_id: dataToCheck.ingreso_id !== undefined ? dataToCheck.ingreso_id : null,
                    sucursal: dataToCheck.sucursal !== undefined ? dataToCheck.sucursal : null
                };
            }
        }
        
        // 오류 응답 구성
        const errorResponse = {
            error: 'Failed to create ingreso',
            details: errorMsg,
            errorType: err.constructor.name,
            errorCode: errorCode || null,
            constraintName: constraintName || null,
            attemptedKeys: attemptedKeys,
            primaryKey: ['ingreso_id', 'sucursal'],
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined
        };
        
        // constraint 관련 추가 정보
        if (constraintName === 'ingreso.pr' || constraintName === 'ingresos_ingreso_id_sucursal_uniq') {
            errorResponse.constraintType = constraintName === 'ingreso.pr' ? 'primary_key' : 'unique_key';
            errorResponse.message = constraintName === 'ingreso.pr' 
                ? 'Primary key (ingreso_id) already exists. The system will attempt to update the existing record based on utime comparison.'
                : 'Unique key (ingreso_id, sucursal) already exists. The system will attempt to update the existing record based on utime comparison.';
        }
        
        res.status(400).json(errorResponse);
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우, utime 비교를 통한 UPDATE/SKIP 결정)
        // Ingresos는 복합 unique key ['ingreso_id', 'sucursal'] 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Ingresos, ['ingreso_id', 'sucursal'], 'Ingresos');
            await notifyBatchSync(req, Ingresos, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Ingresos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Ingresos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Ingresos.update(dataToUpdate, { where: { ingreso_id: id }, transaction });
            if (count === 0) {
                if (transaction && !transaction.finished) {
                    await transaction.rollback();
                }
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Ingresos.findByPk(id, { transaction });
            if (transaction && !transaction.finished) {
                await transaction.commit();
            }
            await notifyDbChange(req, Ingresos, 'update', updated);
            res.json(updated);
        } catch (err) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update ingreso', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Ingresos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Ingresos.findByPk(id, { transaction });
            if (!toDelete) {
                if (transaction && !transaction.finished) {
                    await transaction.rollback();
                }
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Ingresos.destroy({ where: { ingreso_id: id }, transaction });
            if (transaction && !transaction.finished) {
                await transaction.commit();
            }
            await notifyDbChange(req, Ingresos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete ingreso', details: err.message });
    }
});

module.exports = router;

