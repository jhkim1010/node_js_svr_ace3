/**
 * 공통 에러 처리 함수
 * unique constraint 에러를 감지하고 명확한 메시지를 출력
 */
const { classifyError, diagnoseConnectionRefusedError } = require('./error-classifier');

/**
 * 에러를 처리하고 로그를 출력하는 함수
 * @param {Error} err - 발생한 에러
 * @param {Object} req - Express request 객체
 * @param {string} modelName - 모델 이름 (예: 'Gastos', 'Vcode')
 * @param {string} primaryKey - Primary key 컬럼 이름 (예: 'id_ga', 'codigo')
 * @param {string} tableName - 테이블 이름 (예: 'gastos', 'vcodes')
 */
function handleInsertUpdateError(err, req, modelName, primaryKey, tableName) {
    const errorMsg = err.original ? err.original.message : err.message;
    const errorClassification = classifyError(err);
    
    // 연결 거부 오류인 경우 상세 진단
    const dbConfig = req.dbConfig || {};
    const connectionDiagnosis = diagnoseConnectionRefusedError(
        err, 
        dbConfig.host || 'localhost', 
        dbConfig.port || 5432
    );
    
    if (connectionDiagnosis) {
        console.error(`\n❌ ${modelName} 연결 거부 오류 발생`);
        console.error(`   연결 정보: ${connectionDiagnosis.connectionInfo.host}:${connectionDiagnosis.connectionInfo.port}`);
        console.error(`   환경: ${connectionDiagnosis.connectionInfo.environment}`);
        console.error(`   진단 요약: ${connectionDiagnosis.diagnosis.summary}`);
        console.error(`   가장 가능성 높은 원인: ${connectionDiagnosis.diagnosis.mostLikelyCause}`);
        console.error(`\n   가능한 원인:`);
        connectionDiagnosis.diagnosis.possibleCauses.forEach((cause, index) => {
            console.error(`   ${index + 1}. [${cause.probability}] ${cause.cause}`);
            console.error(`      ${cause.description}`);
        });
        console.error(`\n   권장 해결 방법:`);
        connectionDiagnosis.diagnosis.recommendedSolutions.forEach((solution, index) => {
            console.error(`   ${index + 1}. ${solution.solution}`);
            console.error(`      ${solution.description}`);
            if (solution.example) {
                console.error(`      예시: ${solution.example}`);
            }
            if (solution.commands) {
                Object.entries(solution.commands).forEach(([platform, cmd]) => {
                    console.error(`      ${platform}: ${cmd}`);
                });
            }
        });
        console.error('');
        return; // 연결 오류는 여기서 처리 완료
    }
    
    // Primary key 또는 unique constraint 위반인 경우 더 명확한 메시지 표시
    const isConstraintError = err.constructor.name.includes('UniqueConstraintError') || 
                               errorMsg.includes('duplicate key') || 
                               errorMsg.includes('unique constraint');
    
    if (isConstraintError) {
        // constraint 이름에서 실제 위반된 컬럼 파악
        const constraintMatch = errorMsg.match(/constraint "([^"]+)"/);
        const constraintName = constraintMatch ? constraintMatch[1] : null;
        
        // primary key가 배열인 경우 첫 번째 키 사용
        const primaryKeyStr = Array.isArray(primaryKey) ? primaryKey[0] : primaryKey;
        
        // primary key 제약 조건인 경우 (테이블명.pr 패턴)
        const primaryKeyConstraintPattern = `${tableName}.pr`;
        if (constraintName === primaryKeyConstraintPattern || errorMsg.includes(primaryKeyConstraintPattern)) {
            const keyDisplay = Array.isArray(primaryKey) ? primaryKey.join(', ') : primaryKey;
            console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: Primary key (${keyDisplay}) duplicate`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: The ${keyDisplay} value already exists in the database. Use UPDATE instead of INSERT, or use a different ${keyDisplay} value.`);
            const bodyData = req.body.new_data || req.body;
            if (bodyData && bodyData[primaryKeyStr] !== undefined) {
                console.error(`   Attempted ${primaryKeyStr} value: ${bodyData[primaryKeyStr]}`);
            }
        } else {
            console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
            if (constraintName) {
                console.error(`   Constraint Name: ${constraintName}`);
            }
        }
    } else if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
        // Validation error인 경우 상세 정보 표시
        console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
        console.error(`   Problem Source: ${errorClassification.description}`);
        console.error(`   Reason: ${errorClassification.reason}`);
        err.errors.forEach((validationError, index) => {
            console.error(`   [${index + 1}] Column: ${validationError.path}`);
            console.error(`       Value: ${validationError.value !== undefined && validationError.value !== null ? JSON.stringify(validationError.value) : 'null'}`);
            console.error(`       Error Type: ${validationError.type || 'N/A'}`);
            console.error(`       Validator: ${validationError.validatorKey || validationError.validatorName || 'N/A'}`);
            console.error(`       Message: ${validationError.message}`);
            if (validationError.validatorArgs && validationError.validatorArgs.length > 0) {
                console.error(`       Validator Args: ${JSON.stringify(validationError.validatorArgs)}`);
            }
        });
    } else {
        console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
        console.error(`   Problem Source: ${errorClassification.description}`);
        console.error(`   Reason: ${errorClassification.reason}`);
    }
}

/**
 * 연결 오류를 포함한 일반적인 데이터베이스 오류에 대한 응답 생성
 * @param {Error} err - 발생한 에러
 * @param {Object} req - Express request 객체
 * @param {string} operation - 작업 설명 (예: 'fetch gastos', 'list records')
 * @returns {Object} 에러 응답 객체
 */
function buildDatabaseErrorResponse(err, req, operation = 'database operation') {
    const errorMsg = err.original ? err.original.message : err.message;
    const errorCode = err.original ? err.original.code : err.code;
    const errorName = err.original ? err.original.name : err.name;
    
    const dbConfig = req.dbConfig || {};
    const connectionDiagnosis = diagnoseConnectionRefusedError(
        err, 
        dbConfig.host || 'localhost', 
        dbConfig.port || 5432
    );
    
    const errorResponse = {
        error: `Failed to ${operation}`,
        details: errorMsg,
        errorType: err.constructor.name,
        errorCode: errorCode,
        errorName: errorName,
        originalError: err.original ? err.original.message : null
    };
    
    // 연결 거부 오류인 경우 상세 진단 정보 추가
    if (connectionDiagnosis) {
        errorResponse.diagnosis = connectionDiagnosis.diagnosis;
        errorResponse.connectionInfo = connectionDiagnosis.connectionInfo;
    }
    
    return errorResponse;
}

module.exports = { handleInsertUpdateError, buildDatabaseErrorResponse };

