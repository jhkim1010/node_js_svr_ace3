/**
 * 테이블 컬럼 리사이즈 + DB별 저장 (API 연동)
 * - getDbHeaders(): localStorage의 dbConfig로 헤더 객체 반환
 * - loadColumnWidths(table, headers): GET /api/settings/column-widths?table=xxx
 * - saveColumnWidths(table, widths, headers): POST /api/settings/column-widths
 * - makeTableResizable(tableEl, tableName, headers): th 리사이즈 핸들 부착 및 저장
 */

(function (global) {
    const STORAGE_KEY = 'ace_db_config';

    function getDbConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function getDbHeaders() {
        const c = getDbConfig();
        if (!c || !c.database || !c.user || !c.password) return null;
        return {
            'x-db-host': c.host || '127.0.0.1',
            'x-db-port': String(c.port || 5432),
            'x-db-name': c.database,
            'x-db-user': c.user,
            'x-db-password': c.password,
            'x-db-ssl': c.ssl ? 'true' : 'false',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    function saveDbConfig(config) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
            return true;
        } catch (e) {
            return false;
        }
    }

    async function loadColumnWidths(table, headers) {
        if (!headers) return {};
        try {
            const res = await fetch('/api/settings/column-widths?table=' + encodeURIComponent(table), { headers });
            if (!res.ok) return {};
            return await res.json();
        } catch (e) {
            console.warn('loadColumnWidths', e);
            return {};
        }
    }

    async function saveColumnWidths(table, widths, headers) {
        if (!headers || typeof widths !== 'object') return;
        try {
            await fetch('/api/settings/column-widths', {
                method: 'POST',
                headers,
                body: JSON.stringify({ table, widths })
            });
        } catch (e) {
            console.warn('saveColumnWidths', e);
        }
    }

    function getCurrentWidths(tableEl) {
        const widths = {};
        const headerRow = tableEl.querySelector('thead tr');
        if (!headerRow) return widths;
        headerRow.querySelectorAll('th').forEach(function (th) {
            const key = th.dataset.column;
            if (key && th.style.width) {
                const px = parseInt(th.style.width, 10);
                if (!isNaN(px)) widths[key] = px;
            }
        });
        return widths;
    }

    function makeTableResizable(tableEl, tableName, headers) {
        if (!tableEl || !tableName) return;
        const thead = tableEl.querySelector('thead tr');
        if (!thead) return;

        const MIN = 40;
        let active = null;
        let startX = 0;
        let startW = 0;

        thead.querySelectorAll('th').forEach(function (th) {
            const key = th.dataset.column;
            if (!key) return;
            th.style.position = 'relative';
            th.style.minWidth = MIN + 'px';
            var handle = document.createElement('span');
            handle.className = 'col-resize-handle';
            handle.setAttribute('aria-label', '컬럼 너비 조절');
            handle.style.cssText = 'position:absolute;top:0;right:0;width:8px;height:100%;cursor:col-resize;user-select:none;';
            th.appendChild(handle);

            handle.addEventListener('mousedown', function (e) {
                e.preventDefault();
                active = th;
                startX = e.pageX;
                startW = th.offsetWidth;
            });
        });

        function onMove(e) {
            if (!active) return;
            var dx = e.pageX - startX;
            var w = Math.max(MIN, startW + dx);
            active.style.width = w + 'px';
        }
        function onUp() {
            if (!active) return;
            active = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            var widths = getCurrentWidths(tableEl);
            if (headers && Object.keys(widths).length) {
                saveColumnWidths(tableName, widths, headers);
            }
        }

        document.addEventListener('mouseup', function (e) {
            if (active) {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                active = null;
                var widths = getCurrentWidths(tableEl);
                if (headers && Object.keys(widths).length) {
                    saveColumnWidths(tableName, widths, headers);
                }
            }
        });

        document.addEventListener('mousemove', function (e) {
            if (active) {
                if (!document.body.style.cursor) {
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                }
                onMove(e);
            }
        });
    }

    function applyWidths(tableEl, widths) {
        if (!widths || typeof widths !== 'object') return;
        tableEl.querySelectorAll('thead th').forEach(function (th) {
            const key = th.dataset.column;
            if (key && widths[key]) {
                th.style.width = widths[key] + 'px';
            }
        });
    }

    global.TableColumnResize = {
        getDbConfig: getDbConfig,
        saveDbConfig: saveDbConfig,
        getDbHeaders: getDbHeaders,
        loadColumnWidths: loadColumnWidths,
        saveColumnWidths: saveColumnWidths,
        makeTableResizable: makeTableResizable,
        applyWidths: applyWidths,
        getCurrentWidths: getCurrentWidths
    };
})(typeof window !== 'undefined' ? window : this);
