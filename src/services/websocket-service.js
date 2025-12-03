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

// 고유 ID 생성기
let clientIdCounter = 0;
function generateClientId() {
    return `client_${Date.now()}_${++clientIdCounter}`;
}

// 테이블 목록
const tables = [
    'vcodes', 'vdetalle', 'ingresos', 'codigos', 'todocodigos', 
    'parametros', 'gasto_info', 'gastos', 'color', 'creditoventas',
    'clientes', 'tipos', 'vtags', 'online_ventas', 'logs'
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
    
    // WebSocket 서버 생성 (path 옵션 없이 모든 경로 지원, 연결 핸들러에서 경로 확인)
    // /ws와 /api/ws 모두 지원
    try {
        wss = new WebSocket.Server({ 
            server,
            perMessageDeflate: false // 압축 비활성화 (선택사항)
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

    wss.on('connection', (ws, req) => {
        // 고유 ID 할당
        ws.id = generateClientId();
        const remoteAddress = req.socket.remoteAddress || 'unknown';
        const requestUrl = req.url || req.originalUrl || 'unknown';
        
        // 경로 확인: /ws 또는 /api/ws만 허용
        if (requestUrl !== '/ws' && requestUrl !== '/api/ws') {
            console.log(`[WebSocket] ⚠️ 지원하지 않는 경로로 연결 시도: ${requestUrl}`);
            ws.close(1008, 'Unsupported path');
            return;
        }
        
        console.log(`[WebSocket] ✅ 클라이언트 연결됨: id=${ws.id}, remoteAddress=${remoteAddress}, url=${requestUrl}`);
        console.log(`[WebSocket] 요청 헤더:`, {
            upgrade: req.headers.upgrade,
            connection: req.headers.connection,
            'sec-websocket-key': req.headers['sec-websocket-key'] ? 'present' : 'missing',
            'sec-websocket-version': req.headers['sec-websocket-version']
        });
        
        // 클라이언트 정보 초기화
        clientInfo.set(ws.id, {
            clientId: null,
            dbKey: null,
            sucursal: null
        });

        // 메시지 수신 처리
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                
                // register-client 메시지 처리
                if (data.type === 'register-client' || data.action === 'register-client') {
                    handleRegisterClient(ws, data);
                } else {
                    // 기타 메시지 처리 (필요시 확장)
                    console.log(`[WebSocket] 알 수 없는 메시지 타입: ${data.type || 'unknown'}`);
                }
            } catch (err) {
                console.error(`[WebSocket] 메시지 파싱 오류: ${err.message}`);
                sendError(ws, 'Invalid message format');
            }
        });

        // 연결 종료 처리
        ws.on('close', (code, reason) => {
            const info = clientInfo.get(ws.id);
            const clientId = info ? info.clientId : 'unknown';
            const dbKey = info ? info.dbKey : null;
            
            console.log(`[WebSocket] ❌ 클라이언트 연결 해제: id=${ws.id}, clientId=${clientId}, code=${code}, reason=${reason || 'none'}`);
            
            // 연결 해제 시 데이터베이스 그룹에서 제거
            if (dbKey && dbClientGroups.has(dbKey)) {
                const group = dbClientGroups.get(dbKey);
                group.delete(ws.id);
                // 그룹이 비어있으면 제거
                if (group.size === 0) {
                    dbClientGroups.delete(dbKey);
                }
                console.log(`[WebSocket] 클라이언트 그룹에서 제거됨: dbKey=${dbKey}, 남은 클라이언트 수=${group.size}`);
            }
            
            // 클라이언트 정보 제거
            clientInfo.delete(ws.id);
        });

        // 오류 처리
        ws.on('error', (error) => {
            console.error(`[WebSocket] 클라이언트 오류 (id=${ws.id}):`, error.message);
        });

        // 연결 확인 메시지 전송
        console.log(`[WebSocket] 연결 확인 메시지 전송 준비: id=${ws.id}, readyState=${ws.readyState}`);
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
    let clientId = data.clientId || ws.id;
    let dbKey = data.dbKey;
    
    // host와 port는 기본값으로 강제 설정
    const defaultHost = getDefaultDbHost();
    const defaultPort = getDefaultDbPort();
    
    // dbKey가 없고 데이터베이스 정보가 제공된 경우 dbKey 생성
    // host와 port는 기본값 사용 (클라이언트가 보낸 값 무시)
    if (!dbKey && data.database && data.user) {
        dbKey = getConnectionKey(defaultHost, defaultPort, data.database, data.user);
    }
    
    if (dbKey) {
        // 클라이언트 정보 업데이트
        const info = {
            clientId: clientId,
            dbKey: dbKey,
            sucursal: data.sucursal !== undefined && data.sucursal !== null ? parseInt(data.sucursal, 10) : null
        };
        clientInfo.set(ws.id, info);
        
        // 데이터베이스별 클라이언트 그룹에 추가
        if (!dbClientGroups.has(dbKey)) {
            dbClientGroups.set(dbKey, new Map());
        }
        dbClientGroups.get(dbKey).set(ws.id, ws);
        
        console.log(`[WebSocket] ✅ 클라이언트 등록됨: id=${ws.id}, clientId=${clientId}, dbKey=${dbKey}, sucursal=${info.sucursal !== null ? info.sucursal : 'all'}, group size=${dbClientGroups.get(dbKey).size}`);
        
        // 등록 확인 메시지 전송
        sendMessage(ws, {
            type: 'registered',
            clientId: clientId,
            dbKey: dbKey,
            sucursal: info.sucursal
        });
    } else {
        console.log(`[WebSocket] ❌ 클라이언트 등록 실패: dbKey 생성 불가. data:`, data);
        sendError(ws, 'Failed to register client: dbKey generation failed');
    }
}

// 메시지 전송 헬퍼
function sendMessage(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(data));
            // 연결 확인 메시지는 로그 출력 (디버깅용)
            if (data.type === 'connected' || data.type === 'registered') {
                console.log(`[WebSocket] 메시지 전송됨: type=${data.type}, clientId=${data.clientId || 'unknown'}`);
            }
        } catch (err) {
            console.error(`[WebSocket] 메시지 전송 오류: ${err.message}`);
        }
    } else {
        const state = ws ? ws.readyState : 'null';
        const stateNames = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };
        console.warn(`[WebSocket] 메시지 전송 실패: WebSocket 상태가 OPEN이 아님 (readyState=${state} ${stateNames[state] || ''})`);
    }
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

    // 모든 테이블의 INSERT, UPDATE, DELETE 채널 리스닝
    const channels = getTableChannels();
    for (const channel of channels) {
        try {
            await client.query(`LISTEN ${channel}`);
        } catch (err) {
            // 채널이 존재하지 않을 수 있으므로 조용히 무시
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
                
                console.log(`[WebSocket] DB Trigger Notification - Channel: ${msg.channel}, Table: ${tableName}, Operation: ${normalizedOperation}, dbKey: ${key}`);
                
                // 동일한 데이터베이스에 연결된 클라이언트들에게만 브로드캐스트
                broadcastToDbClients(key, null, {
                    channel: msg.channel,
                    table: tableName,
                    operation: normalizedOperation,
                    payload: msg.payload,
                    database: database,
                    host: host,
                    port: port
                });
            } else {
                // 채널 형식이 예상과 다를 경우 원본 정보만 전달
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
    client.on('error', (err) => {
        console.error(`❌ DB LISTEN connection error (${key}):`, err.message);
        dbListeners.delete(key);
        client.release();
    });

    dbListeners.set(key, { client, pool });
}

function getWebSocketServer() {
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
            sendMessage(ws, message);
            sentCount++;
        } else {
            filteredCount++;
        }
    });
    
    // 로그 출력 (필터링이 발생한 경우)
    if (filteredCount > 0 || (isIngresosTable && dataSucursal !== null)) {
        console.log(`[WebSocket] 브로드캐스트: table=${tableName || 'unknown'}, dbKey=${dbKey}, sucursal=${dataSucursal !== null ? dataSucursal : 'all'}, 전송=${sentCount}, 필터링=${filteredCount}`);
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
    
    // 등록된 모든 dbKey 출력 (디버깅)
    if (dbClientGroups.size > 0) {
        const allDbKeys = Array.from(dbClientGroups.keys());
        console.log(`[WebSocket] All registered dbKeys:`, allDbKeys);
    }
    
    const clientGroup = dbClientGroups.get(dbKey);
    if (!clientGroup || clientGroup.size === 0) {
        console.log(`[WebSocket] getConnectedClientCount: No client group found for dbKey(${dbKey}). Please check if it matches the registered dbKey.`);
        return 0;
    }
    
    console.log(`[WebSocket] getConnectedClientCount: ${clientGroup.size} sockets registered for dbKey(${dbKey})`);
    
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
        console.log(`[WebSocket] getConnectedClientCount: ${count} clients after excluding excludeClientId(${excludeClientId}, wsId=${excludeWsId || 'not found'}), all socket info:`, socketDetails);
        return count;
    }
    
    // excludeClientId가 없으면 전체 클라이언트 개수 반환
    console.log(`[WebSocket] getConnectedClientCount: No excludeClientId, returning total client count ${clientGroup.size}`);
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
