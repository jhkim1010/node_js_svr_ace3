/**
 * 공통 에러 처리 함수
 * unique constraint 에러를 감지하고 명확한 메시지를 출력
 */
const { classifyError } = require('./error-classifier');

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

module.exports = { handleInsertUpdateError };

