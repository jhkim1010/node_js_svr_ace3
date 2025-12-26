const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

/**
 * 추가 필터 조건을 생성하는 함수
 * @param {boolean} isDescontado - descontado 필터 여부
 * @param {boolean} isReservado - reservado 필터 여부
 * @param {boolean} isCredito - credito 필터 여부
 * @returns {string} SQL WHERE 조건 문자열
 */
function buildAdditionalFilters(isDescontado, isReservado, isCredito) {
    const conditions = [];
    
    if (isDescontado) {
        conditions.push('AND b_descontado IS TRUE');
    }
    
    if (isReservado) {
        conditions.push('AND b_reservado IS TRUE');
    }
    
    if (isCredito) {
        conditions.push('AND (b_endeudando IS TRUE OR b_deudapago IS TRUE)');
    }
    
    return conditions.length > 0 ? '\n                        ' + conditions.join('\n                        ') : '';
}

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
    
    // 데이터베이스 정보 추출 (헤더에서 파싱된 정보 사용)
    const dbInfo = req.dbConfig ? {
        database: req.dbConfig.database || 'unknown',
        host: req.dbConfig.host || 'unknown',
        port: req.dbConfig.port || 'unknown'
    } : {
        database: 'unknown',
        host: 'unknown',
        port: 'unknown'
    };

    // 쿼리 파라미터 파싱 (날짜 범위)
    const fechaInicio = req.query.fecha_inicio || req.query.start_date || req.query.fecha_desde;
    const fechaFin = req.query.fecha_fin || req.query.end_date || req.query.fecha_hasta;
    
    // unit 파라미터 파싱 (기본값: 'vcode')
    const unit = req.query.unit || 'vcode';
    
    // descontado 파라미터 파싱 (체크박스 상태)
    const descontado = req.query.descontado || req.body.descontado;
    const isDescontado = descontado === 'true' || descontado === true || descontado === '1' || descontado === 1;
    
    // reservado 파라미터 파싱 (체크박스 상태)
    const reservado = req.query.reservado || req.body.reservado;
    const isReservado = reservado === 'true' || reservado === true || reservado === '1' || reservado === 1;
    
    // credito 파라미터 파싱 (체크박스 상태)
    const credito = req.query.credito || req.body.credito;
    const isCredito = credito === 'true' || credito === true || credito === '1' || credito === 1;

    // 날짜가 없으면 에러 반환
    if (!fechaInicio || !fechaFin) {
        throw new Error('fecha_inicio and fecha_fin are required');
    }
    
    // unit 값 검증
    const validUnits = ['vcode', 'day', 'month', 'year'];
    if (!validUnits.includes(unit)) {
        throw new Error(`Invalid unit parameter. Valid values: ${validUnits.join(', ')}`);
    }

    // 기간 계산
    const period = calculatePeriod(fechaInicio, fechaFin);
    
    // unit이 'vcode'가 아닌 경우 (day, month, year) 직접 쿼리 실행
    // unit이 'vcode'이거나 없으면 PostgreSQL 함수 호출 시도
    let query;
    let queryParams;
    let data = [];
    let functionUsed = false;
    let functionName;

    // unit이 day, month, year인 경우 직접 쿼리 실행
    if (unit !== 'vcode') {
        try {
            // unit에 따라 쿼리 구성
            let directQuery;
            let fechaField = '';
            
            if (unit === 'day') {
                // 일별 그룹화 (fecha 형식: "YYYY-MM-DD")
                fechaField = `fecha::text as fecha`;
                directQuery = `
                    SELECT 
                        fecha,
                        COUNT(*) as eventCount,
                        SUM(tpago) as tVents,
                        SUM(cntropas) as tCntRopas,
                        SUM(tefectivo) as tefectivo,
                        SUM(tcredito) as tcredito,
                        SUM(tbanco) as tbanco,
                        SUM(treservado) as treservado,
                        SUM(tfavor) as tfavor,
                        sucursal
                    FROM public.vcodes
                    WHERE fecha BETWEEN :fechaInicio AND :fechaFin 
                        AND borrado = false
                        AND b_cancelado IS FALSE${buildAdditionalFilters(isDescontado, isReservado, isCredito)}
                    GROUP BY fecha, sucursal
                    ORDER BY fecha DESC
                `;
            } else if (unit === 'month') {
                // 월별 그룹화
                fechaField = `DATE_TRUNC('month', fecha)::date AS month`;
                directQuery = `
                    SELECT 
                        DATE_TRUNC('month', fecha)::date AS month,
                        COUNT(*) AS eventCount,
                        SUM(tpago) AS tVents,
                        SUM(cntropas) AS tCntRopas,
                        SUM(tefectivo) AS tefectivo,
                        SUM(tcredito) AS tcredito,
                        SUM(tbanco) AS tbanco,
                        SUM(treservado) AS treservado,
                        SUM(tfavor) AS tfavor,
                        sucursal
                    FROM public.vcodes
                    WHERE fecha BETWEEN :fechaInicio AND :fechaFin 
                        AND borrado IS FALSE
                        AND b_cancelado IS FALSE${buildAdditionalFilters(isDescontado, isReservado, isCredito)}
                    GROUP BY DATE_TRUNC('month', fecha), sucursal
                    ORDER BY DATE_TRUNC('month', fecha) DESC
                `;
            } else if (unit === 'year') {
                // 연도별 그룹화
                fechaField = `DATE_TRUNC('year', fecha)::date AS year`;
                directQuery = `
                    SELECT 
                        DATE_TRUNC('year', fecha)::date AS year,
                        COUNT(*) AS eventCount,
                        SUM(tpago) AS tVents,
                        SUM(cntropas) AS tCntRopas,
                        SUM(tefectivo) AS tefectivo,
                        SUM(tcredito) AS tcredito,
                        SUM(tbanco) AS tbanco,
                        SUM(treservado) AS treservado,
                        SUM(tfavor) AS tfavor,
                        sucursal
                    FROM public.vcodes
                    WHERE fecha BETWEEN :fechaInicio AND :fechaFin 
                        AND borrado IS FALSE
                        AND b_cancelado IS FALSE${buildAdditionalFilters(isDescontado, isReservado, isCredito)}
                    GROUP BY DATE_TRUNC('year', fecha), sucursal
                    ORDER BY DATE_TRUNC('year', fecha) DESC
                `;
            }
            
            const directResults = await sequelize.query(directQuery, {
                replacements: {
                    fechaInicio: fechaInicio,
                    fechaFin: fechaFin
                },
                type: Sequelize.QueryTypes.SELECT
            });
            
            data = Array.isArray(directResults) ? directResults : [];
            functionUsed = false;
            functionName = `direct_query_${unit}`;
        } catch (directErr) {
            console.error(`[Ventas 보고서] 직접 쿼리 실행 실패 (unit: ${unit}):`);
            console.error('   Error:', directErr.message);
            throw directErr;
        }
    } else {
        // unit이 'vcode'이거나 없는 경우: PostgreSQL 함수 호출 시도, 실패 시 직접 쿼리로 fallback
        // 어떤 함수를 호출할지 결정
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

        try {
            // 함수 호출 쿼리 (PostgreSQL 함수 호출 형식)
            // 파라미터 타입을 명시적으로 지정 (DATE 타입으로 캐스팅)
            // 먼저 public 스키마를 시도하고, 실패하면 스키마 없이 시도
            let results;
            try {
                // public 스키마에서 시도
                query = `SELECT * FROM public.${functionName}($1::DATE, $2::DATE)`;
                queryParams = [fechaInicio, fechaFin];
                results = await sequelize.query(query, {
                    bind: queryParams,
                    type: Sequelize.QueryTypes.SELECT
                });
            } catch (schemaErr) {
                // public 스키마 실패 시 스키마 없이 시도 (search_path 사용)
                query = `SELECT * FROM ${functionName}($1::DATE, $2::DATE)`;
                queryParams = [fechaInicio, fechaFin];
                results = await sequelize.query(query, {
                    bind: queryParams,
                    type: Sequelize.QueryTypes.SELECT
                });
            }

            // 결과가 배열인지 확인
            data = Array.isArray(results) ? results : [];
            functionUsed = true;
        } catch (err) {
            // 함수가 존재하지 않는 경우 직접 쿼리로 fallback
            const isFunctionNotFound = err.message && (
                err.message.includes('does not exist') ||
                err.message.includes('function') && err.message.includes('not found') ||
                err.original && err.original.code === '42883' // PostgreSQL function does not exist
            );
            
            // 함수가 존재하지 않는 경우는 정상적인 fallback이므로 로그를 최소화
            if (isFunctionNotFound) {
                // 함수가 없으면 직접 쿼리로 fallback (정상 동작, 로그 출력 안 함)
            } else {
                // 다른 종류의 오류는 상세 로그 출력
                console.error(`\n[Ventas 보고서 오류] 함수 ${functionName} 호출 실패:`);
                console.error(`   Database: ${dbInfo.database} (${dbInfo.host}:${dbInfo.port})`);
                console.error('   Error type:', err.constructor.name);
                console.error('   Error message:', err.message);
                if (err.original) {
                    console.error('   Original error:', err.original.message);
                    console.error('   Original code:', err.original.code);
                }
            }
            
            if (isFunctionNotFound) {
                try {
                    // unit이 'vcode'인 경우 직접 쿼리 구성
                    let directQuery;
                    
                    // 하루치 보고서인 경우 (ventas_rpt_a_day)
                    if (period.isSameDay) {
                        directQuery = `
                            SELECT 
                                RIGHT(vcode, 5) as vcode,
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
                                hora,
                                fecha,
                                resiva,
                                casoesp,
                                nencargado,
                                cretmp,
                                sucursal,
                                ntiqrepetir,
                                b_mercadopago,
                                d_num_caja,
                                d_num_terminal,
                                vcode_id as id
                            FROM public.vcodes
                            WHERE fecha = :fechaInicio 
                                AND borrado IS FALSE${buildAdditionalFilters(isDescontado, isReservado, isCredito)}
                            ORDER BY vcode_id ASC
                        `;
                    } else {
                        // 기간 보고서인 경우
                        directQuery = `
                            SELECT 
                                RIGHT(vcode, 5) as vcode,
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
                                hora,
                                fecha,
                                resiva,
                                casoesp,
                                nencargado,
                                cretmp,
                                sucursal,
                                ntiqrepetir,
                                b_mercadopago,
                                d_num_caja,
                                d_num_terminal,
                                vcode_id as id
                            FROM public.vcodes
                            WHERE fecha >= :fechaInicio 
                                AND fecha <= :fechaFin 
                                AND borrado IS FALSE${buildAdditionalFilters(isDescontado, isReservado, isCredito)}
                            ORDER BY vcode_id ASC
                        `;
                    }
                
                const directResults = await sequelize.query(directQuery, {
                    replacements: {
                        fechaInicio: fechaInicio,
                        fechaFin: fechaFin
                    },
                    type: Sequelize.QueryTypes.SELECT
                });
                
                data = Array.isArray(directResults) ? directResults : [];
                
                // 하루치 보고서인 경우 함수 이름을 ventas_rpt_a_day로 설정
                if (period.isSameDay) {
                    functionName = 'ventas_rpt_a_day';
                }
            } catch (fallbackErr) {
                console.error(`[Ventas 보고서] 직접 쿼리도 실패:`);
                console.error(`   Database: ${dbInfo.database} (${dbInfo.host}:${dbInfo.port})`);
                console.error('   Error:', fallbackErr.message);
                throw fallbackErr;
            }
        } else {
            // 다른 종류의 에러는 그대로 throw
            throw err;
        }
        }
    }

    return {
        filters: {
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            start_date: fechaInicio,
            end_date: fechaFin,
            unit: unit,
            descontado: isDescontado,
            reservado: isReservado,
            credito: isCredito,
            period_days: period.days,
            period_months: period.months,
            period_years: period.years,
            is_same_day: period.isSameDay
        },
        summary: {
            function_used: functionUsed ? functionName : (period.isSameDay ? 'ventas_rpt_a_day' : functionName),
            total_items: data.length,
            unit: unit
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

