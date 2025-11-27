const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const config = require('./config');
const routes = require('./routes');
const { parseDbHeader } = require('./middleware/db-header');
const { responseLogger } = require('./middleware/response-logger');
const { operationLogger } = require('./middleware/operation-logger');
const { initializeWebSocket } = require('./services/websocket-service');
const { displayBuildInfo } = require('./utils/build-info');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));  // BATCH_SYNC 대용량 데이터 처리를 위해 10MB로 증가
app.use(express.static(path.resolve('./') + '/public'));

// 요청 정보를 상세히 출력하는 함수
function logRequestInfo(req, routeName) {
    console.log(`\n=== ${routeName} 요청 정보 ===`);
    console.log('Timestamp:', new Date().toISOString());
    console.log('Method:', req.method);
    console.log('Original URL:', req.originalUrl);
    console.log('Path:', req.path);
    console.log('URL:', req.url);
    console.log('Query Parameters:', JSON.stringify(req.query, null, 2));
    
    // 모든 헤더 출력
    console.log('\n--- 모든 헤더 ---');
    const allHeaders = {};
    Object.keys(req.headers).forEach(key => {
        if (key.toLowerCase().includes('password')) {
            allHeaders[key] = '***';
        } else {
            allHeaders[key] = req.headers[key];
        }
    });
    console.log(JSON.stringify(allHeaders, null, 2));
    
    // DB 관련 헤더만 별도로 출력
    console.log('\n--- DB 관련 헤더 ---');
    const dbHeaders = {
        'x-db-host': req.headers['x-db-host'] || req.headers['db-host'] || '없음',
        'x-db-port': req.headers['x-db-port'] || req.headers['db-port'] || '없음',
        'x-db-name': req.headers['x-db-name'] || req.headers['db-name'] || '없음',
        'x-db-user': req.headers['x-db-user'] || req.headers['db-user'] || '없음',
        'x-db-password': req.headers['x-db-password'] || req.headers['db-password'] ? '***' : '없음',
        'x-db-ssl': req.headers['x-db-ssl'] || req.headers['db-ssl'] || '없음'
    };
    console.log(JSON.stringify(dbHeaders, null, 2));
    
    // Body 정보 출력
    console.log('\n--- Body 정보 ---');
    if (req.body && Object.keys(req.body).length > 0) {
        const bodyCopy = JSON.parse(JSON.stringify(req.body));
        // 비밀번호 필드 마스킹
        if (bodyCopy.password) bodyCopy.password = '***';
        if (bodyCopy.db_password) bodyCopy.db_password = '***';
        if (bodyCopy['x-db-password']) bodyCopy['x-db-password'] = '***';
        console.log(JSON.stringify(bodyCopy, null, 2));
    } else {
        console.log('없음 (GET 요청이거나 Body가 비어있음)');
    }
    
    // DB Config 정보 출력
    console.log('\n--- DB Config (req.dbConfig) ---');
    if (req.dbConfig) {
        console.log(JSON.stringify({
            host: req.dbConfig.host,
            port: req.dbConfig.port,
            database: req.dbConfig.database,
            user: req.dbConfig.user,
            password: '***',
            ssl: req.dbConfig.ssl
        }, null, 2));
    } else {
        console.log('없음 (아직 parseDbHeader 미들웨어를 통과하지 않았거나 설정되지 않음)');
    }
    
    console.log('===================================\n');
}

// Health 체크는 헤더 필요 없음
app.get('/api/health', (req, res) => {
    // 요청 정보 출력
    logRequestInfo(req, 'GET /api/health');
    
    try {
        const { getBuildDate } = require('./utils/build-info');
        const buildDate = getBuildDate();
        
        const responseData = { 
            ok: true, 
            status: 'online',
            uptimeSec: Math.floor(process.uptime()),
            serverTime: new Date().toISOString(),
            buildDate: buildDate,
            version: require('../package.json').version || '1.0.0'
        };
        
        console.log('✅ 성공: GET /api/health 응답 데이터');
        console.log('==========================================');
        console.log(JSON.stringify(responseData, null, 2));
        console.log('==========================================\n');
        
        res.json(responseData);
    } catch (err) {
        console.error('\n❌ 실패: GET /api/health 처리 중 오류 발생');
        console.error('==========================================');
        console.error('Error Type:', err.constructor.name);
        console.error('Error Message:', err.message);
        console.error('Error Stack:', err.stack);
        console.error('==========================================\n');
        
        const errorResponse = {
            ok: false,
            error: 'Internal server error',
            message: err.message
        };
        
        res.status(500).json(errorResponse);
    }
});

