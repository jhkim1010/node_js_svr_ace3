// 요청이 들어올 때 operation을 먼저 확인하고 로그를 출력하는 미들웨어

function operationLogger(req, res, next) {
    // path가 http:// 또는 https://로 시작하는지 확인
    const path = req.originalUrl || req.path || req.url;
    if (path && (path.toLowerCase().startsWith('http://') || path.toLowerCase().startsWith('https://'))) {
        console.error(`\nERROR: Invalid path detected - path should not start with http:// or https://`);
        console.error(`   Received path: ${path}`);
        console.error(`   Method: ${req.method}`);
        console.error(`   This is likely a configuration error in the client application.`);
        console.error('');
    }
    
    // GET 요청에 대한 간단한 로그
    if (req.method === 'GET') {
        const routerName = extractRouterName(path);
        const dbInfo = req.dbConfig 
            ? `${req.dbConfig.database}@${req.dbConfig.host}:${req.dbConfig.port}`
            : 'N/A';
        const clientId = req.headers['x-client-id'] || req.headers['client-id'] || 'N/A';
        console.log(`[Request Received] Method: GET | Operation: READ | Table: ${routerName} | DB: ${dbInfo} | Client: ${clientId}`);
    }
    
    // POST, PUT, DELETE 요청에 대해서만 operation 확인
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        // 디버깅: 요청 기본 정보 출력
        const routerName = extractRouterName(path);
        const contentType = req.headers['content-type'] || 'N/A';
        
        // 디버깅: operation 찾기 과정 추적
        let operation = null;
        let operationSource = 'N/A';
        
        // 1. 헤더에서 찾기
        if (req.headers['x-operation']) {
            operation = req.headers['x-operation'];
            operationSource = 'header[x-operation]';
        } else if (req.headers['operation']) {
            operation = req.headers['operation'];
            operationSource = 'header[operation]';
        }
        
        // 2. 쿼리에서 찾기
        if (!operation && req.query.operation) {
            operation = req.query.operation;
            operationSource = 'query.operation';
        }
        
        // 3. 본문에서 찾기
        if (!operation && req.body) {
            if (req.body.operation) {
                operation = req.body.operation;
                operationSource = 'body.operation';
            } else if (req.body.trigger_operation) {
                operation = req.body.trigger_operation;
                operationSource = 'body.trigger_operation';
            }
        }
        
        // 디버깅: req.body 상태 확인
        console.log(`   Body Status:`);
        console.log(`      req.body exists: ${!!req.body}`);
        console.log(`      req.body type: ${typeof req.body}`);
        if (req.body) {
            console.log(`      req.body keys: ${Object.keys(req.body).join(', ') || 'empty object'}`);
            if (req.body.operation !== undefined) {
                console.log(`      req.body.operation: ${req.body.operation} (type: ${typeof req.body.operation})`);
            }
            if (req.body.trigger_operation !== undefined) {
                console.log(`      req.body.trigger_operation: ${req.body.trigger_operation} (type: ${typeof req.body.trigger_operation})`);
            }
            // 본문 일부 출력 (너무 크면 자르기)
            try {
                const bodyStr = JSON.stringify(req.body);
                if (bodyStr.length > 500) {
                    console.log(`      req.body preview: ${bodyStr.substring(0, 500)}... (truncated, total: ${bodyStr.length} chars)`);
                } else {
                    console.log(`      req.body: ${bodyStr}`);
                }
            } catch (e) {
                console.log(`      req.body (stringify failed): ${e.message}`);
            }
        } else {
            console.log(`      WARNING: req.body is null/undefined - JSON parsing may have failed!`);
        }
        
        // operation 정규화 (대문자로 변환)
        if (operation) {
            operation = operation.toUpperCase();
            console.log(`   Operation found: "${operation}" from ${operationSource}`);
        } else {
            // operation이 없으면 HTTP 메서드 기반으로 추정
            const methodMap = {
                'POST': 'CREATE',
                'PUT': 'UPDATE',
                'PATCH': 'UPDATE',
                'DELETE': 'DELETE'
            };
            operation = methodMap[req.method] || req.method;
            console.log(`   WARNING: Operation not found, using method-based default: "${operation}"`);
        }
        
        // 데이터베이스 정보
        const dbInfo = req.dbConfig 
            ? `${req.dbConfig.database}@${req.dbConfig.host}:${req.dbConfig.port}`
            : 'N/A';
        
        // 클라이언트 ID
        const clientId = req.headers['x-client-id'] || req.headers['client-id'] || 'N/A';
        
        // 데이터 개수 (req.body.count를 우선 사용, 없으면 배열 길이 계산)
        let dataCount = 1;
        if (req.body) {
            // req.body.count를 우선적으로 사용 (클라이언트가 명시적으로 전달한 값)
            if (req.body.count !== undefined && req.body.count !== null) {
                dataCount = parseInt(req.body.count, 10) || 1;
            } else if (Array.isArray(req.body.data)) {
                dataCount = req.body.data.length;
            } else if (Array.isArray(req.body)) {
                dataCount = req.body.length;
            } else if (Array.isArray(req.body.new_data)) {
                dataCount = req.body.new_data.length;
            }
        }
        
        // req에 데이터 개수 저장 (다른 미들웨어나 핸들러에서 사용 가능)
        req._dataCount = dataCount;
        
        // operation을 먼저 로그로 출력 (HTTP 메서드 포함)
        console.log(`[Request Received] Method: ${req.method} | Operation: ${operation} | Table: ${routerName} | DB: ${dbInfo} | Client: ${clientId} | Data Count: ${dataCount}`);
        console.log('='.repeat(80) + '\n');
        
        // req에 operation 정보 저장 (다른 미들웨어나 핸들러에서 사용 가능)
        req._operation = operation;
    }
    
    next();
}

function extractRouterName(path) {
    if (!path) return 'Unknown';
    
    // 경로에서 라우터 이름 추출
    let cleanPath = path.toString();
    
    // 쿼리 문자열 제거
    if (cleanPath.includes('?')) {
        cleanPath = cleanPath.split('?')[0];
    }
    
    // /api 접두사 제거
    if (cleanPath.startsWith('/api/')) {
        cleanPath = cleanPath.substring(5);
    } else if (cleanPath.startsWith('/api')) {
        cleanPath = cleanPath.substring(4);
    }
    
    // 앞뒤 슬래시 제거
    cleanPath = cleanPath.replace(/^\/+|\/+$/g, '');
    
    const parts = cleanPath.split('/').filter(p => p && p.trim());
    
    if (parts.length > 0) {
        const router = parts[0].toLowerCase();
        const routerMap = {
            'vcodes': 'vcodes',
            'vdetalle': 'vdetalle',
            'ingresos': 'ingresos',
            'codigos': 'codigos',
            'todocodigos': 'todocodigos',
            'parametros': 'parametros',
            'gasto_info': 'gasto_info',
            'gastos': 'gastos',
            'color': 'color',
            'creditoventas': 'creditoventas',
            'clientes': 'clientes',
            'tipos': 'tipos',
            'vtags': 'vtags',
            'online_ventas': 'online_ventas',
            'logs': 'logs',
            'health': 'health'
        };
        return routerMap[router] || router;
    }
    return 'Unknown';
}

module.exports = { operationLogger };

