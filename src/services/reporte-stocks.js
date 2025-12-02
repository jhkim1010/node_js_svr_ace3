const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getStocksReport(req) {
    const Ingresos = getModelForRequest(req, 'Ingresos');
    const Vdetalle = getModelForRequest(req, 'Vdetalle');
    const Codigos = getModelForRequest(req, 'Codigos');
    const sequelize = Ingresos.sequelize;

    // 쿼리 파라미터 파싱
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;
    const codigo = req.query.codigo || null;
    const fechaDesde = req.query.fecha_desde || null;
    const fechaHasta = req.query.fecha_hasta || null;

    // 재고 계산: 입고(Ingresos) - 판매(Vdetalle)
    // 입고 집계 (borrado = false)
    const ingresosWhere = { borrado: false };
    if (sucursal) ingresosWhere.sucursal = sucursal;
    if (codigo) ingresosWhere.codigo = codigo;
    if (fechaDesde || fechaHasta) {
        ingresosWhere.fecha = {};
        if (fechaDesde) ingresosWhere.fecha[Sequelize.Op.gte] = fechaDesde;
        if (fechaHasta) ingresosWhere.fecha[Sequelize.Op.lte] = fechaHasta;
    }

    const ingresosResult = await Ingresos.findAll({
        attributes: [
            'codigo',
            'sucursal',
            [sequelize.fn('SUM', sequelize.col('cant3')), 'total_ingresos'],
            [sequelize.fn('SUM', sequelize.literal('cant3 * COALESCE(pre1, 0)')), 'total_valor_ingresos']
        ],
        where: ingresosWhere,
        group: ['codigo', 'sucursal'],
        raw: true
    });

    // 판매 집계 (borrado = false, codigo1 != 'de')
    const ventasWhere = {
        borrado: false,
        codigo1: { [Sequelize.Op.ne]: 'de' }
    };
    if (sucursal) ventasWhere.sucursal = sucursal;
    if (codigo) ventasWhere.codigo1 = codigo;
    if (fechaDesde || fechaHasta) {
        ventasWhere.fecha1 = {};
        if (fechaDesde) ventasWhere.fecha1[Sequelize.Op.gte] = fechaDesde;
        if (fechaHasta) ventasWhere.fecha1[Sequelize.Op.lte] = fechaHasta;
    }

    const ventasResult = await Vdetalle.findAll({
        attributes: [
            'codigo1',
            'sucursal',
            [sequelize.fn('SUM', sequelize.col('cant1')), 'total_ventas'],
            [sequelize.fn('SUM', sequelize.literal('cant1 * COALESCE(preuni, 0)')), 'total_valor_ventas']
        ],
        where: ventasWhere,
        group: ['codigo1', 'sucursal'],
        raw: true
    });

    // 결과 합치기
    const stockMap = new Map();

    // 입고 데이터 추가
    ingresosResult.forEach(item => {
        const key = `${item.codigo}_${item.sucursal}`;
        if (!stockMap.has(key)) {
            stockMap.set(key, {
                codigo: item.codigo,
                sucursal: item.sucursal,
                total_ingresos: parseFloat(item.total_ingresos || 0),
                total_ventas: 0,
                stock_actual: 0,
                total_valor_ingresos: parseFloat(item.total_valor_ingresos || 0),
                total_valor_ventas: 0
            });
        } else {
            const existing = stockMap.get(key);
            existing.total_ingresos += parseFloat(item.total_ingresos || 0);
            existing.total_valor_ingresos += parseFloat(item.total_valor_ingresos || 0);
        }
    });

    // 판매 데이터 추가
    ventasResult.forEach(item => {
        const key = `${item.codigo1}_${item.sucursal}`;
        if (!stockMap.has(key)) {
            stockMap.set(key, {
                codigo: item.codigo1,
                sucursal: item.sucursal,
                total_ingresos: 0,
                total_ventas: parseFloat(item.total_ventas || 0),
                stock_actual: 0,
                total_valor_ingresos: 0,
                total_valor_ventas: parseFloat(item.total_valor_ventas || 0)
            });
        } else {
            const existing = stockMap.get(key);
            existing.total_ventas += parseFloat(item.total_ventas || 0);
            existing.total_valor_ventas += parseFloat(item.total_valor_ventas || 0);
        }
    });

    // 재고 계산
    const stocks = Array.from(stockMap.values()).map(item => ({
        ...item,
        stock_actual: item.total_ingresos - item.total_ventas
    }));

    return {
        filters: {
            sucursal: sucursal || 'all',
            codigo: codigo || 'all',
            fecha_desde: fechaDesde || 'all',
            fecha_hasta: fechaHasta || 'all'
        },
        summary: {
            total_items: stocks.length,
            total_stock_actual: stocks.reduce((sum, item) => sum + item.stock_actual, 0),
            total_valor_stock: stocks.reduce((sum, item) => sum + (item.stock_actual * (item.total_valor_ingresos / (item.total_ingresos || 1))), 0)
        },
        data: stocks
    };
}

module.exports = { getStocksReport };

