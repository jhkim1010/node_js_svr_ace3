function parseDbHeader(req, res, next) {
    // 헤더에서 DB 정보 추출 (공백 제거)
    const dbHost = (req.headers['x-db-host'] || req.headers['db-host'] || '').trim();
    const dbPort = (req.headers['x-db-port'] || req.headers['db-port'] || '').trim();
    const dbName = (req.headers['x-db-name'] || req.headers['db-name'] || '').trim();
    const dbUser = (req.headers['x-db-user'] || req.headers['db-user'] || '').trim();
    const dbPassword = (req.headers['x-db-password'] || req.headers['db-password'] || '').trim();
    const dbSsl = (req.headers['x-db-ssl'] || req.headers['db-ssl'] || '').trim();
    
    // 헤더 검증 오류 수집
    const errors = [];
    const receivedValues = {};
    
    // x-db-host 검증
    if (!dbHost) {
        errors.push({
            header: 'x-db-host (or db-host)',
            issue: '누락됨 (Missing)',
            received: null,
            expected: 'PostgreSQL 서버 주소 (예: localhost, 192.168.1.1)'
        });
    } else {
        receivedValues['x-db-host'] = dbHost;
    }
    
    // x-db-port 검증
    if (!dbPort) {
        errors.push({
            header: 'x-db-port (or db-port)',
            issue: '누락됨 (Missing)',
            received: null,
            expected: 'PostgreSQL 포트 번호 (예: 5432)'
        });
    } else {
        receivedValues['x-db-port'] = dbPort;
        // 포트 번호가 숫자인지 확인
        const portNum = parseInt(dbPort, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            errors.push({
                header: 'x-db-port (or db-port)',
                issue: '잘못된 포트 번호 (Invalid port number)',
                received: dbPort,
                expected: '1-65535 범위의 숫자'
            });
        }
    }
    
    // x-db-name 검증
    if (!dbName) {
        errors.push({
            header: 'x-db-name (or db-name)',
            issue: '누락됨 (Missing)',
            received: null,
            expected: '데이터베이스 이름'
        });
    } else {
        receivedValues['x-db-name'] = dbName;
    }
    
    // x-db-user 검증
    if (!dbUser) {
        errors.push({
            header: 'x-db-user (or db-user)',
            issue: '누락됨 (Missing)',
            received: null,
            expected: '데이터베이스 사용자 이름'
        });
    } else {
        receivedValues['x-db-user'] = dbUser;
    }
    
    // x-db-password 검증
    if (!dbPassword) {
        errors.push({
            header: 'x-db-password (or db-password)',
            issue: '누락됨 (Missing)',
            received: null,
            expected: '데이터베이스 비밀번호'
        });
    } else {
        receivedValues['x-db-password'] = '***'; // 보안상 비밀번호는 표시하지 않음
    }
    
    // x-db-ssl 검증 (선택사항이지만 값이 있으면 검증)
    if (dbSsl) {
        receivedValues['x-db-ssl'] = dbSsl;
        const validSslValues = ['true', 'false', '1', '0', ''];
        if (!validSslValues.includes(dbSsl.toLowerCase())) {
            errors.push({
                header: 'x-db-ssl (or db-ssl)',
                issue: '잘못된 값 (Invalid value)',
                received: dbSsl,
                expected: 'true, false, 1, 0 중 하나'
            });
        }
    }
    
    // 오류가 있으면 응답 반환
    if (errors.length > 0) {
        const path = req.originalUrl || req.path || req.url;
        console.error(`\nERROR: 헤더 정보 오류`);
        console.error(`   Method: ${req.method}`);
        console.error(`   Path: ${path}`);
        console.error(`   발견된 오류:`);
        errors.forEach((err, index) => {
            console.error(`   ${index + 1}. ${err.header}`);
            console.error(`      - 문제: ${err.issue}`);
            if (err.received !== null) {
                console.error(`      - 받은 값: ${err.received}`);
            }
            console.error(`      - 예상 값: ${err.expected}`);
        });
        console.error('');
        
        return res.status(400).json({
            error: '헤더 정보 오류',
            message: 'Invalid or missing database headers',
            errors: errors.map(err => ({
                header: err.header,
                issue: err.issue,
                received: err.received,
                expected: err.expected
            })),
            received: receivedValues
        });
    }
    
    // req 객체에 DB 정보 저장
    req.dbConfig = {
        host: dbHost,
        port: parseInt(dbPort, 10),
        database: dbName,
        user: dbUser,
        password: dbPassword,
        ssl: dbSsl === 'true' || dbSsl === '1'
    };
    
    next();
}

module.exports = { parseDbHeader };

