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
// tipos.js와 동일한 Map을 공유하기 위해 전역으로 이동 필요
// 대신 각 파일에서 독립적으로 처리하되, 짧은 시간 내에 두 요청이 오는지 확인

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
        const Temporadas = getModelForRequest(req, 'Temporadas');
        
        // all 파라미터 확인 (모든 데이터 반환)
        const all = req.query.all === 'true' || req.body.all === 'true';
        
        if (all) {
            // 모든 데이터 반환 (borrado=false인 것만)
            const records = await Temporadas.findAll({ 
                where: { borrado: false },
                order: [['id_temporada', 'ASC']] 
            });
            
            // 응답 로거에서 사용할 데이터 개수 저장
            req._responseDataCount = records.length;
            
            // temporadas 데이터 개수 로깅 (tipos와 함께 한 줄로 출력하기 위해)
            const dbName = req.dbConfig ? `[${req.dbConfig.database}]` : '';
            logCombinedTiposTemporadas(dbName, null, records.length);
            
            res.json({
                data: records,
                total: records.length
            });
            return;
        }
        
        // last_get_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        const lastGetUtime = req.body?.last_get_utime || req.query?.last_get_utime;
        
        // 검색어 파라미터 확인
        const filteringWord = req.body?.filtering_word || req.query?.filtering_word || req.body?.filteringWord || req.query?.filteringWord || req.body?.search || req.query?.search;
        
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
        
        // FilteringWord 검색 조건 추가 (temporada_nombre에서 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereCondition[Op.and] = [
                ...(whereCondition[Op.and] || []),
                {
                    [Op.or]: [
                        { temporada_nombre: { [Op.iLike]: searchTerm } }
                    ]
                }
            ];
        }
        
        // borrado 필터 추가
        whereCondition.borrado = false;
        
        // 총 데이터 개수 조회
        const totalCount = await Temporadas.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Temporadas.findAll({ 
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_temporada', 'ASC']] 
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 id_temporada)
        let nextMaxUtime = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_temporada !== null && lastRecord.id_temporada !== undefined) {
                // id_temporada 값을 문자열로 변환하여 반환
                nextMaxUtime = String(lastRecord.id_temporada);
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
        
        // temporadas 데이터 개수 로깅 (tipos와 함께 한 줄로 출력하기 위해)
        const dbName = req.dbConfig ? `[${req.dbConfig.database}]` : '';
        logCombinedTiposTemporadas(dbName, null, data.length);
        
        res.json(responseData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list temporadas', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Temporadas = getModelForRequest(req, 'Temporadas');
        const record = await Temporadas.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch temporada', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Temporadas = getModelForRequest(req, 'Temporadas');
        const cleanedData = removeSyncField(req.body);
        const dataToCreate = filterModelFields(Temporadas, cleanedData);
        
        const record = await Temporadas.create(dataToCreate);
        await notifyDbChange(req, Temporadas, 'create', record);
        res.status(201).json(record);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Temporadas', 'id_temporada', 'temporadas');
    }
});

router.put('/:id', async (req, res) => {
    try {
        const Temporadas = getModelForRequest(req, 'Temporadas');
        const id = req.params.id;
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Temporadas, cleanedData);
        
        const sequelize = Temporadas.sequelize;
        await sequelize.transaction(async (transaction) => {
            const [count] = await Temporadas.update(dataToUpdate, { 
                where: { id_temporada: id }, 
                transaction 
            });
            
            if (count === 0) {
                return res.status(404).json({ error: 'Not found' });
            }
            
            const updated = await Temporadas.findByPk(id, { transaction });
            await notifyDbChange(req, Temporadas, 'update', updated);
            res.json(updated);
        });
    } catch (err) {
        handleInsertUpdateError(err, req, 'Temporadas', 'id_temporada', 'temporadas');
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const Temporadas = getModelForRequest(req, 'Temporadas');
        const id = req.params.id;
        const sequelize = Temporadas.sequelize;
        
        await sequelize.transaction(async (transaction) => {
            const toDelete = await Temporadas.findByPk(id, { transaction });
            if (!toDelete) {
                return res.status(404).json({ error: 'Not found' });
            }
            
            const count = await Temporadas.destroy({ 
                where: { id_temporada: id }, 
                transaction 
            });
            
            await notifyDbChange(req, Temporadas, 'delete', toDelete);
            res.json({ message: 'Deleted', count });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete temporada', details: err.message });
    }
});

module.exports = router;

