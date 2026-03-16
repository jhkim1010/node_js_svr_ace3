const WebSocket = require('ws');
const { Pool } = require('pg');

// 기본 DB 호스트 결정 (Docker 환경이면 host.docker.internal, 아니면 127.0.0.1)
function isDockerEnvironment() {
    try {
        const fs = require('fs');
        return process.env.DOCKER === 'true' || 
               process.env.IN_DOCKER === 'true' ||
               fs.existsSync('/.dockerenv') ||
               process.env.HOSTNAME?.includes('docker') ||
               process.cwd() === '/home/node/app';
    } catch (e) {
        return false;
    }
}

function getDefaultDbHost() {
    // 환경 변수 DB_HOST가 있으면 우선 사용
    if (process.env.DB_HOST) {
        return process.env.DB_HOST;
    }
    // Docker 환경이면 host.docker.internal 사용
    if (isDockerEnvironment()) {
        return 'host.docker.internal';
    }
    // 로컬 환경이면 127.0.0.1 사용
    return '127.0.0.1';
}

function getDefaultDbPort() {
    return process.env.DB_PORT || '5432';
}

// WebSocket 서버 인스턴스
let wss = null;

// 각 DB 연결별 LISTEN 리스너 관리
const dbListeners = new Map();

// 데이터베이스별 클라이언트 그룹 관리 (dbKey -> Map of ws.id -> ws)
const dbClientGroups = new Map();

// 클라이언트 정보 저장 (ws.id -> { clientId, dbKey, sucursal })
const clientInfo = new Map();

// 클라이언트별 페이지네이션 큐 관리 (ws.id -> [{ table, operation, data, timestamp }, ...])
const clientPaginationQueues = new Map();

// 디바운싱 설정 (100ms)
const DEBOUNCE_DELAY = 100; // milliseconds

// 트리거 알림 디바운스 큐 관리: Map<`${dbKey}:${tableName}`, Array<알림데이터>>
const triggerDebounceQueues = new Map();

// 트리거 알림 디바운스 타이머 관리: Map<`${dbKey}:${tableName}`, NodeJS.Timeout>
const triggerDebounceTimers = new Map();

// 고유 ID 생성기
let clientIdCounter = 0;
function generateClientId() {
    return `client_${Date.now()}_${++clientIdCounter}`;
}

// 테이블 목록 (구독 허용 + LISTEN 채널용). 클라이언트 config enabled 테이블과 맞춤.
const tables = [
    'vcodes', 'vdetalle', 'ingresos', 'codigos', 'todocodigos',
    'parametros', 'gasto_info', 'gastos', 'color', 'creditoventas',
    'clientes', 'tipos', 'vtags', 'online_ventas', 'logs', 'temporadas', 'cuentas',
    'vendedores', 'fventas', 'senias_vinculados'
];

// 각 테이블별 INSERT, UPDATE, DELETE 채널 생성
function getTableChannels() {
    const channels = [];
    for (const table of tables) {
        channels.push(`db_change_${table}_insert`);
        channels.push(`db_change_${table}_update`);
        channels.push(`db_change_${table}_delete`);
    }
    return channels;
}

