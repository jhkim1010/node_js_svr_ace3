function responseLogger(req, res, next) {
    const startTime = Date.now();
    
    // 응답이 완료될 때 실행
    res.on('finish', () => {
        // 라우터 정보 추출 (테이블 이름)
        const path = req.originalUrl || req.path || req.url;
        
        // resumen_del_dia 요청은 로그 출력하지 않음
        if (path && (path.includes('/resumen_del_dia') || path.includes('resumen_del_dia'))) {
            return;
        }
        // ingresos 테이블 POST/PUT 요청은 로그 출력하지 않음 (요청이 많아 일일 로그 불필요)
        if (path && (path.includes('/ingresos') || path.includes('ingresos')) && (req.method === 'POST' || req.method === 'PUT')) {
            return;
        }
        
        const statusCode = res.statusCode;
        const isSuccess = statusCode >= 200 && statusCode < 300;
        
        // path가 http:// 또는 https://로 시작하는지 확인
        if (path && (path.toLowerCase().startsWith('http://') || path.toLowerCase().startsWith('https://'))) {
            console.error(`\nERROR: Invalid path detected in response - path should not start with http:// or https://`);
            console.error(`   Received path: ${path}`);
            console.error(`   Method: ${req.method}`);
            console.error(`   Status Code: ${statusCode}`);
            console.error(`   This is likely a configuration error in the client application.`);
            console.error('');
        }
        
        // 테이블(라우터) 이름 추출 및 강조
        const routerNameRaw = extractRouterName(path);
        const routerName = `**${routerNameRaw}**`;
        
        // CRUD 작업 종류 (커스텀 operation 타입이 있으면 우선 사용)
        const operation = req._operationType || getOperationType(req.method);
        
        // 데이터 개수 확인
        // GET 요청의 경우 응답 데이터 개수를 우선 사용 (req._responseDataCount)
        // POST/PUT/DELETE의 경우 요청 데이터 개수 사용
        let dataCount = 1;
        if (req.method === 'GET' && req._responseDataCount !== undefined) {
            // GET 요청: 실제 응답 데이터 개수 사용
            dataCount = req._responseDataCount;
        } else if (req.body && req.body.count !== undefined && req.body.count !== null) {
            // POST/PUT/DELETE 요청: 요청 바디의 count 사용
            dataCount = parseInt(req.body.count, 10) || 1;
        } else {
            // 기본값: req._dataCount 또는 1
            dataCount = req._dataCount || 1;
        }
        
        // 데이터베이스 이름만 (host:port 제거) - 출력 시 [ ]로 감싸기
        const rawDbName = req.dbConfig 
            ? req.dbConfig.database
            : 'N/A';
        const dbName = `[${rawDbName}]`;
        
        // HTTP 메서드와 operation을 함께 표시하여 POST/GET 구분 명확히
        const method = (req.method || '').toUpperCase();
        const operationWithMethod = `${method}/${operation}`;
        
        // 상태 코드에 따른 성공/실패 표시
        const statusEmoji = isSuccess ? '✅' : '❌';
        const statusText = isSuccess ? '' : ` | Status: ${statusCode}`;
        
        // 처리 통계 정보가 있으면 총 개수만 출력 (pagination으로 나눠서 들어올 때도 총 개수만 표시)
        if (req._processingStats) {
            const stats = req._processingStats;
            const skippedText = stats.skipped > 0 ? ` | Skipped: ${stats.skipped}` : '';
            console.log(`${statusEmoji} ${dbName} | ${routerName} | ${operationWithMethod} | Total: ${stats.total} | Created: ${stats.created} | Updated: ${stats.updated} | Deleted: ${stats.deleted} | Failed: ${stats.failed}${skippedText}${statusText}`);
        } else {
            // 보고서별 추가 정보 포함
            const reportInfo = req._ventasInfo || req._itemsInfo || '';
            const reportInfoText = reportInfo ? ` | ${reportInfo}` : '';
            // 1줄로 출력
            console.log(`${statusEmoji} ${dbName} | ${routerName} | ${operationWithMethod} | ${dataCount}개${reportInfoText}${statusText}`);
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

