const { Router } = require('express');
const { Op, Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { diagnoseConnectionRefusedError } = require('../utils/error-classifier');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        const sequelize = Codigos.sequelize;
        
        // id_codigo 파라미터 확인 (페이지네이션용, 첫 요청에는 없음)
        const idCodigo = req.body?.id_codigo || req.query?.id_codigo;
        
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
            'codigo', 'descripcion', 'pre1', 'pre2', 'pre3', 'pre4', 'pre5', 'preorg',
            'tcodigo', 'borrado', 'b_sincronizar_x_web', 'id_woocommerce', 'id_woocommerce_producto',
            'id_codigo'
        ];
        
        // 정렬 컬럼 검증 및 기본값 설정
        // 파라미터가 없으면 codigo를 중심으로 오름차순 정렬
        const defaultSortColumn = 'codigo';
        const validSortBy = sortColumn && allowedSortColumns.includes(sortColumn) ? sortColumn : defaultSortColumn;
        
        // WHERE 조건 구성
        let whereConditions = [];
        let replacements = {};
        
        if (idCodigo) {
            // id_codigo 파라미터로 페이지네이션 (다음 페이지 요청 시 사용)
            const maxIdCodigo = parseInt(idCodigo, 10);
            if (isNaN(maxIdCodigo)) {
                console.error(`ERROR: Invalid id_codigo format: ${idCodigo}`);
            } else {
                whereConditions.push('c.id_codigo > :idCodigo');
                replacements.idCodigo = maxIdCodigo;
            }
        }
        
        // last_get_utime이 있으면 utime 필터 추가
        if (lastGetUtime) {
            // ISO 8601 형식의 'T'를 공백으로 변환하고 시간대 정보 제거
            let utimeStr = String(lastGetUtime);
            utimeStr = utimeStr.replace(/T/, ' ').replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
            whereConditions.push(`c.utime::text > :lastGetUtime`);
            replacements.lastGetUtime = utimeStr;
        }
        
        // FilteringWord 검색 조건 추가 (codigo 또는 descripcion에서만 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereConditions.push(`(
                c.codigo ILIKE :filteringWord OR 
                c.descripcion ILIKE :filteringWord
            )`);
            replacements.filteringWord = searchTerm;
        }
        
        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';
        
        // 총 데이터 개수 조회
        const countQuery = `
            SELECT COUNT(*) as total
            FROM codigos c
            INNER JOIN todocodigos t ON c.ref_id_todocodigo = t.id_todocodigo
            ${whereClause}
        `;
        const [countResult] = await sequelize.query(countQuery, {
            replacements: replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        const totalCount = parseInt(countResult.total, 10);
        
        // 100개 단위로 제한
        const limit = 100;
        
        // JOIN 쿼리 실행 (사용자가 요청한 필드 + 페이지네이션을 위한 id_codigo)
        const query = `
            SELECT 
                c.codigo, 
                c.descripcion, 
                c.pre1, 
                c.pre2, 
                c.pre3, 
                c.pre4, 
                c.pre5, 
                c.preorg, 
                t.tcodigo, 
                c.borrado, 
                c.b_sincronizar_x_web, 
                c.id_woocommerce, 
                c.id_woocommerce_producto,
                c.id_codigo
            FROM codigos c
            INNER JOIN todocodigos t ON c.ref_id_todocodigo = t.id_todocodigo
            ${whereClause}
            ORDER BY ${validSortBy === 'tcodigo' ? 't.tcodigo' : `c.${validSortBy}`} ${sortOrder}
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
        
        // 응답 데이터 구성 (id_codigo 포함)
        const data = allRecords;
        
        // 다음 요청을 위한 id_codigo 계산 (마지막 레코드의 id_codigo)
        let nextIdCodigo = null;
        if (allRecords.length > 0) {
            const lastRecord = allRecords[allRecords.length - 1];
            if (lastRecord.id_codigo !== null && lastRecord.id_codigo !== undefined) {
                nextIdCodigo = lastRecord.id_codigo;
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                id_codigo: nextIdCodigo
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
        console.error('\nERROR: Codigos fetch error:');
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
            console.error(`\n❌ Codigos 연결 거부 오류 발생`);
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
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list codigos');
        res.status(500).json(errorResponse);
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        const record = await Codigos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error('\nERROR: Codigos fetch by id error:');
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
            console.error(`\n❌ Codigos 연결 거부 오류 발생`);
            console.error(`   연결 정보: ${diagnosis.connectionInfo.host}:${diagnosis.connectionInfo.port}`);
            console.error(`   환경: ${diagnosis.connectionInfo.environment}`);
            console.error(`   진단 요약: ${diagnosis.diagnosis.summary}`);
            console.error(`   가장 가능성 높은 원인: ${diagnosis.diagnosis.mostLikelyCause}`);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'fetch codigo');
        res.status(500).json(errorResponse);
    }
});

