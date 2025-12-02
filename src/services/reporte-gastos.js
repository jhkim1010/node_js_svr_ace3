const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getGastosReport(req) {
    const Gastos = getModelForRequest(req, 'Gastos');
    const sequelize = Gastos.sequelize;

    // 쿼리 파라미터 파싱
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;
    const tipo = req.query.tipo || null;
    const tema = req.query.tema || null;
    const fechaDesde = req.query.fecha_desde || null;
    const fechaHasta = req.query.fecha_hasta || null;
    const borrado = req.query.borrado === 'true' ? true : (req.query.borrado === 'false' ? false : null);

    // 필터 조건 구성
    const whereConditions = { borrado: borrado !== null ? borrado : false };
    if (sucursal) whereConditions.sucursal = sucursal;
    if (tipo) whereConditions.tipo = { [Sequelize.Op.like]: `%${tipo}%` };
    if (tema) whereConditions.tema = { [Sequelize.Op.like]: `%${tema}%` };
    if (fechaDesde || fechaHasta) {
        whereConditions.fecha = {};
        if (fechaDesde) whereConditions.fecha[Sequelize.Op.gte] = fechaDesde;
        if (fechaHasta) whereConditions.fecha[Sequelize.Op.lte] = fechaHasta;
    }

    // 지출 조회
    const gastos = await Gastos.findAll({
        where: whereConditions,
        order: [['fecha', 'DESC'], ['id_ga', 'DESC']],
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
        raw: true
    });

    // 집계 정보
    const totalGastos = await Gastos.count({ where: whereConditions });
    const totalCosto = await Gastos.sum('costo', { where: whereConditions });

    // Sucursal별 집계
    const sucursalStats = await Gastos.findAll({
        attributes: [
            'sucursal',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('costo')), 'total_costo'],
            [sequelize.fn('AVG', sequelize.col('costo')), 'avg_costo']
        ],
        where: whereConditions,
        group: ['sucursal'],
        order: [[sequelize.fn('SUM', sequelize.col('costo')), 'DESC']],
        raw: true
    });

    // Tipo별 집계
    const tipoStats = await Gastos.findAll({
        attributes: [
            'tipo',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('costo')), 'total_costo'],
            [sequelize.fn('AVG', sequelize.col('costo')), 'avg_costo']
        ],
        where: { ...whereConditions, tipo: { [Sequelize.Op.ne]: null } },
        group: ['tipo'],
        order: [[sequelize.fn('SUM', sequelize.col('costo')), 'DESC']],
        limit: 20,
        raw: true
    });

    // 날짜별 집계
    const fechaStats = await Gastos.findAll({
        attributes: [
            'fecha',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('costo')), 'total_costo']
        ],
        where: whereConditions,
        group: ['fecha'],
        order: [['fecha', 'DESC']],
        limit: 30,
        raw: true
    });

    // 월별 집계
    const monthlyStats = await Gastos.findAll({
        attributes: [
            [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha')), 'month'],
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('costo')), 'total_costo']
        ],
        where: whereConditions,
        group: [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha'))],
        order: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha')), 'DESC']],
        limit: 12,
        raw: true
    });

    return {
        filters: {
            sucursal: sucursal || 'all',
            tipo: tipo || 'all',
            tema: tema || 'all',
            fecha_desde: fechaDesde || 'all',
            fecha_hasta: fechaHasta || 'all',
            borrado: borrado !== null ? borrado : false
        },
        summary: {
            total_gastos: totalGastos,
            total_costo: parseFloat(totalCosto || 0),
            avg_costo: totalGastos > 0 ? parseFloat(totalCosto || 0) / totalGastos : 0,
            by_sucursal: sucursalStats,
            by_tipo: tipoStats,
            by_fecha: fechaStats,
            by_month: monthlyStats
        },
        data: gastos
    };
}

module.exports = { getGastosReport };

