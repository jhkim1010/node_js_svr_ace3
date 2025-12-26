const { Router } = require('express');
const { Op, Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        // req가 undefined일 수 있으므로 안전하게 처리
        if (!req) {
            return res.status(500).json({ error: 'Invalid request object' });
        }
        
        const Cuentas = getModelForRequest(req, 'Cuentas');
        
        // req.query와 req.body가 undefined일 수 있으므로 안전하게 처리
        const query = (req && req.query) ? req.query : {};
        const body = (req && req.body) ? req.body : {};
        
        // all 파라미터 확인 (모든 데이터 반환)
        const all = (query && query.all === 'true') || (body && body.all === 'true');
        
        if (all) {
            // 모든 데이터 반환 (borrado=false인 것만)
            const records = await Cuentas.findAll({ 
                where: { borrado: false },
                order: [['id_cuenta', 'ASC']] 
            });
            
            // 응답 로거에서 사용할 데이터 개수 저장
            req._responseDataCount = records.length;
            
            res.json({
                data: records,
                total: records.length
            });
            return;
        }
        
        // last_get_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        const lastGetUtime = body.last_get_utime || query.last_get_utime;
        
        // 검색어 파라미터 확인
        const filteringWord = body.filtering_word || query.filtering_word || body.filteringWord || query.filteringWord || body.search || query.search;
        
        let whereCondition = {};
        
        // last_get_utime이 있으면 utime 필터 추가 (문자열 비교로 timezone 변환 방지)
        if (lastGetUtime) {
            // ISO 8601 형식의 'T'를 공백으로 변환하고 시간대 정보 제거
            let utimeStr = String(lastGetUtime);
            utimeStr = utimeStr.replace(/T/, ' ').replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
            // utime::text > 'last_get_utime' 조건 추가 (문자열 비교)
            whereCondition[Op.and] = [
                Sequelize.literal(`utime::text > '${utimeStr.replace(/'/g, "''")}'`)
            ];
        }
        
        // FilteringWord 검색 조건 추가 (cuenta_nombre에서 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereCondition[Op.and] = [
                ...(whereCondition[Op.and] || []),
                {
                    [Op.or]: [
                        { cuenta_nombre: { [Op.iLike]: searchTerm } }
                    ]
                }
            ];
        }
        
        // borrado 필터 추가
        whereCondition.borrado = false;
        
        // 총 데이터 개수 조회
        const totalCount = await Cuentas.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Cuentas.findAll({ 
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_cuenta', 'ASC']] 
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 id_cuenta)
        let nextMaxUtime = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_cuenta !== null && lastRecord.id_cuenta !== undefined) {
                // id_cuenta 값을 문자열로 변환하여 반환
                nextMaxUtime = String(lastRecord.id_cuenta);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                nextMaxUtime: nextMaxUtime
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error('[Cuentas GET] 오류:', err);
        console.error('[Cuentas GET] 요청 정보:', {
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            hasDbConfig: !!req.dbConfig
        });
        res.status(500).json({ 
            error: 'Failed to list cuentas', 
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Cuentas = getModelForRequest(req, 'Cuentas');
        const record = await Cuentas.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch cuenta', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Cuentas = getModelForRequest(req, 'Cuentas');
        
        // BATCH_SYNC 작업 처리
        // cuentas는 primary key 충돌 시 utime 비교를 통해 update/skip 결정
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Cuentas, 'id_cuenta', 'Cuentas');
            await notifyBatchSync(req, Cuentas, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        // cuentas는 utime 비교가 필요하므로 utime 비교 핸들러 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || req.body.trigger_operation || 'UPDATE';
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Cuentas, 'id_cuenta', 'Cuentas');
            await notifyBatchSync(req, Cuentas, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 utime 비교 핸들러 사용
            req.body.data = rawData;
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Cuentas, 'id_cuenta', 'Cuentas');
            await notifyBatchSync(req, Cuentas, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (utime 비교 핸들러 사용)
        // 단일 항목도 배열로 변환하여 utime 비교 핸들러 사용
        req.body.data = [rawData];
        const result = await handleUtimeComparisonArrayData(req, res, Cuentas, 'id_cuenta', 'Cuentas');
        const singleResult = result.results && result.results.length > 0 ? result.results[0] : null;
        if (singleResult) {
            await notifyDbChange(req, Cuentas, singleResult.action === 'created' ? 'create' : singleResult.action === 'updated' ? 'update' : 'skip', singleResult.data);
            res.status(singleResult.action === 'created' ? 201 : singleResult.action === 'updated' ? 200 : 200).json(singleResult.data);
            return;
        }
        throw new Error('Failed to process cuenta');
    } catch (err) {
        handleInsertUpdateError(err, req, 'Cuentas', 'id_cuenta', 'cuentas');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create cuenta');
        
        // Validation 에러인 경우 상세 정보 추가
        if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            errorResponse.validationErrors = err.errors.map(e => ({
                field: e.path,
                message: e.message,
                value: e.value
            }));
        }
        
        res.status(errorResponse.status || 500).json(errorResponse);
    }
});

router.put('/:id', async (req, res) => {
    try {
        const Cuentas = getModelForRequest(req, 'Cuentas');
        const id = req.params.id;
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Cuentas, cleanedData);
        
        const sequelize = Cuentas.sequelize;
        await sequelize.transaction(async (transaction) => {
            const [count] = await Cuentas.update(dataToUpdate, { 
                where: { id_cuenta: id }, 
                transaction 
            });
            
            if (count === 0) {
                return res.status(404).json({ error: 'Not found' });
            }
            
            const updated = await Cuentas.findByPk(id, { transaction });
            await notifyDbChange(req, Cuentas, 'update', updated);
            res.json(updated);
        });
    } catch (err) {
        handleInsertUpdateError(err, req, 'Cuentas', 'id_cuenta', 'cuentas');
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const Cuentas = getModelForRequest(req, 'Cuentas');
        const id = req.params.id;
        const sequelize = Cuentas.sequelize;
        
        await sequelize.transaction(async (transaction) => {
            const toDelete = await Cuentas.findByPk(id, { transaction });
            if (!toDelete) {
                return res.status(404).json({ error: 'Not found' });
            }
            
            const count = await Cuentas.destroy({ 
                where: { id_cuenta: id }, 
                transaction 
            });
            
            await notifyDbChange(req, Cuentas, 'delete', toDelete);
            res.json({ message: 'Deleted', count });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete cuenta', details: err.message });
    }
});

module.exports = router;