router.post('/', async (req, res) => {
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        
        // BATCH_SYNC 작업 처리
        // codigos는 primary key 충돌 시 utime 비교를 통해 update/skip 결정
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Codigos, 'codigo', 'Codigos');
            await notifyBatchSync(req, Codigos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        // codigos는 utime 비교가 필요하므로 utime 비교 핸들러 사용
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Codigos, 'codigo', 'Codigos');
            await notifyBatchSync(req, Codigos, result);
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 utime 비교 핸들러 사용
            req.body.data = rawData;
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Codigos, 'codigo', 'Codigos');
            await notifyBatchSync(req, Codigos, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (utime 비교 핸들러 사용)
        // 단일 항목도 배열로 변환하여 utime 비교 핸들러 사용
        req.body.data = [rawData];
        const result = await handleUtimeComparisonArrayData(req, res, Codigos, 'codigo', 'Codigos');
        const singleResult = result.results && result.results.length > 0 ? result.results[0] : null;
        if (singleResult) {
            await notifyDbChange(req, Codigos, singleResult.action === 'created' ? 'create' : singleResult.action === 'updated' ? 'update' : 'skip', singleResult.data);
            res.status(singleResult.action === 'created' ? 201 : singleResult.action === 'updated' ? 200 : 200).json(singleResult.data);
            return;
        }
        throw new Error('Failed to process codigo');
        // WebSocket 알림 전송
        await notifyDbChange(req, Codigos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Codigos', 'codigo', 'codigos');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create codigo');
        
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

// PUT /codigos/id/:id 라우트 추가 (Flutter 앱 호환성)
router.put('/id/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    
    // 기존 PUT /:id 핸들러와 동일한 로직 사용
    return handlePutCodigo(req, res, id);
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    
    return handlePutCodigo(req, res, id);
});