function initializeWebSocket(server) {
    console.log(`[WebSocket] 초기화 시작: HTTP 서버 상태 확인 중...`);
    
    // HTTP 서버가 리스닝 중인지 확인
    if (!server || !server.listening) {
        console.warn(`[WebSocket] 경고: HTTP 서버가 아직 리스닝 중이 아닙니다.`);
    }
    
    // WebSocket 서버 생성
    // path 옵션을 사용하여 특정 경로만 처리하도록 설정
    // 이렇게 하면 Express가 해당 경로의 요청을 처리하기 전에 ws 라이브러리가 처리함
    try {
        // /ws와 /api/ws 모두 지원
        // path 옵션을 사용하지 않고 verifyClient로 경로 확인
        wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false, // 압축 비활성화 (선택사항)
            clientTracking: true, // 클라이언트 추적 활성화
            // 타임아웃 설정: ping을 보낸 후 pong을 기다리는 시간 (기본값 45초보다 길게 설정)
            // ping은 60초마다 보내므로, clientTimeout을 120초로 설정하여 충분한 여유 확보
            clientTimeout: 120000, // 120초 (2분) - ping 간격(60초)의 2배로 설정
            verifyClient: (info) => {
                const rawUrl = info.req.url || '';
                const pathOnly = rawUrl.split('?')[0].split('#')[0];
                const upgrade = info.req.headers.upgrade;
                
                // 경로 확인 (쿼리/해시 제외). /ws 또는 /api/ws 허용
                const isWebSocketPath = pathOnly === '/ws' || pathOnly === '/api/ws';
                
                if (!isWebSocketPath) return false;
                if (!upgrade || upgrade.toLowerCase() !== 'websocket') return false;
                
                return true;
            }
        });
        console.log(`[WebSocket] ✅ WebSocket 서버 생성 완료: 경로=/ws, /api/ws 지원`);
    } catch (err) {
        console.error(`[WebSocket] ❌ WebSocket 서버 생성 실패:`, err.message);
        throw err;
    }

    // WebSocket 서버 이벤트 리스너
    wss.on('listening', () => {
        console.log(`[WebSocket] ✅ 서버 리스닝 중: 경로=/ws, /api/ws 지원`);
    });

    wss.on('error', (error) => {
        console.error(`[WebSocket] ❌ 서버 오류:`, error.message);
        console.error(`[WebSocket] 오류 상세:`, error);
    });
    
    // WebSocket 서버 초기화 완료 표시
    console.log(`[WebSocket] ✅ WebSocket 서버 초기화 완료: 경로=/ws, /api/ws 지원`);
    
    // connection 이벤트가 발생하는지 확인하기 위한 디버깅
    console.log(`[WebSocket] connection 이벤트 리스너 등록 완료`);

    wss.on('connection', (ws, req) => {
        // 고유 ID 할당
        ws.id = generateClientId();
        const remoteAddress = req.socket.remoteAddress || 'unknown';
        const requestUrl = req.url || req.originalUrl || 'unknown';
        const pathOnly = String(requestUrl).split('?')[0].split('#')[0];
        
        // 경로 확인: /ws 또는 /api/ws만 허용 (쿼리/해시 무시)
        if (pathOnly !== '/ws' && pathOnly !== '/api/ws') {
            console.log(`[WebSocket] ⚠️ 지원하지 않는 경로로 연결 시도: ${requestUrl}`);
            ws.close(1008, 'Unsupported path');
            return;
        }
        
        // 클라이언트 정보 초기화
        clientInfo.set(ws.id, {
            clientId: null,
            dbKey: null,
            sucursal: null,
            subscribedTables: null  // null = 모든 테이블 구독, array = 해당 테이블만
        });

        // 메시지 수신 처리
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                const msgType = data.type || data.action || 'unknown';
                
                // register-client 또는 register 메시지 처리 (register는 register-client의 별칭)
                if (data.type === 'register-client' || data.action === 'register-client' || 
                    data.type === 'register' || data.action === 'register') {
                    handleRegisterClient(ws, data);
                } 
                // fetch-more 메시지 처리 (페이지네이션)
                else if (data.type === 'fetch-more' || data.action === 'fetch-more') {
                    handleFetchMore(ws, data);
                }
                // 구독 테이블 목록 갱신 (activar/desactivar)
                else if (data.type === 'update-subscription') {
                    handleUpdateSubscription(ws, data);
                }
                else {
                    // 기타 메시지 처리 (필요시 확장)
                    console.log(`[WebSocket] 알 수 없는 메시지 타입: ${msgType}`);
                }
            } catch (err) {
                sendError(ws, 'Invalid message format');
            }
        });

        // ping/pong으로 연결 유지 (30초마다 - 연결 안정성 향상)
        // clientTimeout이 120초이므로, 30초마다 ping을 보내면 충분한 여유가 있음
        // 클라이언트가 pong을 응답하지 않아도 최대 4번의 ping 기회가 있음 (30초 × 4 = 120초)
        let pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.ping();
                } catch (err) {
                    console.error(`[WebSocket] ping 전송 오류 (id=${ws.id}):`, err.message);
                    if (pingInterval) {
                        clearInterval(pingInterval);
                        pingInterval = null;
                    }
                }
            } else {
                if (pingInterval) {
                    clearInterval(pingInterval);
                    pingInterval = null;
                }
            }
        }, 30000); // 30초마다 ping 전송 (연결 안정성 향상)

        // ping interval 정리 헬퍼 함수
        const cleanupPingInterval = () => {
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
        };

        // 연결 종료 처리
        ws.on('close', (code, reason) => {
            // ping 인터벌 정리
            cleanupPingInterval();
            
            const info = clientInfo.get(ws.id);
            const clientId = info ? info.clientId : 'unknown';
            const dbKey = info ? info.dbKey : null;
            
            // 간단한 연결 해제 메시지
            console.log(`[WebSocket] 클라이언트 연결 끊어짐: clientId=${clientId}`);
            
            // 연결 해제 시 데이터베이스 그룹에서 제거
            if (dbKey && dbClientGroups.has(dbKey)) {
                const group = dbClientGroups.get(dbKey);
                group.delete(ws.id);
                // 그룹이 비어있으면 제거
                if (group.size === 0) {
                    dbClientGroups.delete(dbKey);
                }
            }
            
            // 클라이언트 정보 제거
            clientInfo.delete(ws.id);
            
            // 페이지네이션 큐 제거
            clientPaginationQueues.delete(ws.id);
        });

        // 오류 처리
        ws.on('error', (error) => {
            console.error(`[WebSocket] 클라이언트 오류 (id=${ws.id}):`, error.message);
            console.error(`[WebSocket] 오류 상세:`, error);
            // 오류 발생 시에도 ping interval 정리
            cleanupPingInterval();
        });

        // pong 응답 처리
        ws.on('pong', () => {
            // 클라이언트가 살아있음을 확인 (ping에 대한 응답)
        });

        // 연결 확인 메시지 전송
        sendMessage(ws, {
            type: 'connected',
            clientId: ws.id,
            message: 'WebSocket connection established'
        });
    });

    console.log(`[WebSocket] 서버 초기화 완료: 경로=/ws, /api/ws 지원`);
    return wss;
}

