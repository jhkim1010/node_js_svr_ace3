const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

/**
 * 날짜 조건을 구성하는 함수
 * @param {string} fechaInicio - 시작 날짜 (YYYY-MM-DD)
 * @param {string} fechaFin - 종료 날짜 (YYYY-MM-DD)
 * @returns {string} 날짜 조건 문자열
 */
function buildDateCondition(fechaInicio, fechaFin) {
    if (fechaInicio && fechaFin) {
        // SQL injection 방지를 위해 이스케이프 처리
        const escapedInicio = fechaInicio.replace(/'/g, "''");
        const escapedFin = fechaFin.replace(/'/g, "''");
        return `v.fecha BETWEEN '${escapedInicio}' AND '${escapedFin}'`;
    }
    // 날짜 조건이 없으면 마지막 1년간
    return 'v.fecha BETWEEN CURRENT_DATE - 365 AND CURRENT_DATE';
}

/**
 * WHERE 조건을 동적으로 구성하는 함수
 * @param {string} responsableIns - "Responsable Ins", "Monotributista", "Sin Rubro" 중 하나
 * @param {string} provincia - 주 이름
 * @param {string} filteringWord - 검색어
 * @returns {string} WHERE 조건 문자열
 */
function buildWhereConditions(responsableIns, provincia, filteringWord) {
    const conditions = ['c.borrado IS FALSE'];
    
    // Responsable Ins 필터
    if (responsableIns) {
        if (responsableIns === 'Responsable Ins') {
            conditions.push('c.resiva = 0');
        } else if (responsableIns === 'Monotributista') {
            conditions.push('c.resiva = 1');
        } else if (responsableIns === 'Sin Rubro') {
            conditions.push('(c.resiva != 1 AND c.resiva = 0)');
        }
    }
    
    // Provincia 필터
    if (provincia) {
        // SQL injection 방지를 위해 이스케이프 처리
        const escapedProvincia = provincia.replace(/'/g, "''");
        conditions.push(`c.provincia = '${escapedProvincia}'`);
    }
    
    // Filtering Word 검색 (대소문자 구분 없음)
    if (filteringWord) {
        const escapedWord = filteringWord.replace(/'/g, "''");
        conditions.push(`(c.nombre ILIKE '%${escapedWord}%' OR c.dni ILIKE '%${escapedWord}%' OR c.memo ILIKE '%${escapedWord}%' OR c.direccion ILIKE '%${escapedWord}%' OR c.telefono ILIKE '%${escapedWord}%' OR c.localidad ILIKE '%${escapedWord}%')`);
    }
    
    return conditions.join(' AND ');
}

/**
 * HAVING 조건을 구성하는 함수
 * @param {boolean} deudores - deudores 필터 여부
 * @returns {string} HAVING 조건 문자열 또는 빈 문자열
 */
function buildHavingCondition(deudores) {
    if (deudores) {
        return 'HAVING COALESCE(SUM(cr.cretmp), 0) > 0';
    }
    return '';
}

/**
 * ORDER BY 절을 구성하는 함수
 * @param {string} sortColumn - 정렬할 컬럼명
 * @param {boolean} sortAscending - true면 오름차순(ASC), false면 내림차순(DESC)
 * @returns {string} ORDER BY 절 문자열
 */
function buildOrderByClause(sortColumn, sortAscending) {
    // 허용된 정렬 컬럼 목록 (SQL injection 방지)
    const allowedColumns = {
        'dni': 'c.dni',
        'nombre': 'c.nombre',
        'vendedor': 'c.vendedor',
        'direccion': 'c.direccion',
        'localidad': 'c.localidad',
        'provincia': 'c.provincia',
        'telefono': 'c.telefono',
        'cntOperation': 'COUNT(v.vcode)',
        'totalImporte_Compra': 'COALESCE(SUM(v.tpago), 0)',
        'totaldeuda': 'COALESCE(SUM(cr.cretmp), 0)',
        'last_buy_date': 'COALESCE(MAX(v.fecha), NULL)',
        'memo': 'c.memo'
    };

    // 기본값: totalImporte_Compra 내림차순
    const column = allowedColumns[sortColumn] || allowedColumns['totalImporte_Compra'];
    const direction = sortAscending ? 'ASC' : 'DESC';

    return `ORDER BY ${column} ${direction}`;
}

async function getClientesReport(req) {
    const Clientes = getModelForRequest(req, 'Clientes');
    const sequelize = Clientes.sequelize;

    // 쿼리 파라미터 파싱
    const fechaInicio = req.query.fecha_inicio || null;
    const fechaFin = req.query.fecha_fin || null;
    const responsableIns = req.query.responsable_ins || null;
    const provincia = req.query.provincia || null;
    const deudores = req.query.deudores === '1' || req.query.deudores === 1 || req.query.deudores === 'true' || req.query.deudores === true;
    const filteringWord = req.query.filtering_word || null;

    // 페이지네이션 파라미터 (기본값: limit=200, offset=0)
    let limit = 200;
    let offset = 0;
    if (req.query.limit) {
        const limitNum = parseInt(req.query.limit, 10);
        if (!isNaN(limitNum) && limitNum > 0 && limitNum <= 1000) {
            limit = limitNum;
        }
    }
    if (req.query.offset) {
        const offsetNum = parseInt(req.query.offset, 10);
        if (!isNaN(offsetNum) && offsetNum >= 0) {
            offset = offsetNum;
        }
    }

    // 정렬 파라미터 파싱 (기본값: totalImporte_Compra 내림차순)
    const sortColumn = req.query.sort_column || 'totalImporte_Compra';
    // sort_ascending이 명시되지 않으면 기본값은 false (내림차순)
    const sortAscending = req.query.sort_ascending !== undefined && 
        (req.query.sort_ascending === '1' || req.query.sort_ascending === 1 || req.query.sort_ascending === 'true' || req.query.sort_ascending === true);

    // 날짜 조건 구성
    const dateCondition = buildDateCondition(fechaInicio, fechaFin);
    
    // WHERE 조건 구성
    const whereConditions = buildWhereConditions(responsableIns, provincia, filteringWord);
    
    // HAVING 조건 구성
    const havingCondition = buildHavingCondition(deudores);
    
    // ORDER BY 절 구성
    const orderByClause = buildOrderByClause(sortColumn, sortAscending);

    // 총 개수를 구하는 쿼리
    const countQuery = `
        SELECT COUNT(*) as total
        FROM (
            SELECT c.dni
            FROM clientes c 
            LEFT JOIN creditoventas cr
                ON c.dni = cr.dni AND cr.borrado IS FALSE 
            LEFT JOIN vcodes v 
                ON c.id = v.ref_id_cliente AND v.borrado IS FALSE AND ${dateCondition}
            WHERE ${whereConditions}
            GROUP BY c.dni, c.nombre, c.vendedor, c.direccion, c.localidad, c.provincia, c.telefono, c.memo
            ${havingCondition}
        ) AS subquery
    `;

    // 데이터 조회 쿼리
    const sqlQuery = `
        SELECT 
            c.dni, 
            c.nombre, 
            c.vendedor, 
            c.direccion, 
            c.localidad, 
            c.provincia, 
            c.telefono, 
            COUNT(v.vcode) AS cntOperation, 
            COALESCE(SUM(v.tpago), 0) AS totalImporte_Compra, 
            COALESCE(SUM(cr.cretmp), 0) AS totaldeuda, 
            COALESCE(MAX(v.fecha), NULL) AS last_buy_date, 
            c.memo 
        FROM clientes c 
        LEFT JOIN creditoventas cr
            ON c.dni = cr.dni AND cr.borrado IS FALSE 
        LEFT JOIN vcodes v 
            ON c.id = v.ref_id_cliente AND v.borrado IS FALSE AND ${dateCondition}
        WHERE ${whereConditions}
        GROUP BY c.dni, c.nombre, c.vendedor, c.direccion, c.localidad, c.provincia, c.telefono, c.memo
        ${havingCondition}
        ${orderByClause}
        LIMIT ${limit} OFFSET ${offset}
    `;

    // 쿼리 실행
    let clientes = [];
    let totalCount = 0;
    try {
        // 총 개수 조회
        const countResults = await sequelize.query(countQuery, {
            type: Sequelize.QueryTypes.SELECT
        });
        totalCount = countResults && countResults[0] ? parseInt(countResults[0].total, 10) : 0;

        // 데이터 조회
        const results = await sequelize.query(sqlQuery, {
            type: Sequelize.QueryTypes.SELECT
        });
        clientes = Array.isArray(results) ? results : [];
    } catch (err) {
        console.error('[Clientes 보고서] 쿼리 실행 실패:');
        console.error('   Error:', err.message);
        console.error('   Count SQL:', countQuery);
        console.error('   Data SQL:', sqlQuery);
        throw err;
    }

    // 집계 정보 계산 (현재 페이지의 데이터 기준)
    const pageClientes = clientes.length;
    const clientesConDeuda = clientes.filter(c => parseFloat(c.totaldeuda || 0) > 0).length;
    const totalDeuda = clientes.reduce((sum, c) => sum + parseFloat(c.totaldeuda || 0), 0);
    const avgDeuda = pageClientes > 0 ? totalDeuda / pageClientes : 0;

    // 지역별 통계 (현재 페이지 기준)
    const provinciaStatsMap = {};
    clientes.forEach(c => {
        const prov = c.provincia || 'Sin Provincia';
        provinciaStatsMap[prov] = (provinciaStatsMap[prov] || 0) + 1;
    });
    const provinciaStats = Object.entries(provinciaStatsMap)
        .map(([provincia, count]) => ({ provincia, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Localidad별 통계 (현재 페이지 기준)
    const localidadStatsMap = {};
    clientes.forEach(c => {
        const loc = c.localidad || 'Sin Localidad';
        localidadStatsMap[loc] = (localidadStatsMap[loc] || 0) + 1;
    });
    const localidadStats = Object.entries(localidadStatsMap)
        .map(([localidad, count]) => ({ localidad, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // 페이지네이션 정보 계산
    const hasMore = offset + limit < totalCount;
    const totalPages = Math.ceil(totalCount / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    return {
        filters: {
            fecha_inicio: fechaInicio || 'last_365_days',
            fecha_fin: fechaFin || 'current_date',
            responsable_ins: responsableIns || 'all',
            provincia: provincia || 'all',
            deudores: deudores,
            filtering_word: filteringWord || 'all',
            sort_column: sortColumn,
            sort_ascending: sortAscending
        },
        summary: {
            total_clientes: totalCount,
            page_clientes: pageClientes,
            clientes_con_deuda: clientesConDeuda,
            total_deuda: totalDeuda,
            avg_deuda: avgDeuda,
            top_localidades: localidadStats,
            top_provincias: provinciaStats
        },
        pagination: {
            total: totalCount,
            count: pageClientes,
            limit: limit,
            offset: offset,
            current_page: currentPage,
            total_pages: totalPages,
            has_more: hasMore
        },
        data: clientes
    };
}

module.exports = { getClientesReport };

