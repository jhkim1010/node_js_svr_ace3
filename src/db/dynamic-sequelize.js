const { Sequelize } = require('sequelize');
const { setupDbListener } = require('../services/websocket-service');

// 연결 풀: 동일한 DB 연결 정보는 재사용
const connectionPool = new Map();

// 전체 연결 풀의 총 최대값 (환경 변수로 설정 가능, 기본값: 500)
const TOTAL_POOL_MAX = parseInt(process.env.DB_POOL_TOTAL_MAX) || parseInt(process.env.MAX_CONNECTIONS) || 500;

// connectionPool Map의 최대 항목 수 (LRU 퇴출 기준, 기본값: 50)
const MAX_POOL_ENTRIES = parseInt(process.env.DB_POOL_MAX_ENTRIES) || 50;

// LRU 퇴출: Map 삽입 순서 기준으로 가장 오래된 항목 제거 후 sequelize.close()
function evictLRU() {
    const [oldestKey, oldestSequelize] = connectionPool.entries().next().value;
    connectionPool.delete(oldestKey);
    oldestSequelize.close().catch(err => {
        console.warn(`[Connection Pool] ⚠️ LRU 퇴출 연결 종료 실패 (${oldestKey}): ${err.message}`);
    });
    console.log(`[Connection Pool] 🗑️ LRU 퇴출: ${oldestKey} (풀 항목 한계: ${MAX_POOL_ENTRIES})`);
}

// 각 데이터베이스당 최대 연결 수 (환경 변수로 설정 가능, 기본값: 50)
const DB_POOL_MAX_DEFAULT = 50;

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
// PostgreSQL 서버의 max_connections를 고려하여 각 데이터베이스당 적절한 최대값 반환
function calculatePoolMaxForDatabase() {
    // DB_POOL_MAX가 명시적으로 설정되어 있지 않으면 기본값(50) 사용
    // 여러 데이터베이스를 사용할 때 서버 한계(100)를 초과하지 않도록 조정
    return DB_POOL_MAX_DEFAULT;
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
    
    // 이미 존재하는 연결이 있으면 LRU 갱신 후 재사용 (Map 맨 뒤로 이동)
    if (connectionPool.has(key)) {
        const existing = connectionPool.get(key);
        connectionPool.delete(key);
        connectionPool.set(key, existing);
        return existing;
    }

    // 최대 항목 수 초과 시 가장 오래된 항목 LRU 퇴출
    if (connectionPool.size >= MAX_POOL_ENTRIES) {
        evictLRU();
    }

    // 전체 연결 풀 사용량 확인
    const { totalUsed } = getTotalPoolUsage();
    
    // 각 데이터베이스의 pool.max 설정
    // DB_POOL_MAX가 명시적으로 설정되어 있으면 사용, 없으면 기본값(50) 사용
    const explicitPoolMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : null;
    const poolMax = explicitPoolMax !== null ? explicitPoolMax : calculatePoolMaxForDatabase();
    
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
        dialectOptions: {
            ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
            // 아르헨티나 시간대 설정 (UTC-3)
            options: "-c timezone=America/Argentina/Buenos_Aires"
        },
        pool: {
            // 각 데이터베이스당 최대 연결 수 (기본값: 50, 환경 변수 DB_POOL_MAX로 설정 가능)
            // PostgreSQL 서버의 max_connections(100)를 고려하여 여러 DB 사용 시 서버 한계 초과 방지
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
    
    // 연결 후 timezone 설정 (각 연결마다 보장)
    sequelize.addHook('afterConnect', async (connection) => {
        try {
            await connection.query("SET timezone = 'America/Argentina/Buenos_Aires'");
        } catch (err) {
            console.warn(`[Timezone] ⚠️ Timezone 설정 실패 (무시): ${err.message}`);
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
    TOTAL_POOL_MAX,
    isDockerEnvironment,
    getDefaultDbHost
};