// PUT 요청 처리 공통 함수
async function handlePutCodigo(req, res, id) {
    console.log(`\n[handlePutCodigo] 함수 호출됨 - codigo_id: ${id}`);
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        console.log(`[handlePutCodigo] Codigos 모델 로드 완료`);
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            console.log(`[handlePutCodigo] 배열 데이터 처리 경로로 이동 - 배열 길이: ${req.body.data.length}`);
            req.body.operation = req.body.operation || 'UPDATE';
            // utime 비교 핸들러 사용 (codigos 전용)
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Codigos, 'codigo', 'Codigos');
            await notifyBatchSync(req, Codigos, result);
            return res.status(200).json(result);
        }
        
        console.log(`[handlePutCodigo] 단일 항목 처리 경로로 이동`);
        
        // 단일 항목 처리 (utime 비교 포함)
        const cleanedData = removeSyncField(req.body);
        
        // tcodigo는 codigos 테이블의 필드가 아니므로 제거 (업데이트 시 무시)
        if (cleanedData.tcodigo) {
            delete cleanedData.tcodigo;
        }
        
        // 문자열 boolean 값을 boolean으로 변환 (Flutter 앱 호환성)
        if (cleanedData.borrado !== undefined) {
            if (cleanedData.borrado === 'true' || cleanedData.borrado === true) {
                cleanedData.borrado = true;
            } else if (cleanedData.borrado === 'false' || cleanedData.borrado === false) {
                cleanedData.borrado = false;
            }
        }
        
        if (cleanedData.b_sincronizar_x_web !== undefined) {
            if (cleanedData.b_sincronizar_x_web === 'true' || cleanedData.b_sincronizar_x_web === true) {
                cleanedData.b_sincronizar_x_web = true;
            } else if (cleanedData.b_sincronizar_x_web === 'false' || cleanedData.b_sincronizar_x_web === false) {
                cleanedData.b_sincronizar_x_web = false;
            }
        }
        
        // null 문자열을 실제 null로 변환
        if (cleanedData.id_woocommerce === 'null' || cleanedData.id_woocommerce === null) {
            cleanedData.id_woocommerce = null;
        }
        
        if (cleanedData.id_woocommerce_producto === 'null' || cleanedData.id_woocommerce_producto === null) {
            cleanedData.id_woocommerce_producto = null;
        }
        
        const dataToUpdate = filterModelFields(Codigos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Codigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            // 기존 레코드 조회 (id_codigo로 조회)
            const existing = await Codigos.findOne({ where: { id_codigo: id }, transaction });
            if (!existing) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            
            // utime 비교: 클라이언트가 utime을 명시적으로 보낸 경우에만 비교
            // 클라이언트가 utime을 보내지 않으면 항상 업데이트 실행
            let clientUtimeStr = null;
            const clientSentUtime = cleanedData.utime !== undefined && cleanedData.utime !== null;
            
            if (clientSentUtime && dataToUpdate.utime) {
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
            
            let shouldUpdate = true; // 기본값: 항상 업데이트
            
            // 클라이언트가 utime을 명시적으로 보낸 경우에만 비교
            if (clientSentUtime && clientUtimeStr) {
                // 서버의 utime을 데이터베이스에서 문자열로 직접 가져오기 (timezone 변환 방지)
                let serverUtimeStr = null;
                const serverUtimeRaw = await Codigos.findOne({ 
                    where: { id_codigo: id }, 
                    transaction,
                    attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                    raw: true
                });
                if (serverUtimeRaw && serverUtimeRaw.utime) {
                    serverUtimeStr = String(serverUtimeRaw.utime).trim();
                }
                
                // utime 비교: 클라이언트 utime이 더 높을 때만 업데이트
                if (clientUtimeStr && serverUtimeStr) {
                    shouldUpdate = clientUtimeStr > serverUtimeStr;
                } else if (clientUtimeStr && !serverUtimeStr) {
                    shouldUpdate = true;
                } else if (!clientUtimeStr && serverUtimeStr) {
                    shouldUpdate = false;
                }
                
                if (!shouldUpdate) {
                    await transaction.rollback();
                    console.log('\n═══════════════════════════════════════════════════════════');
                    console.log('=== Codigo Update 요청 (스킵됨) ===');
                    console.log(`codigo_id: ${id}`);
                    console.log(`이유: 서버 utime이 더 최신이거나 같음`);
                    console.log(`서버 utime: ${serverUtimeStr || 'N/A'}`);
                    console.log(`클라이언트 utime: ${clientUtimeStr || 'N/A'}`);
                    console.log('═══════════════════════════════════════════════════════════\n');
                    return res.status(200).json({
                        message: 'Skipped: server utime is newer or equal',
                        serverUtime: serverUtimeStr,
                        clientUtime: clientUtimeStr,
                        data: existing
                    });
                }
            }
            
            // dataToUpdate에서 utime 제거 (나중에 now()로 설정할 예정)
            delete dataToUpdate.utime;
            
            // mac과 platform 값 처리
            if (cleanedData.mac) {
                dataToUpdate.mac = cleanedData.mac;
            }
            if (cleanedData.platform) {
                // platform 값을 valor1에 저장
                dataToUpdate.valor1 = cleanedData.platform;
            }
            
            // 실행될 SQL 스크립트 구성 및 출력
            console.log('\n═══════════════════════════════════════════════════════════');
            console.log('=== Codigo Update 요청 ===');
            console.log(`codigo_id: ${id}`);
            console.log(`요청 데이터:`, JSON.stringify(cleanedData, null, 2));
            console.log('\n--- 업데이트 전 데이터 ---');
            const beforeUpdate = existing.toJSON ? existing.toJSON() : existing;
            console.log(JSON.stringify(beforeUpdate, null, 2));
            
            // mac과 platform 값 처리
            if (cleanedData.mac) {
                dataToUpdate.mac = cleanedData.mac;
            }
            if (cleanedData.platform) {
                // platform 값을 valor1에 저장
                dataToUpdate.valor1 = cleanedData.platform;
            }
            
            // utime을 now()로 설정
            dataToUpdate.utime = Sequelize.literal(`now()`);
            
            console.log('\n--- 실행될 SQL 스크립트 ---');
            
            // SQL SET 절 구성 (사용자 요청 형식)
            const setClauses = [];
            
            // 필드 순서 정의 (사용자 요청 순서)
            const fieldOrder = ['codigo', 'descripcion', 'pre1', 'pre2', 'pre3', 'borrado', 'pre4', 'pre5', 
                               'mac', 'b_mostrar_vcontrol', 'valor1', 'utime'];
            
            // 우선순위 필드 먼저 처리
            for (const key of fieldOrder) {
                if (dataToUpdate.hasOwnProperty(key)) {
                    const value = dataToUpdate[key];
                    if (key === 'utime') {
                        setClauses.push(`${key} = now()`);
                    } else if (value === null || value === undefined) {
                        setClauses.push(`${key} = NULL`);
                    } else if (typeof value === 'string') {
                        // SQL injection 방지를 위해 작은따옴표 이스케이프
                        const escapedValue = value.replace(/'/g, "''");
                        setClauses.push(`${key} = '${escapedValue}'`);
                    } else if (typeof value === 'boolean') {
                        setClauses.push(`${key} = ${value}`);
                    } else if (typeof value === 'number') {
                        setClauses.push(`${key} = ${value}`);
                    }
                }
            }
            
            // 나머지 필드 처리 (fieldOrder에 없는 필드들)
            for (const [key, value] of Object.entries(dataToUpdate)) {
                if (!fieldOrder.includes(key)) {
                    if (value === null || value === undefined) {
                        setClauses.push(`${key} = NULL`);
                    } else if (typeof value === 'string') {
                        const escapedValue = value.replace(/'/g, "''");
                        setClauses.push(`${key} = '${escapedValue}'`);
                    } else if (typeof value === 'boolean') {
                        setClauses.push(`${key} = ${value}`);
                    } else if (typeof value === 'number') {
                        setClauses.push(`${key} = ${value}`);
                    }
                }
            }
            
            // SQL 쿼리 구성 (사용자 요청 형식: 여러 줄로 표시, 적절한 위치에서 줄바꿈)
            let sqlScript = `UPDATE codigos SET ${setClauses.join(', ')} WHERE id_codigo = ${id}`;
            
            // 가독성을 위해 적절한 위치에서 줄바꿈 (약 80자마다)
            // 하지만 필드 단위로 나누는 것이 더 나을 수 있음
            // 사용자 예시를 보면 첫 줄에 codigo, descripcion, pre1, pre2, pre3이 있고
            // 두 번째 줄에 borrado, pre4, pre5, mac이 있고
            // 세 번째 줄에 b_mostrar_vcontrol, valor1, utime이 있습니다.
            
            // 필드를 그룹으로 나누어 표시
            const groups = [
                ['codigo', 'descripcion', 'pre1', 'pre2', 'pre3'],
                ['borrado', 'pre4', 'pre5', 'mac'],
                ['b_mostrar_vcontrol', 'valor1', 'utime']
            ];
            
            const groupedClauses = [];
            for (const group of groups) {
                const groupClauses = [];
                for (const key of group) {
                    if (dataToUpdate.hasOwnProperty(key)) {
                        const value = dataToUpdate[key];
                        if (key === 'utime') {
                            groupClauses.push(`${key} = now()`);
                        } else if (value === null || value === undefined) {
                            groupClauses.push(`${key} = NULL`);
                        } else if (typeof value === 'string') {
                            const escapedValue = value.replace(/'/g, "''");
                            groupClauses.push(`${key} = '${escapedValue}'`);
                        } else if (typeof value === 'boolean') {
                            groupClauses.push(`${key} = ${value}`);
                        } else if (typeof value === 'number') {
                            groupClauses.push(`${key} = ${value}`);
                        }
                    }
                }
                if (groupClauses.length > 0) {
                    groupedClauses.push(groupClauses.join(', '));
                }
            }
            
            // 나머지 필드 추가
            const remainingClauses = [];
            for (const [key, value] of Object.entries(dataToUpdate)) {
                const inAnyGroup = groups.some(group => group.includes(key));
                if (!inAnyGroup) {
                    if (value === null || value === undefined) {
                        remainingClauses.push(`${key} = NULL`);
                    } else if (typeof value === 'string') {
                        const escapedValue = value.replace(/'/g, "''");
                        remainingClauses.push(`${key} = '${escapedValue}'`);
                    } else if (typeof value === 'boolean') {
                        remainingClauses.push(`${key} = ${value}`);
                    } else if (typeof value === 'number') {
                        remainingClauses.push(`${key} = ${value}`);
                    }
                }
            }
            
            if (remainingClauses.length > 0) {
                groupedClauses.push(remainingClauses.join(', '));
            }
            
            sqlScript = `UPDATE codigos SET ${groupedClauses.join(', \n')} WHERE id_codigo = ${id}`;
            console.log(sqlScript);
            console.log(`\n업데이트할 필드: ${Object.keys(dataToUpdate).join(', ')}`);
            
            console.log('\n--- UPDATE 실행 중... ---');
            const [count] = await Codigos.update(dataToUpdate, { where: { id_codigo: id }, transaction });
            console.log(`UPDATE 결과: ${count}개 행 영향받음`);
            
            if (count === 0) {
                await transaction.rollback();
                console.log('\n--- 결과: 업데이트된 행 없음 (롤백) ---');
                console.log('═══════════════════════════════════════════════════════════\n');
                return res.status(404).json({ error: 'Not found' });
            }
            
            const updated = await Codigos.findOne({ where: { id_codigo: id }, transaction });
            console.log('\n--- 업데이트 후 데이터 ---');
            const afterUpdate = updated.toJSON ? updated.toJSON() : updated;
            console.log(JSON.stringify(afterUpdate, null, 2));
            console.log(`\n--- 최종 결과: ${count}개 행 업데이트됨 ---`);
            console.log('═══════════════════════════════════════════════════════════\n');
            
            // logs 테이블에 기록
            try {
                const Logs = getModelForRequest(req, 'Logs');
                const now = new Date();
                const fecha = now.toISOString().split('T')[0]; // YYYY-MM-DD
                const hora = now.toTimeString().split(' ')[0]; // HH:MM:SS
                
                // 날짜와 시간을 한국어 형식으로 변환
                const year = now.getFullYear();
                const month = now.getMonth() + 1;
                const day = now.getDate();
                const hours = now.getHours();
                const minutes = now.getMinutes();
                const fechaStr = `${year}년 ${month}월 ${day}일`;
                const horaStr = `${hours}시 ${minutes}분`;
                
                // 이벤트 메시지 구성
                const mac = cleanedData.mac || updated.mac || 'N/A';
                const platform = cleanedData.platform || 'N/A';
                const codigo = updated.codigo || 'N/A';
                const descripcion = updated.descripcion || 'N/A';
                const precios = [];
                if (updated.pre1 !== null && updated.pre1 !== undefined) precios.push(`pre1=${updated.pre1}`);
                if (updated.pre2 !== null && updated.pre2 !== undefined) precios.push(`pre2=${updated.pre2}`);
                if (updated.pre3 !== null && updated.pre3 !== undefined) precios.push(`pre3=${updated.pre3}`);
                if (updated.pre4 !== null && updated.pre4 !== undefined) precios.push(`pre4=${updated.pre4}`);
                if (updated.pre5 !== null && updated.pre5 !== undefined) precios.push(`pre5=${updated.pre5}`);
                
                const preciosStr = precios.length > 0 ? precios.join(', ') : 'N/A';
                const evento = `MAC: ${mac}, Platform: ${platform}에서 제품 코드: ${codigo}, 설명: ${descripcion}, 가격: ${preciosStr}를 ${fechaStr} ${horaStr}에 편집`;
                
                // logs 테이블에 삽입
                await Logs.create({
                    fecha: fecha,
                    hora: hora,
                    evento: evento,
                    progname: 'codigos_update',
                    sucursal: req.dbConfig?.sucursal || 1
                }, { transaction });
            } catch (logErr) {
                // logs 기록 실패는 무시하지 않고 로그만 출력
                console.error('Failed to write log entry:', logErr);
            }
            
            await transaction.commit();
            // WebSocket 알림 전송
            await notifyDbChange(req, Codigos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update codigo', details: err.message });
    }
}

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Codigos = getModelForRequest(req, 'Codigos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Codigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            // 삭제 전에 데이터 가져오기
            const toDelete = await Codigos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Codigos.destroy({ where: { id_codigo: id }, transaction });
            await transaction.commit();
            // WebSocket 알림 전송
            await notifyDbChange(req, Codigos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete codigo', details: err.message });
    }
});

module.exports = router;

