const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const routes = require('./routes');
const { parseDbHeader } = require('./middleware/db-header');
const { responseLogger } = require('./middleware/response-logger');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));  // BATCH_SYNC 대용량 데이터 처리를 위해 10MB로 증가
app.use(express.static(path.resolve('./') + '/public'));

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
        console.error('\n❌ 요청 본문 크기 초과:');
        console.error(`   요청 크기: ${(err.length / 1024 / 1024).toFixed(2)}MB`);
        console.error(`   제한 크기: ${(err.limit / 1024 / 1024).toFixed(2)}MB`);
        console.error('');
        return res.status(413).json({ 
            error: 'Payload Too Large', 
            message: `요청 본문이 너무 큽니다. 최대 ${(err.limit / 1024 / 1024).toFixed(2)}MB까지 허용됩니다.`,
            received: `${(err.length / 1024 / 1024).toFixed(2)}MB`,
            limit: `${(err.limit / 1024 / 1024).toFixed(2)}MB`
        });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

async function start() {
    try {
        // 헤더 기반 동적 연결 사용하므로 서버 시작 시 DB 연결 불필요
        app.listen(config.port, () => {
            console.log(`Server listening on http://localhost:${config.port}`);
            console.log('Ready to accept requests with DB connection info in headers');
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();


