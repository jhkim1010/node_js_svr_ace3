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
    // 기본 호스트 결정 (Docker 환경 감지)
    const getDefaultDbHost = () => {
        if (process.env.DB_HOST) return process.env.DB_HOST;
        try {
            const fs = require('fs');
            const isDocker = process.env.DOCKER === 'true' || 
                           process.env.IN_DOCKER === 'true' ||
                           fs.existsSync('/.dockerenv') ||
                           process.env.HOSTNAME?.includes('docker') ||
                           process.cwd() === '/home/node/app';
            return isDocker ? 'host.docker.internal' : '127.0.0.1';
        } catch (e) {
            return '127.0.0.1';
        }
    };
    const connectionDiagnosis = diagnoseConnectionRefusedError(
        err, 
        dbConfig.host || getDefaultDbHost(), 
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
        // 컬럼 길이 제한 오류 감지 및 분석
        const isLengthError = errorMsg.includes('value too long for type') || 
                             errorMsg.includes('character varying') ||
                             errorMsg.includes('too long');
        
        if (isLengthError) {
            // 에러 메시지에서 컬럼 정보 추출
            // PostgreSQL 형식: "value too long for type character varying(50) of column 'column_name'"
            const columnMatch = errorMsg.match(/column ['"]([^'"]+)['"]/i) || 
                               errorMsg.match(/of column ['"]([^'"]+)['"]/i);
            const lengthMatch = errorMsg.match(/character varying\((\d+)\)/i) || 
                               errorMsg.match(/varchar\((\d+)\)/i);
            
            const columnName = columnMatch ? columnMatch[1] : null;
            const maxLength = lengthMatch ? parseInt(lengthMatch[1], 10) : null;
            
            console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: Column length exceeded`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
            console.error(`   Error Message: ${errorMsg}`);
            
            if (columnName) {
                console.error(`   Problematic Column: ${columnName}`);
                if (maxLength) {
                    console.error(`   Maximum Length: ${maxLength} characters`);
                }
                
                // 요청 본문에서 해당 컬럼의 값 확인
                const bodyData = req.body.new_data || req.body.data || req.body;
                if (bodyData) {
                    if (Array.isArray(bodyData)) {
                        // 배열인 경우 첫 번째 항목 확인
                        const firstItem = bodyData[0];
                        if (firstItem && firstItem[columnName] !== undefined) {
                            const value = firstItem[columnName];
                            const valueLength = value ? String(value).length : 0;
                            console.error(`   Attempted Value Length: ${valueLength} characters`);
                            if (maxLength && valueLength > maxLength) {
                                console.error(`   Value Exceeds Limit By: ${valueLength - maxLength} characters`);
                            }
                            // 값이 너무 길면 일부만 표시
                            const valueStr = String(value);
                            if (valueStr.length > 100) {
                                console.error(`   Value Preview: ${valueStr.substring(0, 100)}...`);
                            } else {
                                console.error(`   Value: ${valueStr}`);
                            }
                        }
                    } else if (bodyData[columnName] !== undefined) {
                        const value = bodyData[columnName];
                        const valueLength = value ? String(value).length : 0;
                        console.error(`   Attempted Value Length: ${valueLength} characters`);
                        if (maxLength && valueLength > maxLength) {
                            console.error(`   Value Exceeds Limit By: ${valueLength - maxLength} characters`);
                        }
                        // 값이 너무 길면 일부만 표시
                        const valueStr = String(value);
                        if (valueStr.length > 100) {
                            console.error(`   Value Preview: ${valueStr.substring(0, 100)}...`);
                        } else {
                            console.error(`   Value: ${valueStr}`);
                        }
                    }
                }
            } else {
                // 컬럼 이름을 찾을 수 없는 경우, 요청 본문의 모든 문자열 필드 확인
                console.error(`   Note: Could not identify specific column from error message`);
                console.error(`   Checking all string fields in request data...`);
                
                const bodyData = req.body.new_data || req.body.data || req.body;
                if (bodyData) {
                    const dataToCheck = Array.isArray(bodyData) ? bodyData[0] : bodyData;
                    if (dataToCheck && typeof dataToCheck === 'object') {
                        const longFields = [];
                        Object.entries(dataToCheck).forEach(([key, value]) => {
                            if (typeof value === 'string' && value.length > 0) {
                                longFields.push({ column: key, length: value.length, value: value.length > 50 ? value.substring(0, 50) + '...' : value });
                            }
                        });
                        if (longFields.length > 0) {
                            console.error(`   String fields in request data:`);
                            longFields.forEach(field => {
                                console.error(`      - ${field.column}: ${field.length} characters (${field.value})`);
                            });
                        }
                    }
                }
            }
        } else {
            console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Reason: ${errorClassification.reason}`);
        }
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
    // 기본 호스트 결정 (Docker 환경 감지)
    const getDefaultDbHost = () => {
        if (process.env.DB_HOST) return process.env.DB_HOST;
        try {
            const fs = require('fs');
            const isDocker = process.env.DOCKER === 'true' || 
                           process.env.IN_DOCKER === 'true' ||
                           fs.existsSync('/.dockerenv') ||
                           process.env.HOSTNAME?.includes('docker') ||
                           process.cwd() === '/home/node/app';
            return isDocker ? 'host.docker.internal' : '127.0.0.1';
        } catch (e) {
            return '127.0.0.1';
        }
    };
    const connectionDiagnosis = diagnoseConnectionRefusedError(
        err, 
        dbConfig.host || getDefaultDbHost(), 
        dbConfig.port || 5432
    );
    
    // 기본 에러 메시지 생성
    let message = errorMsg;
    if (connectionDiagnosis) {
        // 연결 거부 오류인 경우 더 명확한 메시지
        message = `Database connection refused: ${connectionDiagnosis.diagnosis.summary}`;
    }
    
    const errorResponse = {
        error: `Failed to ${operation}`,
        message: message,
        details: errorMsg,
        errorType: err.constructor.name,
        errorCode: errorCode,
        errorName: errorName,
        originalError: err.original ? err.original.message : null
    };
    
    // 연결 거부 오류인 경우 상세 진단 정보 추가 (해결 방법 제외)
    if (connectionDiagnosis) {
        // 해결 방법(recommendedSolutions)은 제외하고 진단 정보만 포함
        const { recommendedSolutions, ...diagnosisWithoutSolutions } = connectionDiagnosis.diagnosis;
        errorResponse.diagnosis = diagnosisWithoutSolutions;
        errorResponse.connectionInfo = connectionDiagnosis.connectionInfo;
        errorResponse.mostLikelyCause = connectionDiagnosis.diagnosis.mostLikelyCause;
    }
    
    return errorResponse;
}

module.exports = { handleInsertUpdateError, buildDatabaseErrorResponse };

