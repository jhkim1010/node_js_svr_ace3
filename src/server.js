const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const config = require('./config');
const routes = require('./routes');
const { parseDbHeader } = require('./middleware/db-header');
const { loadBcolorview } = require('./middleware/bcolorview-loader');
const { responseLogger } = require('./middleware/response-logger');
const { operationLogger } = require('./middleware/operation-logger');
const { initializeWebSocket, getWebSocketServer } = require('./services/websocket-service');
const { displayBuildInfo } = require('./utils/build-info');
const { startMonitoring, getMonitoringStatus } = require('./services/monitoring-service');

const app = express();
// HTTP 서버를 Express 없이 생성하여 ws 라이브러리가 upgrade 이벤트를 처리할 수 있도록 함
const server = http.createServer();

// upgrade 이벤트는 ws 라이브러리가 자동으로 처리함
// 여기서는 로깅만 수행 (필요시 디버깅용으로 활성화)
// server.on('upgrade', (request, socket, head) => {
//     // 디버깅이 필요한 경우에만 활성화
// });

// 일반 HTTP 요청만 Express가 처리하도록 설정
server.on('request', (req, res) => {
    // WebSocket upgrade 요청은 Express가 처리하지 않음
    // ws 라이브러리가 upgrade 이벤트에서 처리함
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        // Express가 처리하지 않도록 함 (ws 라이브러리가 처리함)
        return;
    }
    // 일반 HTTP 요청만 Express가 처리
    app(req, res);
});

// WebSocket 경로는 Express 미들웨어를 거치지 않음
// HTTP 서버의 upgrade 이벤트에서 직접 처리됨

// WebSocket 경로를 가장 먼저 처리하여 Express 미들웨어가 가로채지 않도록 함
// 중요: Express가 WebSocket 요청을 처리하지 않도록 함
app.use(['/ws', '/api/ws'], (req, res, next) => {
    // WebSocket upgrade 요청인 경우 Express에서 처리하지 않음
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        console.log(`[Express] ⚠️ WebSocket 요청이 Express를 거치고 있습니다!`);
        console.log(`   URL: ${req.url}, Upgrade: ${req.headers.upgrade}`);
        console.log(`   이것은 ws 라이브러리가 upgrade를 처리하지 못했다는 의미입니다.`);
        // 아무 응답도 보내지 않음 (ws 라이브러리가 처리해야 함)
        // 하지만 이미 Express가 요청을 받았으므로, 연결을 유지하되 응답하지 않음
        return;
    }
    next();
});

// 모든 요청 로깅 (디버깅용)
// WebSocket 업그레이드 요청은 Express 미들웨어를 거치지 않아야 함
app.use((req, res, next) => {
    // WebSocket 업그레이드 요청인 경우 Express 미들웨어 건너뛰기
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        console.log(`[Express] ⚠️ WebSocket 업그레이드 요청이 Express를 거치고 있습니다! (이것은 정상이 아닙니다)`);
        console.log(`   URL: ${req.url}, Path: ${req.path}, OriginalUrl: ${req.originalUrl}`);
        console.log(`   Upgrade: ${req.headers.upgrade}, Connection: ${req.headers.connection}`);
        // WebSocket 요청은 Express에서 처리하지 않음
        return res.end(); // 응답 종료
    }
    next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));  // BATCH_SYNC 대용량 데이터 처리를 위해 10MB로 증가
app.use(express.static(path.resolve('./') + '/public'));

// Health 체크는 헤더 필요 없음
app.get('/api/health', (req, res) => {
    try {
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
        res.status(500).json({
            ok: false,
            error: 'Internal server error',
            message: err.message
        });
    }
});

// 모니터링 상태 조회 (헤더 필요 없음)
app.get('/api/monitoring/status', (req, res) => {
    try {
        const status = getMonitoringStatus(getWebSocketServer);
        res.json({
            ok: true,
            ...status
        });
    } catch (err) {
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
            
            return res.status(400).json(errorResponse);
        }
        
        // Sequelize를 사용하여 연결 테스트
        const { Sequelize } = require('sequelize');
        // host가 없으면 기본값 결정 (Docker 환경 감지)
        const getDefaultDbHost = () => {
            if (process.env.DB_HOST) return process.env.DB_HOST;
            try {
                const fs = require('fs');
                const isDocker = process.env.DOCKER === 'true' || 
                               process.env.IN_DOCKER === 'true' ||
                               fs.existsSync('/.dockerenv') ||
                               process.env.HOSTNAME?.includes('docker') ||
                               process.cwd() === '/home/node/app';
                return isDocker ? 'host.docker.internal' : '127.0.0.1';
            } catch (e) {
                return '127.0.0.1';
            }
        };
        const dbHost = (host || process.env.DB_HOST || getDefaultDbHost()).toString().trim();
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
        let errorMessage = err.original ? err.original.message : err.message;
        // 연결 한계 도달 오류 메시지 간소화
        if (errorMessage && errorMessage.includes('remaining connection slots are reserved for non-replication superuser connections')) {
            errorMessage = 'database 연결 한계도달';
        }
        const errorCode = err.original ? err.original.code : err.code;
        const errorName = err.original ? err.original.name : err.name;
        
        // 연결 거부 오류 진단
        const { diagnoseConnectionRefusedError } = require('./utils/error-classifier');
        const diagnosis = diagnoseConnectionRefusedError(err, dbHost, dbPort);
        
        const errorResponse = {
            ok: false,
            status: 'connection_failed',
            error: 'Database connection failed',
            message: errorMessage,
            errorType: err.constructor.name,
            errorCode: errorCode,
            errorName: errorName,
            connectionInfo: {
                host: dbHost,
                port: dbPort,
                database: databaseName,
                username: username
            }
        };
        
        // 연결 거부 오류인 경우 상세 진단 정보 추가 (해결 방법 제외)
        if (diagnosis) {
            // 해결 방법(recommendedSolutions)은 제외하고 진단 정보만 포함
            const { recommendedSolutions, ...diagnosisWithoutSolutions } = diagnosis.diagnosis;
            errorResponse.diagnosis = diagnosisWithoutSolutions;
            errorResponse.errorType = diagnosis.errorType;
        }
        
        res.status(400).json(errorResponse);
    }
});