// POST /api/health: 데이터베이스 연결 테스트
app.post('/api/health', async (req, res) => {
    // 요청 정보 출력
    logRequestInfo(req, 'POST /api/health');
    
    try {
        const { databaseName, username, password, port, host } = req.body;
        
        // 필수 파라미터 확인
        if (!databaseName || !username || !password) {
            const errorResponse = {
                ok: false,
                error: 'Missing required parameters',
                required: ['databaseName', 'username', 'password'],
                optional: ['port', 'host'],
                received: {
                    databaseName: databaseName || '없음',
                    username: username || '없음',
                    password: password ? '***' : '없음',
                    port: port || '없음',
                    host: host || '없음'
                }
            };
            
            console.error('\n❌ 실패: POST /api/health - 필수 파라미터 부족');
            console.error('==========================================');
            console.error('부족한 정보:');
            if (!databaseName) console.error('   - databaseName: 없음');
            if (!username) console.error('   - username: 없음');
            if (!password) console.error('   - password: 없음');
            console.error('받은 정보:', JSON.stringify(errorResponse.received, null, 2));
            console.error('==========================================\n');
            
            return res.status(400).json(errorResponse);
        }
        
        // Sequelize를 사용하여 연결 테스트
        const { Sequelize } = require('sequelize');
        // host가 없으면 기본값 'localhost' 사용 (오류 없이)
        const dbHost = (host || process.env.DB_HOST || 'localhost').toString().trim();
        // port가 없거나 빈 값이면 기본값 5432 사용 (PostgreSQL 기본 포트, 오류 없이)
        let dbPort = 5432; // 기본값
        if (port && port.toString().trim() !== '') {
            const parsedPort = parseInt(port.toString().trim(), 10);
            if (!isNaN(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
                dbPort = parsedPort;
            } else {
                // port가 제공되었지만 유효하지 않은 경우에만 오류
                const errorResponse = {
                    ok: false,
                    error: 'Invalid port number',
                    received: port,
                    expected: '1-65535 범위의 숫자'
                };
                
                console.error('\n❌ 실패: POST /api/health - 잘못된 포트 번호');
                console.error('==========================================');
                console.error('받은 포트:', port);
                console.error('예상 형식: 1-65535 범위의 숫자');
                console.error('==========================================\n');
                
                return res.status(400).json(errorResponse);
            }
        }
        
        // 테스트용 Sequelize 인스턴스 생성 (연결 풀에 저장하지 않음)
        const testSequelize = new Sequelize(databaseName, username, password, {
            host: dbHost,
            port: dbPort,
            dialect: 'postgres',
            logging: false,
            pool: {
                max: 1,
                min: 0,
                idle: 1000,
                acquire: 5000,  // 5초 타임아웃
                evict: 1000
            },
            retry: {
                max: 1  // 재시도 1번만
            }
        });
        
        // 연결 테스트
        await testSequelize.authenticate();
        
        // 연결 성공 시 인스턴스 종료
        await testSequelize.close();
        
        const responseData = {
            ok: true,
            status: 'connected',
            message: 'Database connection successful',
            database: databaseName,
            host: dbHost,
            port: dbPort,
            username: username
        };
        
        console.log('✅ 성공: POST /api/health 응답 데이터');
        console.log('==========================================');
        console.log(JSON.stringify(responseData, null, 2));
        console.log('==========================================\n');
        
        res.status(200).json(responseData);
    } catch (err) {
        // 연결 실패 - 상세 메시지 출력
        const errorMessage = err.original ? err.original.message : err.message;
        const errorCode = err.original ? err.original.code : err.code;
        const errorName = err.original ? err.original.name : err.name;
        
        const errorResponse = {
            ok: false,
            status: 'connection_failed',
            error: 'Database connection failed',
            message: errorMessage,
            errorType: err.constructor.name,
            errorCode: errorCode,
            errorName: errorName,
            connectionInfo: {
                host: host || process.env.DB_HOST || 'localhost',
                port: port,
                database: databaseName,
                username: username
            }
        };
        
        console.error('\n❌ 실패: POST /api/health - 데이터베이스 연결 실패');
        console.error('==========================================');
        console.error('Error Type:', err.constructor.name);
        console.error('Error Message:', errorMessage);
        console.error('Error Code:', errorCode);
        console.error('Error Name:', errorName);
        if (err.stack) {
            console.error('Error Stack:', err.stack);
        }
        if (err.original) {
            console.error('Original Error:', err.original);
        }
        console.error('\n연결 정보:');
        console.error(JSON.stringify(errorResponse.connectionInfo, null, 2));
        
        // 부족한 정보 분석
        const missingInfo = [];
        if (!databaseName) missingInfo.push('databaseName이 필요합니다');
        if (!username) missingInfo.push('username이 필요합니다');
        if (!password) missingInfo.push('password가 필요합니다');
        
        // 데이터베이스 연결 오류 분석
        if (err.name === 'SequelizeConnectionError' || errorCode === 'ECONNREFUSED') {
            missingInfo.push('데이터베이스 연결 실패 - 호스트, 포트, 인증 정보를 확인하세요');
        }
        if (err.name === 'SequelizeAccessDeniedError' || errorCode === '28P01') {
            missingInfo.push('데이터베이스 인증 실패 - 사용자 이름과 비밀번호를 확인하세요');
        }
        if (err.name === 'SequelizeDatabaseError' || errorCode === '3D000') {
            missingInfo.push('데이터베이스가 존재하지 않습니다 - 데이터베이스 이름을 확인하세요');
        }
        
        if (missingInfo.length > 0) {
            console.error('\n부족한 정보:');
            missingInfo.forEach((info, idx) => {
                console.error(`   ${idx + 1}. ${info}`);
            });
        }
        
        console.error('==========================================\n');
        
        res.status(400).json(errorResponse);
    }
});

// Operation 로깅 미들웨어 (요청 본문 파싱 후, DB 헤더 파싱 전에 적용)
// POST, PUT, DELETE 요청의 operation을 먼저 확인하고 로그 출력
app.use('/api', operationLogger);

// 응답 로깅 미들웨어 (모든 요청에 적용)
app.use(responseLogger);

// DB 헤더 파싱 미들웨어를 모든 API 라우트에 적용
app.use('/api', parseDbHeader, routes);

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        console.error('\nERROR: Request body size exceeded:');
        console.error(`   Request size: ${(err.length / 1024 / 1024).toFixed(2)}MB`);
        console.error(`   Size limit: ${(err.limit / 1024 / 1024).toFixed(2)}MB`);
        console.error('');
        return res.status(413).json({ 
            error: 'Payload Too Large', 
            message: `Request body is too large. Maximum ${(err.limit / 1024 / 1024).toFixed(2)}MB is allowed.`,
            received: `${(err.length / 1024 / 1024).toFixed(2)}MB`,
            limit: `${(err.limit / 1024 / 1024).toFixed(2)}MB`
        });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

async function start() {
    try {
        // 빌드 정보 표시
        displayBuildInfo();
        
        // WebSocket 서버 초기화
        initializeWebSocket(server);
        
        // HTTP 및 WebSocket 서버 시작
        server.listen(config.port, () => {
            console.log(`Server listening on http://localhost:${config.port}`);
            console.log(`WebSocket server ready on ws://localhost:${config.port}`);
            console.log('Ready to accept requests with DB connection info in headers');
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();


