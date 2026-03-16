const { getWebSocketServer, broadcastToDbClients, getConnectionKey, getConnectedClientCount } = require('../services/websocket-service');

// 디바운싱 설정 (100ms)
const DEBOUNCE_DELAY = 100; // milliseconds

// 디바운스 큐 관리: Map<`${dbKey}:${tableName}`, Array<알림데이터>>
const debounceQueues = new Map();

// 디바운스 타이머 관리: Map<`${dbKey}:${tableName}`, NodeJS.Timeout>
const debounceTimers = new Map();

// 테이블명 매핑 (라우트 경로 -> 테이블명)
const routeToTableMap = {
    'vcodes': 'vcodes',
    'vdetalle': 'vdetalle',
    'ingresos': 'ingresos',
    'codigos': 'codigos',
    'todocodigos': 'todocodigos',
    'parametros': 'parametros',
    'gasto_info': 'gasto_info',
    'gastos': 'gastos',
    'color': 'color',
    'creditoventas': 'creditoventas',
    'clientes': 'clientes',
    'tipos': 'tipos',
    'vtags': 'vtags',
    'online_ventas': 'online_ventas',
    'logs': 'logs',
    'temporadas': 'temporadas',
    'cuentas': 'cuentas',
    'vendedores': 'vendedores',
    'fventas': 'fventas',
    'senias_vinculados': 'senias_vinculados'
};

// HTTP 요청에서 클라이언트 ID 추출
function getClientIdFromRequest(req) {
    // X-Client-ID 헤더에서 클라이언트 ID 추출
    return req.headers['x-client-id'] || null;
}

// 라우트 경로에서 테이블명 추출
function getTableNameFromPath(path) {
    if (!path) return 'unknown';
    
    // /api/codigos -> codigos
    // /api/codigos/id/100243 -> codigos (id 다음 부분은 무시)
    // /codigos/id/100243 -> codigos
    let cleanPath = path.toString();
    
    // 쿼리 문자열 제거
    if (cleanPath.includes('?')) {
        cleanPath = cleanPath.split('?')[0];
    }
    
    // /api 접두사 제거
    if (cleanPath.startsWith('/api/')) {
        cleanPath = cleanPath.substring(5); // '/api/'.length
    } else if (cleanPath.startsWith('/api')) {
        cleanPath = cleanPath.substring(4); // '/api'.length
    }
    
    // 앞뒤 슬래시 제거
    cleanPath = cleanPath.replace(/^\/+|\/+$/g, '');
    
    const parts = cleanPath.split('/').filter(p => p && p.trim());
    
    if (parts.length === 0) return 'unknown';
    
    // 첫 번째 부분이 테이블명 (기본값)
    let route = parts[0];
    
    // /api/codigos/id/100243 같은 패턴 처리
    // parts[0] = 'codigos', parts[1] = 'id', parts[2] = '100243'
    // parts[1]이 'id'이고 parts[2]가 숫자인 경우, parts[0]을 테이블명으로 사용
    if (parts.length >= 3 && parts[1] === 'id' && /^\d+$/.test(parts[2])) {
        route = parts[0]; // 이미 parts[0]이지만 명시적으로 설정
    }
    // /api/codigos/:id 같은 패턴 (parts[1]이 ':id'로 시작하는 경우)
    else if (parts.length >= 2 && parts[1].startsWith(':')) {
        route = parts[0];
    }
    // parts[1]이 숫자인 경우 (예: /api/codigos/100243), parts[0]을 테이블명으로 사용
    else if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
        route = parts[0];
    }
    // parts[0]이 'id'인 경우 (잘못된 경로), 다음 부분을 확인
    else if (parts[0] === 'id' && parts.length > 1) {
        // 이 경우는 라우터 설정 문제일 수 있음
        route = parts[1] || 'unknown';
    }
    
    // routeToTableMap에서 찾거나, 없으면 route 그대로 반환
    return routeToTableMap[route] || route;
}

