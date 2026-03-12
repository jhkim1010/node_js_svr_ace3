const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { fetchMovidos } = require('../services/fetch-movidos');
const { parsePaginationParams } = require('../utils/fetch-utils');
const { buildDatabaseErrorResponse } = require('../utils/error-handler');
const { logPoolAfterResponse } = require('../utils/pool-debug');

const router = Router();

/**
 * movidos 요청 공통 핸들러
 * GET/POST 모두 지원. Body: last_get_utime, utime_movidos_fetch, prefix
 * Query/Header: sucursal_numero, page, limit (기본 20, 최대 100)
 */
async function handleMovidos(req, res) {
    try {
        const Ingresos = getModelForRequest(req, 'Ingresos');
        const sequelize = Ingresos.sequelize;

        const body = req.body || {};
        const query = req.query || {};
        const lastGetUtime = body.last_get_utime ?? query.last_get_utime;
        const utimeMovidosFetch = body.utime_movidos_fetch ?? query.utime_movidos_fetch;
        const prefix = body.prefix ?? query.prefix;

        const idIngreso = body.ingreso_id || query.ingreso_id;

        const headerSucursalNumero = req.headers['x-sucursal-numero'] || req.headers['X-Sucursal-Numero'];
        const sucursalNumero = query.sucursal_numero
            || headerSucursalNumero
            || body.sucursal_numero;

        const paginationSource = Object.keys(query).length > 0 ? query : body;
        const { limit, offset } = parsePaginationParams(paginationSource, 20, 100);

        if (!idIngreso && !utimeMovidosFetch && !lastGetUtime) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'last_get_utime 또는 utime_movidos_fetch가 필요합니다. (body) 또는 ingreso_id로 ID 기반 페이지네이션을 사용하세요.'
            });
        }

        if (sucursalNumero === undefined || sucursalNumero === null) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'sucursal_numero가 필요합니다. (쿼리 ?sucursal_numero=2, 헤더 x-sucursal-numero, 또는 body)'
            });
        }

        const result = await fetchMovidos(sequelize, {
            lastGetUtime,
            utimeMovidosFetch,
            prefix,
            idIngreso,
            sucursal: sucursalNumero,
            limit,
            offset
        });

        req._responseDataCount = result.data.length;
        req._operationType = 'Fetched';

        const page = parseInt(paginationSource.page || paginationSource.page_number || 1, 10);
        console.log(`[movidos] sucursal=${sucursalNumero} last_get_utime=${lastGetUtime ?? '-'} utime_movidos_fetch=${utimeMovidosFetch ?? '-'} prefix=${prefix ?? '-'} page=${page} limit=${limit} ingreso_id=${idIngreso ?? '-'} → 전송 ${result.data.length}건`);

        res.json({
            data: result.data,
            pagination: result.pagination
        });
        logPoolAfterResponse(sequelize, 'movidos');
    } catch (err) {
        console.error('\nERROR: Fetch Movidos error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        const errorResponse = buildDatabaseErrorResponse(err, req, 'fetch movidos');
        res.status(500).json(errorResponse);
    }
}

/**
 * GET /api/movidos?sucursal_numero=2
 * Body (GET 시 query로 대체 가능): last_get_utime, utime_movidos_fetch, prefix, page, limit
 * Headers: x-db-host, x-db-port, x-db-name, x-db-user, x-db-password, x-db-ssl, x-sucursal-numero
 */
router.get('/', (req, res) => handleMovidos(req, res));

/**
 * POST /api/movidos
 * Body (JSON): last_get_utime, utime_movidos_fetch, prefix, page, limit
 * Headers: 동일
 */
router.post('/', (req, res) => handleMovidos(req, res));

module.exports = router;

