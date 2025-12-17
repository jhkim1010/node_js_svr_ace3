const { Sequelize } = require('sequelize');
const { setupDbListener } = require('../services/websocket-service');

// 연결 풀: 동일한 DB 연결 정보는 재사용
const connectionPool = new Map();

// 전체 연결 풀의 총 최대값 (환경 변수로 설정 가능, 기본값: 500)
const TOTAL_POOL_MAX = parseInt(process.env.DB_POOL_TOTAL_MAX) || parseInt(process.env.MAX_CONNECTIONS) || 500;

// PostgreSQL 서버의 실제 max_connections를 캐시 (동적으로 조회)
let cachedPgMaxConnections = null;
let pgMaxConnectionsPromise = null; // 조회 중인 경우 Promise 저장

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

// PostgreSQL 서버의 max_connections 조회 (캐시 사용, 비동기)
async function getPostgresMaxConnections(sequelize) {
    if (cachedPgMaxConnections !== null) {
        return cachedPgMaxConnections;
    }
    
    // 이미 조회 중이면 기다림
    if (pgMaxConnectionsPromise) {
        return await pgMaxConnectionsPromise;
    }
    
    // 조회 시작
    pgMaxConnectionsPromise = (async () => {
        try {
            const [maxConnResult] = await sequelize.query(`SHOW max_connections`);
            if (maxConnResult && maxConnResult[0] && maxConnResult[0].max_connections) {
                cachedPgMaxConnections = parseInt(maxConnResult[0].max_connections, 10);
                console.log(`[Connection Pool] 📊 PostgreSQL 서버 max_connections: ${cachedPgMaxConnections}개`);
                pgMaxConnectionsPromise = null;
                return cachedPgMaxConnections;
            }
        } catch (err) {
            console.warn(`[Connection Pool] ⚠️ PostgreSQL max_connections 조회 실패: ${err.message}`);
        }
        
        // 조회 실패 시 환경 변수 또는 기본값 사용
        cachedPgMaxConnections = parseInt(process.env.MAX_CONNECTIONS) || 100;
        pgMaxConnectionsPromise = null;
        return cachedPgMaxConnections;
    })();
    
    return await pgMaxConnectionsPromise;
}

// 각 데이터베이스의 pool.max를 동적으로 계산 (동기 버전)
// 사용자가 원하는 대로 각 데이터베이스가 전체 최대값(400)까지 사용할 수 있도록 설정
function calculatePoolMaxForDatabase() {
    // DB_POOL_MAX가 명시적으로 설정되어 있지 않으면, 각 데이터베이스가 전체 최대값(400)까지 사용 가능
    // 필요에 따라 자유롭게 사용할 수 있도록 함
    // PostgreSQL 서버의 max_connections는 첫 번째 연결 생성 시 확인하여 경고만 표시
    return TOTAL_POOL_MAX;
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
    
    // 각 데이터베이스의 pool.max 설정
    // DB_POOL_MAX가 명시적으로 설정되어 있으면 사용, 없으면 PostgreSQL 서버의 max_connections를 고려하여 계산
    const explicitPoolMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : null;
    const poolMax = explicitPoolMax || calculatePoolMaxForDatabase();
    
    // 전체 최대값을 초과하지 않도록 확인
    if (totalUsed >= TOTAL_POOL_MAX) {
        console.warn(`[Connection Pool] ⚠️ 전체 연결 풀 한계 도달: ${totalUsed}/${TOTAL_POOL_MAX}`);
        console.warn(`[Connection Pool] 새로운 연결 생성을 위해 기존 연결을 확인하세요.`);
    }
    
    // 새로운 연결 생성
    const sequelize = new Sequelize(database, user, password, {
        host: host,
        port: parseInt(port, 10),
        dialect: 'postgres',
        dialectOptions: ssl ? { ssl: { rejectUnauthorized: false } } : {},
        pool: {
            // 각 데이터베이스가 필요에 따라 전체 최대값(400)까지 사용할 수 있도록 설정
            // DB_POOL_MAX가 명시적으로 설정되어 있으면 그 값을 사용
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
    
    // 첫 번째 연결인 경우 PostgreSQL 서버의 max_connections 조회 (비동기, 백그라운드)
    // 경고 메시지는 출력하지 않음
    if (connectionPool.size === 1 && cachedPgMaxConnections === null) {
        getPostgresMaxConnections(sequelize).catch(() => {
            // 조회 실패는 무시
        });
    }
    
    // WebSocket LISTEN 리스너 설정 (비동기, 에러는 무시)
    setupDbListener(host, port, database, user, password, ssl).catch(() => {
        // LISTEN 설정 실패는 조용히 무시 (이미 설정되어 있을 수 있음)
    });
    
    // 현재 전체 연결 풀 사용량 확인 (연결 추가 후)
    const { totalUsed: currentTotalUsed } = getTotalPoolUsage();
    console.log(`[Connection Pool] ✅ 새로운 연결 생성: ${database} (현재: ${currentTotalUsed}/${TOTAL_POOL_MAX})`);
    
    return sequelize;
}

module.exports = { 
    getDynamicSequelize, 
    connectionPool, 
    getTotalPoolUsage, 
    TOTAL_POOL_MAX 
};

