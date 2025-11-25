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

// Health 체크는 헤더 필요 없음
app.get('/api/health', (req, res) => {
    try {
        // 헤더 정보 출력
        console.log('\n[GET /api/health] Request received');
        console.log('   Headers:');
        Object.keys(req.headers).forEach(key => {
            console.log(`      ${key}: ${req.headers[key]}`);
        });
        console.log('   Body:', req.body || 'N/A');
        
        const { getBuildDate } = require('./utils/build-info');
        const buildDate = getBuildDate();
        
        res.json({ 
            ok: true, 
            status: 'online',
            uptimeSec: Math.floor(process.uptime()),
            serverTime: new Date().toISOString(),
            buildDate: buildDate,
            version: require('../package.json').version || '1.0.0'
        });
    } catch (err) {
        console.error('\nERROR: GET /api/health failed');
        console.error('   Error Type:', err.constructor.name);
        console.error('   Error Message:', err.message);
        if (err.stack) {
            console.error('   Stack Trace:', err.stack);
        }
        console.error('');
        
        res.status(500).json({
            ok: false,
            error: 'Internal server error',
            message: err.message
        });
    }
});

// POST /api/health: 데이터베이스 연결 테스트
app.post('/api/health', async (req, res) => {
    try {
        // 헤더 정보 출력
        console.log('\n[POST /api/health] Request received');
        console.log('   Headers:');
        Object.keys(req.headers).forEach(key => {
            console.log(`      ${key}: ${req.headers[key]}`);
        });
        console.log('   Body:', JSON.stringify(req.body, null, 2));
        
        const { databaseName, username, password, port, host } = req.body;
        
        // 필수 파라미터 확인
        if (!databaseName || !username || !password || !port) {
            return res.status(400).json({
                ok: false,
                error: 'Missing required parameters',
                required: ['databaseName', 'username', 'password', 'port']
            });
        }
        
        // Sequelize를 사용하여 연결 테스트
        const { Sequelize } = require('sequelize');
        const dbHost = host || process.env.DB_HOST || 'localhost';
        const dbPort = parseInt(port, 10);
        
        if (isNaN(dbPort)) {
            return res.status(400).json({
                ok: false,
                error: 'Invalid port number',
                received: port
            });
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
        
        res.status(200).json({
            ok: true,
            status: 'connected',
            message: 'Database connection successful',
            database: databaseName,
            host: dbHost,
            port: dbPort,
            username: username
        });
    } catch (err) {
        // 연결 실패 - 상세 오류 정보 출력
        const errorMessage = err.original ? err.original.message : err.message;
        const errorCode = err.original ? err.original.code : err.code;
        const errorName = err.original ? err.original.name : err.name;
        
        console.error('\nERROR: POST /api/health - Database connection test failed');
        console.error('   Request Headers:');
        Object.keys(req.headers).forEach(key => {
            console.error(`      ${key}: ${req.headers[key]}`);
        });
        console.error('   Request Body:', JSON.stringify(req.body, null, 2));
        console.error('   Connection details:');
        console.error('      Host:', host || process.env.DB_HOST || 'localhost');
        console.error('      Port:', port);
        console.error('      Database:', databaseName);
        console.error('      Username:', username);
        console.error('   Error information:');
        console.error('      Error Type:', err.constructor.name);
        console.error('      Error Name:', errorName || 'N/A');
        console.error('      Error Code:', errorCode || 'N/A');
        console.error('      Error Message:', errorMessage);
        if (err.original) {
            console.error('      Original Error:', JSON.stringify(err.original, Object.getOwnPropertyNames(err.original)));
        }
        if (err.stack) {
            console.error('      Stack Trace:', err.stack);
        }
        console.error('');
        
        res.status(400).json({
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
        });
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