// Operation 로깅 미들웨어 (요청 본문 파싱 후, DB 헤더 파싱 전에 적용)
// POST, PUT, DELETE 요청의 operation을 먼저 확인하고 로그 출력
// WebSocket 경로(/ws, /api/ws)는 제외
app.use('/api', (req, res, next) => {
    // WebSocket 업그레이드 요청인 경우 Express 미들웨어 건너뛰기
    if (req.path === '/ws' || req.url === '/ws' || req.originalUrl === '/api/ws' || req.originalUrl === '/ws' ||
        (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket')) {
        return next(); // WebSocket 서버로 전달
    }
    operationLogger(req, res, next);
});

// 응답 로깅 미들웨어 (모든 요청에 적용)
// WebSocket 경로는 제외
app.use((req, res, next) => {
    // WebSocket 업그레이드 요청인 경우 Express 미들웨어 건너뛰기
    if (req.path === '/ws' || req.url === '/ws' || req.originalUrl === '/api/ws' || req.originalUrl === '/ws' ||
        (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket')) {
        return next(); // WebSocket 서버로 전달
    }
    responseLogger(req, res, next);
});

// DB 헤더 파싱 미들웨어를 모든 API 라우트에 적용
// WebSocket 경로(/ws, /api/ws)는 제외 (WebSocket 서버가 직접 처리)
app.use('/api', (req, res, next) => {
    // WebSocket 업그레이드 요청인 경우 Express 라우터 건너뛰기
    if (req.path === '/ws' || req.url === '/ws' || req.originalUrl === '/api/ws' || req.originalUrl === '/ws' ||
        (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket')) {
        return next(); // WebSocket 서버로 전달
    }
    parseDbHeader(req, res, () => {
        loadBcolorview(req, res, () => {
            routes(req, res, next);
        });
    });
});

app.use((req, res) => {
    // WebSocket 업그레이드 요청인 경우 404 응답하지 않음
    // 이 요청은 HTTP 서버의 upgrade 이벤트에서 처리되어야 함
    if (req.path === '/ws' || req.url === '/ws' || req.originalUrl === '/api/ws' || req.originalUrl === '/ws' ||
        (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket')) {
        // WebSocket 요청은 Express에서 처리하지 않음
        // 응답을 보내지 않고 그냥 종료 (ws 라이브러리가 처리함)
        if (!res.headersSent) {
            res.destroy(); // 연결 종료
        }
        return;
    }
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
    
    // 데이터베이스 오류인 경우 Telegram 알림 전송
    const dbConfig = req.dbConfig || {};
    const database = dbConfig.database || '알 수 없음';
    let tableName = null;
    if (req.path) {
        const pathParts = req.path.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart !== 'api') {
            tableName = lastPart;
        }
    }
    
    // 데이터베이스 관련 오류인지 확인
    const isDatabaseError = err.original || 
                            err.message?.includes('database') ||
                            err.message?.includes('connection') ||
                            err.message?.includes('constraint') ||
                            err.message?.includes('foreign key') ||
                            err.message?.includes('unique constraint') ||
                            err.constructor.name?.includes('Sequelize');
    
    if (isDatabaseError) {
        const { sendDatabaseErrorAlert } = require('./services/monitoring-service');
        sendDatabaseErrorAlert(err, database, tableName, 'Unhandled database error').catch(() => {
            // 알림 전송 실패는 조용히 무시
        });
    }
    
    // 연결 한계 도달 오류 메시지 간소화
    let errorDetails = err.message;
    if (errorDetails && errorDetails.includes('remaining connection slots are reserved for non-replication superuser connections')) {
        errorDetails = 'database 연결 한계도달';
        console.error('database 연결 한계도달');
    } else {
        console.error('Unhandled error:', err);
    }
    res.status(500).json({ error: 'Internal Server Error', details: errorDetails });
});

async function start() {
    try {
        // 빌드 정보 표시
        displayBuildInfo();
        
        // WebSocket 서버를 먼저 초기화 (Express 연결 전)
        // 이렇게 하면 WebSocket 요청이 Express를 거치지 않음
        initializeWebSocket(server);
        
        // HTTP 서버 시작
        server.listen(config.port, () => {
            console.log(`Server listening on http://localhost:${config.port}`);
            console.log(`WebSocket server ready on ws://localhost:${config.port}/ws and ws://localhost:${config.port}/api/ws`);
            console.log('Ready to accept requests with DB connection info in headers');
            
            // 모니터링 시작 (WebSocket 서버가 초기화된 후)
            startMonitoring(getWebSocketServer);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();


