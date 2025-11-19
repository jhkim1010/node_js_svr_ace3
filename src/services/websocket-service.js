const { Server } = require('socket.io');
const { Pool } = require('pg');

// WebSocket 서버 인스턴스
let io = null;

// 각 DB 연결별 LISTEN 리스너 관리
const dbListeners = new Map();

// 데이터베이스별 클라이언트 그룹 관리 (dbKey -> Set of socket.id)
const dbClientGroups = new Map();

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
    io = new Server(server, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        // 클라이언트가 자신의 ID와 데이터베이스 정보를 등록
        socket.on('register-client', (data) => {
            // 이전 방식 호환성: 문자열로 전달된 경우
            if (typeof data === 'string') {
                socket.clientId = data;
                console.log(`[WebSocket] Client registered (string): socketId=${socket.id}, clientId=${data}`);
            } else {
                // 객체로 전달된 경우
                socket.clientId = data.clientId;
                
                // dbKey가 직접 제공된 경우
                let dbKey = data.dbKey;
                
                // dbKey가 없고 데이터베이스 정보가 제공된 경우 dbKey 생성
                if (!dbKey && data.host && data.port && data.database && data.user) {
                    dbKey = getConnectionKey(data.host, data.port, data.database, data.user);
                }
                
                if (dbKey) {
                    socket.dbKey = dbKey;
                    // 데이터베이스별 클라이언트 그룹에 추가
                    if (!dbClientGroups.has(dbKey)) {
                        dbClientGroups.set(dbKey, new Set());
                    }
                    dbClientGroups.get(dbKey).add(socket.id);
                    console.log(`[WebSocket] Client registered: socketId=${socket.id}, clientId=${data.clientId || socket.id}, dbKey=${dbKey}, group size=${dbClientGroups.get(dbKey).size}`);
                } else {
                    console.log(`[WebSocket] Client registration failed: Cannot generate dbKey. data:`, data);
                }
            }
        });

        socket.on('disconnect', () => {
            // 연결 해제 시 데이터베이스 그룹에서 제거
            if (socket.dbKey && dbClientGroups.has(socket.dbKey)) {
                const group = dbClientGroups.get(socket.dbKey);
                group.delete(socket.id);
                // 그룹이 비어있으면 제거
                if (group.size === 0) {
                    dbClientGroups.delete(socket.dbKey);
                }
            }
        });
    });

    return io;
}

function getConnectionKey(host, port, database, user) {
    // 포트를 문자열로 통일하여 일관성 유지
    const portStr = String(port).trim();
    return `${host}:${portStr}/${database}@${user}`;
}

async function setupDbListener(host, port, database, user, password, ssl = false) {
    const key = getConnectionKey(host, port, database, user);
    
    // 이미 리스너가 설정되어 있으면 스킵
    if (dbListeners.has(key)) {
        return;
    }

    // LISTEN 전용 연결 생성 (Sequelize 풀과 별도)
    const pool = new Pool({
        host,
        port: parseInt(port, 10),
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
        if (io) {
            // 동일한 데이터베이스에 연결된 클라이언트들에게만 브로드캐스트
            broadcastToDbClients(key, null, 'db_change', {
                channel: msg.channel,
                payload: msg.payload,
                database: database,
                host: host,
                port: port
            });
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
    return io;
}

// 특정 데이터베이스에 연결된 클라이언트들에게만 브로드캐스트 (요청한 클라이언트 제외)
function broadcastToDbClients(dbKey, excludeClientId, eventName, data) {
    if (!io || !dbKey) return;
    
    // 해당 데이터베이스에 연결된 클라이언트 그룹 가져오기
    const clientGroup = dbClientGroups.get(dbKey);
    if (!clientGroup || clientGroup.size === 0) return;
    
    // 그룹 내의 각 클라이언트에게 전송
    clientGroup.forEach((socketId) => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            const socketClientId = socket.clientId || socket.id;
            // 요청한 클라이언트는 제외
            if (socketClientId !== excludeClientId) {
                socket.emit(eventName, data);
            }
        }
    });
}

// 특정 클라이언트를 제외한 다른 클라이언트들에게 브로드캐스트 (레거시 호환성)
function broadcastToOthers(excludeClientId, eventName, data) {
    if (!io) return;
    
    // 모든 소켓에 대해
    io.sockets.sockets.forEach((socket) => {
        // 클라이언트 ID가 있고, 제외할 클라이언트 ID와 다르면 전송
        const socketClientId = socket.clientId || socket.id;
        if (socketClientId !== excludeClientId) {
            socket.emit(eventName, data);
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
    if (excludeClientId) {
        let count = 0;
        const socketDetails = [];
        clientGroup.forEach((socketId) => {
            const socket = io?.sockets.sockets.get(socketId);
            if (socket) {
                const socketClientId = socket.clientId || socket.id;
                socketDetails.push({ socketId, clientId: socketClientId, dbKey: socket.dbKey });
                if (socketClientId !== excludeClientId) {
                    count++;
                }
            }
        });
        console.log(`[WebSocket] getConnectedClientCount: ${count} clients after excluding excludeClientId(${excludeClientId}), all socket info:`, socketDetails);
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