// 클라이언트 등록 처리
function handleRegisterClient(ws, data) {
    const database = data.database || data.dbName || data.db_name;
    const user = data.user || data.dbUser || data.db_user;
    
    let clientId = data.clientId || ws.id;
    let dbKey = data.dbKey;
    
    // host와 port는 기본값으로 강제 설정
    const defaultHost = getDefaultDbHost();
    const defaultPort = getDefaultDbPort();
    
    // 다양한 필드명 지원 (dbName/dbUser 또는 database/user)
    // host와 port는 기본값 사용 (클라이언트가 보낸 값 무시)
    if (!dbKey && database && user) {
        dbKey = getConnectionKey(defaultHost, defaultPort, database, user);
    }
    
    if (dbKey) {
        // 구독 테이블 목록 정규화 (배열이면 소문자, 허용 테이블만; 없으면 null = 전체)
        const rawTables = data.subscribedTables;
        let subscribedTables = null;
        if (Array.isArray(rawTables) && rawTables.length > 0) {
            const allowed = new Set(tables);
            subscribedTables = rawTables
                .map(t => (typeof t === 'string' ? t.toLowerCase().trim() : ''))
                .filter(t => t && allowed.has(t));
        }
        // 클라이언트 정보 업데이트
        const info = {
            clientId: clientId,
            dbKey: dbKey,
            sucursal: data.sucursal !== undefined && data.sucursal !== null ? parseInt(data.sucursal, 10) : null,
            subscribedTables: subscribedTables
        };
        clientInfo.set(ws.id, info);
        
        // 데이터베이스별 클라이언트 그룹에 추가
        if (!dbClientGroups.has(dbKey)) {
            dbClientGroups.set(dbKey, new Map());
        }
        dbClientGroups.get(dbKey).set(ws.id, ws);
        
        const tablesLabel = info.subscribedTables && info.subscribedTables.length > 0
            ? info.subscribedTables.join(', ')
            : 'all';
        console.log(`[WebSocket] ✅ 클라이언트 등록됨: id=${ws.id}, clientId=${clientId}, dbKey=${dbKey}, sucursal=${info.sucursal !== null ? info.sucursal : 'all'}, tables=[${tablesLabel}], group size=${dbClientGroups.get(dbKey).size}`);
        
        // 등록 확인 메시지 전송
        sendMessage(ws, {
            type: 'registered',
            clientId: clientId,
            dbKey: dbKey,
            sucursal: info.sucursal,
            subscribedTables: info.subscribedTables
        });
    } else {
        sendError(ws, 'Failed to register client: dbKey generation failed');
    }
}

// 구독 테이블 목록 갱신 (update-subscription)
function handleUpdateSubscription(ws, data) {
    const info = clientInfo.get(ws.id);
    if (!info || !info.dbKey) {
        sendError(ws, 'Register first before updating subscription');
        return;
    }
    const rawTables = data.subscribedTables;
    let subscribedTables = null;
    if (Array.isArray(rawTables) && rawTables.length > 0) {
        const allowed = new Set(tables);
        subscribedTables = rawTables
            .map(t => (typeof t === 'string' ? t.toLowerCase().trim() : ''))
            .filter(t => t && allowed.has(t));
    }
    info.subscribedTables = subscribedTables;
    clientInfo.set(ws.id, info);
    sendMessage(ws, {
        type: 'subscription-updated',
        subscribedTables: subscribedTables
    });
}

// 페이지네이션된 데이터 전송 (20개씩)
function sendPaginatedData(ws, message) {
    const dataArray = Array.isArray(message.data) ? message.data : (message.data ? [message.data] : []);
    const pageSize = 20;
    
    if (dataArray.length === 0) {
        // 데이터가 없으면 그냥 전송
        sendMessage(ws, message);
        return;
    }
    
    if (dataArray.length <= pageSize) {
        // 20개 이하면 그냥 전송
        sendMessage(ws, {
            ...message,
            data: dataArray,
            pagination: {
                total: dataArray.length,
                currentPage: 1,
                pageSize: pageSize,
                hasMore: false
            }
        });
        return;
    }
    
    // 20개 초과면 첫 20개만 전송하고 나머지는 큐에 저장
    const firstPage = dataArray.slice(0, pageSize);
    const remainingData = dataArray.slice(pageSize);
    
    // 고유한 changeId 생성 (타임스탬프 + 랜덤 문자열 + 클라이언트 ID)
    const changeId = `${message.table}_${message.operation}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}_${ws.id}`;
    
    // 첫 페이지 전송
    sendMessage(ws, {
        ...message,
        data: firstPage,
        pagination: {
            total: dataArray.length,
            currentPage: 1,
            pageSize: pageSize,
            hasMore: true,
            changeId: changeId
        }
    });
    
    // 나머지 데이터를 큐에 저장
    if (!clientPaginationQueues.has(ws.id)) {
        clientPaginationQueues.set(ws.id, []);
    }
    
    const queue = clientPaginationQueues.get(ws.id);
    queue.push({
        changeId: changeId,
        table: message.table,
        operation: message.operation,
        data: remainingData,
        timestamp: Date.now(),
        total: dataArray.length,
        pageSize: pageSize
    });
}

