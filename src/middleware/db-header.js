function parseDbHeader(req, res, next) {
    // PUT, GET, POST 요청의 경우 host 헤더를 무조건 127.0.0.1로 강제 설정
    if (req.method === 'PUT' || req.method === 'GET' || req.method === 'POST') {
        // 요청 헤더의 host 관련 값들을 127.0.0.1로 강제 설정
        if (req.headers['x-db-host']) {
            req.headers['x-db-host'] = '127.0.0.1';
        }
        if (req.headers['db-host']) {
            req.headers['db-host'] = '127.0.0.1';
        }
        // 쿼리 파라미터도 127.0.0.1로 강제 설정
        if (req.query?.db_host) {
            req.query.db_host = '127.0.0.1';
        }
        if (req.query?.host) {
            req.query.host = '127.0.0.1';
        }
        // 요청 본문도 127.0.0.1로 강제 설정
        if (req.body?.db_host) {
            req.body.db_host = '127.0.0.1';
        }
        if (req.body?.host) {
            req.body.host = '127.0.0.1';
        }
    }
    
    // DB Trigger 요청 또는 내부 요청 확인
    // trigger_operation이 있거나 x-internal-request 헤더/쿼리가 있으면 내부 요청으로 간주
    const isInternalRequest = req.body?.trigger_operation || 
                             req.body?.operation === 'BATCH_SYNC' ||
                             req.query?.trigger_operation ||
                             req.query?.operation === 'BATCH_SYNC' ||
                             req.headers['x-internal-request'] === 'true' ||
                             req.query['x-internal-request'] === 'true' ||
                             req.headers['x-db-trigger'] === 'true' ||
                             req.query['x-db-trigger'] === 'true';
    
    // 내부 요청인 경우 요청 본문, 쿼리 파라미터, 환경 변수에서 DB 정보 찾기
    if (isInternalRequest) {
        // 요청 본문에서 DB 정보 추출 시도 (host는 무조건 127.0.0.1로 강제)
        const bodyDbHost = '127.0.0.1'; // 무조건 127.0.0.1 사용
        const bodyDbPort = req.body?.db_port || req.body?.port;
        const bodyDbName = req.body?.db_name || req.body?.database || req.body?.db;
        const bodyDbUser = req.body?.db_user || req.body?.user;
        const bodyDbPassword = req.body?.db_password || req.body?.password;
        const bodyDbSsl = req.body?.db_ssl || req.body?.ssl;
        
        // 쿼리 파라미터에서 DB 정보 추출 시도 (GET 요청용, host는 무조건 127.0.0.1로 강제)
        const queryDbHost = '127.0.0.1'; // 무조건 127.0.0.1 사용
        const queryDbPort = req.query?.db_port || req.query?.port;
        const queryDbName = req.query?.db_name || req.query?.database || req.query?.db;
        const queryDbUser = req.query?.db_user || req.query?.user;
        const queryDbPassword = req.query?.db_password || req.query?.password;
        const queryDbSsl = req.query?.db_ssl || req.query?.ssl;
        
        // 환경 변수에서 기본 DB 설정 가져오기 (host는 무조건 127.0.0.1로 강제)
        const defaultHost = '127.0.0.1'; // 무조건 127.0.0.1 사용 (환경 변수 무시)
        const defaultPort = process.env.DB_PORT || '5432';
        const defaultDatabase = process.env.DB_NAME || '';
        const defaultUser = process.env.DB_USER || '';
        const defaultPassword = process.env.DB_PASSWORD || '';
        const defaultSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1';
        
        // 우선순위: 헤더 > 쿼리 파라미터 > 요청 본문 > 환경 변수
        // host는 무조건 '127.0.0.1'로 설정 (헤더 값 무시)
        const dbHost = '127.0.0.1';
        const dbPort = (req.headers['x-db-port'] || req.headers['db-port'] || queryDbPort || bodyDbPort || defaultPort).toString().trim();
        const dbName = (req.headers['x-db-name'] || req.headers['db-name'] || queryDbName || bodyDbName || defaultDatabase).toString().trim();
        const dbUser = (req.headers['x-db-user'] || req.headers['db-user'] || queryDbUser || bodyDbUser || defaultUser).toString().trim();
        const dbPassword = (req.headers['x-db-password'] || req.headers['db-password'] || queryDbPassword || bodyDbPassword || defaultPassword).toString().trim();
        const dbSsl = (req.headers['x-db-ssl'] || req.headers['db-ssl'] || queryDbSsl || bodyDbSsl || (defaultSsl ? 'true' : 'false')).toString().trim();
        
        // 내부 요청인 경우 DB 정보가 하나라도 있으면 사용
        if (dbHost && dbPort && dbName && dbUser && dbPassword) {
            req.dbConfig = {
                host: '127.0.0.1', // 무조건 127.0.0.1 사용
                port: parseInt(dbPort, 10),
                database: dbName,
                user: dbUser,
                password: dbPassword,
                ssl: dbSsl === 'true' || dbSsl === '1'
            };
            return next();
        }
        // DB 정보가 없으면 일반 헤더 검증으로 진행
    }
    
    // 헤더에서 DB 정보 추출 (공백 제거)
    // host는 무조건 '127.0.0.1'로 설정 (헤더 값 무시)
    // port는 기본값 사용 (없어도 오류 발생 안 함)
    const dbHost = '127.0.0.1'; // 헤더 값 무시하고 항상 127.0.0.1 사용
    const dbPort = (req.headers['x-db-port'] || req.headers['db-port'] || '5432').trim();
    const dbName = (req.headers['x-db-name'] || req.headers['db-name'] || '').trim();
    const dbUser = (req.headers['x-db-user'] || req.headers['db-user'] || '').trim();
    const dbPassword = (req.headers['x-db-password'] || req.headers['db-password'] || '').trim();
    const dbSsl = (req.headers['x-db-ssl'] || req.headers['db-ssl'] || '').trim();
    
    // 헤더 검증 오류 수집
    const errors = [];
    const receivedValues = {};
    
    // x-db-host는 무조건 '127.0.0.1' 사용 (헤더 값 무시)
    receivedValues['x-db-host'] = '127.0.0.1';
    
    // x-db-port 검증 (기본값 사용하지만 유효성은 확인)
    receivedValues['x-db-port'] = dbPort;
    const portNum = parseInt(dbPort, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errors.push({
            header: 'x-db-port (or db-port)',
            issue: '잘못된 포트 번호 (Invalid port number)',
            received: dbPort,
            expected: '1-65535 범위의 숫자'
        });
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
        host: '127.0.0.1', // 무조건 127.0.0.1 사용 (헤더 값 무시)
        port: parseInt(dbPort, 10),
        database: dbName,
        user: dbUser,
        password: dbPassword,
        ssl: dbSsl === 'true' || dbSsl === '1'
    };
    
    next();
}

module.exports = { parseDbHeader };

