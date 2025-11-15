const { Sequelize } = require('sequelize');

// 연결 풀: 동일한 DB 연결 정보는 재사용
const connectionPool = new Map();

function getConnectionKey(host, port, database, user) {
    return `${host}:${port}/${database}@${user}`;
}

function getDynamicSequelize(host, port, database, user, password, ssl = false) {
    host = process.env.DB_HOST || 'localhost';
    const key = getConnectionKey(host, port, database, user);
    
    // 이미 존재하는 연결이 있으면 재사용
    if (connectionPool.has(key)) {
        return connectionPool.get(key);
    }
    
    // 연결 정보 로깅
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║ Sequelize 연결 생성 시도');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║   Host: ${host}`);
    console.log(`║   Port: ${port} (parsed: ${parseInt(port, 10)})`);
    console.log(`║   Database: ${database}`);
    console.log(`║   User: ${user}`);
    console.log(`║   Password: ${password}`);
    console.log(`║   SSL: ${ssl}`);
    console.log(`║   Connection Key: ${key}`);
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    // 새로운 연결 생성
    const sequelize = new Sequelize(database, user, password, {
        host: host,
        port: parseInt(port, 10),
        dialect: 'postgres',
        dialectOptions: ssl ? { ssl: { rejectUnauthorized: false } } : {},
        pool: { max: 5, idle: 10000 },
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
    
    // 연결 테스트 (비동기, 에러는 쿼리 시점에 발생)
    sequelize.authenticate()
        .then(() => {
            console.log('✅ 데이터베이스 연결 성공!\n');
        })
        .catch((err) => {
            console.error('\n❌ 데이터베이스 연결 실패!');
            console.error('   에러 타입:', err.constructor.name);
            console.error('   에러 메시지:', err.message);
            console.error('   연결 정보:');
            console.error(`     Host: ${host}`);
            console.error(`     Port: ${port}`);
            console.error(`     Database: ${database}`);
            console.error(`     User: ${user}`);
            console.error(`     Password: ${password}`);
            console.error('   전체 에러:', err);
            console.error('');
        });
    
    return sequelize;
}

module.exports = { getDynamicSequelize, connectionPool };

