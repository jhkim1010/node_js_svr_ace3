const { Router } = require('express');
const { Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        const sequelize = Gastos.sequelize;
        const { Op } = Sequelize;
        
        // req.query와 req.body가 undefined일 수 있으므로 안전하게 처리
        const query = req.query || {};
        const body = req.body || {};
        
        // 날짜 파라미터 확인 (query 또는 body)
        const fecha = query.fecha || body.fecha;
        const fechaInicio = query.fecha_inicio || query.start_date || body.fecha_inicio || body.start_date;
        const fechaFin = query.fecha_fin || query.end_date || body.fecha_fin || body.end_date;
        
        // sucursal 파라미터 확인
        const sucursal = query.sucursal || body.sucursal;
        
        // rubro 파라미터 확인 (codigo 필터링용)
        const rubro = query.rubro || body.rubro;
        
        // 검색어 파라미터 확인
        const filteringWord = query.filtering_word || query.filteringWord || body.filtering_word || body.filteringWord || query.search || body.search;
        
        // 페이지네이션 파라미터 확인 (id_ga 기준)
        const lastIdGa = query.last_id_ga || body.last_id_ga;
        
        // WHERE 조건 구성
        let whereConditions = [];
        
        // 날짜 필터링
        if (fecha) {
            // 특정 날짜만 조회 (정확히 일치)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(fecha)) {
                return res.status(400).json({ 
                    error: 'Invalid fecha format. Expected YYYY-MM-DD',
                    received: fecha
                });
            }
            whereConditions.push(
                Sequelize.where(
                    Sequelize.fn('DATE', Sequelize.col('fecha')),
                    fecha
                )
            );
        } else if (fechaInicio) {
            // 날짜 범위 조회
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(fechaInicio)) {
                return res.status(400).json({ 
                    error: 'Invalid fecha_inicio format. Expected YYYY-MM-DD',
                    received: fechaInicio
                });
            }
            
            // SQL injection 방지를 위해 작은따옴표 이스케이프
            const escapedFechaInicio = fechaInicio.replace(/'/g, "''");
            // fecha >= fechaInicio 조건
            whereConditions.push(
                Sequelize.literal(`DATE(fecha) >= '${escapedFechaInicio}'`)
            );
            
            if (fechaFin) {
                if (!dateRegex.test(fechaFin)) {
                    return res.status(400).json({ 
                        error: 'Invalid fecha_fin format. Expected YYYY-MM-DD',
                        received: fechaFin
                    });
                }
                // SQL injection 방지를 위해 작은따옴표 이스케이프
                const escapedFechaFin = fechaFin.replace(/'/g, "''");
                // fecha <= fechaFin 조건
                whereConditions.push(
                    Sequelize.literal(`DATE(fecha) <= '${escapedFechaFin}'`)
                );
            }
        }
        
        // 삭제되지 않은 항목만 조회
        whereConditions.push({ borrado: false });
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            const sucursalNum = parseInt(sucursal, 10);
            if (!isNaN(sucursalNum)) {
                whereConditions.push({ sucursal: sucursalNum });
            }
        }
        
        // rubro 필터링 추가 (codigo가 특정 문자로 시작하는 경우)
        if (rubro && rubro.trim()) {
            const rubroValue = rubro.trim();
            // SQL injection 방지를 위해 이스케이프 처리
            const escapedRubro = rubroValue.replace(/'/g, "''");
            whereConditions.push({
                codigo: { [Op.like]: `${escapedRubro}%` }
            });
        }
        
        // filtering_word 검색 조건 추가 (tema, codigo, nencargado에서 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereConditions.push({
                [Op.or]: [
                    { tema: { [Op.iLike]: searchTerm } },
                    { codigo: { [Op.iLike]: searchTerm } },
                    { nencargado: { [Op.iLike]: searchTerm } }
                ]
            });
        }
        
        // 페이지네이션: id_ga가 제공되면 해당 ID보다 큰 것만 조회
        if (lastIdGa) {
            const idGa = parseInt(lastIdGa, 10);
            if (isNaN(idGa)) {
                return res.status(400).json({ error: 'Invalid last_id_ga format' });
            }
            whereConditions.push({ id_ga: { [Op.gt]: idGa } });
        }
        
        // WHERE 조건을 SQL 문자열로 변환 (rubro별 집계 쿼리용)
        let sqlWhereConditions = [];
        const sqlParams = [];
        let paramIndex = 1;
        
        // 날짜 필터링 (SQL)
        if (fecha) {
            sqlWhereConditions.push(`DATE(g.fecha) = $${paramIndex}`);
            sqlParams.push(fecha);
            paramIndex++;
        } else if (fechaInicio) {
            sqlWhereConditions.push(`DATE(g.fecha) >= $${paramIndex}`);
            sqlParams.push(fechaInicio);
            paramIndex++;
            if (fechaFin) {
                sqlWhereConditions.push(`DATE(g.fecha) <= $${paramIndex}`);
                sqlParams.push(fechaFin);
                paramIndex++;
            }
        }
        
        // 삭제되지 않은 항목만
        sqlWhereConditions.push('g.borrado IS FALSE');
        
        // sucursal 필터링
        if (sucursal) {
            const sucursalNum = parseInt(sucursal, 10);
            if (!isNaN(sucursalNum)) {
                sqlWhereConditions.push(`g.sucursal = $${paramIndex}`);
                sqlParams.push(sucursalNum);
                paramIndex++;
            }
        }
        
        // filtering_word 검색 조건
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            // 같은 파라미터를 3번 사용 (PostgreSQL에서 지원)
            sqlWhereConditions.push(`(g.tema ILIKE $${paramIndex} OR g.codigo ILIKE $${paramIndex} OR g.nencargado ILIKE $${paramIndex})`);
            sqlParams.push(searchTerm);
            paramIndex++;
        }
        
        const sqlWhereClause = sqlWhereConditions.length > 0 
            ? 'WHERE ' + sqlWhereConditions.join(' AND ')
            : '';
        
        // Rubro별 집계 쿼리 실행 (PostgreSQL에서 대소문자 유지를 위해 따옴표 사용)
        const rubroSummaryQuery = `
            SELECT 
                COUNT(*) as "cntEvento",
                MAX(gi.desc_gasto) as "descripcion_rubro",
                SUM(g.costo) as "total_Gasto",
                LEFT(g.codigo, 1) as "codigo_rubro"
            FROM gastos g
            INNER JOIN gasto_info gi 
                ON gi.codigo = LEFT(g.codigo, 1)
            ${sqlWhereClause}
            GROUP BY LEFT(g.codigo, 1)
            ORDER BY LEFT(g.codigo, 1)
        `;
        
        let rubroSummary = [];
        try {
            const rubroResults = await sequelize.query(rubroSummaryQuery, {
                bind: sqlParams.length > 0 ? sqlParams : undefined,
                type: Sequelize.QueryTypes.SELECT
            });
            
            // 필드명을 정확한 대소문자로 변환 (PostgreSQL이 소문자로 변환하는 경우 대비)
            rubroSummary = Array.isArray(rubroResults) ? rubroResults.map(item => {
                // 다양한 가능한 필드명 변형 처리
                return {
                    cntEvento: item.cntEvento || item.cntevento || item.cnt_evento || 0,
                    descripcion_rubro: item.descripcion_rubro || item.descripcionrubro || item.descripcionRubro || '',
                    total_Gasto: item.total_Gasto || item.total_gasto || item.totalGasto || 0,
                    codigo_rubro: item.codigo_rubro || item.codigorubro || item.codigoRubro || ''
                };
            }) : [];
        } catch (rubroErr) {
            console.error('[Gastos] Rubro summary query error:', rubroErr.message);
            // rubro 집계 오류가 있어도 세부 내역은 반환
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Gastos.count({ 
            where: {
                [Op.and]: whereConditions
            }
        });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Gastos.findAll({ 
            where: {
                [Op.and]: whereConditions
            },
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_ga', 'DESC']] // id_ga 내림차순 정렬
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 last_id_ga 계산 (마지막 레코드의 id_ga)
        let nextLastIdGa = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_ga !== null && lastRecord.id_ga !== undefined) {
                nextLastIdGa = String(lastRecord.id_ga);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            summary_by_rubro: rubroSummary, // rubro별 집계 결과
            data: data, // 세부 내역
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                nextLastIdGa: nextLastIdGa // id_ga 기반 페이징을 위한 nextLastIdGa
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error('\nERROR: Gastos fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list gastos');
        res.status(500).json(errorResponse);
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        const record = await Gastos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch gasto', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        // Gastos 동기화 로직에서는 (id_ga, sucursal) 복합 키를 기본 식별자로 사용
        const compositePrimaryKey = ['id_ga', 'sucursal'];
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleUtimeComparisonArrayData(req, res, Gastos, compositePrimaryKey, 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            // utime 비교 + primary key 우선 순서 적용
            const result = await handleUtimeComparisonArrayData(req, res, Gastos, compositePrimaryKey, 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // 단일 생성/업데이트 요청도 utime 비교 + primary key 우선 순서 적용
        const rawData = req.body.new_data || req.body;
        req.body.data = Array.isArray(rawData) ? rawData : [rawData];

        const result = await handleUtimeComparisonArrayData(req, res, Gastos, compositePrimaryKey, 'Gastos');

        // 첫 번째 결과를 기반으로 응답 구성
        const first = result.results && result.results[0];
        const action = first?.action || 'created';
        const data = first?.data || rawData;

        if (action === 'skipped') {
            // 중복(unique) 또는 FK 문제로 스킵된 경우도 에러가 아닌 정상 응답으로 처리
            await notifyDbChange(req, Gastos, 'skip', data);
            return res.status(200).json(first);
        }

        await notifyDbChange(req, Gastos, action === 'created' ? 'create' : 'update', data);
        res.status(action === 'created' ? 201 : 200).json(data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Gastos', 'id_ga', 'gastos');
        res.status(400).json({ 
            error: 'Failed to create gasto', 
            details: err.message,
            errorType: err.constructor.name,
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined,
            originalError: err.original ? err.original.message : null
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, Gastos, 'id_ga', 'Gastos');
            await notifyBatchSync(req, Gastos, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Gastos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Gastos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Gastos.update(dataToUpdate, { where: { id_ga: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Gastos.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Gastos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update gasto', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Gastos = getModelForRequest(req, 'Gastos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Gastos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Gastos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Gastos.destroy({ where: { id_ga: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Gastos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete gasto', details: err.message });
    }
});

module.exports = router;

