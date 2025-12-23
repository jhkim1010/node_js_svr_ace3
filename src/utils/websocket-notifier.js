const { getWebSocketServer, broadcastToDbClients, getConnectionKey, getConnectedClientCount } = require('../services/websocket-service');

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
    'logs': 'logs'
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
    
    // /api/codigos/id/100243 같은 패턴 처리
    // id, :id, 또는 숫자로 시작하는 부분은 무시하고 그 앞의 부분을 테이블명으로 사용
    let route = parts[0];
    
    // parts[1]이 'id' 또는 ':id'이고 parts[2]가 숫자인 경우, parts[0]을 테이블명으로 사용
    if (parts.length >= 3 && (parts[1] === 'id' || parts[1] === ':id') && /^\d+$/.test(parts[2])) {
        route = parts[0];
    }
    // parts[1]이 숫자인 경우 (예: /api/codigos/100243), parts[0]을 테이블명으로 사용
    else if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
        route = parts[0];
    }
    
    return routeToTableMap[route] || route;
}

// CRUD 작업 완료 후 WebSocket 알림 전송
async function notifyDbChange(req, Model, operation, data) {
    try {
        // 항상 WebSocket 알림 전송 (변동을 일으킨 연결을 제외하고 동일한 데이터베이스에 연결된 다른 연결에 전송)
        
        const clientId = getClientIdFromRequest(req);
        const tableName = getTableNameFromPath(req.path || req.originalUrl || req.url);
        
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
        
        // codigos, todocodigos 테이블에 대한 상세 메시지 출력 (API를 통한 알림)
        if (tableName === 'codigos' || tableName === 'todocodigos') {
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
            console.log(`   📍 경로: ${req.path || req.originalUrl || req.url}`);
            console.log(`   👤 클라이언트 ID: ${clientId || 'none'}`);
            console.log(`   👥 연결된 클라이언트: ${connectedClientCount}개`);
            console.log(`   ⏰ 시간: ${new Date().toISOString()}`);
            console.log(`   🔄 웹소켓 브로드캐스트 시작...\n`);
        } else {
            // 다른 테이블은 기존 로그 유지
            console.log(`[WebSocket] DB Change Notification - Table: ${tableName}, Operation: ${operationLabel}, dbKey: ${dbKey}, clientId: ${clientId || 'none'}, Connected clients: ${connectedClientCount}`);
        }
        
        // 동일한 데이터베이스에 연결된 다른 클라이언트들에게만 브로드캐스트
        // sucursal 필터링은 broadcastToDbClients 내부에서 처리됨
        broadcastToDbClients(dbKey, clientId, {
            table: tableName,
            operation: operationLabel,
            data: plainData,
            connectedClients: connectedClientCount,
            sucursal: req.dbConfig.sucursal // sucursal 정보 전달
        });
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
        const tableName = getTableNameFromPath(req.path || req.originalUrl || req.url);
        
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

