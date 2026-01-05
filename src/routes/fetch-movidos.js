const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { fetchMovidos } = require('../services/fetch-movidos');
const { parsePaginationParams } = require('../utils/fetch-utils');
const { buildDatabaseErrorResponse } = require('../utils/error-handler');

const router = Router();

/**
 * GET /api/movidos
 * 
 * Body Parameters:
 * - last_get_utime: 마지막 조회 시간 (예: '2024-01-01 12:00:00')
 * - utime_movidos_fetch: utime 기준 시간 (필수, 예: '2024-01-01 12:00:00')
 * 
 * Query Parameters:
 * - sucursal_numero: sucursal 값 (필수, 쿼리 파라미터 또는 헤더)
 * - page: 페이지 번호 (기본값: 1)
 * - limit: 페이지당 레코드 수 (기본값: 100, 최대: 1000)
 * 
 * Headers:
 * - x-sucursal-numero: sucursal 값 (쿼리 파라미터와 동일)
 */
router.get('/', async (req, res) => {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const sequelize = Ingresos.sequelize;
        
        // 파라미터 추출 (body 우선, 그 다음 query)
        const body = req.body || {};
        const query = req.query || {};
        
        // body에서 파라미터 읽기
        const lastGetUtime = body.last_get_utime;
        const utimeMovidosFetch = body.utime_movidos_fetch;
        
        // sucursal_numero는 쿼리 파라미터, 헤더, body 순으로 확인
        // Express는 헤더를 소문자로 변환하므로 소문자로 확인
        const headerSucursalNumero = req.headers['x-sucursal-numero'] || req.headers['X-Sucursal-Numero'];
        const sucursalNumero = query.sucursal_numero 
            || headerSucursalNumero
            || body.sucursal_numero;
        
        // 페이지네이션 파라미터 파싱 (query 또는 body에서)
        const paginationSource = Object.keys(query).length > 0 ? query : body;
        const { limit, offset, page } = parsePaginationParams(paginationSource, 100, 1000);
        
        // 필수 파라미터 검증
        if (!utimeMovidosFetch) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'utime_movidos_fetch 파라미터가 필요합니다. (body에 포함)'
            });
        }
        
        if (sucursalNumero === undefined || sucursalNumero === null) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'sucursal_numero 파라미터가 필요합니다. (쿼리 파라미터, 헤더, 또는 body에 포함)'
            });
        }
        
        // 서비스 호출
        const result = await fetchMovidos(sequelize, {
            utimeMovidosFetch,
            sucursal: sucursalNumero, // 서비스에서는 sucursal로 전달
            limit,
            offset
        });
        
        // 응답 로거에서 사용할 데이터 개수 및 operation 타입 저장
        req._responseDataCount = result.data.length;
        req._operationType = 'Fetched';
        
        // 응답
        res.json({
            data: result.data,
            pagination: result.pagination
        });
    } catch (err) {
        console.error('\nERROR: Fetch Movidos error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'fetch movidos');
        res.status(500).json(errorResponse);
    }
});

module.exports = router;

