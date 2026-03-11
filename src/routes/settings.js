const { Router } = require('express');
const { getDbKey, getWidths, setWidths } = require('../utils/column-widths-store');

const router = Router();

const ALLOWED_TABLES = ['codigos', 'todocodigos'];

/**
 * GET /api/settings/column-widths?table=codigos | todocodigos
 * 헤더: x-db-host, x-db-port, x-db-name, x-db-user, x-db-password (현재 DB 식별용)
 * 응답: { "codigo": 120, "descripcion": 200, ... }
 */
router.get('/column-widths', (req, res) => {
    const table = (req.query.table || '').toLowerCase();
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({
            error: 'Invalid table',
            message: 'table은 codigos 또는 todocodigos 여야 합니다.',
            received: req.query.table
        });
    }
    const dbKey = getDbKey(req.dbConfig);
    if (!dbKey) {
        return res.status(400).json({
            error: 'Database not identified',
            message: 'DB 헤더 정보가 없습니다.'
        });
    }
    const widths = getWidths(dbKey, table);
    res.json(widths);
});

/**
 * POST /api/settings/column-widths
 * Body: { table: "codigos" | "todocodigos", widths: { "codigo": 120, "descripcion": 200, ... } }
 * 헤더: x-db-* (동일)
 */
router.post('/column-widths', (req, res) => {
    const { table: rawTable, widths } = req.body || {};
    const table = (rawTable || '').toLowerCase();
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({
            error: 'Invalid table',
            message: 'table은 codigos 또는 todocodigos 여야 합니다.',
            received: rawTable
        });
    }
    if (!widths || typeof widths !== 'object') {
        return res.status(400).json({
            error: 'Invalid widths',
            message: 'widths 객체가 필요합니다.',
            received: widths
        });
    }
    const dbKey = getDbKey(req.dbConfig);
    if (!dbKey) {
        return res.status(400).json({
            error: 'Database not identified',
            message: 'DB 헤더 정보가 없습니다.'
        });
    }
    const normalized = {};
    for (const [col, w] of Object.entries(widths)) {
        const n = parseInt(w, 10);
        if (!isNaN(n) && n > 0) normalized[col] = n;
    }
    setWidths(dbKey, table, normalized);
    res.json({ ok: true, table, saved: Object.keys(normalized).length });
});

module.exports = router;
