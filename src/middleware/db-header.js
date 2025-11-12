function parseDbHeader(req, res, next) {
    // 헤더에서 DB 정보 추출 (공백 제거)
    const dbHost = (req.headers['x-db-host'] || req.headers['db-host'] || '').trim();
    const dbPort = (req.headers['x-db-port'] || req.headers['db-port'] || '').trim();
    const dbName = (req.headers['x-db-name'] || req.headers['db-name'] || '').trim();
    const dbUser = (req.headers['x-db-user'] || req.headers['db-user'] || '').trim();
    const dbPassword = (req.headers['x-db-password'] || req.headers['db-password'] || '').trim();
    const dbSsl = (req.headers['x-db-ssl'] || req.headers['db-ssl'] || '').trim();
    
    // 필수 헤더 확인
    if (!dbHost || !dbPort || !dbName || !dbUser || !dbPassword) {
        return res.status(400).json({
            error: 'Missing required database headers',
            required: ['x-db-host (or db-host)', 'x-db-port (or db-port)', 'x-db-name (or db-name)', 'x-db-user (or db-user)', 'x-db-password (or db-password)']
        });
    }
    
    // req 객체에 DB 정보 저장
    req.dbConfig = {
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
        ssl: dbSsl === 'true' || dbSsl === '1'
    };
    
    // 화면에 헤더 정보 출력 (비밀번호 포함)
    const timestamp = new Date().toISOString();
    
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log(`║ [${timestamp}] 요청 수신 - ${req.method} ${req.path}`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║ 모든 요청 헤더 정보:');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    
    // 모든 헤더 출력
    Object.keys(req.headers).forEach(key => {
        console.log(`║   ${key}: ${req.headers[key]}`);
    });
    
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║ 헤더에서 읽은 데이터베이스 연결 정보:');
    console.log(`║   서버 URL:  ${dbHost}:${dbPort}`);
    console.log(`║   데이터베이스명: ${dbName}`);
    console.log(`║   사용자명:  ${dbUser}`);
    console.log(`║   비밀번호:  ${dbPassword || 'N/A'}`);
    console.log(`║   SSL 사용:  ${req.dbConfig.ssl ? 'Yes' : 'No'}`);
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    // 응답 헤더에 DB 연결 정보 추가 (비밀번호 제외, 디버깅용)
    res.setHeader('X-DB-Connection-Info', JSON.stringify({
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        ssl: req.dbConfig.ssl
    }));
    
    next();
}

module.exports = { parseDbHeader };

