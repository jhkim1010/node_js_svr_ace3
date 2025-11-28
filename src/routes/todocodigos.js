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
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // max_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        // 실제로는 id_todocodigo 값을 받음 (호환성을 위해 max_utime 이름 유지)
        const maxUtime = req.body?.max_utime || req.query?.max_utime;
        
        // last_get_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        const lastGetUtime = req.body?.last_get_utime || req.query?.last_get_utime;
        
        let whereCondition = {};
        let maxIdTodocodigo = null;
        
        if (maxUtime) {
            // max_utime 값이 실제로는 id_todocodigo 값임
            maxIdTodocodigo = parseInt(maxUtime, 10);
            if (isNaN(maxIdTodocodigo)) {
                console.error(`ERROR: Invalid id_todocodigo format: ${maxUtime}`);
            } else {
                // id_todocodigo가 maxIdTodocodigo보다 큰 레코드만 조회
                whereCondition.id_todocodigo = {
                    [Op.gt]: maxIdTodocodigo
                };
            }
        }
        
        // last_get_utime이 있으면 utime 필터 추가
        if (lastGetUtime) {
            // ISO 8601 형식의 'T'를 공백으로 변환하고 시간대 정보 제거
            let utimeStr = String(lastGetUtime);
            utimeStr = utimeStr.replace(/T/, ' ').replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
            // utime::text > 'last_get_utime' 조건 추가 (문자열 비교)
            whereCondition[Op.and] = [
                ...(whereCondition[Op.and] || []),
                Sequelize.literal(`utime::text > '${utimeStr.replace(/'/g, "''")}'`)
            ];
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Todocodigos.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        // id_todocodigo로 정렬 (일관된 정렬 보장)
        // raw: true를 사용하여 원본 데이터베이스 데이터를 그대로 반환 (모든 필드 포함)
        const records = await Todocodigos.findAll({
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_todocodigo', 'ASC']],
            attributes: [
                'id_todocodigo', 'tcodigo', 'tdesc', 'tpre1', 'tpre2', 'tpre3', 'torgpre',
                'ttelacodigo', 'ttelakg', 'tinfo1', 'tinfo2', 'tinfo3', 'utime', 'borrado',
                'fotonombre', 'tpre4', 'tpre5', 'pubip', 'ip', 'mac', 'bmobile',
                'ref_id_temporada', 'ref_id_tipo', 'ref_id_origen', 'ref_id_empresa', 'memo',
                'estatus_precios', 'tprecio_dolar', 'utime_modificado', 'id_todocodigo_centralizado',
                'b_mostrar_vcontrol', 'd_oferta_mode', 'id_serial', 'str_prefijo'
            ],
            raw: true // 원본 데이터베이스 데이터를 그대로 반환 (변환 없음)
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 id_todocodigo)
        let nextMaxUtime = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_todocodigo !== null && lastRecord.id_todocodigo !== undefined) {
                // id_todocodigo 값을 문자열로 변환하여 반환
                nextMaxUtime = String(lastRecord.id_todocodigo);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        // data는 원본 데이터베이스에서 가져온 형태 그대로 반환 (변환 없음)
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
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
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
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
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

