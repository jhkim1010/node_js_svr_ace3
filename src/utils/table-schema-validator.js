// 테이블명과 스키마 검증 유틸리티

// 라우트 경로와 테이블명 매핑
const routeToTableMap = {
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
    'vendedores': 'vendedores'
};

// 모델명과 테이블명 매핑
const modelToTableMap = {
    'Vcode': 'vcodes',
    'Vdetalle': 'vdetalle',
    'Ingresos': 'ingresos',
    'Codigos': 'codigos',
    'Todocodigos': 'todocodigos',
    'Parametros': 'parametros',
    'GastoInfo': 'gasto_info',
    'Gastos': 'gastos',
    'Color': 'color',
    'Creditoventas': 'creditoventas',
    'Clientes': 'clientes',
    'Tipos': 'tipos',
    'Vtags': 'vtags',
    'OnlineVentas': 'online_ventas',
    'Logs': 'logs',
    'Vendedores': 'vendedores'
};

/**
 * 요청에서 테이블명과 스키마 검증
 * @param {Object} req - Express request 객체
 * @param {string} routePath - 라우트 경로 (예: 'clientes')
 * @param {string} modelName - 모델명 (예: 'Clientes')
 * @returns {Object} { valid: boolean, errors: Array, warnings: Array }
 */
function validateTableAndSchema(req, routePath, modelName) {
    const errors = [];
    const warnings = [];
    
    // table 필드 검증
    if (req.body.table !== undefined) {
        const expectedTable = routeToTableMap[routePath] || modelToTableMap[modelName];
        const receivedTable = req.body.table?.toLowerCase();
        
        if (expectedTable && receivedTable !== expectedTable.toLowerCase()) {
            warnings.push({
                field: 'table',
                issue: '테이블명 불일치 (Table name mismatch)',
                received: req.body.table,
                expected: expectedTable,
                message: `요청된 테이블명 '${req.body.table}'이 라우트 경로 '${routePath}'와 일치하지 않습니다.`
            });
        }
    }
    
    // schema 필드 검증
    if (req.body.schema !== undefined) {
        const receivedSchema = req.body.schema?.toLowerCase();
        const expectedSchema = 'public'; // 기본 스키마는 public
        
        if (receivedSchema !== expectedSchema) {
            warnings.push({
                field: 'schema',
                issue: '스키마 불일치 (Schema mismatch)',
                received: req.body.schema,
                expected: expectedSchema,
                message: `요청된 스키마 '${req.body.schema}'이 예상 스키마 '${expectedSchema}'와 일치하지 않습니다.`
            });
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * 테이블명과 스키마 정보를 로깅
 * @param {Object} req - Express request 객체
 * @param {string} routePath - 라우트 경로
 * @param {string} modelName - 모델명
 */
function logTableAndSchema(req, routePath, modelName) {
    if (req.body.table || req.body.schema) {
        const table = req.body.table || 'not specified';
        const schema = req.body.schema || 'not specified';
        console.log(`[BATCH_SYNC] Table: ${table}, Schema: ${schema}, Route: ${routePath}, Model: ${modelName}`);
    }
}

module.exports = {
    validateTableAndSchema,
    logTableAndSchema,
    routeToTableMap,
    modelToTableMap
};

