const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { isClientDisconnected } = require('../middleware/client-disconnect-handler');

const router = Router();

router.post('/', async (req, res) => {
    console.log('[resumen_del_dia] 요청 받음:', {
        body: req.body,
        dbConfig: req.dbConfig ? {
            host: req.dbConfig.host,
            port: req.dbConfig.port,
            database: req.dbConfig.database,
            user: req.dbConfig.user
        } : null
    });
    
    try {
        // 필수 DB 헤더 검증
        const missingHeaders = [];
        if (!req.dbConfig) {
            missingHeaders.push('DB 설정 정보가 없습니다. 헤더에 DB 연결 정보가 필요합니다.');
        } else {
            if (!req.dbConfig.host) missingHeaders.push('x-db-host 헤더가 필요합니다');
            if (!req.dbConfig.port) missingHeaders.push('x-db-port 헤더가 필요합니다');
            if (!req.dbConfig.database) missingHeaders.push('x-db-name 헤더가 필요합니다');
            if (!req.dbConfig.user) missingHeaders.push('x-db-user 헤더가 필요합니다');
            if (!req.dbConfig.password) missingHeaders.push('x-db-password 헤더가 필요합니다');
        }
        
        if (missingHeaders.length > 0) {
            console.log('[resumen_del_dia] 필수 헤더 부족:', missingHeaders);
            return res.status(400).json({
                success: false,
                error: '필수 정보 부족',
                message: 'Required information is missing',
                missing: missingHeaders,
                required_headers: [
                    'x-db-host (또는 db-host): PostgreSQL 서버 주소',
                    'x-db-port (또는 db-port): PostgreSQL 포트 번호',
                    'x-db-name (또는 db-name): 데이터베이스 이름',
                    'x-db-user (또는 db-user): 데이터베이스 사용자 이름',
                    'x-db-password (또는 db-password): 데이터베이스 비밀번호'
                ],
                optional_headers: [
                    'x-db-ssl (또는 db-ssl): SSL 사용 여부 (true/false)'
                ]
            });
        }
        
        console.log('[resumen_del_dia] 모델 가져오기 시작');
        const Vcode = getModelForRequest(req, 'Vcode');
        console.log('[resumen_del_dia] Vcode 모델 가져옴');
        const Gastos = getModelForRequest(req, 'Gastos');
        console.log('[resumen_del_dia] Gastos 모델 가져옴');
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        console.log('[resumen_del_dia] Vdetalle 모델 가져옴');
        const Ingresos = getModelForRequest(req, 'Ingresos');
        console.log('[resumen_del_dia] Ingresos 모델 가져옴');
        const sequelize = Vcode.sequelize;
        
        // 요청 본문에서 date와 sucursal 받기
        let targetDate = req.body?.date || req.body?.fecha;
        const sucursal = req.body?.sucursal;
        
        // 날짜가 제공되지 않으면 현재 날짜 사용
        let vcodeDate, otherDate;
        
        if (targetDate) {
            // 날짜 유효성 검사
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(targetDate)) {
                return res.status(400).json({
                    error: '날짜 형식 오류',
                    message: 'Invalid date format',
                    received: targetDate,
                    expected: 'YYYY-MM-DD 형식 (예: 2024-01-15)'
                });
            }
            // 모든 쿼리에 동일한 날짜 사용
            vcodeDate = targetDate;
            otherDate = targetDate;
        } else {
            // 기본값: 현재 날짜 사용
            const today = new Date();
            const dateString = today.toISOString().split('T')[0]; // YYYY-MM-DD
            vcodeDate = dateString;
            otherDate = dateString;
        }
        
        // 쿼리 1: vcodes 데이터 집계 - Sucursal별 그룹화
        // 조건: fecha = target_date AND b_cancelado is false AND borrado is false AND clientenombre not like '%CAJA%'
        const vcodeWhereConditions = [
            { fecha: vcodeDate },
            { b_cancelado: false },
            { borrado: false },
            { clientenombre: { [Sequelize.Op.notLike]: '%CAJA%' } }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            vcodeWhereConditions.push({ sucursal: sucursal });
        }
        
        // 클라이언트 연결 종료 체크 (nginx를 통한 요청에서는 신뢰할 수 없으므로 주석 처리)
        // nginx를 통한 요청에서는 소켓 상태가 다를 수 있어서 잘못 감지될 수 있음
        // if (isClientDisconnected(req)) {
        //     // 클라이언트 연결이 끊어졌으면 조기 종료 (연결 풀 낭비 방지)
        //     // 하지만 응답은 보내야 함 (nginx가 타임아웃을 기다리지 않도록)
        //     if (!res.headersSent) {
        //         return res.status(499).json({ 
        //             error: 'Client closed request',
        //             message: 'Client disconnected before response could be sent'
        //         });
        //     }
        //     return;
        // }
        
        const vcodeResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'operation_count'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_venta_day'],
                [sequelize.fn('SUM', sequelize.col('tefectivo')), 'total_efectivo_day'],
                [sequelize.fn('SUM', sequelize.col('tcredito')), 'total_credito_day'],
                [sequelize.fn('SUM', sequelize.col('tbanco')), 'total_banco_day'],
                [sequelize.fn('SUM', sequelize.col('tfavor')), 'total_favor_day'],
                [sequelize.fn('MAX', sequelize.col('hora')), 'last_venta_hour'],
                [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_count_ropas'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: vcodeWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 2: gastos 데이터 집계 - Sucursal별 그룹화
        // 조건: fecha = target_date AND borrado is false
        const gastosWhereConditions = [
            { fecha: otherDate },
            { borrado: false }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            gastosWhereConditions.push({ sucursal: sucursal });
        }
        
        const gastosResult = await Gastos.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'gasto_count'],
                [sequelize.fn('SUM', sequelize.col('costo')), 'total_gasto_day'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: gastosWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 3: vdetalle 데이터 집계 - Sucursal별 그룹화
        // 조건: fecha1 = target_date AND borrado is false AND codigo1 = 'de'
        const vdetalleWhereConditions = [
            { fecha1: otherDate },
            { borrado: false },
            { codigo1: 'de' }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            vdetalleWhereConditions.push({ sucursal: sucursal });
        }
        
        const vdetalleResult = await Vdetalle.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_discount_event'],
                [sequelize.fn('SUM', sequelize.col('precio')), 'total_discount_day'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: vdetalleWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 4: vcodes 데이터 집계 (MercadoPago) - Sucursal별 그룹화
        // 조건: fecha = target_date AND b_cancelado is false AND borrado is false AND b_mercadopago is true
        const vcodeMpagoWhereConditions = [
            { fecha: otherDate },
            { b_cancelado: false },
            { borrado: false },
            { b_mercadopago: true }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            vcodeMpagoWhereConditions.push({ sucursal: sucursal });
        }
        
        const vcodeMpagoResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_mpago_total'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_mpago_day'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: vcodeMpagoWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 5: ingresos 데이터 집계 - Sucursal별 그룹화
        // 조건: fecha = target_date AND borrado is false
        const ingresosWhereConditions = [
            { fecha: otherDate },
            { borrado: false }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            ingresosWhereConditions.push({ sucursal: sucursal });
        }
        
        const ingresosResult = await Ingresos.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'ingreso_events'],
                [sequelize.fn('SUM', sequelize.col('cant3')), 'ingreso_total_ropas'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: ingresosWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 6: stocks 데이터 집계 (screendetails2_id) - Sucursal별 그룹화
        const stocksQueryParams = [];
        let stocksParamIndex = 1;
        let stocksWhereConditions = ['si.sucursal >= 1'];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            stocksWhereConditions.push(`si.sucursal = $${stocksParamIndex}`);
            stocksQueryParams.push(sucursal);
            stocksParamIndex++;
        }

        const stocksQuery = `
            SELECT 
                COUNT(*) as item_count, 
                SUM(si.totalventa) as tVentas, 
                SUM(si.totaling) as tIngresos, 
                SUM(si.cntoffset) as tOffset, 
                SUM(si.todayventa) as hVentas, 
                SUM(si.todayingreso) as hIngresos, 
                SUM(si.stockreal) as finalStock, 
                si.sucursal
            FROM public.screendetails2_id si 
            WHERE ${stocksWhereConditions.join(' AND ')}
            GROUP BY si.sucursal
            ORDER BY si.sucursal ASC
        `;

        const stocksResult = await sequelize.query(stocksQuery, {
            bind: stocksQueryParams.length > 0 ? stocksQueryParams : undefined,
            type: Sequelize.QueryTypes.SELECT
        });
        
        // Sucursal별로 그룹화된 결과를 배열로 변환
        const vcodeSummary = (vcodeResult || []).map(item => ({
            sucursal: item.sucursal || null,
            operation_count: parseInt(item.operation_count || 0, 10),
            total_venta_day: parseFloat(item.total_venta_day || 0),
            total_efectivo_day: parseFloat(item.total_efectivo_day || 0),
            total_credito_day: parseFloat(item.total_credito_day || 0),
            total_banco_day: parseFloat(item.total_banco_day || 0),
            total_favor_day: parseFloat(item.total_favor_day || 0),
            last_venta_hour: item.last_venta_hour || null,
            total_count_ropas: parseFloat(item.total_count_ropas || 0)
        }));
        
        const gastosSummary = (gastosResult || []).map(item => ({
            sucursal: item.sucursal || null,
            gasto_count: parseInt(item.gasto_count || 0, 10),
            total_gasto_day: parseFloat(item.total_gasto_day || 0)
        }));
        
        const vdetalleSummary = (vdetalleResult || []).map(item => ({
            sucursal: item.sucursal || null,
            count_discount_event: parseInt(item.count_discount_event || 0, 10),
            total_discount_day: parseFloat(item.total_discount_day || 0)
        }));
        
        const vcodeMpagoSummary = (vcodeMpagoResult || []).map(item => ({
            sucursal: item.sucursal || null,
            count_mpago_total: parseInt(item.count_mpago_total || 0, 10),
            total_mpago_day: parseFloat(item.total_mpago_day || 0)
        }));
        
        const ingresosSummary = (ingresosResult || []).map(item => ({
            sucursal: item.sucursal || null,
            ingreso_events: parseInt(item.ingreso_events || 0, 10),
            ingreso_total_ropas: parseFloat(item.ingreso_total_ropas || 0)
        }));
        
        const stocksSummary = (stocksResult || []).map(item => ({
            sucursal: item.sucursal || null,
            item_count: parseInt(item.item_count || 0, 10),
            tVentas: parseFloat(item.tventas || 0),
            tIngresos: parseFloat(item.tingresos || 0),
            tOffset: parseFloat(item.toffset || 0),
            hVentas: parseFloat(item.hventas || 0),
            hIngresos: parseFloat(item.hingresos || 0),
            finalStock: parseFloat(item.finalstock || 0)
        }));
        
        const responseData = {
            fecha: targetDate || otherDate, // 요청된 날짜 또는 현재 날짜 (YYYY-MM-DD)
            fecha_vcodes: vcodeDate, // vcodes 쿼리에 사용된 날짜
            fecha_otros: otherDate, // 다른 쿼리에 사용된 날짜
            vcodes: vcodeSummary, // Sucursal별 배열
            gastos: gastosSummary, // Sucursal별 배열
            vdetalle: vdetalleSummary, // Sucursal별 배열
            vcodes_mpago: vcodeMpagoSummary, // Sucursal별 배열
            ingresos: ingresosSummary, // Sucursal별 배열
            stocks: stocksSummary // Sucursal별 배열
        };
        
        console.log('[resumen_del_dia] 응답 데이터 준비 완료');
        res.json(responseData);
        console.log('[resumen_del_dia] 응답 전송 완료');
    } catch (err) {
        console.error('[resumen_del_dia] 에러 발생:', {
            message: err.message,
            type: err.constructor.name,
            stack: err.stack,
            original: err.original ? err.original.message : null
        });
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Failed to get resumen del dia', 
                details: err.message,
                errorType: err.constructor.name,
                originalError: err.original ? err.original.message : null
            });
        } else {
            console.error('[resumen_del_dia] 응답이 이미 전송되어 에러 응답을 보낼 수 없음');
        }
    }
});

module.exports = router;

