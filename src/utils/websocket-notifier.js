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
    // /api/codigos -> codigos
    const parts = path.split('/').filter(p => p);
    const route = parts[parts.length - 1] || parts[0];
    return routeToTableMap[route] || route;
}

// CRUD 작업 완료 후 WebSocket 알림 전송
async function notifyDbChange(req, Model, operation, data) {
    try {
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
        // clientId가 없어도 전체 클라이언트 수를 반환하도록 함
        const connectedClientCount = getConnectedClientCount(dbKey, clientId || null);
        
        // 디버깅 로그
        console.log(`[WebSocket] DB 변경 알림 - 테이블: ${tableName}, 작업: ${operation}, dbKey: ${dbKey}, clientId: ${clientId || '없음'}, 연결된 클라이언트 수: ${connectedClientCount}`);
        console.log(`[WebSocket] req.dbConfig:`, req.dbConfig);
        
        // 동일한 데이터베이스에 연결된 다른 클라이언트들에게만 브로드캐스트
        broadcastToDbClients(dbKey, clientId, 'db-change', {
            table: tableName,
            operation: operation,
            data: plainData,
            connectedClients: connectedClientCount
        });
    } catch (err) {
        // WebSocket 알림 실패는 조용히 무시 (CRUD 작업은 이미 완료됨)
        console.error('WebSocket 알림 실패:', err.message);
    }
}

// BATCH_SYNC 작업 완료 후 알림
async function notifyBatchSync(req, Model, result) {
    try {
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
            // clientId가 없어도 전체 클라이언트 수를 반환하도록 함
            const connectedClientCount = getConnectedClientCount(dbKey, clientId || null);
            
            // 디버깅 로그
            console.log(`[WebSocket] BATCH_SYNC 알림 - 테이블: ${tableName}, dbKey: ${dbKey}, clientId: ${clientId || '없음'}, 연결된 클라이언트 수: ${connectedClientCount}`);
            
            // 동일한 데이터베이스에 연결된 다른 클라이언트들에게만 브로드캐스트
            broadcastToDbClients(dbKey, clientId, 'db-change', {
                table: tableName,
                operation: 'batch_sync',
                data: successData,
                connectedClients: connectedClientCount
            });
        }
    } catch (err) {
        console.error('WebSocket 알림 실패:', err.message);
    }
}

module.exports = {
    notifyDbChange,
    notifyBatchSync,
    getClientIdFromRequest
};

