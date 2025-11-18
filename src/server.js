const express = require('express');
const cors = require('cors');
const http = require('http');
const config = require('./config');
const routes = require('./routes');
const { parseDbHeader } = require('./middleware/db-header');
const { responseLogger } = require('./middleware/response-logger');
const { initializeWebSocket } = require('./services/websocket-service');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));  // BATCH_SYNC 대용량 데이터 처리를 위해 10MB로 증가

// Health 체크는 헤더 필요 없음
app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptimeSec: process.uptime() });
});

// 응답 로깅 미들웨어 (모든 요청에 적용)
app.use(responseLogger);

// DB 헤더 파싱 미들웨어를 모든 API 라우트에 적용
app.use('/api', parseDbHeader, routes);

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        console.error('\n❌ Request body size exceeded:');
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


