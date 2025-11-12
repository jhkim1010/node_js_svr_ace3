function responseLogger(req, res, next) {
    const startTime = Date.now();
    
    // 응답이 완료될 때 실행
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const timestamp = new Date().toISOString();
        const statusCode = res.statusCode;
        const statusEmoji = statusCode >= 200 && statusCode < 300 ? '✅' : 
                           statusCode >= 400 && statusCode < 500 ? '⚠️' : 
                           statusCode >= 500 ? '❌' : 'ℹ️';
        
        // 라우터 정보 추출
        // req.originalUrl 또는 req.path 사용
        const path = req.originalUrl || req.path || req.url;
        const route = req.route ? req.route.path : path;
        const routerName = extractRouterName(path);
        const command = getCommandDescription(req.method, path);
        
        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(`${statusEmoji} [${timestamp}] 응답 완료`);
        console.log('───────────────────────────────────────────────────────────');
        console.log(`📡 라우터: ${routerName}`);
        console.log(`🔧 명령: ${command}`);
        console.log(`📍 경로: ${req.method} ${route}`);
        console.log(`📊 상태 코드: ${statusCode}`);
        console.log(`⏱️  처리 시간: ${duration}ms`);
        if (req.dbConfig) {
            console.log(`🗄️  데이터베이스: ${req.dbConfig.database}@${req.dbConfig.host}:${req.dbConfig.port}`);
        }
        console.log('═══════════════════════════════════════════════════════════\n');
    });
    
    next();
}

function extractRouterName(path) {
    if (!path) return 'Unknown (no path)';
    
    // 경로에서 라우터 이름 추출
    // /api/vcodes -> vcodes 추출
    let cleanPath = path.toString();
    
    // 쿼리 문자열 제거
    if (cleanPath.includes('?')) {
        cleanPath = cleanPath.split('?')[0];
    }
    
    // /api 접두사 제거
    if (cleanPath.startsWith('/api/')) {
        cleanPath = cleanPath.substring(5); // '/api/'.length
    } else if (cleanPath.startsWith('/api')) {
        cleanPath = cleanPath.substring(4); // '/api'.length
    }
    
    // 앞뒤 슬래시 제거
    cleanPath = cleanPath.replace(/^\/+|\/+$/g, '');
    
    const parts = cleanPath.split('/').filter(p => p && p.trim());
    
    if (parts.length > 0) {
        const router = parts[0].toLowerCase();
        // 라우터 이름을 읽기 쉽게 변환
        const routerMap = {
            'vcodes': 'Vcodes (판매 코드)',
            'vdetalle': 'Vdetalle (판매 상세)',
            'ingresos': 'Ingresos (입고)',
            'codigos': 'Codigos (코드)',
            'todocodigos': 'Todocodigos (전체 코드)',
            'parametros': 'Parametros (파라미터)',
            'gasto_info': 'GastoInfo (지출 정보)',
            'gastos': 'Gastos (지출)',
            'health': 'Health (상태 체크)'
        };
        return routerMap[router] || `${router} (${router})`;
    }
    return `Unknown (path: ${path}, cleaned: ${cleanPath})`;
}

function getCommandDescription(method, path) {
    if (!path) return method;
    
    // /api 접두사 제거
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
    const router = parts[0];
    const id = parts[1];
    
    const methodMap = {
        'GET': '조회',
        'POST': '생성',
        'PUT': '수정',
        'DELETE': '삭제',
        'PATCH': '부분 수정'
    };
    
    const action = methodMap[method] || method;
    
    if (method === 'GET' && id) {
        return `${action} (단건 조회 - ID: ${id})`;
    } else if (method === 'GET') {
        return `${action} (목록 조회)`;
    } else if (method === 'POST') {
        return `${action} (새 레코드 추가)`;
    } else if (method === 'PUT' && id) {
        return `${action} (레코드 업데이트 - ID: ${id})`;
    } else if (method === 'DELETE' && id) {
        return `${action} (레코드 삭제 - ID: ${id})`;
    }
    
    return action;
}

module.exports = { responseLogger };

