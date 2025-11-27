function parseDbHeader(req, res, next) {
    // 헤더에서 DB 정보 추출 (공백 제거)
    const dbHost = (req.headers['x-db-host'] || req.headers['db-host'] || '').trim();
    const dbPort = (req.headers['x-db-port'] || req.headers['db-port'] || '').trim();
    const dbName = (req.headers['x-db-name'] || req.headers['db-name'] || '').trim();
    const dbUser = (req.headers['x-db-user'] || req.headers['db-user'] || '').trim();
    const dbPassword = (req.headers['x-db-password'] || req.headers['db-password'] || '').trim();
    const dbSsl = (req.headers['x-db-ssl'] || req.headers['db-ssl'] || '').trim();
    
    // 필수 헤더 확인
    const missingHeaders = [];
    if (!dbHost) missingHeaders.push('x-db-host (or db-host)');
    if (!dbPort) missingHeaders.push('x-db-port (or db-port)');
    if (!dbName) missingHeaders.push('x-db-name (or db-name)');
    if (!dbUser) missingHeaders.push('x-db-user (or db-user)');
    if (!dbPassword) missingHeaders.push('x-db-password (or db-password)');
    
    if (missingHeaders.length > 0) {
        const path = req.originalUrl || req.path || req.url;
        console.error(`\nERROR: 헤더 정보 오류 (Missing required database headers)`);
        console.error(`   Method: ${req.method}`);
        console.error(`   Path: ${path}`);
        console.error(`   누락된 헤더 (Missing headers):`);
        missingHeaders.forEach(header => {
            console.error(`      - ${header}`);
        });
        console.error('');
        
        return res.status(400).json({
            error: '헤더 정보 오류',
            message: 'Missing required database headers',
            required: [
                'x-db-host (or db-host)',
                'x-db-port (or db-port)',
                'x-db-name (or db-name)',
                'x-db-user (or db-user)',
                'x-db-password (or db-password)'
            ],
            missing: missingHeaders,
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

