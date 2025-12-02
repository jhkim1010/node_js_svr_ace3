const { Router } = require('express');
const { getStocksReport } = require('../services/reporte-stocks');
const { getItemsReport } = require('../services/reporte-items');
const { getClientesReport } = require('../services/reporte-clientes');
const { getGastosReport } = require('../services/reporte-gastos');
const { getVentasReport } = require('../services/reporte-ventas');
const { getAlertasReport } = require('../services/reporte-alertas');

const router = Router();

// Stocks 보고서
router.get('/stocks', async (req, res) => {
    try {
        const result = await getStocksReport(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to get stocks report',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

// Items 보고서
router.get('/items', async (req, res) => {
    try {
        const result = await getItemsReport(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to get items report',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

// Clientes 보고서
router.get('/clientes', async (req, res) => {
    try {
        const result = await getClientesReport(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to get clientes report',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

// Gastos 보고서
router.get('/gastos', async (req, res) => {
    try {
        const result = await getGastosReport(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to get gastos report',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

// Ventas 보고서
router.get('/ventas', async (req, res) => {
    try {
        const result = await getVentasReport(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to get ventas report',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

// Alertas 보고서
router.get('/alertas', async (req, res) => {
    try {
        const result = await getAlertasReport(req);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: 'Failed to get alertas report',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

module.exports = router;