// fetch-more 메시지 처리
function handleFetchMore(ws, data) {
    const changeId = data.changeId;
    const page = data.page || 2; // 기본값: 2페이지
    
    if (!changeId) {
        sendError(ws, 'changeId is required for fetch-more');
        return;
    }
    
    const queue = clientPaginationQueues.get(ws.id);
    if (!queue || queue.length === 0) {
        sendMessage(ws, {
            type: 'fetch-more-response',
            changeId: changeId,
            data: [],
            pagination: {
                hasMore: false,
                message: 'No more data available'
            }
        });
        return;
    }
    
    // changeId로 큐에서 찾기
    const changeIndex = queue.findIndex(item => item.changeId === changeId);
    if (changeIndex === -1) {
        sendMessage(ws, {
            type: 'fetch-more-response',
            changeId: changeId,
            data: [],
            pagination: {
                hasMore: false,
                message: 'Change not found in queue'
            }
        });
        return;
    }
    
    const change = queue[changeIndex];
    const pageSize = change.pageSize || 20;
    const startIndex = (page - 2) * pageSize; // 첫 페이지는 이미 전송했으므로 page-2
    const endIndex = startIndex + pageSize;
    
    if (startIndex >= change.data.length) {
        // 더 이상 데이터가 없으면 큐에서 제거
        queue.splice(changeIndex, 1);
        sendMessage(ws, {
            type: 'fetch-more-response',
            changeId: changeId,
            data: [],
            pagination: {
                hasMore: false,
                message: 'No more data available'
            }
        });
        return;
    }
    
    // 다음 페이지 데이터 전송
    const pageData = change.data.slice(startIndex, endIndex);
    const hasMore = endIndex < change.data.length;
    
    sendMessage(ws, {
        type: 'fetch-more-response',
        changeId: changeId,
        table: change.table,
        operation: change.operation,
        data: pageData,
        pagination: {
            total: change.total,
            currentPage: page,
            pageSize: pageSize,
            hasMore: hasMore
        }
    });
    
    // 마지막 페이지를 전송했으면 큐에서 제거
    if (!hasMore) {
        queue.splice(changeIndex, 1);
    }
}

// 메시지 전송 헬퍼
// 1000개 이상 연결 시 성능 최적화: 에러 로깅 최소화
function sendMessage(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
            // 연결 확인 메시지는 로그 출력 (디버깅용)
            if (data.type === 'registered') {
                console.log(`[WebSocket] 메시지 전송됨: type=${data.type}, clientId=${data.clientId || 'unknown'}`);
            }
        } catch (err) {
            // 에러 로깅 최소화 (1000개 이상 연결 시 로그 폭주 방지)
            // 중요한 에러만 로깅
            if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
                console.error(`[WebSocket] 메시지 전송 오류: ${err.message}`);
            }
        }
    }
    // 상태가 OPEN이 아닌 경우 로그 출력하지 않음 (1000개 이상 연결 시 로그 폭주 방지)
}

// 오류 메시지 전송 헬퍼
function sendError(ws, message) {
    sendMessage(ws, {
        type: 'error',
        message: message
    });
}

function getConnectionKey(host, port, database, user) {
    // 포트를 문자열로 통일하여 일관성 유지
    const portStr = String(port).trim();
    return `${host}:${portStr}/${database}@${user}`;
}

