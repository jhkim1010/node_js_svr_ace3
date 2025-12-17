const { Router } = require('express');
const { Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleVcodesBatchSync } = require('../utils/vcodes-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
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
    // 502 에러 추적을 위한 변수들
    const requestStartTime = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let responseSent = false;
    let processingStartTime = null;
    let processingEndTime = null;
    
    const dbName = req.dbConfig?.database ? `[${req.dbConfig.database}]` : '[N/A]';
    const dataCount = Array.isArray(req.body.data) ? req.body.data.length : (req.body.data ? 1 : 0);
    const operation = req.body.operation || 'CREATE';
    
    // 연결 상태 추적
    const logConnectionState = (stage) => {
        const elapsed = Date.now() - requestStartTime;
        const socketState = req.socket ? {
            destroyed: req.socket.destroyed,
            readable: req.socket.readable,
            writable: req.socket.writable,
            readyState: req.socket.readyState
        } : 'no socket';
        
        console.log(`[502 Tracker] ${requestId} | ${dbName} | ${stage} | elapsed=${elapsed}ms | socket=${JSON.stringify(socketState)} | headersSent=${res.headersSent} | responseSent=${responseSent}`);
    };
    
    // 타임아웃 감지
    res.setTimeout(300000, () => {
        const elapsed = Date.now() - requestStartTime;
        console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ TIMEOUT DETECTED | elapsed=${elapsed}ms | responseSent=${responseSent} | headersSent=${res.headersSent}`);
        logConnectionState('TIMEOUT');
        
        if (!responseSent && !res.headersSent) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ Response not sent before timeout - this will cause 502 error`);
            res.status(504).json({ 
                error: 'Gateway Timeout', 
                message: 'Request processing exceeded timeout limit',
                requestId: requestId,
                elapsed: elapsed
            });
            responseSent = true;
        }
    });
    
    // 연결 종료 감지
    req.on('close', () => {
        const elapsed = Date.now() - requestStartTime;
        if (!responseSent) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ CLIENT DISCONNECTED | elapsed=${elapsed}ms | responseSent=${responseSent} | This may cause 502 error`);
            logConnectionState('CLIENT_DISCONNECTED');
        }
    });
    
    // 응답 전송 감지 및 소켓 상태 확인
    const originalJson = res.json.bind(res);
    res.json = function(body) {
        const elapsed = Date.now() - requestStartTime;
        const processingTime = processingEndTime ? processingEndTime - processingStartTime : null;
        
        // 소켓 상태 확인 (매우 중요!)
        const socketDestroyed = !req.socket || req.socket.destroyed;
        const socketWritable = req.socket && req.socket.writable;
        const socketReadable = req.socket && req.socket.readable;
        const socketReadyState = req.socket?.readyState;
        
        // 소켓이 이미 닫혀있거나 쓸 수 없는 상태인지 확인
        if (socketDestroyed || !socketWritable) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️⚠️⚠️ SOCKET DESTROYED BEFORE RESPONSE | elapsed=${elapsed}ms | This will cause 502 error!`);
            console.error(`[502 Tracker] ${requestId} | ${dbName} | Socket state: destroyed=${socketDestroyed}, writable=${socketWritable}, readable=${socketReadable}, readyState=${socketReadyState}`);
            console.error(`[502 Tracker] ${requestId} | ${dbName} | Response headersSent=${res.headersSent}, responseSent=${responseSent}`);
            logConnectionState('SOCKET_DESTROYED_BEFORE_RESPONSE');
            
            // 소켓이 이미 닫혀있으면 응답을 보낼 수 없음
            if (socketDestroyed) {
                console.error(`[502 Tracker] ${requestId} | ${dbName} | ❌ Cannot send response - socket already destroyed. Client will receive 502 error.`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ This is the ROOT CAUSE of 502 error!`);
                // 응답을 보내려고 시도하지 않음 (이미 소켓이 닫혀있으므로)
                return res;
            }
        }
        
        // 응답 전송 시도
        responseSent = true;
        console.log(`[502 Tracker] ${requestId} | ${dbName} | ✅ RESPONSE SENT | elapsed=${elapsed}ms | processingTime=${processingTime}ms | status=${res.statusCode}`);
        logConnectionState('RESPONSE_SENT');
        
        try {
            return originalJson(body);
        } catch (jsonErr) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ❌ Failed to send JSON response: ${jsonErr.message}`);
            console.error(`[502 Tracker] ${requestId} | ${dbName} | Error stack: ${jsonErr.stack}`);
            logConnectionState('JSON_RESPONSE_FAILED');
            throw jsonErr;
        }
    };
    
    // 에러 발생 감지
    res.on('error', (err) => {
        const elapsed = Date.now() - requestStartTime;
        console.error(`[502 Tracker] ${requestId} | ${dbName} | ❌ RESPONSE ERROR | elapsed=${elapsed}ms | error=${err.message} | responseSent=${responseSent}`);
        logConnectionState('RESPONSE_ERROR');
    });
    
    // 응답 완료 감지
    res.on('finish', () => {
        const elapsed = Date.now() - requestStartTime;
        const processingTime = processingEndTime ? processingEndTime - processingStartTime : null;
        console.log(`[502 Tracker] ${requestId} | ${dbName} | ✅ RESPONSE FINISHED | elapsed=${elapsed}ms | processingTime=${processingTime}ms | status=${res.statusCode}`);
    });
    
    try {
        // Set timeout and keep-alive headers to prevent 502 errors
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=300');
        
        // Log incoming request
        console.log(`[Vcodes POST] ${dbName} | Received: operation=${operation}, dataCount=${dataCount}, path=${req.path} | requestId=${requestId}`);
        
        // ⚠️⚠️⚠️ CRITICAL: Check socket state at request start
        const socketDestroyedAtStart = !req.socket || req.socket.destroyed;
        const socketWritableAtStart = req.socket && req.socket.writable;
        const socketReadableAtStart = req.socket && req.socket.readable;
        const socketReadyStateAtStart = req.socket?.readyState;
        const connectionHeader = req.headers['connection']?.toLowerCase();
        const isConnectionClose = connectionHeader === 'close';
        
        // Connection: close 헤더가 있으면 응답 후 연결을 닫겠다는 의미이므로 정상 동작
        // 하지만 소켓이 이미 destroyed 상태면 문제가 있음
        if (socketDestroyedAtStart || !socketWritableAtStart) {
            console.warn(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ WARNING: SOCKET STATE ISSUE AT REQUEST START`);
            console.warn(`[502 Tracker] ${requestId} | ${dbName} | Socket state: destroyed=${socketDestroyedAtStart}, writable=${socketWritableAtStart}, readable=${socketReadableAtStart}, readyState=${socketReadyStateAtStart}`);
            console.warn(`[502 Tracker] ${requestId} | ${dbName} | Connection header: ${connectionHeader || 'not set'}`);
            console.warn(`[502 Tracker] ${requestId} | ${dbName} | Request method: ${req.method}, URL: ${req.url}, path: ${req.path}`);
            
            // Connection: close 헤더가 있으면 정상 동작일 수 있음
            // 하지만 소켓이 이미 destroyed 상태면 문제가 있음
            if (isConnectionClose) {
                console.warn(`[502 Tracker] ${requestId} | ${dbName} | Note: Connection: close header detected - this is normal, but socket destroyed state is unusual`);
            } else {
                console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️⚠️⚠️ CRITICAL: SOCKET DESTROYED WITHOUT Connection: close HEADER!`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} | This means the socket was closed BEFORE this request was received!`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ ROOT CAUSE: This is likely a Nginx/proxy issue!`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} | Check Nginx configuration:`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} |   1. proxy_read_timeout should be >= 300s`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} |   2. proxy_connect_timeout should be >= 300s`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} |   3. proxy_send_timeout should be >= 300s`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} |   4. keepalive_timeout should be >= 300s`);
            }
            
            logConnectionState('SOCKET_STATE_CHECK');
            
            // ⚠️ 중요: 소켓이 닫혀있어도 요청은 처리 시도
            // Connection: close 헤더가 있으면 응답 후 연결을 닫겠다는 의미이므로
            // 요청 자체는 처리해야 함. 응답 시도 시 소켓이 닫혀있으면 에러가 발생하지만
            // 그때 처리하는 것이 맞음
        }
        
        logConnectionState('REQUEST_RECEIVED');
        
        processingStartTime = Date.now();
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // BATCH_SYNC 작업 처리 (Vcodes 전용 핸들러 사용)
        // vcodes는 vcode_id와 sucursal의 복합 unique key를 사용
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            console.log(`[Vcodes POST] ${dbName} | Processing BATCH_SYNC with ${req.body.data.length} items | requestId=${requestId}`);
            logConnectionState('BATCH_SYNC_START');
            
            const result = await handleVcodesBatchSync(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            
            processingEndTime = Date.now();
            const processingTime = processingEndTime - processingStartTime;
            console.log(`[502 Tracker] ${requestId} | ${dbName} | BATCH_SYNC processing completed | processingTime=${processingTime}ms`);
            logConnectionState('BATCH_SYNC_PROCESSING_COMPLETE');
            
            await notifyBatchSync(req, Vcode, result);
            
            console.log(`[Vcodes POST] ${dbName} | BATCH_SYNC completed: ${result.processed} processed, ${result.created} created, ${result.updated} updated, ${result.skipped || 0} skipped, ${result.failed} failed | requestId=${requestId}`);
            logConnectionState('BATCH_SYNC_BEFORE_RESPONSE');
            
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도) (utime 비교를 통한 개별 처리)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            console.log(`[Vcodes POST] ${dbName} | Processing ${operation} with ${req.body.data.length} items using utime comparison | requestId=${requestId}`);
            logConnectionState(`${operation}_START`);
            
            const result = await handleUtimeComparisonArrayData(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            
            processingEndTime = Date.now();
            const processingTime = processingEndTime - processingStartTime;
            console.log(`[502 Tracker] ${requestId} | ${dbName} | ${operation} processing completed | processingTime=${processingTime}ms`);
            logConnectionState(`${operation}_PROCESSING_COMPLETE`);
            
            // 소켓 상태 확인 (처리 완료 후, 응답 전송 전)
            const socketDestroyed = !req.socket || req.socket.destroyed;
            const socketWritable = req.socket && req.socket.writable;
            if (socketDestroyed || !socketWritable) {
                console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️⚠️⚠️ SOCKET DESTROYED AFTER PROCESSING | elapsed=${Date.now() - requestStartTime}ms | This will cause 502 error!`);
                console.error(`[502 Tracker] ${requestId} | ${dbName} | Socket state: destroyed=${socketDestroyed}, writable=${socketWritable}, readable=${req.socket?.readable}`);
                logConnectionState('SOCKET_DESTROYED_AFTER_PROCESSING');
            }
            
            // Summary log only (detailed logs are already printed in handleUtimeComparisonArrayData)
            console.log(`[Vcodes POST] ${dbName} | ${operation} completed: ${result.processed || 0} processed, ${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped, ${result.failed || 0} failed | requestId=${requestId}`);
            logConnectionState(`${operation}_BEFORE_RESPONSE`);
            
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (복합 unique key 기반으로 UPDATE/CREATE 결정)
        logConnectionState('SINGLE_ITEM_START');
        const result = await handleSingleItem(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
        
        processingEndTime = Date.now();
        const processingTime = processingEndTime - processingStartTime;
        console.log(`[502 Tracker] ${requestId} | ${dbName} | Single item processing completed | processingTime=${processingTime}ms`);
        logConnectionState('SINGLE_ITEM_BEFORE_RESPONSE');
        
        await notifyDbChange(req, Vcode, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        processingEndTime = Date.now();
        const elapsed = Date.now() - requestStartTime;
        const processingTime = processingEndTime - processingStartTime;
        
        console.error(`[502 Tracker] ${requestId} | ${dbName} | ❌ ERROR OCCURRED | elapsed=${elapsed}ms | processingTime=${processingTime}ms | error=${err.message}`);
        logConnectionState('ERROR_OCCURRED');
        
        // 연결 상태 확인
        if (!req.socket || req.socket.destroyed) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ Socket destroyed before error response - 502 likely`);
        }
        
        if (res.headersSent) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ⚠️ Headers already sent - cannot send error response`);
            return;
        }
        
        handleInsertUpdateError(err, req, 'Vcode', ['vcode_id', 'sucursal'], 'vcodes');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create vcode');
        errorResponse.requestId = requestId;
        errorResponse.elapsed = elapsed;
        errorResponse.processingTime = processingTime;
        
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
        
        try {
            res.status(400).json(errorResponse);
            responseSent = true;
            console.log(`[502 Tracker] ${requestId} | ${dbName} | ✅ Error response sent`);
        } catch (responseErr) {
            console.error(`[502 Tracker] ${requestId} | ${dbName} | ❌ Failed to send error response: ${responseErr.message}`);
            logConnectionState('ERROR_RESPONSE_FAILED');
        }
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우) - utime 비교를 통한 개별 처리
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
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

