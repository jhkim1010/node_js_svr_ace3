const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getAlertasReport(req) {
    const Logs = getModelForRequest(req, 'Logs');
    const sequelize = Logs.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    const startDate = req.query.fecha_inicio || req.query.start_date || req.query.fecha_desde;
    const endDate = req.query.fecha_fin || req.query.end_date || req.query.fecha_hasta;

    // 날짜 범위 필터 (필수)
    if (!startDate || !endDate) {
        throw new Error('fecha_inicio and fecha_fin are required');
    }

    // 사용자가 제공한 쿼리 형식 사용
    const query = `
        SELECT 
            l.fecha,
            hora,
            l.evento,
            l.progname,
            alerta,
            l.sucursal
        FROM logs l
        WHERE fecha BETWEEN $1 AND $2
            AND alerta IS TRUE
        ORDER BY l.fecha DESC, hora DESC
    `;

    // SQL 쿼리 실행
    const results = await sequelize.query(query, {
        bind: [startDate, endDate],
        type: Sequelize.QueryTypes.SELECT
    });

    // 결과가 배열인지 확인
    const alertas = Array.isArray(results) ? results : [];

    return {
        filters: {
            fecha_inicio: startDate,
            fecha_fin: endDate,
            start_date: startDate,
            end_date: endDate
        },
        summary: {
            total_items: alertas.length
        },
        data: alertas
    };
}

module.exports = { getAlertasReport };