// 실제 WebSocket 알림 전송 함수 (디바운싱 없이 즉시 전송)
async function sendDbChangeNotification(dbKey, clientId, tableName, operationLabel, plainData, connectedClientCount, sucursal, isCodigosTable, isTodocodigosTable, requestPath) {
    // 연결된 클라이언트가 있는 경우에만 로그 출력
    if (connectedClientCount > 0) {
        if (isCodigosTable || isTodocodigosTable) {
            const firstItem = plainData[0] || {};
            const codigo = firstItem.codigo || firstItem.tcodigo || 'N/A';
            const idCodigo = firstItem.id_codigo || firstItem.id_todocodigo || 'N/A';
            const descripcion = firstItem.descripcion || firstItem.tdesc || 'N/A';
            const pre1 = firstItem.pre1 !== undefined ? firstItem.pre1 : (firstItem.tpre1 !== undefined ? firstItem.tpre1 : 'N/A');
            
            console.log(`\n📡 [${tableName === 'codigos' ? 'Codigos' : 'Todocodigos'} API 알림]`);
            console.log(`   📋 테이블: ${tableName}`);
            console.log(`   🔧 작업: ${operationLabel}`);
            console.log(`   🏷️  코드: ${codigo}`);
            console.log(`   🆔 ID: ${idCodigo}`);
            console.log(`   📝 설명: ${descripcion}`);
            console.log(`   💰 가격1: ${pre1}`);
            console.log(`   🗄️  데이터베이스: ${dbKey}`);
            console.log(`   📍 경로: ${requestPath || 'N/A'}`);
            console.log(`   👤 클라이언트 ID: ${clientId || 'none'}`);
            console.log(`   👥 연결된 클라이언트: ${connectedClientCount}개`);
            console.log(`   ⏰ 시간: ${new Date().toISOString()}`);
            console.log(`   🔄 웹소켓 브로드캐스트 시작...\n`);
        } else {
            // 다른 테이블은 기존 로그 유지
            console.log(`[WebSocket] DB Change Notification - Table: ${tableName}, Operation: ${operationLabel}, dbKey: ${dbKey}, clientId: ${clientId || 'none'}, Connected clients: ${connectedClientCount}`);
        }
    }
    
    // 동일한 데이터베이스에 연결된 다른 클라이언트들에게만 브로드캐스트
    broadcastToDbClients(dbKey, clientId, {
        table: tableName,
        operation: operationLabel,
        data: plainData,
        connectedClients: connectedClientCount,
        sucursal: sucursal
    });
}

// 배치 알림 전송 (디바운스 큐에서 여러 알림을 묶어서 전송)
async function flushDebounceQueue(dbKey, tableName) {
    const queueKey = `${dbKey}:${tableName}`;
    const queue = debounceQueues.get(queueKey);
    
    if (!queue || queue.length === 0) {
        return;
    }
    
    // 큐에서 모든 알림 데이터 수집
    const allData = [];
    let lastClientId = null;
    let lastConnectedClientCount = 0;
    let lastSucursal = null;
    let lastOperation = null;
    let lastRequestPath = null;
    let isCodigosTable = false;
    let isTodocodigosTable = false;
    
    // 큐의 모든 항목을 하나로 합치기
    for (const item of queue) {
        if (Array.isArray(item.data)) {
            allData.push(...item.data);
        } else {
            allData.push(item.data);
        }
        lastClientId = item.clientId;
        lastConnectedClientCount = Math.max(lastConnectedClientCount, item.connectedClientCount);
        lastSucursal = item.sucursal;
        lastOperation = item.operation;
        lastRequestPath = item.requestPath;
        isCodigosTable = isCodigosTable || item.isCodigosTable;
        isTodocodigosTable = isTodocodigosTable || item.isTodocodigosTable;
    }
    
    // 큐와 타이머 정리
    debounceQueues.delete(queueKey);
    const timer = debounceTimers.get(queueKey);
    if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(queueKey);
    }
    
    // 배치 알림 전송 (BATCH_SYNC로 표시)
    if (allData.length > 0) {
        // 배치 알림은 BATCH_SYNC로 표시
        await sendDbChangeNotification(
            dbKey,
            lastClientId,
            tableName,
            'BATCH_SYNC',
            allData,
            lastConnectedClientCount,
            lastSucursal,
            isCodigosTable,
            isTodocodigosTable,
            lastRequestPath
        );
        
        // 배치 알림 로그
        if (lastConnectedClientCount > 0) {
            console.log(`[WebSocket] 📦 배치 알림 전송 - Table: ${tableName}, Items: ${allData.length}개, dbKey: ${dbKey}`);
        }
    }
}

