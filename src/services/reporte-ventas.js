const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

/**
 * 날짜 차이를 계산하여 기간을 판단하는 함수
 * @param {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @param {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @returns {Object} { days: number, months: number, years: number, isSameDay: boolean }
 */
function calculatePeriod(startDate, endDate) {
    if (!startDate || !endDate) {
        return { days: 0, months: 0, years: 0, isSameDay: false };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // 동일한 날짜인지 확인
    const isSameDay = startDate === endDate;
    
    // 날짜 차이 계산 (밀리초)
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // 대략적인 월 수 계산 (30일 기준)
    const diffMonths = Math.floor(diffDays / 30);
    
    // 대략적인 연 수 계산 (365일 기준)
    const diffYears = Math.floor(diffDays / 365);
    
    return {
        days: diffDays,
        months: diffMonths,
        years: diffYears,
        isSameDay: isSameDay
    };
}

async function getVentasReport(req) {
    const Vcode = getModelForRequest(req, 'Vcode');
    const sequelize = Vcode.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    const fechaInicio = req.query.fecha_inicio || req.query.start_date || req.query.fecha_desde;
    const fechaFin = req.query.fecha_fin || req.query.end_date || req.query.fecha_hasta;

    // 날짜가 없으면 에러 반환
    if (!fechaInicio || !fechaFin) {
        throw new Error('fecha_inicio and fecha_fin are required');
    }

    // 기간 계산
    const period = calculatePeriod(fechaInicio, fechaFin);
    
    // 어떤 함수를 호출할지 결정
    let functionName;
    if (period.isSameDay) {
        // 동일한 날짜인 경우
        functionName = 'ventas_rpt_a_day';
    } else if (period.years >= 2) {
        // 2년 이상인 경우
        functionName = 'ventas_rpt_x_year';
    } else if (period.months >= 2) {
        // 2개월 이상인 경우
        functionName = 'ventas_rpt_x_month';
    } else {
        // 그 외 (기간, 2개월 미만)
        functionName = 'ventas_rpt_a_periodo';
    }

    // PostgreSQL 함수 호출 시도, 실패 시 직접 쿼리로 fallback
    let query;
    let queryParams;
    let data = [];
    let functionUsed = false;

    try {
        // 함수 호출 쿼리 (PostgreSQL 함수 호출 형식)
        query = `SELECT * FROM ${functionName}($1, $2)`;
        queryParams = [fechaInicio, fechaFin];

        console.log(`[Ventas 보고서] PostgreSQL 함수 호출 시도: ${functionName}(${fechaInicio}, ${fechaFin})`);

        // SQL 쿼리 실행
        const results = await sequelize.query(query, {
            bind: queryParams,
            type: Sequelize.QueryTypes.SELECT
        });

        // 결과가 배열인지 확인
        data = Array.isArray(results) ? results : [];
        functionUsed = true;
        
        console.log(`[Ventas 보고서] PostgreSQL 함수 호출 성공: ${data.length}개 레코드 반환`);
    } catch (err) {
        console.error(`\n[Ventas 보고서 오류] 함수 ${functionName} 호출 실패:`);
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        if (err.original) {
            console.error('   Original error:', err.original.message);
            console.error('   Original code:', err.original.code);
        }
        
        // 함수가 존재하지 않는 경우 직접 쿼리로 fallback
        const isFunctionNotFound = err.message && (
            err.message.includes('does not exist') ||
            err.message.includes('function') && err.message.includes('not found') ||
            err.original && err.original.code === '42883' // PostgreSQL function does not exist
        );
        
        if (isFunctionNotFound) {
            console.log(`[Ventas 보고서] PostgreSQL 함수가 없습니다. 직접 쿼리로 fallback...`);
            
            try {
                // 직접 쿼리로 데이터 조회
                const directQuery = `
                    SELECT 
                        vcode_id as id,
                        hora,
                        tpago,
                        cntropas,
                        clientenombre,
                        tefectivo,
                        tcredito,
                        tbanco,
                        treservado,
                        tfavor,
                        vendedor,
                        tipo,
                        dni,
                        resiva,
                        casoesp,
                        nencargado,
                        cretmp,
                        fecha,
                        sucursal,
                        ntiqrepetir,
                        vcode_id,
                        b_mercadopago,
                        d_num_caja,
                        d_num_terminal
                    FROM public.vcodes
                    WHERE fecha >= :fechaInicio 
                        AND fecha <= :fechaFin 
                        AND borrado = false
                    ORDER BY vcode_id ASC
                `;
                
                const directResults = await sequelize.query(directQuery, {
                    replacements: {
                        fechaInicio: fechaInicio,
                        fechaFin: fechaFin
                    },
                    type: Sequelize.QueryTypes.SELECT
                });
                
                data = Array.isArray(directResults) ? directResults : [];
                console.log(`[Ventas 보고서] 직접 쿼리 성공: ${data.length}개 레코드 반환`);
                
                // 하루치 보고서인 경우 함수 이름을 ventas_rpt_a_day로 설정
                if (period.isSameDay) {
                    functionName = 'ventas_rpt_a_day';
                }
            } catch (fallbackErr) {
                console.error(`[Ventas 보고서] 직접 쿼리도 실패:`);
                console.error('   Error:', fallbackErr.message);
                throw fallbackErr;
            }
        } else {
            // 다른 종류의 에러는 그대로 throw
            throw err;
        }
    }

    return {
        filters: {
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            start_date: fechaInicio,
            end_date: fechaFin,
            period_days: period.days,
            period_months: period.months,
            period_years: period.years,
            is_same_day: period.isSameDay
        },
        summary: {
            function_used: functionUsed ? functionName : (period.isSameDay ? 'ventas_rpt_a_day' : functionName),
            total_items: data.length
        },
        data: data
    };
}

// 기존 함수는 유지 (하위 호환성을 위해)
async function getVentasReportLegacy(req) {
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