// 특정 날짜의 판매 데이터 조회 (페이지네이션)
router.get('/ventas_x_a_day', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const sequelize = Vcode.sequelize;
        
        // 날짜 파라미터 확인 (query 또는 body)
        const fecha = req.query.fecha || req.body.fecha;
        if (!fecha) {
            return res.status(400).json({ error: 'fecha parameter is required' });
        }
        
        // 날짜 형식 검증 (YYYY-MM-DD)
        const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!fechaRegex.test(fecha)) {
            return res.status(400).json({ error: 'Invalid fecha format. Expected YYYY-MM-DD' });
        }
        
        // 페이지네이션 파라미터 확인 (vcode_id 기준)
        const lastVcodeId = req.query.last_vcode_id || req.body.last_vcode_id;
        
        // WHERE 조건 구성
        let whereConditions = ['fecha = :fecha', 'borrado = false'];
        const replacements = { fecha };
        
        // 페이지네이션: vcode_id가 제공되면 해당 ID보다 큰 것만 조회
        if (lastVcodeId) {
            const vcodeId = parseInt(lastVcodeId, 10);
            if (isNaN(vcodeId)) {
                return res.status(400).json({ error: 'Invalid last_vcode_id format' });
            }
            whereConditions.push('vcode_id > :lastVcodeId');
            replacements.lastVcodeId = vcodeId;
        }
        
        const whereClause = 'WHERE ' + whereConditions.join(' AND ');
        
        // 총 데이터 개수 조회
        const countQuery = `
            SELECT COUNT(*) as total
            FROM public.vcodes
            ${whereClause}
        `;
        const [countResult] = await sequelize.query(countQuery, {
            replacements: replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        const totalCount = parseInt(countResult.total, 10);
        
        // 50개 단위로 제한
        const limit = 50;
        
        // 쿼리 실행 (요청한 필드들)
        const query = `
            SELECT 
                vcode_id as id,
                right(vcode, 5) as vcode,
                hora,
                tpago,
                cntropas,
                clientenombre,
                tefectivo,
                tcredito,
                tbanco,
                treservado,
                tfavor,
                vendedor,
                tipo,
                dni,
                resiva,
                casoesp,
                nencargado,
                cretmp,
                fecha,
                sucursal,
                ntiqrepetir,
                b_mercadopago,
                d_num_caja,
                d_num_terminal
            FROM public.vcodes
            ${whereClause}
            ORDER BY vcode_id ASC
            LIMIT :limit
        `;
        
        // 다음 배치 존재 여부 확인을 위해 limit + 1개 조회
        const records = await sequelize.query(query, {
            replacements: {
                ...replacements,
                limit: limit + 1
            },
            type: Sequelize.QueryTypes.SELECT
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 vcode_id 계산 (마지막 레코드의 vcode_id)
        let nextVcodeId = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.vcode_id !== null && lastRecord.vcode_id !== undefined) {
                nextVcodeId = lastRecord.vcode_id;
            }
        }
        
        // 응답 구성
        const response = {
            success: true,
            fecha: fecha,
            total: totalCount,
            count: data.length,
            hasMore: hasMore,
            data: data
        };
        
        // 다음 페이지가 있으면 next_vcode_id 포함
        if (hasMore && nextVcodeId !== null) {
            response.next_vcode_id = nextVcodeId;
        }
        
        res.json(response);
    } catch (err) {
        console.error('[Ventas x a Day] 오류:', err);
        res.status(500).json({ 
            error: 'Failed to get ventas_x_a_day', 
            details: err.message 
        });
    }
});

module.exports = router;


