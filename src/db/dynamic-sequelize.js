const { Sequelize } = require('sequelize');
const { setupDbListener } = require('../services/websocket-service');

// 연결 풀: 동일한 DB 연결 정보는 재사용
const connectionPool = new Map();

function getConnectionKey(host, port, database, user) {
    return `${host}:${port}/${database}@${user}`;
}

function getDynamicSequelize(host, port, database, user, password, ssl = false) {
    // host는 파라미터로 받은 값을 사용 (무조건 localhost로 강제되어 있음)
    // 환경 변수 DB_HOST는 무시하고 파라미터로 받은 host 사용
    host = host || 'localhost';
    const key = getConnectionKey(host, port, database, user);
    
    // 이미 존재하는 연결이 있으면 재사용
    if (connectionPool.has(key)) {
        return connectionPool.get(key);
    }
    
    // 새로운 연결 생성
    const sequelize = new Sequelize(database, user, password, {
        host: host,
        port: parseInt(port, 10),
        dialect: 'postgres',
        dialectOptions: ssl ? { ssl: { rejectUnauthorized: false } } : {},
        pool: {
            max: 50,              // 최대 연결 수 (100개 동시 클라이언트 대응)
            min: 2,               // 최소 연결 수 (항상 유지할 연결)
            idle: 10000,          // 유휴 연결 유지 시간 (10초)
            acquire: 30000,       // 연결 획득 대기 시간 (30초)
            evict: 1000           // 유휴 연결 체크 주기 (1초)
        },
        logging: false,  // Sequelize 쿼리 로깅 비활성화
        // 연결 실패 시 재시도 설정
        retry: {
            max: 3,
            match: [
                /ETIMEDOUT/,
                /EHOSTUNREACH/,
                /ECONNREFUSED/,
                /ENOTFOUND/,
                /SequelizeConnectionError/,
                /SequelizeConnectionRefusedError/,
                /SequelizeHostNotFoundError/,
                /SequelizeHostNotReachableError/,
                /SequelizeInvalidConnectionError/,
                /SequelizeConnectionTimedOutError/
            ]
        }
    });
    
    connectionPool.set(key, sequelize);
    
    // WebSocket LISTEN 리스너 설정 (비동기, 에러는 무시)
    setupDbListener(host, port, database, user, password, ssl).catch(() => {
        // LISTEN 설정 실패는 조용히 무시 (이미 설정되어 있을 수 있음)
    });
    
    return sequelize;
}

module.exports = { getDynamicSequelize, connectionPool };

