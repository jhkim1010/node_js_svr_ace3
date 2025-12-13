const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getGastosReport(req) {
    const Gastos = getModelForRequest(req, 'Gastos');
    const sequelize = Gastos.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    const fechaInicio = req.query.fecha_inicio || req.query.start_date || req.query.fecha_desde;
    const fechaFin = req.query.fecha_fin || req.query.end_date || req.query.fecha_hasta;

    // 날짜가 없으면 에러 반환
    if (!fechaInicio) {
        throw new Error('fecha_inicio is required');
    }

    // WHERE 조건 구성
    let whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // 날짜 필터 (fecha > fechaInicio)
    whereConditions.push(`g.fecha > $${paramIndex}`);
    queryParams.push(fechaInicio);
    paramIndex++;

    // 종료일이 있으면 추가 필터
    if (fechaFin) {
        whereConditions.push(`g.fecha <= $${paramIndex}`);
        queryParams.push(fechaFin);
        paramIndex++;
    }

    // 삭제되지 않은 항목만 조회
    whereConditions.push(`g.borrado IS FALSE`);

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // 첫 번째 쿼리: 그룹화된 집계 (left(g.codigo, 1)로 그룹화)
    const summaryQuery = `
        SELECT 
            COUNT(*) as count,
            MAX(gi.desc_gasto) as desc_gasto,
            SUM(g.costo) as sum_costo,
            LEFT(g.codigo, 1) as codigo_rubro
        FROM gastos g
        INNER JOIN gasto_info gi 
            ON gi.codigo = LEFT(g.codigo, 1)
        ${whereClause}
        GROUP BY LEFT(g.codigo, 1)
        ORDER BY LEFT(g.codigo, 1)
    `;

    // 두 번째 쿼리: 상세 데이터
    const detailQuery = `
        SELECT 
            g.fecha,
            g.hora,
            g.tema,
            g.costo,
            g.sucursal,
            g.codigo,
            gi.desc_gasto as rubro
        FROM gastos g
        INNER JOIN gasto_info gi 
            ON gi.codigo = g.codigo
        ${whereClause}
        ORDER BY g.fecha DESC, g.hora DESC
    `;

    // 두 쿼리 실행
    const [summaryResults, detailResults] = await Promise.all([
        sequelize.query(summaryQuery, {
            bind: queryParams.length > 0 ? queryParams : undefined,
            type: Sequelize.QueryTypes.SELECT
        }),
        sequelize.query(detailQuery, {
            bind: queryParams.length > 0 ? queryParams : undefined,
            type: Sequelize.QueryTypes.SELECT
        })
    ]);

    // 결과가 배열인지 확인
    const summary = Array.isArray(summaryResults) ? summaryResults : [];
    const detail = Array.isArray(detailResults) ? detailResults : [];

    return {
        filters: {
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin || null,
            start_date: fechaInicio,
            end_date: fechaFin || null
        },
        summary: {
            total_rubros: summary.length,
            total_items: detail.length,
            total_costo: summary.reduce((sum, item) => sum + (parseFloat(item.sum_costo) || 0), 0)
        },
        data: {
            summary: summary,
            detail: detail
        }
    };
}

module.exports = { getGastosReport };