async function setupDbListener(host, port, database, user, password, ssl = false) {
    // host와 port는 기본값으로 강제 설정
    const defaultHost = getDefaultDbHost();
    const defaultPort = getDefaultDbPort();
    const actualHost = defaultHost;
    const actualPort = defaultPort;
    
    const key = getConnectionKey(actualHost, actualPort, database, user);
    
    // 이미 리스너가 설정되어 있으면 스킵
    if (dbListeners.has(key)) {
        return;
    }

    // LISTEN 전용 연결 생성 (Sequelize 풀과 별도)
    const pool = new Pool({
        host: actualHost,
        port: parseInt(actualPort, 10),
        database,
        user,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : false,
        max: 1, // LISTEN은 단일 연결만 필요
    });

    const client = await pool.connect();
    
    // 아르헨티나 시간대 설정 (UTC-3)
    try {
        await client.query("SET timezone = 'America/Argentina/Buenos_Aires'");
    } catch (err) {
        console.warn(`[WebSocket Timezone] ⚠️ Timezone 설정 실패 (무시): ${err.message}`);
    }

    // 모든 테이블의 INSERT, UPDATE, DELETE 채널 리스닝
    const channels = getTableChannels();
    for (const channel of channels) {
        try {
            await client.query(`LISTEN ${channel}`);
        } catch (err) {
            // 채널이 존재하지 않을 수 있으므로 조용히 무시
        }
    }

    // 트리거 알림 배치 전송 함수
    function flushTriggerDebounceQueue(dbKey, tableName) {
        const queueKey = `${dbKey}:${tableName}`;
        const queue = triggerDebounceQueues.get(queueKey);
        
        if (!queue || queue.length === 0) {
            return;
        }
        
        // 큐에서 모든 알림 데이터 수집
        const allPayloads = [];
        let lastChannel = null;
        let lastOperation = null;
        const clientGroup = dbClientGroups.get(dbKey);
        const connectedCount = clientGroup ? clientGroup.size : 0;
        
        // 큐의 모든 항목을 하나로 합치기
        for (const item of queue) {
            if (item.payload) {
                try {
                    const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
                    if (Array.isArray(payload)) {
                        allPayloads.push(...payload);
                    } else {
                        allPayloads.push(payload);
                    }
                } catch (e) {
                    // 파싱 실패 시 원본 추가
                    allPayloads.push(item.payload);
                }
            }
            lastChannel = item.channel;
            lastOperation = item.operation;
        }
        
        // 큐와 타이머 정리
        triggerDebounceQueues.delete(queueKey);
        const timer = triggerDebounceTimers.get(queueKey);
        if (timer) {
            clearTimeout(timer);
            triggerDebounceTimers.delete(queueKey);
        }
        
        // 배치 알림 전송
        if (allPayloads.length > 0 && connectedCount > 0) {
            // 배치 알림 로그
            if (tableName === 'codigos') {
                const firstPayload = allPayloads[0] || {};
                const codigo = firstPayload.codigo || 'N/A';
                console.log(`\n🔔 [Codigos 트리거 배치 알림]`);
                console.log(`   📋 테이블: ${tableName}`);
                console.log(`   🔧 작업: BATCH_SYNC`);
                console.log(`   📦 총 항목 수: ${allPayloads.length}개`);
                console.log(`   🏷️  첫 번째 코드: ${codigo}`);
                console.log(`   🗄️  데이터베이스: ${database}`);
                console.log(`   👥 연결된 클라이언트: ${connectedCount}개`);
                console.log(`   ⏰ 시간: ${new Date().toISOString()}`);
                console.log(`   🔄 웹소켓 브로드캐스트 시작...\n`);
            } else {
                console.log(`[WebSocket] DB Trigger Batch Notification - Table: ${tableName}, Items: ${allPayloads.length}개, dbKey: ${dbKey}, Connected clients: ${connectedCount}`);
            }
            
            // 배치 알림 전송 (BATCH_SYNC로 표시)
            broadcastToDbClients(key, null, {
                channel: lastChannel,
                table: tableName,
                operation: 'BATCH_SYNC',
                payload: JSON.stringify(allPayloads),
                database: database,
                host: host,
                port: port
            });
        }
    }

    // NOTIFY 이벤트 리스너
    client.on('notification', (msg) => {
        if (wss) {
            // 채널 이름에서 테이블명과 operation 추출
            // 형식: db_change_{table}_{operation}
            // 예: db_change_gastos_insert, db_change_gastos_update, db_change_gastos_delete
            const channelParts = msg.channel.split('_');
            let tableName = null;
            let operation = null;
            
            if (channelParts.length >= 4 && channelParts[0] === 'db' && channelParts[1] === 'change') {
                // 마지막 부분이 operation (insert, update, delete)
                operation = channelParts[channelParts.length - 1].toLowerCase();
                // 중간 부분이 테이블명 (언더스코어로 연결된 경우도 처리)
                tableName = channelParts.slice(2, -1).join('_');
                
                // operation을 표준화 (insert -> CREATE, update -> UPDATE, delete -> DELETE)
                const operationMap = {
                    'insert': 'CREATE',
                    'update': 'UPDATE',
                    'delete': 'DELETE'
                };
                const normalizedOperation = operationMap[operation] || operation.toUpperCase();
                
                // 동일한 데이터베이스에 연결된 클라이언트들에게만 브로드캐스트
                // 브로드캐스트 전에 클라이언트 수 확인
                const clientGroup = dbClientGroups.get(key);
                const connectedCount = clientGroup ? clientGroup.size : 0;
                
                // 디바운스 큐에 추가
                const queueKey = `${key}:${tableName}`;
                if (!triggerDebounceQueues.has(queueKey)) {
                    triggerDebounceQueues.set(queueKey, []);
                }
                
                triggerDebounceQueues.get(queueKey).push({
                    channel: msg.channel,
                    table: tableName,
                    operation: normalizedOperation,
                    payload: msg.payload,
                    database: database,
                    host: host,
                    port: port
                });
                
                // 기존 타이머가 있으면 취소
                const existingTimer = triggerDebounceTimers.get(queueKey);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                }
                
                // 새로운 타이머 설정
                const timer = setTimeout(() => {
                    flushTriggerDebounceQueue(key, tableName);
                }, DEBOUNCE_DELAY);
                
                triggerDebounceTimers.set(queueKey, timer);
                
            } else {
                // 채널 형식이 예상과 다를 경우 원본 정보만 전달 (디바운싱 없이 즉시 전송)
                console.warn(`[WebSocket] Unexpected channel format: ${msg.channel}`);
                broadcastToDbClients(key, null, {
                    channel: msg.channel,
                    payload: msg.payload,
                    database: database,
                    host: host,
                    port: port
                });
            }
        }
    });

    // 연결 오류 처리
    client.on('error', async (err) => {
        console.error(`❌ DB LISTEN connection error (${key}):`, err.message);
        
        // 리스너에서 제거
        dbListeners.delete(key);
        
        // 클라이언트 해제
        try {
            if (client && !client._ending) {
                client.release();
            }
        } catch (releaseErr) {
            console.error(`[WebSocket] Client release error:`, releaseErr.message);
        }
        
        // Pool 정리 (더 이상 사용하지 않을 경우)
        // 주의: 다른 연결이 pool을 사용할 수 있으므로 신중하게 처리
        // 현재는 pool을 유지하되, client만 해제
    });

    // 연결 종료 처리
    client.on('end', () => {
        console.log(`[WebSocket] DB LISTEN connection ended (${key})`);
        dbListeners.delete(key);
    });

    dbListeners.set(key, { client, pool });
}

