const { Router } = require('express');
const { Op, Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');

const router = Router();

// tipos와 temporadas 요청을 한 줄로 출력하기 위한 공유 상태
// 대기 시간 (ms) - 이 시간 내에 두 요청이 모두 오면 한 줄로 출력
const WAIT_TIME = 200;

// 전역 상태 (두 파일에서 공유)
if (!global._tiposTemporadasPending) {
    global._tiposTemporadasPending = new Map();
}

function logCombinedTiposTemporadas(dbName, tiposCount, temporadasCount) {
    const key = dbName || 'default';
    const now = Date.now();
    
    // 현재 상태 확인
    const current = global._tiposTemporadasPending.get(key);
    
    if (tiposCount !== null && tiposCount !== undefined) {
        // tipos 요청 완료
        if (current && current.temporadas !== null && current.temporadas !== undefined) {
            // temporadas가 이미 완료됨 - 한 줄로 출력
            console.log(`✅ ${key} Tipos: ${tiposCount}개 | Temporadas: ${current.temporadas}개`);
            global._tiposTemporadasPending.delete(key);
        } else {
            // temporadas 대기 중
            global._tiposTemporadasPending.set(key, { tipos: tiposCount, temporadas: null, timestamp: now });
            setTimeout(() => {
                const pending = global._tiposTemporadasPending.get(key);
                if (pending && pending.temporadas === null) {
                    // temporadas가 아직 오지 않음 - 개별 출력
                    console.log(`✅ ${key} Tipos: ${pending.tipos}개`);
                    global._tiposTemporadasPending.delete(key);
                }
            }, WAIT_TIME);
        }
    } else if (temporadasCount !== null && temporadasCount !== undefined) {
        // temporadas 요청 완료
        if (current && current.tipos !== null && current.tipos !== undefined) {
            // tipos가 이미 완료됨 - 한 줄로 출력
            console.log(`✅ ${key} Tipos: ${current.tipos}개 | Temporadas: ${temporadasCount}개`);
            global._tiposTemporadasPending.delete(key);
        } else {
            // tipos 대기 중
            global._tiposTemporadasPending.set(key, { tipos: null, temporadas: temporadasCount, timestamp: now });
            setTimeout(() => {
                const pending = global._tiposTemporadasPending.get(key);
                if (pending && pending.tipos === null) {
                    // tipos가 아직 오지 않음 - 개별 출력
                    console.log(`✅ ${key} Temporadas: ${pending.temporadas}개`);
                    global._tiposTemporadasPending.delete(key);
                }
            }, WAIT_TIME);
        }
    }
}

router.get('/', async (req, res) => {
    try {
        // req가 undefined일 수 있으므로 안전하게 처리
        if (!req) {
            return res.status(500).json({ error: 'Invalid request object' });
        }
        
        const Tipos = getModelForRequest(req, 'Tipos');
        
        // req.query와 req.body가 undefined일 수 있으므로 안전하게 처리
        const query = (req && req.query) ? req.query : {};
        const body = (req && req.body) ? req.body : {};
        
        // all 파라미터 확인 (모든 데이터 반환)
        const all = (query && query.all === 'true') || (body && body.all === 'true');
        
        if (all) {
            // 모든 데이터 반환 (borrado=false인 것만)
            const records = await Tipos.findAll({ 
                where: { borrado: false },
                order: [['id_tipo', 'ASC']] 
            });
            
            // 응답 로거에서 사용할 데이터 개수 저장
            req._responseDataCount = records.length;
            
            // tipos 데이터 개수 로깅 (temporadas와 함께 한 줄로 출력하기 위해)
            const dbName = req.dbConfig ? `[${req.dbConfig.database}]` : '';
            logCombinedTiposTemporadas(dbName, records.length, null);
            
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
        
        // FilteringWord 검색 조건 추가 (tpcodigo 또는 tpdesc에서 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereCondition[Op.and] = [
                ...(whereCondition[Op.and] || []),
                {
                    [Op.or]: [
                        { tpcodigo: { [Op.iLike]: searchTerm } },
                        { tpdesc: { [Op.iLike]: searchTerm } }
                    ]
                }
            ];
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Tipos.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Tipos.findAll({ 
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_tipo', 'ASC']] 
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 id_tipo)
        let nextMaxUtime = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_tipo !== null && lastRecord.id_tipo !== undefined) {
                // id_tipo 값을 문자열로 변환하여 반환
                nextMaxUtime = String(lastRecord.id_tipo);
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
        
        // tipos 데이터 개수 로깅 (temporadas와 함께 한 줄로 출력하기 위해)
        const dbName = req.dbConfig ? `[${req.dbConfig.database}]` : '';
        logCombinedTiposTemporadas(dbName, data.length, null);
        
        res.json(responseData);
    } catch (err) {
        console.error('[Tipos GET] 오류:', err);
        console.error('[Tipos GET] 요청 정보:', {
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            hasDbConfig: !!req.dbConfig
        });
        res.status(500).json({ 
            error: 'Failed to list tipos', 
            details: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
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
        // tipos는 primary key 충돌 시 utime 비교를 통해 update/skip 결정
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Tipos, 'tpcodigo', 'Tipos');
            await notifyBatchSync(req, Tipos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        // tipos는 utime 비교가 필요하므로 utime 비교 핸들러 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Tipos, 'tpcodigo', 'Tipos');
            await notifyBatchSync(req, Tipos, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 utime 비교 핸들러 사용
            req.body.data = rawData;
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Tipos, 'tpcodigo', 'Tipos');
            await notifyBatchSync(req, Tipos, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (utime 비교 핸들러 사용)
        // 단일 항목도 배열로 변환하여 utime 비교 핸들러 사용
        req.body.data = [rawData];
        const result = await handleUtimeComparisonArrayData(req, res, Tipos, 'tpcodigo', 'Tipos');
        const singleResult = result.results && result.results.length > 0 ? result.results[0] : null;
        if (singleResult) {
            await notifyDbChange(req, Tipos, singleResult.action === 'created' ? 'create' : singleResult.action === 'updated' ? 'update' : 'skip', singleResult.data);
            res.status(singleResult.action === 'created' ? 201 : singleResult.action === 'updated' ? 200 : 200).json(singleResult.data);
            return;
        }
        throw new Error('Failed to process tipo');
    } catch (err) {
        handleInsertUpdateError(err, req, 'Tipos', 'tpcodigo', 'tipos');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create tipo');
        
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
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Tipos = getModelForRequest(req, 'Tipos');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, Tipos, 'tpcodigo', 'Tipos');
            await notifyBatchSync(req, Tipos, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
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

