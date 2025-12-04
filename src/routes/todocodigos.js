const { Router } = require('express');
const { Op, Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { diagnoseConnectionRefusedError } = require('../utils/error-classifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const sequelize = Todocodigos.sequelize;
        
        // id_todocodigo 파라미터 확인 (페이지네이션용, 첫 요청에는 없음)
        const idTodocodigo = req.body?.id_todocodigo || req.query?.id_todocodigo;
        
        // last_get_utime 파라미터 확인 (바디 또는 쿼리 파라미터, 호환성 유지)
        const lastGetUtime = req.body?.last_get_utime || req.query?.last_get_utime;
        
        // 검색 및 정렬 파라미터 확인
        const filteringWord = req.body?.filtering_word || req.query?.filtering_word || req.body?.filteringWord || req.query?.filteringWord || req.body?.search || req.query?.search;
        const sortColumn = req.body?.sort_column || req.query?.sort_column || req.body?.sortBy || req.query?.sortBy;
        const sortAscending = req.body?.sort_ascending !== undefined 
            ? (req.body?.sort_ascending === 'true' || req.body?.sort_ascending === true)
            : (req.query?.sort_ascending !== undefined 
                ? (req.query?.sort_ascending === 'true' || req.query?.sort_ascending === true)
                : (req.body?.sortOrder || req.query?.sortOrder 
                    ? (req.body?.sortOrder || req.query?.sortOrder).toUpperCase() === 'ASC'
                    : true)); // 기본값: 오름차순
        const sortOrder = sortAscending ? 'ASC' : 'DESC';
        
        // 정렬 가능한 컬럼 화이트리스트 (SQL injection 방지)
        const allowedSortColumns = [
            'tcodigo', 'tdesc', 'tpre1', 'tpre2', 'tpre3', 'torgpre',
            'ttelacodigo', 'ttelakg', 'tinfo1', 'tinfo2', 'tinfo3', 'utime', 'borrado',
            'fotonombre', 'tpre4', 'tpre5', 'pubip', 'ip', 'mac', 'bmobile',
            'ref_id_temporada', 'ref_id_tipo', 'ref_id_origen', 'ref_id_empresa', 'memo',
            'estatus_precios', 'tprecio_dolar', 'utime_modificado', 'id_todocodigo_centralizado',
            'b_mostrar_vcontrol', 'd_oferta_mode', 'id_serial', 'str_prefijo',
            'id_todocodigo'
        ];
        
        // 정렬 컬럼 검증 및 기본값 설정
        // 파라미터가 없으면 tcodigo를 중심으로 오름차순 정렬
        const defaultSortColumn = 'tcodigo';
        const validSortBy = sortColumn && allowedSortColumns.includes(sortColumn) ? sortColumn : defaultSortColumn;
        
        // WHERE 조건 구성
        let whereConditions = [];
        let replacements = {};
        
        if (idTodocodigo) {
            // id_todocodigo 파라미터로 페이지네이션 (다음 페이지 요청 시 사용)
            const maxIdTodocodigo = parseInt(idTodocodigo, 10);
            if (isNaN(maxIdTodocodigo)) {
                console.error(`ERROR: Invalid id_todocodigo format: ${idTodocodigo}`);
            } else {
                whereConditions.push('id_todocodigo > :idTodocodigo');
                replacements.idTodocodigo = maxIdTodocodigo;
            }
        }
        
        // last_get_utime이 있으면 utime 필터 추가
        if (lastGetUtime) {
            // ISO 8601 형식의 'T'를 공백으로 변환하고 시간대 정보 제거
            let utimeStr = String(lastGetUtime);
            utimeStr = utimeStr.replace(/T/, ' ').replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
            whereConditions.push(`utime::text > :lastGetUtime`);
            replacements.lastGetUtime = utimeStr;
        }
        
        // FilteringWord 검색 조건 추가 (tcodigo 또는 tdesc에서만 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereConditions.push(`(
                tcodigo ILIKE :filteringWord OR 
                tdesc ILIKE :filteringWord
            )`);
            replacements.filteringWord = searchTerm;
        }
        
        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';
        
        // 총 데이터 개수 조회
        const countQuery = `
            SELECT COUNT(*) as total
            FROM todocodigos
            ${whereClause}
        `;
        const [countResult] = await sequelize.query(countQuery, {
            replacements: replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        const totalCount = parseInt(countResult.total, 10);
        
        // 100개 단위로 제한
        const limit = 100;
        
        // 쿼리 실행 (사용자가 요청한 필드 + 페이지네이션을 위한 id_todocodigo)
        const query = `
            SELECT 
                id_todocodigo, 
                tcodigo, 
                tdesc, 
                tpre1, 
                tpre2, 
                tpre3, 
                torgpre,
                ttelacodigo, 
                ttelakg, 
                tinfo1, 
                tinfo2, 
                tinfo3, 
                utime, 
                borrado,
                fotonombre, 
                tpre4, 
                tpre5, 
                pubip, 
                ip, 
                mac, 
                bmobile,
                ref_id_temporada, 
                ref_id_tipo, 
                ref_id_origen, 
                ref_id_empresa, 
                memo,
                estatus_precios, 
                tprecio_dolar, 
                utime_modificado, 
                id_todocodigo_centralizado,
                b_mostrar_vcontrol, 
                d_oferta_mode, 
                id_serial, 
                str_prefijo
            FROM todocodigos
            ${whereClause}
            ORDER BY ${validSortBy} ${sortOrder}, id_todocodigo ASC
            LIMIT :limit OFFSET :offset
        `;
        
        // 다음 배치 존재 여부 확인을 위해 limit + 1개 조회
        const records = await sequelize.query(query, {
            replacements: {
                ...replacements,
                limit: limit + 1,
                offset: 0
            },
            type: Sequelize.QueryTypes.SELECT
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const allRecords = hasMore ? records.slice(0, limit) : records;
        
        // 응답 데이터 구성 (id_todocodigo 포함)
        const data = allRecords;
        
        // 다음 요청을 위한 id_todocodigo 계산 (마지막 레코드의 id_todocodigo)
        let nextIdTodocodigo = null;
        if (allRecords.length > 0) {
            const lastRecord = allRecords[allRecords.length - 1];
            if (lastRecord.id_todocodigo !== null && lastRecord.id_todocodigo !== undefined) {
                nextIdTodocodigo = lastRecord.id_todocodigo;
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                id_todocodigo: nextIdTodocodigo
            },
            filters: {
                filtering_word: filteringWord || null,
                sort_column: validSortBy,
                sort_ascending: sortAscending
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error('\nERROR: Todocodigos fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        
        // 연결 거부 오류 진단
        const dbConfig = req.dbConfig || {};
        // 기본 호스트 결정 (Docker 환경 감지)
        const getDefaultDbHost = () => {
            if (process.env.DB_HOST) return process.env.DB_HOST;
            try {
                const fs = require('fs');
                const isDocker = process.env.DOCKER === 'true' || 
                               process.env.IN_DOCKER === 'true' ||
                               fs.existsSync('/.dockerenv') ||
                               process.env.HOSTNAME?.includes('docker') ||
                               process.cwd() === '/home/node/app';
                return isDocker ? 'host.docker.internal' : '127.0.0.1';
            } catch (e) {
                return '127.0.0.1';
            }
        };
        const diagnosis = diagnoseConnectionRefusedError(
            err, 
            dbConfig.host || getDefaultDbHost(), 
            dbConfig.port || 5432
        );
        
        if (diagnosis) {
            console.error(`\n❌ Todocodigos 연결 거부 오류 발생`);
            console.error(`   연결 정보: ${diagnosis.connectionInfo.host}:${diagnosis.connectionInfo.port}`);
            console.error(`   환경: ${diagnosis.connectionInfo.environment}`);
            console.error(`   진단 요약: ${diagnosis.diagnosis.summary}`);
            console.error(`   가장 가능성 높은 원인: ${diagnosis.diagnosis.mostLikelyCause}`);
            console.error(`\n   가능한 원인:`);
            diagnosis.diagnosis.possibleCauses.forEach((cause, index) => {
                console.error(`   ${index + 1}. [${cause.probability}] ${cause.cause}`);
                console.error(`      ${cause.description}`);
            });
            console.error('');
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list todocodigos');
        res.status(500).json(errorResponse);
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const record = await Todocodigos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error('\nERROR: Todocodigos fetch by id error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        
        // 연결 거부 오류 진단
        const dbConfig = req.dbConfig || {};
        // 기본 호스트 결정 (Docker 환경 감지)
        const getDefaultDbHost = () => {
            if (process.env.DB_HOST) return process.env.DB_HOST;
            try {
                const fs = require('fs');
                const isDocker = process.env.DOCKER === 'true' || 
                               process.env.IN_DOCKER === 'true' ||
                               fs.existsSync('/.dockerenv') ||
                               process.env.HOSTNAME?.includes('docker') ||
                               process.cwd() === '/home/node/app';
                return isDocker ? 'host.docker.internal' : '127.0.0.1';
            } catch (e) {
                return '127.0.0.1';
            }
        };
        const diagnosis = diagnoseConnectionRefusedError(
            err, 
            dbConfig.host || getDefaultDbHost(), 
            dbConfig.port || 5432
        );
        
        if (diagnosis) {
            console.error(`\n❌ Todocodigos 연결 거부 오류 발생`);
            console.error(`   연결 정보: ${diagnosis.connectionInfo.host}:${diagnosis.connectionInfo.port}`);
            console.error(`   환경: ${diagnosis.connectionInfo.environment}`);
            console.error(`   진단 요약: ${diagnosis.diagnosis.summary}`);
            console.error(`   가장 가능성 높은 원인: ${diagnosis.diagnosis.mostLikelyCause}`);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'fetch todocodigo');
        res.status(500).json(errorResponse);
    }
});

router.post('/', async (req, res) => {
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // BATCH_SYNC 작업 처리
        // todocodigos는 primary key 충돌 시 utime 비교를 통해 update/skip 결정
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Todocodigos, 'id_todocodigo', 'Todocodigos');
            await notifyBatchSync(req, Todocodigos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        // todocodigos는 utime 비교가 필요하므로 utime 비교 핸들러 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Todocodigos, 'id_todocodigo', 'Todocodigos');
            await notifyBatchSync(req, Todocodigos, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 utime 비교 핸들러 사용
            req.body.data = rawData;
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Todocodigos, 'id_todocodigo', 'Todocodigos');
            await notifyBatchSync(req, Todocodigos, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (utime 비교 핸들러 사용)
        // 단일 항목도 배열로 변환하여 utime 비교 핸들러 사용
        req.body.data = [rawData];
        const result = await handleUtimeComparisonArrayData(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
        const singleResult = result.results && result.results.length > 0 ? result.results[0] : null;
        if (singleResult) {
            await notifyDbChange(req, Todocodigos, singleResult.action === 'created' ? 'create' : singleResult.action === 'updated' ? 'update' : 'skip', singleResult.data);
            res.status(singleResult.action === 'created' ? 201 : singleResult.action === 'updated' ? 200 : 200).json(singleResult.data);
            return;
        }
        throw new Error('Failed to process todocodigo');
        await notifyDbChange(req, Todocodigos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Todocodigos', 'id_todocodigo', 'todocodigos');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create todocodigo');
        
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
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // utime 비교 핸들러 사용 (todocodigos 전용)
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Todocodigos, 'id_todocodigo', 'Todocodigos');
            await notifyBatchSync(req, Todocodigos, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (utime 비교 포함)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Todocodigos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Todocodigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            // 기존 레코드 조회
            const existing = await Todocodigos.findByPk(id, { transaction });
            if (!existing) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            
            // utime 비교: 클라이언트 utime이 더 높을 때만 업데이트 (문자열 직접 비교, timezone 변환 없음)
            let clientUtimeStr = null;
            if (dataToUpdate.utime) {
                if (dataToUpdate.utime instanceof Date) {
                    // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                    const year = dataToUpdate.utime.getFullYear();
                    const month = String(dataToUpdate.utime.getMonth() + 1).padStart(2, '0');
                    const day = String(dataToUpdate.utime.getDate()).padStart(2, '0');
                    const hours = String(dataToUpdate.utime.getHours()).padStart(2, '0');
                    const minutes = String(dataToUpdate.utime.getMinutes()).padStart(2, '0');
                    const seconds = String(dataToUpdate.utime.getSeconds()).padStart(2, '0');
                    const ms = String(dataToUpdate.utime.getMilliseconds()).padStart(3, '0');
                    clientUtimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                } else {
                    // 문자열인 경우 ISO 8601 형식의 'T'를 공백으로 변환하여 통일된 형식으로 비교
                    // "2025-11-27T19:20:52.615" -> "2025-11-27 19:20:52.615"
                    let utimeStr = String(dataToUpdate.utime);
                    // 'T'를 공백으로 변환 (ISO 8601 형식 처리)
                    utimeStr = utimeStr.replace(/T/, ' ');
                    // 시간대 정보 제거 (Z, +09:00 등)
                    utimeStr = utimeStr.replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
                    clientUtimeStr = utimeStr.trim();
                }
            }
            
            // 서버의 utime을 데이터베이스에서 문자열로 직접 가져오기 (timezone 변환 방지)
            let serverUtimeStr = null;
            const serverUtimeRaw = await Todocodigos.findOne({ 
                where: { id_todocodigo: id }, 
                transaction,
                attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                raw: true
            });
            if (serverUtimeRaw && serverUtimeRaw.utime) {
                serverUtimeStr = String(serverUtimeRaw.utime).trim();
            }
            
            let shouldUpdate = false;
            if (!clientUtimeStr && !serverUtimeStr) {
                shouldUpdate = true;
            } else if (clientUtimeStr && !serverUtimeStr) {
                shouldUpdate = true;
            } else if (clientUtimeStr && serverUtimeStr) {
                // 문자열 직접 비교 (timezone 변환 없음)
                shouldUpdate = clientUtimeStr > serverUtimeStr;
            } else {
                shouldUpdate = false;
            }
            
            if (!shouldUpdate) {
                await transaction.rollback();
                return res.status(200).json({
                    message: 'Skipped: server utime is newer or equal',
                    serverUtime: serverUtimeStr,
                    clientUtime: clientUtimeStr,
                    data: existing
                });
            }
            
            // utime을 문자열로 보장하여 timezone 변환 방지 (Sequelize.literal 사용)
            if (dataToUpdate.utime) {
                let utimeStr = null;
                if (dataToUpdate.utime instanceof Date) {
                    // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                    const year = dataToUpdate.utime.getFullYear();
                    const month = String(dataToUpdate.utime.getMonth() + 1).padStart(2, '0');
                    const day = String(dataToUpdate.utime.getDate()).padStart(2, '0');
                    const hours = String(dataToUpdate.utime.getHours()).padStart(2, '0');
                    const minutes = String(dataToUpdate.utime.getMinutes()).padStart(2, '0');
                    const seconds = String(dataToUpdate.utime.getSeconds()).padStart(2, '0');
                    const ms = String(dataToUpdate.utime.getMilliseconds()).padStart(3, '0');
                    utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                } else {
                    // 문자열인 경우 그대로 사용 (timezone 변환 없음)
                    utimeStr = String(dataToUpdate.utime);
                }
                // Sequelize.literal을 사용하여 문자열을 그대로 저장 (timezone 변환 방지)
                dataToUpdate.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
            }
            
            const [count] = await Todocodigos.update(dataToUpdate, { where: { id_todocodigo: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Todocodigos.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Todocodigos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update todocodigo', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Todocodigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Todocodigos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Todocodigos.destroy({ where: { id_todocodigo: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Todocodigos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete todocodigo', details: err.message });
    }
});

module.exports = router;

