const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getVentasReport(req) {
    const Vcode = getModelForRequest(req, 'Vcode');
    const Vdetalle = getModelForRequest(req, 'Vdetalle');
    const sequelize = Vcode.sequelize;

    // 쿼리 파라미터 파싱
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;
    const dni = req.query.dni || null;
    const vendedor = req.query.vendedor || null;
    const fechaDesde = req.query.fecha_desde || null;
    const fechaHasta = req.query.fecha_hasta || null;
    const bCancelado = req.query.b_cancelado === 'true' ? true : (req.query.b_cancelado === 'false' ? false : null);
    const bMercadoPago = req.query.b_mercadopago === 'true' ? true : (req.query.b_mercadopago === 'false' ? false : null);

    // Vcode 필터 조건 구성
    const vcodeWhere = { borrado: false };
    if (sucursal) vcodeWhere.sucursal = sucursal;
    if (dni) vcodeWhere.dni = dni;
    if (vendedor) vcodeWhere.vendedor = vendedor;
    if (bCancelado !== null) vcodeWhere.b_cancelado = bCancelado;
    if (bMercadoPago !== null) vcodeWhere.b_mercadopago = bMercadoPago;
    if (fechaDesde || fechaHasta) {
        vcodeWhere.fecha = {};
        if (fechaDesde) vcodeWhere.fecha[Sequelize.Op.gte] = fechaDesde;
        if (fechaHasta) vcodeWhere.fecha[Sequelize.Op.lte] = fechaHasta;
    }

    // 판매 데이터 조회
    const ventas = await Vcode.findAll({
        where: vcodeWhere,
        order: [['fecha', 'DESC'], ['vcode_id', 'DESC']],
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
        raw: true
    });

    // 집계 정보
    const totalVentas = await Vcode.count({ where: vcodeWhere });
    const totalMonto = await Vcode.sum('tpago', { where: vcodeWhere });
    const totalEfectivo = await Vcode.sum('tefectivo', { where: vcodeWhere });
    const totalCredito = await Vcode.sum('tcredito', { where: vcodeWhere });
    const totalBanco = await Vcode.sum('tbanco', { where: vcodeWhere });
    const totalFavor = await Vcode.sum('tfavor', { where: vcodeWhere });
    const totalRopas = await Vcode.sum('cntropas', { where: vcodeWhere });

    // Sucursal별 집계
    const sucursalStats = await Vcode.findAll({
        attributes: [
            'sucursal',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('tpago')), 'total_monto'],
            [sequelize.fn('SUM', sequelize.col('tefectivo')), 'total_efectivo'],
            [sequelize.fn('SUM', sequelize.col('tcredito')), 'total_credito'],
            [sequelize.fn('SUM', sequelize.col('tbanco')), 'total_banco'],
            [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_ropas']
        ],
        where: vcodeWhere,
        group: ['sucursal'],
        order: [[sequelize.fn('SUM', sequelize.col('tpago')), 'DESC']],
        raw: true
    });

    // 날짜별 집계
    const fechaStats = await Vcode.findAll({
        attributes: [
            'fecha',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('tpago')), 'total_monto'],
            [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_ropas']
        ],
        where: vcodeWhere,
        group: ['fecha'],
        order: [['fecha', 'DESC']],
        limit: 30,
        raw: true
    });

    // 월별 집계
    const monthlyStats = await Vcode.findAll({
        attributes: [
            [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha')), 'month'],
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('tpago')), 'total_monto'],
            [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_ropas']
        ],
        where: vcodeWhere,
        group: [sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha'))],
        order: [[sequelize.fn('DATE_TRUNC', 'month', sequelize.col('fecha')), 'DESC']],
        limit: 12,
        raw: true
    });

    // Vendedor별 집계
    const vendedorStats = await Vcode.findAll({
        attributes: [
            'vendedor',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
            [sequelize.fn('SUM', sequelize.col('tpago')), 'total_monto'],
            [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_ropas']
        ],
        where: { ...vcodeWhere, vendedor: { [Sequelize.Op.ne]: null } },
        group: ['vendedor'],
        order: [[sequelize.fn('SUM', sequelize.col('tpago')), 'DESC']],
        limit: 20,
        raw: true
    });

    // Vdetalle 집계 (판매 상세)
    const vdetalleWhere = {
        borrado: false,
        codigo1: { [Sequelize.Op.ne]: 'de' }
    };
    if (sucursal) vdetalleWhere.sucursal = sucursal;
    if (fechaDesde || fechaHasta) {
        vdetalleWhere.fecha1 = {};
        if (fechaDesde) vdetalleWhere.fecha1[Sequelize.Op.gte] = fechaDesde;
        if (fechaHasta) vdetalleWhere.fecha1[Sequelize.Op.lte] = fechaHasta;
    }

    const itemsVendidos = await Vdetalle.findAll({
        attributes: [
            [sequelize.fn('COUNT', sequelize.col('*')), 'total_items'],
            [sequelize.fn('SUM', sequelize.col('cant1')), 'total_cantidad'],
            [sequelize.fn('SUM', sequelize.literal('cant1 * COALESCE(preuni, precio)')), 'total_valor']
        ],
        where: vdetalleWhere,
        raw: true
    });

    // 상위 판매 상품
    const topItems = await Vdetalle.findAll({
        attributes: [
            'codigo1',
            [sequelize.fn('SUM', sequelize.col('cant1')), 'total_cantidad'],
            [sequelize.fn('SUM', sequelize.literal('cant1 * COALESCE(preuni, precio)')), 'total_valor']
        ],
        where: vdetalleWhere,
        group: ['codigo1'],
        order: [[sequelize.fn('SUM', sequelize.literal('cant1 * COALESCE(preuni, precio)')), 'DESC']],
        limit: 20,
        raw: true
    });

    return {
        filters: {
            sucursal: sucursal || 'all',
            dni: dni || 'all',
            vendedor: vendedor || 'all',
            fecha_desde: fechaDesde || 'all',
            fecha_hasta: fechaHasta || 'all',
            b_cancelado: bCancelado !== null ? bCancelado : 'all',
            b_mercadopago: bMercadoPago !== null ? bMercadoPago : 'all'
        },
        summary: {
            total_ventas: totalVentas,
            total_monto: parseFloat(totalMonto || 0),
            total_efectivo: parseFloat(totalEfectivo || 0),
            total_credito: parseFloat(totalCredito || 0),
            total_banco: parseFloat(totalBanco || 0),
            total_favor: parseFloat(totalFavor || 0),
            total_ropas: parseFloat(totalRopas || 0),
            avg_monto_por_venta: totalVentas > 0 ? parseFloat(totalMonto || 0) / totalVentas : 0,
            items_vendidos: itemsVendidos[0] || {},
            by_sucursal: sucursalStats,
            by_fecha: fechaStats,
            by_month: monthlyStats,
            by_vendedor: vendedorStats,
            top_items: topItems
        },
        data: ventas
    };
}

module.exports = { getVentasReport };

