const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

/**
 * Movidos 보고서
 * GET /api/reporte/movidos
 * 쿼리 파라미터: fecha_inicio, fecha_fin, sucursal, item_view, filtering_word
 * - ingresos 테이블에서 bmovido = true 인 레코드를 날짜·지점·검색어로 필터링
 */
async function getMovidosReport(req) {
    const Parametros = getModelForRequest(req, 'Parametros');
    const sequelize = Parametros.sequelize;

    // 쿼리/바디 파라미터 (클라이언트는 쿼리로 전달)
    const fechaInicio = req.query.fecha_inicio || req.body?.fecha_inicio;
    const fechaFin = req.query.fecha_fin || req.body?.fecha_fin;
    const sucursal = req.query.sucursal != null ? req.query.sucursal : req.body?.sucursal;
    const itemView = req.query.item_view != null ? req.query.item_view : req.body?.item_view;
    const filteringWord = req.query.filtering_word || req.body?.filtering_word || req.query?.filteringWord || req.body?.filteringWord;

    const sucursalInt = sucursal !== undefined && sucursal !== null && sucursal !== '' ? parseInt(sucursal, 10) : null;

    // 날짜 필수 (클라이언트가 항상 보냄)
    if (!fechaInicio || String(fechaInicio).trim() === '') {
        throw new Error('fecha_inicio is required');
    }

    const whereConditions = ['i.bmovido IS TRUE', 'i.borrado IS FALSE'];
    const queryParams = [];
    let paramIndex = 1;

    // fecha_inicio: fecha >= fecha_inicio
    whereConditions.push(`i.fecha >= $${paramIndex}`);
    queryParams.push(String(fechaInicio).trim());
    paramIndex++;

    // fecha_fin: fecha <= fecha_fin
    if (fechaFin != null && String(fechaFin).trim() !== '') {
        whereConditions.push(`i.fecha <= $${paramIndex}`);
        queryParams.push(String(fechaFin).trim());
        paramIndex++;
    }

    // sucursal
    if (sucursalInt !== null && !isNaN(sucursalInt)) {
        whereConditions.push(`i.sucursal = $${paramIndex}`);
        queryParams.push(sucursalInt);
        paramIndex++;
    }

    // filtering_word: codigo, desc3 검색
    if (filteringWord != null && String(filteringWord).trim() !== '') {
        const term = `%${String(filteringWord).trim()}%`;
        whereConditions.push(`(i.codigo ILIKE $${paramIndex} OR i.desc3 ILIKE $${paramIndex})`);
        queryParams.push(term);
        paramIndex++;
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // 전체 개수
    const countQuery = `
        SELECT COUNT(*) as total
        FROM public.ingresos i
        ${whereClause}
    `;
    const [countRow] = await sequelize.query(countQuery, {
        bind: queryParams,
        type: Sequelize.QueryTypes.SELECT
    });
    const totalCount = parseInt(countRow?.total || 0, 10);

    // 페이지네이션: 최대 500건 (보고서용)
    const limit = 500;
    const dataQuery = `
        SELECT
            i.ingreso_id,
            i.codigo,
            i.desc3,
            i.cant3,
            i.pre1,
            i.pre2,
            i.pre3,
            i.pre4,
            i.pre5,
            i.totpre,
            i.fecha,
            i.hora,
            i.sucursal,
            i.utime,
            i.ref_id_codigo,
            i.ref_id_todocodigo,
            i.ref_sucursal
        FROM public.ingresos i
        ${whereClause}
        ORDER BY i.utime ASC, i.ingreso_id ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataParams = [...queryParams, limit, 0];
    const data = await sequelize.query(dataQuery, {
        bind: dataParams,
        type: Sequelize.QueryTypes.SELECT
    });

    const items = Array.isArray(data) ? data : [];

    return {
        filters: {
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin || null,
            sucursal: sucursalInt ?? 'all',
            item_view: itemView ?? null,
            filtering_word: filteringWord && String(filteringWord).trim() !== '' ? String(filteringWord).trim() : null
        },
        summary: {
            total_items: items.length,
            total_count: totalCount,
            source_table: 'ingresos'
        },
        data: items,
        pagination: {
            count: items.length,
            total: totalCount,
            hasMore: totalCount > limit,
            limit
        }
    };
}

module.exports = { getMovidosReport };
