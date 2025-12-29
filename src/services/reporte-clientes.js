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
    
    // Filtering Word 검색
    if (filteringWord) {
        const escapedWord = filteringWord.replace(/'/g, "''");
        conditions.push(`(c.nombre LIKE '%${escapedWord}%' OR c.dni LIKE '%${escapedWord}%' OR c.memo LIKE '%${escapedWord}%' OR c.direccion LIKE '%${escapedWord}%' OR c.telefono LIKE '%${escapedWord}%')`);
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

    // 날짜 조건 구성
    const dateCondition = buildDateCondition(fechaInicio, fechaFin);
    
    // WHERE 조건 구성
    const whereConditions = buildWhereConditions(responsableIns, provincia, filteringWord);
    
    // HAVING 조건 구성
    const havingCondition = buildHavingCondition(deudores);

    // SQL 쿼리 구성
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
        ORDER BY c.nombre ASC
    `;

    // 쿼리 실행
    let clientes = [];
    try {
        const results = await sequelize.query(sqlQuery, {
            type: Sequelize.QueryTypes.SELECT
        });
        clientes = Array.isArray(results) ? results : [];
    } catch (err) {
        console.error('[Clientes 보고서] 쿼리 실행 실패:');
        console.error('   Error:', err.message);
        console.error('   SQL:', sqlQuery);
        throw err;
    }

    // 집계 정보 계산
    const totalClientes = clientes.length;
    const clientesConDeuda = clientes.filter(c => parseFloat(c.totaldeuda || 0) > 0).length;
    const totalDeuda = clientes.reduce((sum, c) => sum + parseFloat(c.totaldeuda || 0), 0);
    const avgDeuda = totalClientes > 0 ? totalDeuda / totalClientes : 0;

    // 지역별 통계
    const provinciaStatsMap = {};
    clientes.forEach(c => {
        const prov = c.provincia || 'Sin Provincia';
        provinciaStatsMap[prov] = (provinciaStatsMap[prov] || 0) + 1;
    });
    const provinciaStats = Object.entries(provinciaStatsMap)
        .map(([provincia, count]) => ({ provincia, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Localidad별 통계
    const localidadStatsMap = {};
    clientes.forEach(c => {
        const loc = c.localidad || 'Sin Localidad';
        localidadStatsMap[loc] = (localidadStatsMap[loc] || 0) + 1;
    });
    const localidadStats = Object.entries(localidadStatsMap)
        .map(([localidad, count]) => ({ localidad, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    return {
        filters: {
            fecha_inicio: fechaInicio || 'last_365_days',
            fecha_fin: fechaFin || 'current_date',
            responsable_ins: responsableIns || 'all',
            provincia: provincia || 'all',
            deudores: deudores,
            filtering_word: filteringWord || 'all'
        },
        summary: {
            total_clientes: totalClientes,
            clientes_con_deuda: clientesConDeuda,
            total_deuda: totalDeuda,
            avg_deuda: avgDeuda,
            top_localidades: localidadStats,
            top_provincias: provinciaStats
        },
        data: clientes
    };
}

module.exports = { getClientesReport };

