const { Sequelize } = require('sequelize');
const { setupDbListener } = require('../services/websocket-service');

// 연결 풀: 동일한 DB 연결 정보는 재사용
const connectionPool = new Map();

// 전체 연결 풀의 총 최대값 (환경 변수로 설정 가능, 기본값: 400)
const TOTAL_POOL_MAX = parseInt(process.env.DB_POOL_TOTAL_MAX) || parseInt(process.env.MAX_CONNECTIONS) || 400;

function getConnectionKey(host, port, database, user) {
    return `${host}:${port}/${database}@${user}`;
}

// 전체 연결 풀의 현재 사용량 계산
function getTotalPoolUsage() {
    let totalUsed = 0;
    let totalMax = 0;
    
    for (const sequelize of connectionPool.values()) {
        if (!sequelize || !sequelize.config) {
            continue;
        }
        
        const pool = sequelize.connectionManager.pool;
        if (pool) {
            totalUsed += (pool.used || 0);
            totalMax += (sequelize.config.pool?.max || 0);
        }
    }
    
    return { totalUsed, totalMax };
}

// 각 데이터베이스의 pool.max를 동적으로 계산
function calculatePoolMaxForDatabase() {
    const dbCount = connectionPool.size || 1; // 데이터베이스 개수 (최소 1)
    
    // 전체 최대값을 데이터베이스 개수로 나눔 (균등 분배)
    // 최소 1개는 보장
    const maxPerDb = Math.max(1, Math.floor(TOTAL_POOL_MAX / dbCount));
    
    return maxPerDb;
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
    
    // 전체 연결 풀 사용량 확인
    const { totalUsed } = getTotalPoolUsage();
    
    // 전체 최대값을 초과하지 않도록 확인
    if (totalUsed >= TOTAL_POOL_MAX) {
        console.warn(`[Connection Pool] ⚠️ 전체 연결 풀 한계 도달: ${totalUsed}/${TOTAL_POOL_MAX}`);
        console.warn(`[Connection Pool] 새로운 연결 생성을 위해 기존 연결을 확인하세요.`);
    }
    
    // 각 데이터베이스의 pool.max를 동적으로 계산
    // DB_POOL_MAX가 명시적으로 설정되어 있으면 우선 사용, 없으면 전체 최대값을 데이터베이스 개수로 나눔
    const explicitPoolMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : null;
    const poolMax = explicitPoolMax || calculatePoolMaxForDatabase();
    
    // 새로운 연결 생성
    const sequelize = new Sequelize(database, user, password, {
        host: host,
        port: parseInt(port, 10),
        dialect: 'postgres',
        dialectOptions: ssl ? { ssl: { rejectUnauthorized: false } } : {},
        pool: {
            // 전체 연결 풀의 총 최대값을 고려하여 각 데이터베이스의 최대값 설정
            // DB_POOL_MAX가 명시적으로 설정되어 있으면 사용, 없으면 전체 최대값을 데이터베이스 개수로 나눔
            max: poolMax,
            min: 0,               // 최소 연결 수 (0으로 설정하여 사용하지 않을 때 연결을 닫음)
            idle: parseInt(process.env.DB_POOL_IDLE) || 5000,  // 유휴 연결 유지 시간 (5초 - 빠른 정리로 연결 수 관리)
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
    
    // 기존 연결들의 pool.max를 재계산하여 전체 최대값을 유지
    // (새로운 데이터베이스가 추가되면 기존 데이터베이스의 pool.max를 조정)
    updateAllPoolMax();
    
    // WebSocket LISTEN 리스너 설정 (비동기, 에러는 무시)
    setupDbListener(host, port, database, user, password, ssl).catch(() => {
        // LISTEN 설정 실패는 조용히 무시 (이미 설정되어 있을 수 있음)
    });
    
    console.log(`[Connection Pool] ✅ 새로운 연결 생성: ${database} (pool.max: ${poolMax}, 전체 최대값: ${TOTAL_POOL_MAX})`);
    
    return sequelize;
}

// 모든 연결 풀의 max 값을 재계산하여 전체 최대값을 유지
function updateAllPoolMax() {
    const dbCount = connectionPool.size;
    if (dbCount === 0) return;
    
    const explicitPoolMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : null;
    const poolMaxPerDb = explicitPoolMax || Math.max(1, Math.floor(TOTAL_POOL_MAX / dbCount));
    
    // Sequelize의 pool.max는 런타임에 변경할 수 없으므로, 로그만 출력
    // 실제로는 새로운 연결 생성 시에만 적용됨
    console.log(`[Connection Pool] 📊 전체 연결 풀 설정: 총 최대값 ${TOTAL_POOL_MAX}, 데이터베이스 ${dbCount}개, 데이터베이스당 최대 ${poolMaxPerDb}개`);
}

module.exports = { 
    getDynamicSequelize, 
    connectionPool, 
    getTotalPoolUsage, 
    TOTAL_POOL_MAX 
};

