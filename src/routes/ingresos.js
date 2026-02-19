const { Router } = require('express');
const { Op, Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, logTableError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const sequelize = Ingresos.sequelize;
        
        // ingreso_id 파라미터 확인 (페이지네이션용, 첫 요청에는 없음)
        const idIngreso = req.body?.ingreso_id || req.query?.ingreso_id;
        
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
            'ingreso_id', 'codigo', 'desc3', 'cant3', 'pre1', 'pre2', 'pre3', 'pre4', 'pre5', 'preorg',
            'fecha', 'hora', 'sucursal', 'codigoproducto', 'utime', 'borrado', 'fotonombre',
            'refemp', 'refcolor', 'totpre', 'pubip', 'ip', 'mac', 'ref1', 'ref_vcode',
            'bfallado', 'bmovido', 'ref_sucursal', 'auto_agregado', 'b_autoagregado',
            'ref_id_codigo', 'num_corte', 'casoesp', 'ref_id_todocodigo', 'utime_modificado',
            'id_ingreso_centralizado'
        ];
        
        // 정렬 컬럼 검증 및 기본값 설정
        // 파라미터가 없으면 ingreso_id를 중심으로 오름차순 정렬
        const defaultSortColumn = 'ingreso_id';
        const validSortBy = sortColumn && allowedSortColumns.includes(sortColumn) ? sortColumn : defaultSortColumn;
        
        // WHERE 조건 구성
        let whereConditions = [];
        let replacements = {};
        
        if (idIngreso) {
            // ingreso_id 파라미터로 페이지네이션 (다음 페이지 요청 시 사용)
            const maxIdIngreso = parseInt(idIngreso, 10);
            if (isNaN(maxIdIngreso)) {
                console.error(`ERROR: Invalid ingreso_id format: ${idIngreso}`);
            } else {
                whereConditions.push('ingreso_id > :idIngreso');
                replacements.idIngreso = maxIdIngreso;
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
        
        // FilteringWord 검색 조건 추가 (codigo 또는 desc3에서만 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereConditions.push(`(
                codigo ILIKE :filteringWord OR 
                desc3 ILIKE :filteringWord
            )`);
            replacements.filteringWord = searchTerm;
        }
        
        const whereClause = whereConditions.length > 0 
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';
        
        // 총 데이터 개수 조회
        const countQuery = `
            SELECT COUNT(*) as total
            FROM ingresos
            ${whereClause}
        `;
        const [countResult] = await sequelize.query(countQuery, {
            replacements: replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        const totalCount = parseInt(countResult.total, 10);
        
        // 100개 단위로 제한
        const limit = 100;
        
        // 쿼리 실행
        const query = `
            SELECT *
            FROM ingresos
            ${whereClause}
            ORDER BY ${validSortBy} ${sortOrder}
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
        
        // 응답 데이터 구성 (ingreso_id 포함)
        const data = allRecords;
        
        // 다음 요청을 위한 ingreso_id 계산 (마지막 레코드의 ingreso_id)
        let nextIdIngreso = null;
        if (allRecords.length > 0) {
            const lastRecord = allRecords[allRecords.length - 1];
            if (lastRecord.ingreso_id !== null && lastRecord.ingreso_id !== undefined) {
                nextIdIngreso = lastRecord.ingreso_id;
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                ingreso_id: nextIdIngreso
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
        logTableError('ingresos', 'list ingresos', err, req);
        res.status(500).json({
            error: 'Failed to list ingresos',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

// 집계 쿼리 엔드포인트 (codigo별 그룹화)
router.get('/summary', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const sequelize = Ingresos.sequelize;
        
        // 날짜 범위 파라미터 (필수)
        const startDate = req.body?.start_date || req.query?.start_date || req.body?.fecha_inicio || req.query?.fecha_inicio;
        const endDate = req.body?.end_date || req.query?.end_date || req.body?.fecha_fin || req.query?.fecha_fin;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ 
                error: 'Missing required parameters', 
                details: 'start_date and end_date (or fecha_inicio and fecha_fin) are required' 
            });
        }
        
        // 날짜 형식 검증
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(startDate)) {
            return res.status(400).json({ 
                error: 'Invalid start_date format. Expected YYYY-MM-DD',
                received: startDate
            });
        }
        if (!dateRegex.test(endDate)) {
            return res.status(400).json({ 
                error: 'Invalid end_date format. Expected YYYY-MM-DD',
                received: endDate
            });
        }
        
        // 날짜 범위 검증
        if (startDate > endDate) {
            return res.status(400).json({ 
                error: 'Invalid date range: start_date must be less than or equal to end_date',
                start_date: startDate,
                end_date: endDate
            });
        }
        
        // 페이지네이션 파라미터 (id_codigo 기준)
        const idCodigo = req.body?.id_codigo || req.query?.id_codigo;
        
        // 기본 WHERE 조건
        const baseWhereConditions = [
            `fecha BETWEEN :startDate AND :endDate`,
            `b_autoagregado IS FALSE`,
            `borrado IS FALSE`
        ];
        
        let replacements = {
            startDate: startDate,
            endDate: endDate
        };
        
        // id_codigo 페이지네이션 조건 처리
        let paginationCondition = '';
        if (idCodigo) {
            const maxIdCodigo = parseInt(idCodigo, 10);
            if (isNaN(maxIdCodigo)) {
                console.error(`ERROR: Invalid id_codigo format: ${idCodigo}`);
            } else {
                replacements.idCodigo = maxIdCodigo;
                paginationCondition = 'HAVING MAX(ref_id_codigo) > :idCodigo';
            }
        }
        
        const whereClause = 'WHERE ' + baseWhereConditions.join(' AND ');
        
        // 총 그룹 개수 조회
        let countQuery = `
            SELECT COUNT(*) as total
            FROM (
                SELECT codigo
                FROM ingresos
                ${whereClause}
                GROUP BY codigo
                ${paginationCondition}
            ) as grouped
        `;
        
        const [countResult] = await sequelize.query(countQuery, {
            replacements: replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        const totalCount = parseInt(countResult.total, 10);
        
        // 집계 쿼리 실행
        const query = `
            SELECT 
                codigo, 
                MAX(desc3) as descripcion, 
                SUM(cant3) as tIngreso, 
                MIN(fecha) as startDate, 
                MAX(fecha) as endDate, 
                COUNT(*) as cntEvent, 
                MAX(ref_id_codigo) as id_codigo
            FROM ingresos
            ${whereClause}
            GROUP BY codigo
            ${paginationCondition}
            ORDER BY MAX(ref_id_codigo) ASC
            LIMIT :limit
        `;
        
        // 100개 단위로 제한
        const limit = 100;
        
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
        const allRecords = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 id_codigo 계산 (마지막 레코드의 id_codigo)
        let nextIdCodigo = null;
        if (allRecords.length > 0) {
            const lastRecord = allRecords[allRecords.length - 1];
            if (lastRecord.id_codigo !== null && lastRecord.id_codigo !== undefined) {
                nextIdCodigo = lastRecord.id_codigo;
            }
        }
        
        // 응답 데이터 구성
        const responseData = {
            data: allRecords,
            pagination: {
                count: allRecords.length,
                total: totalCount,
                hasMore: hasMore,
                id_codigo: nextIdCodigo
            },
            filters: {
                start_date: startDate,
                end_date: endDate
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = allRecords.length;
        
        res.json(responseData);
    } catch (err) {
        logTableError('ingresos', 'ingresos summary', err, req);
        res.status(500).json({
            error: 'Failed to fetch ingresos summary',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
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
        logTableError('ingresos', 'fetch ingreso', err, req);
        res.status(500).json({
            error: 'Failed to fetch ingreso',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

router.post('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        
        // BATCH_SYNC 또는 배열 데이터 처리 (utime 비교를 통한 UPDATE/SKIP 결정)
        // Ingresos는 복합 unique key ['ingreso_id', 'sucursal'] 사용
        if ((req.body.operation === 'BATCH_SYNC' || Array.isArray(req.body.data)) && Array.isArray(req.body.data) && req.body.data.length > 0) {
            // 50개를 넘으면 배치로 나눠서 처리 (연결 풀 효율적 사용)
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Ingresos, ['ingreso_id', 'sucursal'], 'Ingresos');
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
        logTableError('ingresos', 'create/update ingreso (POST)', err, req);
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
        logTableError('ingresos', 'update ingreso', err, req);
        res.status(400).json({
            error: 'Failed to update ingreso',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
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
        logTableError('ingresos', 'delete ingreso', err, req);
        res.status(400).json({
            error: 'Failed to delete ingreso',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

module.exports = router;

