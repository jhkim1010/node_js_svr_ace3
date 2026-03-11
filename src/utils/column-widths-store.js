/**
 * 테이블 컬럼 너비 저장소 (DB별로 분리)
 * 파일: data/column-widths.json
 * 구조: { "dbKey": { "codigos": { "codigo": 120, ... }, "todocodigos": { "tcodigo": 100, ... } } }
 * dbKey = host:port:database
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const FILE_PATH = path.join(DATA_DIR, 'column-widths.json');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function getDbKey(dbConfig) {
    if (!dbConfig || !dbConfig.database) return null;
    const host = dbConfig.host || '';
    const port = dbConfig.port || 5432;
    return `${host}:${port}:${dbConfig.database}`;
}

function loadAll() {
    ensureDataDir();
    if (!fs.existsSync(FILE_PATH)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[column-widths-store] load failed:', e.message);
        return {};
    }
}

function saveAll(data) {
    ensureDataDir();
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * @param {string} dbKey - getDbKey(req.dbConfig)
 * @param {string} table - 'codigos' | 'todocodigos'
 * @returns {Object} { columnName: widthPx, ... }
 */
function getWidths(dbKey, table) {
    if (!dbKey || !table) return {};
    const all = loadAll();
    const db = all[dbKey];
    if (!db || !db[table]) return {};
    return { ...db[table] };
}

/**
 * @param {string} dbKey
 * @param {string} table
 * @param {Object} widths - { columnName: widthPx, ... }
 */
function setWidths(dbKey, table, widths) {
    if (!dbKey || !table || typeof widths !== 'object') return;
    const all = loadAll();
    if (!all[dbKey]) all[dbKey] = {};
    all[dbKey][table] = { ...widths };
    saveAll(all);
}

module.exports = {
    getDbKey,
    getWidths,
    setWidths
};
