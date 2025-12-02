const { Sequelize } = require('sequelize');
const { setupDbListener } = require('../services/websocket-service');

// 연결 풀: 동일한 DB 연결 정보는 재사용
const connectionPool = new Map();

function getConnectionKey(host, port, database, user) {
    return `${host}:${port}/${database}@${user}`;
}

// Docker 환경 감지 함수
function isDockerEnvironment() {
    try {
        const fs = require('fs');
        return process.env.DOCKER === 'true' || 
               process.env.IN_DOCKER === 'true' ||
               fs.existsSync('/.dockerenv') ||
               process.env.HOSTNAME?.includes('docker') ||
               process.cwd() === '/home/node/app';
    } catch (e) {
        return process.env.DOCKER === 'true' || 
               process.env.IN_DOCKER === 'true' ||
               process.env.HOSTNAME?.includes('docker') ||
               process.cwd() === '/home/node/app';
    }
}

// 기본 DB 호스트 결정 (Docker 환경이면 host.docker.internal, 아니면 127.0.0.1)
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

function getDynamicSequelize(host, port, database, user, password, ssl = false) {
    // host가 없으면 기본 호스트 사용 (Docker 환경 감지)
    host = host || getDefaultDbHost();
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
            max: 200,             // 최대 연결 수 증가 (동시 처리 항목 수 증가 대응)
            min: 0,               // 최소 연결 수 (0으로 설정하여 사용하지 않을 때 연결을 닫음)
            idle: 10000,          // 유휴 연결 유지 시간 (10초 - 연결 재사용 최적화)
            acquire: 60000,       // 연결 획득 대기 시간 (60초 - 연결 대기 시간 증가)
            evict: 1000,          // 유휴 연결 체크 주기 (1초)
            handleDisconnects: true  // 연결 끊김 자동 처리
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

