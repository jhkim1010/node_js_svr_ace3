const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getAlertasReport(req) {
    const Logs = getModelForRequest(req, 'Logs');
    const sequelize = Logs.sequelize;

    // 쿼리 파라미터 파싱
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;
    const progname = req.query.progname || null;
    const evento = req.query.evento || null;
    const fechaDesde = req.query.fecha_desde || null;
    const fechaHasta = req.query.fecha_hasta || null;
    const alerta = req.query.alerta === 'true' ? true : (req.query.alerta === 'false' ? false : null);

    // 필터 조건 구성
    const whereConditions = {};
    if (sucursal) whereConditions.sucursal = sucursal;
    if (progname) whereConditions.progname = { [Sequelize.Op.like]: `%${progname}%` };
    if (evento) whereConditions.evento = { [Sequelize.Op.like]: `%${evento}%` };
    if (alerta !== null) whereConditions.alerta = alerta;
    if (fechaDesde || fechaHasta) {
        whereConditions.fecha = {};
        if (fechaDesde) whereConditions.fecha[Sequelize.Op.gte] = fechaDesde;
        if (fechaHasta) whereConditions.fecha[Sequelize.Op.lte] = fechaHasta;
    }

    // 알림 데이터 조회
    const alertas = await Logs.findAll({
        where: whereConditions,
        order: [['fecha', 'DESC'], ['hora', 'DESC']],
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
        raw: true
    });

    // 집계 정보
    const totalAlertas = await Logs.count({ where: whereConditions });
    const totalAlerts = await Logs.count({ where: { ...whereConditions, alerta: true } });
    const totalLogs = await Logs.count({ where: { ...whereConditions, alerta: false } });

    // Sucursal별 집계
    const sucursalStats = await Logs.findAll({
        attributes: [
            'sucursal',
            [sequelize.fn('COUNT', sequelize.col('*')), 'total'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'alertas'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = false THEN 1 END')), 'logs']
        ],
        where: whereConditions,
        group: ['sucursal'],
        order: [[sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'DESC']],
        raw: true
    });

    // Progname별 집계
    const prognameStats = await Logs.findAll({
        attributes: [
            'progname',
            [sequelize.fn('COUNT', sequelize.col('*')), 'total'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'alertas']
        ],
        where: whereConditions,
        group: ['progname'],
        order: [[sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'DESC']],
        limit: 20,
        raw: true
    });

    // 날짜별 집계
    const fechaStats = await Logs.findAll({
        attributes: [
            'fecha',
            [sequelize.fn('COUNT', sequelize.col('*')), 'total'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'alertas']
        ],
        where: whereConditions,
        group: ['fecha'],
        order: [['fecha', 'DESC']],
        limit: 30,
        raw: true
    });

    // 월별 집계
    const monthlyStats = await Logs.findAll({
        attributes: [
            [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha')), 'month'],
            [sequelize.fn('COUNT', sequelize.col('*')), 'total'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'alertas']
        ],
        where: whereConditions,
        group: [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha'))],
        order: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha')), 'DESC']],
        limit: 12,
        raw: true
    });

    // 시간대별 집계 (시간대별 알림 분포)
    const horaStats = await Logs.findAll({
        attributes: [
            [sequelize.fn('SUBSTRING', sequelize.col('hora'), 1, 2), 'hora'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN alerta = true THEN 1 END')), 'alertas']
        ],
        where: { ...whereConditions, alerta: true },
        group: [sequelize.fn('SUBSTRING', sequelize.col('hora'), 1, 2)],
        order: [[sequelize.fn('SUBSTRING', sequelize.col('hora'), 1, 2), 'ASC']],
        raw: true
    });

    // 최근 알림 (알erta = true인 것만)
    const recentAlertas = await Logs.findAll({
        where: { ...whereConditions, alerta: true },
        order: [['fecha', 'DESC'], ['hora', 'DESC']],
        limit: 50,
        raw: true
    });

    return {
        filters: {
            sucursal: sucursal || 'all',
            progname: progname || 'all',
            evento: evento || 'all',
            fecha_desde: fechaDesde || 'all',
            fecha_hasta: fechaHasta || 'all',
            alerta: alerta !== null ? alerta : 'all'
        },
        summary: {
            total_registros: totalAlertas,
            total_alertas: totalAlerts,
            total_logs: totalLogs,
            alerta_percentage: totalAlertas > 0 ? ((totalAlerts / totalAlertas) * 100).toFixed(2) : 0,
            by_sucursal: sucursalStats,
            by_progname: prognameStats,
            by_fecha: fechaStats,
            by_month: monthlyStats,
            by_hora: horaStats,
            recent_alertas: recentAlertas
        },
        data: alertas
    };
}

module.exports = { getAlertasReport };