function getWebSocketServer() {
    return wss;
}

// WebSocket 서버 인스턴스 반환 (모니터링용)
function getWebSocketServerInstance() {
    return wss;
}

// 특정 데이터베이스에 연결된 클라이언트들에게만 브로드캐스트 (요청한 클라이언트 제외)
// 테이블별 sucursal 필터링 규칙:
// - codigos, todocodigos, tipos, color: sucursal 무관하게 모든 클라이언트에게 전송
// - ingresos: 데이터베이스와 sucursal 번호가 같은 경우에만 전송
// - 기타 테이블: 기본적으로 sucursal 필터링 적용
// 
// excludeClientId 처리:
// - excludeClientId는 clientId 또는 ws.id일 수 있음
// - ws.id는 항상 고유하므로 ws.id로 비교하는 것이 안전함
// - clientId가 짧거나 중복될 수 있으므로, excludeClientId가 ws.id와 일치하는지 먼저 확인
function broadcastToDbClients(dbKey, excludeClientId, data) {
    if (!wss || !dbKey) return;
    
    // 해당 데이터베이스에 연결된 클라이언트 그룹 가져오기
    const clientGroup = dbClientGroups.get(dbKey);
    if (!clientGroup || clientGroup.size === 0) return;
    
    // excludeClientId에 해당하는 ws.id 찾기 (clientId 중복 방지)
    let excludeWsId = null;
    if (excludeClientId) {
        clientGroup.forEach((ws, wsId) => {
            const info = clientInfo.get(wsId);
            if (info) {
                // ws.id가 excludeClientId와 일치하는지 확인 (가장 정확)
                if (wsId === excludeClientId) {
                    excludeWsId = wsId;
                }
                // clientId가 excludeClientId와 일치하는지 확인 (하지만 ws.id가 우선)
                else if (info.clientId === excludeClientId && !excludeWsId) {
                    // clientId가 중복될 수 있으므로 첫 번째 매치만 사용
                    // 실제로는 ws.id로 비교하는 것이 더 안전함
                    excludeWsId = wsId;
                }
            }
        });
    }
    
    // 테이블명 추출
    let tableName = null;
    if (data && typeof data === 'object') {
        // data.table이 있는 경우
        if (data.table) {
            tableName = data.table.toLowerCase();
        }
        // data.channel에서 추출 (NOTIFY 이벤트의 경우)
        else if (data.channel) {
            const channelParts = data.channel.split('_');
            if (channelParts.length >= 4 && channelParts[0] === 'db' && channelParts[1] === 'change') {
                tableName = channelParts.slice(2, -1).join('_').toLowerCase();
            }
        }
    }
    
    // sucursal 무관 테이블 목록
    const sucursalIndependentTables = ['codigos', 'todocodigos', 'tipos', 'color'];
    const isSucursalIndependent = tableName && sucursalIndependentTables.includes(tableName);
    
    // ingresos 테이블인지 확인
    const isIngresosTable = tableName === 'ingresos';
    
    // 데이터에서 sucursal 추출 (sucursal 필터링이 필요한 경우만)
    let dataSucursal = null;
    if (!isSucursalIndependent && data && typeof data === 'object') {
        // data.data가 배열인 경우
        if (Array.isArray(data.data) && data.data.length > 0) {
            dataSucursal = data.data[0].sucursal !== undefined ? parseInt(data.data[0].sucursal, 10) : null;
        } 
        // data.data가 단일 객체인 경우
        else if (data.data && typeof data.data === 'object' && data.data.sucursal !== undefined) {
            dataSucursal = parseInt(data.data.sucursal, 10);
        }
        // data 자체가 배열인 경우
        else if (Array.isArray(data) && data.length > 0) {
            dataSucursal = data[0].sucursal !== undefined ? parseInt(data[0].sucursal, 10) : null;
        }
        // data 자체가 객체이고 sucursal이 있는 경우
        else if (data.sucursal !== undefined) {
            dataSucursal = parseInt(data.sucursal, 10);
        }
        // payload에서 sucursal 추출 시도 (NOTIFY 이벤트의 경우)
        else if (data.payload) {
            try {
                const payload = typeof data.payload === 'string' ? JSON.parse(data.payload) : data.payload;
                if (payload && payload.sucursal !== undefined) {
                    dataSucursal = parseInt(payload.sucursal, 10);
                }
            } catch (e) {
                // payload 파싱 실패는 무시
            }
        }
    }
    
    // 메시지 구성
    const message = {
        type: 'db-change',
        ...data
    };
    
    // 그룹 내의 각 클라이언트에게 전송
    let sentCount = 0;
    let filteredCount = 0;
    
    clientGroup.forEach((ws, wsId) => {
        const info = clientInfo.get(wsId);
        if (!info) return;
        
        // 요청한 클라이언트는 제외 (ws.id로 비교하여 정확성 보장)
        if (excludeWsId && wsId === excludeWsId) {
            filteredCount++;
            return; // 제외
        }
        // 구독 테이블 필터: subscribedTables가 배열이면 해당 테이블만 수신
        if (tableName && Array.isArray(info.subscribedTables) && info.subscribedTables.length > 0) {
            if (!info.subscribedTables.includes(tableName)) {
                filteredCount++;
                return;
            }
        }
        
        let shouldSend = false;
        
        if (isSucursalIndependent) {
            // codigos, todocodigos, tipos, color: sucursal 무관하게 모든 클라이언트에게 전송
            shouldSend = true;
        } else if (isIngresosTable) {
            // ingresos: 데이터베이스와 sucursal 번호가 같은 경우에만 전송
            // - 클라이언트가 특정 sucursal에 연결된 경우: 해당 sucursal 데이터만 전송
            // - 클라이언트가 sucursal 없이 연결된 경우: 전송하지 않음 (ingresos는 반드시 sucursal 필요)
            // - 데이터에 sucursal이 없는 경우: 전송하지 않음
            shouldSend = info.sucursal !== null && 
                         dataSucursal !== null && 
                         info.sucursal === dataSucursal;
        } else {
            // 기타 테이블: 기본 sucursal 필터링
            // - 클라이언트가 특정 sucursal에 연결된 경우: 해당 sucursal 데이터만 전송
            // - 클라이언트가 sucursal 없이 연결된 경우 (null): 모든 데이터 전송
            // - 데이터에 sucursal이 없는 경우: 모든 클라이언트에게 전송
            shouldSend = info.sucursal === null || 
                         dataSucursal === null || 
                         info.sucursal === dataSucursal;
        }
        
        if (shouldSend) {
            // 페이지네이션 처리: 데이터를 20개씩 나눠서 전송
            sendPaginatedData(ws, message);
            sentCount++;
        } else {
            filteredCount++;
        }
    });
    
    // 전송된 클라이언트가 있는 경우에만 로그 출력
    if (sentCount > 0) {
        // codigos, todocodigos 테이블에 대한 상세 브로드캐스트 메시지 출력
        if (tableName === 'codigos' || tableName === 'todocodigos') {
            // 트리거를 통한 알림인지 API를 통한 알림인지 구분
            const isTriggerNotification = data.channel && data.channel.startsWith('db_change_');
            const sourceType = isTriggerNotification ? '트리거' : 'API';
            
            console.log(`\n📤 [${tableName === 'codigos' ? 'Codigos' : 'Todocodigos'} 웹소켓 브로드캐스트 완료]`);
            console.log(`   📋 테이블: ${tableName}`);
            console.log(`   🔧 작업: ${data.operation || 'UNKNOWN'}`);
            console.log(`   📡 소스: ${sourceType}를 통한 알림`);
            console.log(`   🗄️  데이터베이스: ${dbKey}`);
            console.log(`   👥 연결된 클라이언트: ${clientGroup.size}개`);
            console.log(`   ✅ 전송된 클라이언트: ${sentCount}개`);
            if (filteredCount > 0) {
                console.log(`   ⏭️  필터링된 클라이언트: ${filteredCount}개`);
            }
            console.log(`   ⏰ 시간: ${new Date().toISOString()}\n`);
        } else if (filteredCount > 0 || (isIngresosTable && dataSucursal !== null)) {
            // 다른 테이블은 필터링이 발생한 경우만 로그 출력
            console.log(`[WebSocket] 브로드캐스트: table=${tableName || 'unknown'}, dbKey=${dbKey}, sucursal=${dataSucursal !== null ? dataSucursal : 'all'}, 전송=${sentCount}, 필터링=${filteredCount}`);
        }
    }
}