// CRUD 작업 완료 후 WebSocket 알림 전송 (디바운싱 적용)
async function notifyDbChange(req, Model, operation, data) {
    try {
        // 항상 WebSocket 알림 전송 (변동을 일으킨 연결을 제외하고 동일한 데이터베이스에 연결된 다른 연결에 전송)
        
        const clientId = getClientIdFromRequest(req);
        const requestPath = req.path || req.originalUrl || req.url;
        
        // 테이블명 추출 (우선순위: Model > 경로 파싱)
        let tableName = null;
        
        // 1. Model에서 테이블명 추출 (가장 정확함)
        if (Model && Model.tableName) {
            const modelTableName = Model.tableName.toLowerCase();
            // routeToTableMap에서 찾거나, 없으면 modelTableName 직접 사용
            tableName = routeToTableMap[modelTableName] || modelTableName;
            // 디버깅: Model 정보 출력 (문제 발생 시에만)
            if (tableName === 'id' || tableName === 'unknown') {
                console.log(`[WebSocket] 🔍 Model 정보 - Model.name: ${Model.name}, Model.tableName: ${Model.tableName}, modelTableName: ${modelTableName}`);
                console.log(`[WebSocket] 🔍 routeToTableMap 키들: ${Object.keys(routeToTableMap).join(', ')}`);
                console.log(`[WebSocket] 🔍 routeToTableMap[${modelTableName}]: ${routeToTableMap[modelTableName] || '없음'}`);
            }
        } else {
            console.warn(`[WebSocket] ⚠️ Model이 없거나 tableName이 없음 - Model: ${Model ? Model.name || '있음' : '없음'}`);
        }
        
        // 2. Model에서 추출 실패 시 경로에서 추출
        if (!tableName || tableName === 'unknown' || tableName === 'id') {
            const pathTableName = getTableNameFromPath(requestPath);
            if (pathTableName && pathTableName !== 'id' && pathTableName !== 'unknown') {
                tableName = pathTableName;
            }
        }
        
        // 3. 여전히 실패한 경우 경고 및 최후의 수단
        if (tableName === 'id' || tableName === 'unknown' || !tableName) {
            console.warn(`[WebSocket] ⚠️ 테이블명 추출 실패 - 경로: ${requestPath}, 추출된 테이블명: ${tableName}`);
            console.warn(`[WebSocket] ⚠️ Model 정보 - Model: ${Model?.name || 'N/A'}, tableName: ${Model?.tableName || 'N/A'}`);
            // 최후의 수단: Model.tableName 직접 사용 (소문자 변환)
            if (Model && Model.tableName) {
                tableName = Model.tableName.toLowerCase();
                console.warn(`[WebSocket] ✅ Model.tableName 직접 사용: ${tableName}`);
            } else {
                tableName = 'unknown';
            }
        }
        
        // 요청의 데이터베이스 정보 가져오기
        if (!req.dbConfig) {
            return; // DB 정보가 없으면 알림 전송 안 함
        }
        
        const dbKey = getConnectionKey(
            req.dbConfig.host,
            req.dbConfig.port,
            req.dbConfig.database,
            req.dbConfig.user
        );
        
        // 데이터가 배열이 아닌 경우 배열로 변환
        const dataArray = Array.isArray(data) ? data : [data];
        
        // Sequelize 모델 인스턴스를 일반 객체로 변환
        const plainData = dataArray.map(item => {
            if (item && typeof item.toJSON === 'function') {
                return item.toJSON();
            }
            return item;
        });
        
        // 동일한 데이터베이스에 연결된 다른 클라이언트 개수 조회
        const connectedClientCount = getConnectedClientCount(dbKey, clientId || null);
        
        // CRUD 작업 유형을 명확히 표시 (대소문자 구분 없이 처리)
        const normalizedOperation = (operation || '').toLowerCase();
        const operationLabel = {
            'create': 'CREATE',
            'update': 'UPDATE', 
            'delete': 'DELETE',
            'read': 'READ'
        }[normalizedOperation] || (operation ? operation.toUpperCase() : 'UNKNOWN');
        
        // codigos, todocodigos 테이블 확인
        const isCodigosTable = tableName === 'codigos' || 
                               (Model && Model.tableName && Model.tableName.toLowerCase() === 'codigos');
        const isTodocodigosTable = tableName === 'todocodigos' || 
                                   (Model && Model.tableName && Model.tableName.toLowerCase() === 'todocodigos');
        
        // 디바운스 큐에 추가
        const queueKey = `${dbKey}:${tableName}`;
        if (!debounceQueues.has(queueKey)) {
            debounceQueues.set(queueKey, []);
        }
        
        debounceQueues.get(queueKey).push({
            table: tableName,
            operation: operationLabel,
            data: plainData,
            clientId: clientId,
            connectedClientCount: connectedClientCount,
            sucursal: req.dbConfig.sucursal,
            isCodigosTable: isCodigosTable,
            isTodocodigosTable: isTodocodigosTable,
            requestPath: requestPath
        });
        
        // 기존 타이머가 있으면 취소
        const existingTimer = debounceTimers.get(queueKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        // 새로운 타이머 설정
        const timer = setTimeout(() => {
            flushDebounceQueue(dbKey, tableName);
        }, DEBOUNCE_DELAY);
        
        debounceTimers.set(queueKey, timer);
        
    } catch (err) {
        // WebSocket notification failure is silently ignored (CRUD operation is already completed)
        console.error('WebSocket notification failed:', err.message);
    }
}

// BATCH_SYNC 작업 완료 후 알림
async function notifyBatchSync(req, Model, result) {
    try {
        // 항상 WebSocket 알림 전송 (변동을 일으킨 연결을 제외하고 동일한 데이터베이스에 연결된 다른 연결에 전송)
        
        const clientId = getClientIdFromRequest(req);
        const requestPath = req.path || req.originalUrl || req.url;
        let tableName = getTableNameFromPath(requestPath);
        
        // 경로 파싱 실패 시 Model에서 테이블명 추출 (POST 요청의 경우 경로가 /일 수 있음)
        if (tableName === 'id' || tableName === 'unknown') {
            // Model에서 테이블명 추출 시도
            if (Model && Model.tableName) {
                const modelTableName = Model.tableName.toLowerCase();
                tableName = routeToTableMap[modelTableName] || modelTableName;
                // Model에서 성공적으로 추출한 경우 경고 없이 로그만 출력
                if (tableName !== 'id' && tableName !== 'unknown') {
                    // 조용히 처리 (경고 메시지 제거)
                } else {
                    console.warn(`[WebSocket] ⚠️ BATCH_SYNC 테이블명 추출 실패 - 경로: ${requestPath}, Model: ${Model.tableName}`);
                }
            } else {
                console.warn(`[WebSocket] ⚠️ BATCH_SYNC 테이블명 추출 실패 - 경로: ${requestPath}, 추출된 테이블명: ${tableName}, Model 없음`);
            }
        }
        
        // 요청의 데이터베이스 정보 가져오기
        if (!req.dbConfig) {
            return; // DB 정보가 없으면 알림 전송 안 함
        }
        
        const dbKey = getConnectionKey(
            req.dbConfig.host,
            req.dbConfig.port,
            req.dbConfig.database,
            req.dbConfig.user
        );
        
        // 성공한 결과만 추출
        const successData = result.results
            .filter(r => r.data)
            .map(r => {
                const item = r.data;
                if (item && typeof item.toJSON === 'function') {
                    return item.toJSON();
                }
                return item;
            });
        
        if (successData.length > 0) {
            // 동일한 데이터베이스에 연결된 다른 클라이언트 개수 조회
            const connectedClientCount = getConnectedClientCount(dbKey, clientId || null);
            
            // 연결된 클라이언트가 2개 이상일 때만 로그 출력
            if (connectedClientCount >= 2) {
                // codigos, todocodigos 테이블에 대한 상세 메시지 출력 (API를 통한 BATCH_SYNC 알림)
                if (tableName === 'codigos' || tableName === 'todocodigos') {
                    const totalItems = successData.length;
                    const firstItem = successData[0] || {};
                    const codigo = firstItem.codigo || firstItem.tcodigo || 'N/A';
                    
                    console.log(`\n📡 [${tableName === 'codigos' ? 'Codigos' : 'Todocodigos'} API BATCH_SYNC 알림]`);
                    console.log(`   📋 테이블: ${tableName}`);
                    console.log(`   🔧 작업: BATCH_SYNC`);
                    console.log(`   📦 총 항목 수: ${totalItems}개`);
                    console.log(`   🏷️  첫 번째 코드: ${codigo}`);
                    console.log(`   🗄️  데이터베이스: ${dbKey}`);
                    console.log(`   📍 경로: ${req.path || req.originalUrl || req.url}`);
                    console.log(`   👤 클라이언트 ID: ${clientId || 'none'}`);
                    console.log(`   👥 연결된 클라이언트: ${connectedClientCount}개`);
                    console.log(`   ⏰ 시간: ${new Date().toISOString()}`);
                    console.log(`   🔄 웹소켓 브로드캐스트 시작...\n`);
                } else {
                    // 다른 테이블은 기존 로그 유지
                    console.log(`[WebSocket] BATCH_SYNC Notification - Table: ${tableName}, Operation: BATCH_SYNC, dbKey: ${dbKey}, clientId: ${clientId || 'none'}, Connected clients: ${connectedClientCount}`);
                }
            }
            
            // 동일한 데이터베이스에 연결된 다른 클라이언트들에게만 브로드캐스트
            // sucursal 필터링은 broadcastToDbClients 내부에서 처리됨
            broadcastToDbClients(dbKey, clientId, {
                table: tableName,
                operation: 'BATCH_SYNC',
                data: successData,
                connectedClients: connectedClientCount,
                sucursal: req.dbConfig.sucursal // sucursal 정보 전달
            });
        }
    } catch (err) {
        console.error('WebSocket notification failed:', err.message);
    }
}

module.exports = {
    notifyDbChange,
    notifyBatchSync,
    getClientIdFromRequest
};

