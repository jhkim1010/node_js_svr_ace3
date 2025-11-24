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
        const path = req.originalUrl || req.path || req.url;
        console.error(`\nERROR: Missing required database headers`);
        console.error(`   Method: ${req.method}`);
        console.error(`   Path: ${path}`);
        console.error(`   Missing headers:`);
        if (!dbHost) console.error(`      - x-db-host or db-host`);
        if (!dbPort) console.error(`      - x-db-port or db-port`);
        if (!dbName) console.error(`      - x-db-name or db-name`);
        if (!dbUser) console.error(`      - x-db-user or db-user`);
        if (!dbPassword) console.error(`      - x-db-password or db-password`);
        console.error('');
        
        return res.status(400).json({
            error: 'Missing required database headers',
            required: ['x-db-host (or db-host)', 'x-db-port (or db-port)', 'x-db-name (or db-name)', 'x-db-user (or db-user)', 'x-db-password (or db-password)'],
            received: {
                'x-db-host': dbHost ? 'present' : 'missing',
                'x-db-port': dbPort ? 'present' : 'missing',
                'x-db-name': dbName ? 'present' : 'missing',
                'x-db-user': dbUser ? 'present' : 'missing',
                'x-db-password': dbPassword ? 'present' : 'missing'
            }
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
    
    next();
}

module.exports = { parseDbHeader };