// 특정 클라이언트를 제외한 다른 클라이언트들에게 브로드캐스트 (레거시 호환성)
// excludeClientId는 clientId 또는 ws.id일 수 있음
// ws.id로 비교하여 clientId 중복 문제 방지
function broadcastToOthers(excludeClientId, eventName, data) {
    if (!wss) return;
    
    // excludeClientId에 해당하는 ws.id 찾기 (clientId 중복 방지)
    let excludeWsId = null;
    if (excludeClientId) {
        wss.clients.forEach((ws) => {
            const info = clientInfo.get(ws.id);
            if (info) {
                // ws.id가 excludeClientId와 일치하는지 확인 (가장 정확)
                if (ws.id === excludeClientId) {
                    excludeWsId = ws.id;
                }
                // clientId가 excludeClientId와 일치하는지 확인 (하지만 ws.id가 우선)
                else if (info.clientId === excludeClientId && !excludeWsId) {
                    excludeWsId = ws.id;
                }
            }
        });
    }
    
    const message = {
        type: eventName,
        ...data
    };
    
    // 모든 소켓에 대해
    wss.clients.forEach((ws) => {
        const info = clientInfo.get(ws.id);
        if (info) {
            // 요청한 클라이언트는 제외 (ws.id로 비교하여 정확성 보장)
            if (!excludeWsId || ws.id !== excludeWsId) {
                sendMessage(ws, message);
            }
        }
    });
}

