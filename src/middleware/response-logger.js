function responseLogger(req, res, next) {
    const startTime = Date.now();
    
    // 응답이 완료될 때 실행
    res.on('finish', () => {
        const statusCode = res.statusCode;
        const isSuccess = statusCode >= 200 && statusCode < 300;
        const statusText = isSuccess ? 'Success' : 'Failed';
        
        // 라우터 정보 추출
        const path = req.originalUrl || req.path || req.url;
        
        // path가 http:// 또는 https://로 시작하는지 확인
        if (path && (path.toLowerCase().startsWith('http://') || path.toLowerCase().startsWith('https://'))) {
            console.error(`\nERROR: Invalid path detected in response - path should not start with http:// or https://`);
            console.error(`   Received path: ${path}`);
            console.error(`   Method: ${req.method}`);
            console.error(`   Status Code: ${statusCode}`);
            console.error(`   This is likely a configuration error in the client application.`);
            console.error('');
        }
        
        const routerName = extractRouterName(path);
        
        // CRUD 작업 종류
        const operation = getOperationType(req.method);
        
        // 데이터 개수 (req.body.count를 우선 사용, 없으면 req._dataCount 사용)
        let dataCount = 1;
        if (req.body && req.body.count !== undefined && req.body.count !== null) {
            dataCount = parseInt(req.body.count, 10) || 1;
        } else {
            dataCount = req._dataCount || 1;
        }
        
        // 데이터베이스 정보
        const dbInfo = req.dbConfig 
            ? `${req.dbConfig.database}@${req.dbConfig.host}:${req.dbConfig.port}`
            : 'N/A';
        
        // HTTP 메서드 정보 추가
        const httpMethod = req.method || 'UNKNOWN';
        
        // 처리 통계 정보가 있으면 상세 출력
        if (req._processingStats) {
            const stats = req._processingStats;
            console.log(`${statusText} | ${httpMethod} | ${dbInfo} | ${routerName} | ${operation} | Total: ${stats.total} | Created: ${stats.created} | Updated: ${stats.updated} | Deleted: ${stats.deleted} | Failed: ${stats.failed}`);
        } else {
            // 1줄로 출력
            console.log(`${statusText} | ${httpMethod} | ${dbInfo} | ${routerName} | ${operation} | ${dataCount}개`);
        }
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
            'vcodes': 'Vcodes',
            'vdetalle': 'Vdetalle',
            'ingresos': 'Ingresos',
            'codigos': 'Codigos',
            'todocodigos': 'Todocodigos',
            'parametros': 'Parametros',
            'gasto_info': 'GastoInfo',
            'gastos': 'Gastos',
            'color': 'Color',
            'creditoventas': 'Creditoventas',
            'clientes': 'Clientes',
            'tipos': 'Tipos',
            'vtags': 'Vtags',
            'online_ventas': 'OnlineVentas',
            'logs': 'Logs',
            'vendedores': 'Vendedores',
            'resumen_del_dia': 'ResumenDelDia',
            'health': 'Health'
        };
        return routerMap[router] || router;
    }
    return `Unknown (path: ${path}, cleaned: ${cleanPath})`;
}

function getOperationType(method) {
    // HTTP 메서드를 대문자로 정규화하여 대소문자 구분 문제 방지
    const normalizedMethod = (method || '').toUpperCase();
    const methodMap = {
        'GET': 'Read',
        'POST': 'Create',
        'PUT': 'Update',
        'DELETE': 'Delete',
        'PATCH': 'Update'
    };
    return methodMap[normalizedMethod] || normalizedMethod;
}

module.exports = { responseLogger };

