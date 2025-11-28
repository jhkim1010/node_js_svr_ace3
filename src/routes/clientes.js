const { Router } = require('express');
const { Op, Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');
const { validateTableAndSchema, logTableAndSchema } = require('../utils/table-schema-validator');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        
        // max_id 파라미터 확인 (id 기반 페이징용)
        const maxId = req.body?.max_id || req.query?.max_id;
        
        // last_get_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        const lastGetUtime = req.body?.last_get_utime || req.query?.last_get_utime;
        
        let whereCondition = {};
        
        // max_id가 있으면 id > maxId 조건 추가 (id 기반 페이징)
        if (maxId) {
            const maxIdNum = parseInt(maxId, 10);
            if (!isNaN(maxIdNum)) {
                whereCondition.id = {
                    [Op.gt]: maxIdNum
                };
            }
        }
        
        // last_get_utime이 있으면 utime 필터 추가 (문자열 비교로 timezone 변환 방지)
        if (lastGetUtime) {
            // ISO 8601 형식의 'T'를 공백으로 변환하고 시간대 정보 제거
            let utimeStr = String(lastGetUtime);
            utimeStr = utimeStr.replace(/T/, ' ').replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
            // utime::text > 'last_get_utime' 조건 추가 (문자열 비교)
            if (whereCondition[Op.and]) {
                whereCondition[Op.and].push(Sequelize.literal(`utime::text > '${utimeStr.replace(/'/g, "''")}'`));
            } else {
                whereCondition[Op.and] = [
                    Sequelize.literal(`utime::text > '${utimeStr.replace(/'/g, "''")}'`)
                ];
            }
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Clientes.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Clientes.findAll({ 
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id', 'ASC']] // id 기반 정렬로 놓치는 정보 없게
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_id 계산 (마지막 레코드의 id)
        let nextMaxId = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id !== null && lastRecord.id !== undefined) {
                // id 값을 문자열로 변환하여 반환
                nextMaxId = String(lastRecord.id);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                nextMaxId: nextMaxId // id 기반 페이징을 위한 nextMaxId
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list clientes', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        const record = await Clientes.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch cliente', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        
        // BATCH_SYNC 작업 처리 (utime 비교 사용)
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // table과 schema 검증 및 로깅
            const validation = validateTableAndSchema(req, 'clientes', 'Clientes');
            logTableAndSchema(req, 'clientes', 'Clientes');
            
            // 경고가 있으면 로그 출력
            if (validation.warnings.length > 0) {
                validation.warnings.forEach(warning => {
                    console.warn(`[WARNING] ${warning.field}: ${warning.message}`);
                });
            }
            
            // clientes는 utime 비교를 사용하여 insert/update/skip 결정
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Clientes, 'dni', 'Clientes');
            await notifyBatchSync(req, Clientes, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (utime 비교 사용)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // utime 비교를 사용하여 insert/update/skip 결정
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Clientes, 'dni', 'Clientes');
            await notifyBatchSync(req, Clientes, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우, utime 비교 사용)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 utime 비교를 사용하여 처리
            req.body.data = rawData;
            req.body.operation = req.body.operation || 'UPDATE';
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Clientes, 'dni', 'Clientes');
            await notifyBatchSync(req, Clientes, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Clientes, 'dni', 'Clientes');
        await notifyDbChange(req, Clientes, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Clientes', 'dni', 'clientes');
        res.status(400).json({ 
            error: 'Failed to create cliente', 
            details: err.message,
            errorType: err.constructor.name,
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우, utime 비교 사용)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // utime 비교를 사용하여 insert/update/skip 결정
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Clientes, 'dni', 'Clientes');
            await notifyBatchSync(req, Clientes, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Clientes, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Clientes.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Clientes.update(dataToUpdate, { where: { dni: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Clientes.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Clientes, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update cliente', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Clientes = getModelForRequest(req, 'Clientes');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Clientes.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Clientes.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Clientes.destroy({ where: { dni: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Clientes, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete cliente', details: err.message });
    }
});

module.exports = router;