// 특정 데이터베이스에 연결된 다른 클라이언트 개수 조회 (요청한 클라이언트 제외)
function getConnectedClientCount(dbKey, excludeClientId = null) {
    if (!dbKey) {
        console.log(`[WebSocket] getConnectedClientCount: dbKey is missing`);
        return 0;
    }
    
    const clientGroup = dbClientGroups.get(dbKey);
    if (!clientGroup || clientGroup.size === 0) {
        // 클라이언트가 없을 때는 로그를 출력하지 않음
        return 0;
    }
    
    // excludeClientId가 제공된 경우 해당 클라이언트를 제외한 개수 계산
    // excludeClientId는 clientId 또는 ws.id일 수 있음
    // ws.id로 비교하여 clientId 중복 문제 방지
    if (excludeClientId) {
        // excludeClientId에 해당하는 ws.id 찾기 (clientId 중복 방지)
        let excludeWsId = null;
        clientGroup.forEach((ws, wsId) => {
            const info = clientInfo.get(wsId);
            if (info) {
                // ws.id가 excludeClientId와 일치하는지 확인 (가장 정확)
                if (wsId === excludeClientId) {
                    excludeWsId = wsId;
                }
                // clientId가 excludeClientId와 일치하는지 확인 (하지만 ws.id가 우선)
                else if (info.clientId === excludeClientId && !excludeWsId) {
                    excludeWsId = wsId;
                }
            }
        });
        
        let count = 0;
        const socketDetails = [];
        clientGroup.forEach((ws, wsId) => {
            const info = clientInfo.get(wsId);
            if (info) {
                const socketClientId = info.clientId || wsId;
                socketDetails.push({ wsId, clientId: socketClientId, dbKey: info.dbKey });
                // ws.id로 비교하여 정확성 보장
                if (!excludeWsId || wsId !== excludeWsId) {
                    count++;
                }
            }
        });
        
        // 클라이언트가 2개 이상일 때만 로그 출력
        if (clientGroup.size >= 2) {
            const allDbKeys = Array.from(dbClientGroups.keys());
            console.log(`[WebSocket] All registered dbKeys:`, allDbKeys);
            console.log(`[WebSocket] getConnectedClientCount: ${clientGroup.size} sockets registered for dbKey(${dbKey})`);
            console.log(`[WebSocket] getConnectedClientCount: ${count} clients after excluding excludeClientId(${excludeClientId}, wsId=${excludeWsId || 'not found'}), all socket info:`, socketDetails);
        }
        return count;
    }
    
    // excludeClientId가 없으면 전체 클라이언트 개수 반환
    // 클라이언트가 2개 이상일 때만 로그 출력
    if (clientGroup.size >= 2) {
        const allDbKeys = Array.from(dbClientGroups.keys());
        console.log(`[WebSocket] All registered dbKeys:`, allDbKeys);
        console.log(`[WebSocket] getConnectedClientCount: ${clientGroup.size} sockets registered for dbKey(${dbKey})`);
        console.log(`[WebSocket] getConnectedClientCount: No excludeClientId, returning total client count ${clientGroup.size}`);
    }
    return clientGroup.size;
}

module.exports = {
    initializeWebSocket,
    setupDbListener,
    getWebSocketServer,
    broadcastToOthers,
    broadcastToDbClients,
    getConnectionKey,
    getConnectedClientCount
};
