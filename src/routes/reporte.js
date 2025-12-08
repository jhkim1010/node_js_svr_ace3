const { Router } = require('express');
const { getStocksReport } = require('../services/reporte-stocks');
const { getItemsReport } = require('../services/reporte-items');
const { getIngresosReport } = require('../services/reporte-ingresos');
const { getClientesReport } = require('../services/reporte-clientes');
const { getGastosReport } = require('../services/reporte-gastos');
const { getVentasReport } = require('../services/reporte-ventas');
const { getAlertasReport } = require('../services/reporte-alertas');

const router = Router();

// JWT 인증 미들웨어 제거됨 - 모든 보고서 엔드포인트는 인증 없이 접근 가능

// 로깅 헬퍼 함수
function logReportRequest(req, reportName) {
    console.log(`\n========== ${reportName} 보고서 요청 ==========`);
    console.log(`Method: ${req.method}`);
    console.log(`Path: ${req.originalUrl || req.path || req.url}`);
    console.log(`\n[요청 헤더]`);
    console.log(JSON.stringify(req.headers, null, 2));
    console.log(`\n[요청 쿼리 파라미터]`);
    console.log(JSON.stringify(req.query, null, 2));
    console.log(`\n[요청 바디]`);
    console.log(JSON.stringify(req.body || {}, null, 2));
    console.log(`==========================================\n`);
}

function logReportResponse(reportName, result) {
    console.log(`\n========== ${reportName} 보고서 응답 ==========`);
    // 응답이 너무 크면 요약만 출력
    if (result.data && Array.isArray(result.data) && result.data.length > 10) {
        console.log(`[응답 요약]`);
        console.log(JSON.stringify({
            filters: result.filters,
            summary: result.summary,
            data_count: result.data.length,
            data_preview: result.data.slice(0, 3) // 처음 3개만 미리보기
        }, null, 2));
        console.log(`\n[전체 데이터 개수: ${result.data.length}개]`);
    } else {
        console.log(JSON.stringify(result, null, 2));
    }
    console.log(`==========================================\n`);
}

// Stocks 보고서
router.get('/stocks', async (req, res) => {
    try {
        const result = await getStocksReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get stocks report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Stocks 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

// Items 보고서
router.get('/items', async (req, res) => {
    try {
        const result = await getItemsReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get items report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Items 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

// Ingresos 보고서
router.get('/ingresos', async (req, res) => {
    try {
        const result = await getIngresosReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get ingresos report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Ingresos 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

// Clientes 보고서
router.get('/clientes', async (req, res) => {
    try {
        const result = await getClientesReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get clientes report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Clientes 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

// Gastos 보고서
router.get('/gastos', async (req, res) => {
    try {
        const result = await getGastosReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get gastos report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Gastos 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

// Ventas 보고서
router.get('/ventas', async (req, res) => {
    try {
        const result = await getVentasReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get ventas report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Ventas 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

// Alertas 보고서
router.get('/alertas', async (req, res) => {
    try {
        const result = await getAlertasReport(req);
        res.json(result);
    } catch (err) {
        const errorResponse = {
            error: 'Failed to get alertas report',
            details: err.message,
            errorType: err.constructor.name
        };
        console.error(`\n[Alertas 보고서 오류]`);
        console.error(JSON.stringify(errorResponse, null, 2));
        console.error(`\n`);
        res.status(500).json(errorResponse);
    }
});

module.exports = router;

