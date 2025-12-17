/**
 * 공통 에러 처리 함수
 * unique constraint 에러를 감지하고 명확한 메시지를 출력
 */
const { classifyError, diagnoseConnectionRefusedError } = require('./error-classifier');
const { sendDatabaseErrorAlert } = require('../services/monitoring-service');

/**
 * 연결 한계 도달 오류 메시지 간소화
 * @param {string} errorMsg - 원본 에러 메시지
 * @returns {string} 간소화된 에러 메시지
 */
function simplifyConnectionLimitError(errorMsg) {
    if (errorMsg && errorMsg.includes('remaining connection slots are reserved for non-replication superuser connections')) {
        return 'database 연결 한계도달';
    }
    return errorMsg;
}

/**
 * 에러를 처리하고 로그를 출력하는 함수
 * @param {Error} err - 발생한 에러
 * @param {Object} req - Express request 객체
 * @param {string} modelName - 모델 이름 (예: 'Gastos', 'Vcode')
 * @param {string} primaryKey - Primary key 컬럼 이름 (예: 'id_ga', 'codigo')
 * @param {string} tableName - 테이블 이름 (예: 'gastos', 'vcodes')
 */
function handleInsertUpdateError(err, req, modelName, primaryKey, tableName) {
    let errorMsg = err.original ? err.original.message : err.message;
    errorMsg = simplifyConnectionLimitError(errorMsg);
    const errorClassification = classifyError(err);
    
    // 연결 거부 오류인 경우 상세 진단
    const dbConfig = req.dbConfig || {};
    
    // 데이터베이스 이름 추출
    const database = dbConfig.database || '알 수 없음';
    
    // Telegram 알림 전송 (비동기, 에러는 무시)
    sendDatabaseErrorAlert(err, database, tableName, `INSERT/UPDATE ${modelName}`).catch(() => {
        // 알림 전송 실패는 조용히 무시 (데이터베이스 오류 처리에 영향 없음)
    });
    
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
    
    // 연결 오류인 경우 상세 정보 출력
    if (errorClassification.source === 'SERVER_DB' && errorClassification.description === 'Database connection problem') {
        const targetHost = dbConfig.host || getDefaultDbHost();
        const targetPort = dbConfig.port || 5432;
        const errorCode = err.original ? err.original.code : err.code;
        const errorName = err.constructor.name;
        const originalErrorMsg = err.original ? err.original.message : err.message;
        
        console.error(`\n❌ ${modelName} 데이터베이스 연결 오류 발생`);
        console.error(`   에러 타입: ${errorName}`);
        console.error(`   에러 코드: ${errorCode || 'N/A'}`);
        console.error(`   에러 메시지: ${originalErrorMsg}`);
        console.error(`   연결 시도: ${targetHost}:${targetPort}`);
        console.error(`   데이터베이스: ${database}`);
        console.error(`   테이블: ${tableName || 'N/A'}`);
        
        if (connectionDiagnosis) {
            console.error(`   환경: ${connectionDiagnosis.connectionInfo.environment}`);
            console.error(`   진단 요약: ${connectionDiagnosis.diagnosis.summary}`);
            console.error(`   가장 가능성 높은 원인: ${connectionDiagnosis.diagnosis.mostLikelyCause}`);
            console.error(`\n   가능한 원인:`);
            connectionDiagnosis.diagnosis.possibleCauses.forEach((cause, index) => {
                console.error(`   ${index + 1}. [${cause.probability}] ${cause.cause}`);
                console.error(`      ${cause.description}`);
            });
        } else {
            // 연결 거부가 아닌 다른 연결 오류인 경우
            console.error(`   원인 분석:`);
            if (originalErrorMsg.toLowerCase().includes('timeout')) {
                console.error(`   - 연결 타임아웃: 데이터베이스 서버가 응답하지 않거나 네트워크가 느립니다.`);
            } else if (originalErrorMsg.toLowerCase().includes('enotfound') || originalErrorMsg.toLowerCase().includes('host not found')) {
                console.error(`   - 호스트를 찾을 수 없음: 호스트 주소(${targetHost})가 올바른지 확인하세요.`);
            } else if (originalErrorMsg.toLowerCase().includes('econnrefused')) {
                console.error(`   - 연결 거부: PostgreSQL 서버가 ${targetHost}:${targetPort}에서 실행 중인지 확인하세요.`);
            } else {
                console.error(`   - 연결 실패: 데이터베이스 서버 상태와 네트워크 연결을 확인하세요.`);
            }
            console.error(`   - 확인 사항:`);
            console.error(`     1. PostgreSQL 서버가 실행 중인지 확인`);
            console.error(`     2. 호스트 주소(${targetHost})와 포트(${targetPort})가 올바른지 확인`);
            console.error(`     3. 방화벽이나 네트워크 설정 확인`);
            console.error(`     4. Docker 환경인 경우 호스트 주소 설정 확인 (host.docker.internal 등)`);
        }
        console.error('');
        return; // 연결 오류는 여기서 처리 완료
    }
    
    // 외래키 제약 조건 위반 감지
    const isForeignKeyError = err.constructor.name.includes('ForeignKeyConstraintError') ||
                             errorMsg.includes('foreign key constraint') ||
                             errorMsg.includes('violates foreign key') ||
                             errorMsg.includes('is not present in table');
    
    if (isForeignKeyError) {
        // 외래키 제약 조건 위반 - 데이터베이스 이름만 간단히 표시
        console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: Foreign key constraint violation - Database: ${database}`);
        return; // 외래키 오류는 여기서 처리 완료
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
            const isCompositeKey = Array.isArray(primaryKey) && primaryKey.length > 1;
            
            console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: Primary key constraint violation`);
            console.error(`   Problem Source: ${errorClassification.description}`);
            console.error(`   Constraint Name: ${constraintName}`);
            console.error(`   Primary Key: ${keyDisplay}`);
            
            if (isCompositeKey) {
                console.error(`   Note: This is a composite primary key. The system will attempt to find the record using individual keys and update based on utime comparison.`);
            } else {
                console.error(`   Reason: The ${keyDisplay} value already exists in the database. The system will attempt to update the existing record based on utime comparison.`);
            }
            
            // 요청 본문에서 primary key 값 찾기
            const bodyData = req.body.new_data || req.body.data || req.body;
            if (bodyData) {
                if (Array.isArray(bodyData)) {
                    // 배열인 경우 복합 키 중복 확인
                    if (isCompositeKey) {
                        const duplicateKeys = [];
                        const seenKeys = new Set();
                        bodyData.forEach((item, index) => {
                            if (item && typeof item === 'object') {
                                const keyValues = primaryKey.map(key => item[key]).filter(v => v !== undefined && v !== null);
                                if (keyValues.length === primaryKey.length) {
                                    const keyStr = keyValues.join('|');
                                    if (seenKeys.has(keyStr)) {
                                        duplicateKeys.push({ index, values: keyValues });
                                    } else {
                                        seenKeys.add(keyStr);
                                    }
                                }
                            }
                        });
                        
                        if (duplicateKeys.length > 0) {
                            console.error(`   ⚠️  중복된 복합 키 값이 요청 배열에 포함되어 있습니다:`);
                            duplicateKeys.forEach(dup => {
                                const keyDisplay = primaryKey.map((key, i) => `${key}=${dup.values[i]}`).join(', ');
                                console.error(`      - 배열 인덱스 ${dup.index}: ${keyDisplay}`);
                            });
                        }
                        
                        // 첫 번째 항목의 primary key 값 표시
                        if (bodyData.length > 0 && bodyData[0] && typeof bodyData[0] === 'object') {
                            const firstItemKeys = primaryKey.map(key => {
                                const value = bodyData[0][key];
                                return value !== undefined ? `${key}=${value}` : null;
                            }).filter(v => v !== null);
                            if (firstItemKeys.length > 0) {
                                console.error(`   Attempted primary key values (first item): ${firstItemKeys.join(', ')}`);
                            }
                        }
                    } else {
                        // 단일 키인 경우 기존 로직
                        const duplicateKeys = [];
                        const seenKeys = new Set();
                        bodyData.forEach((item, index) => {
                            if (item && item[primaryKeyStr] !== undefined && item[primaryKeyStr] !== null) {
                                const keyValue = item[primaryKeyStr];
                                if (seenKeys.has(keyValue)) {
                                    duplicateKeys.push({ index, value: keyValue });
                                } else {
                                    seenKeys.add(keyValue);
                                }
                            }
                        });
                        
                        if (duplicateKeys.length > 0) {
                            console.error(`   ⚠️  중복된 ${primaryKeyStr} 값이 요청 배열에 포함되어 있습니다:`);
                            duplicateKeys.forEach(dup => {
                                console.error(`      - 배열 인덱스 ${dup.index}: ${primaryKeyStr} = ${dup.value}`);
                            });
                        }
                        
                        if (bodyData.length > 0 && bodyData[0] && bodyData[0][primaryKeyStr] !== undefined) {
                            console.error(`   Attempted ${primaryKeyStr} value (first item): ${bodyData[0][primaryKeyStr]}`);
                        }
                    }
                } else if (bodyData && typeof bodyData === 'object') {
                    // 단일 객체인 경우
                    if (isCompositeKey) {
                        const keyValues = primaryKey.map(key => {
                            const value = bodyData[key];
                            return value !== undefined ? `${key}=${value}` : null;
                        }).filter(v => v !== null);
                        if (keyValues.length > 0) {
                            console.error(`   Attempted primary key values: ${keyValues.join(', ')}`);
                        }
                    } else {
                        if (bodyData[primaryKeyStr] !== undefined) {
                            console.error(`   Attempted ${primaryKeyStr} value: ${bodyData[primaryKeyStr]}`);
                        }
                    }
                }
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
        
        // 누락된 필수 컬럼 확인
        const missingColumns = [];
        const invalidColumns = [];
        
        err.errors.forEach((validationError, index) => {
            const columnName = validationError.path || 'unknown';
            const errorType = validationError.type || 'N/A';
            
            console.error(`   [${index + 1}] Column: ${columnName}`);
            console.error(`       Value: ${validationError.value !== undefined && validationError.value !== null ? JSON.stringify(validationError.value) : 'null'}`);
            console.error(`       Error Type: ${errorType}`);
            console.error(`       Validator: ${validationError.validatorKey || validationError.validatorName || 'N/A'}`);
            console.error(`       Message: ${validationError.message}`);
            if (validationError.validatorArgs && validationError.validatorArgs.length > 0) {
                console.error(`       Validator Args: ${JSON.stringify(validationError.validatorArgs)}`);
            }
            
            // NOT NULL 제약 조건 위반인 경우
            if (errorType === 'notNull Violation' || 
                validationError.message?.toLowerCase().includes('cannot be null') ||
                validationError.message?.toLowerCase().includes('notnull violation')) {
                missingColumns.push(columnName);
            } else {
                invalidColumns.push({ column: columnName, reason: validationError.message });
            }
        });
        
        // 누락된 필수 컬럼 요약
        if (missingColumns.length > 0) {
            console.error(`\n   ⚠️  필수 컬럼 누락 (${missingColumns.length}개):`);
            missingColumns.forEach(col => {
                console.error(`      - ${col}: 필수 값이 누락되었습니다 (NOT NULL 제약 조건)`);
            });
        }
        
        // 유효하지 않은 컬럼 요약
        if (invalidColumns.length > 0) {
            console.error(`\n   ⚠️  유효하지 않은 컬럼 (${invalidColumns.length}개):`);
            invalidColumns.forEach(({ column, reason }) => {
                console.error(`      - ${column}: ${reason}`);
            });
        }
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
            // NOT NULL 제약 조건 위반 감지 (PostgreSQL 에러 메시지에서)
            const isNotNullError = errorMsg.includes('null value in column') ||
                                 errorMsg.includes('violates not-null constraint') ||
                                 errorMsg.includes('column') && errorMsg.includes('cannot be null');
            
            if (isNotNullError) {
                // 컬럼 이름 추출
                const columnMatch = errorMsg.match(/column ['"]([^'"]+)['"]/i) || 
                                   errorMsg.match(/column ([^\s]+)/i);
                const columnName = columnMatch ? columnMatch[1] : '알 수 없음';
                
                console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: Required column missing`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
                console.error(`   Error Message: ${errorMsg}`);
                console.error(`   Missing Column: ${columnName}`);
                console.error(`   Description: 필수 컬럼 '${columnName}'에 값이 제공되지 않았습니다 (NOT NULL 제약 조건)`);
                
                // 요청 본문에서 해당 컬럼 확인
                const bodyData = req.body.new_data || req.body.data || req.body;
                if (bodyData) {
                    const dataToCheck = Array.isArray(bodyData) ? bodyData[0] : bodyData;
                    if (dataToCheck && typeof dataToCheck === 'object') {
                        if (dataToCheck[columnName] === undefined) {
                            console.error(`   Status: 요청 데이터에 '${columnName}' 필드가 없습니다`);
                        } else if (dataToCheck[columnName] === null) {
                            console.error(`   Status: 요청 데이터에 '${columnName}' 필드가 null로 설정되어 있습니다`);
                        } else {
                            console.error(`   Status: 요청 데이터에 '${columnName}' 필드가 있지만 값이 유효하지 않습니다`);
                            console.error(`   Value: ${JSON.stringify(dataToCheck[columnName])}`);
                        }
                        
                        // 요청 데이터의 모든 필드 목록 출력 (디버깅용)
                        const providedFields = Object.keys(dataToCheck).filter(key => dataToCheck[key] !== null && dataToCheck[key] !== undefined);
                        console.error(`   Provided Fields (${providedFields.length}): ${providedFields.join(', ')}`);
                    }
                }
            } else {
                console.error(`ERROR: ${modelName} INSERT/UPDATE failed [${errorClassification.source}]: ${errorMsg}`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
            }
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
    let errorMsg = err.original ? err.original.message : err.message;
    errorMsg = simplifyConnectionLimitError(errorMsg);
    const errorCode = err.original ? err.original.code : err.code;
    const errorName = err.original ? err.original.name : err.name;
    
    const dbConfig = req.dbConfig || {};
    
    // 데이터베이스 이름 추출
    const database = dbConfig.database || '알 수 없음';
    
    // 테이블 이름 추출 (경로에서 추출 시도)
    let tableName = null;
    if (req.path) {
        // 경로에서 테이블 이름 추출 (예: /api/gastos -> gastos)
        const pathParts = req.path.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart !== 'api') {
            tableName = lastPart;
        }
    }
    
    // Telegram 알림 전송 (비동기, 에러는 무시)
    sendDatabaseErrorAlert(err, database, tableName, operation).catch(() => {
        // 알림 전송 실패는 조용히 무시 (데이터베이스 오류 처리에 영향 없음)
    });
    
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
    const targetHost = dbConfig.host || getDefaultDbHost();
    const targetPort = dbConfig.port || 5432;
    const connectionDiagnosis = diagnoseConnectionRefusedError(
        err, 
        targetHost, 
        targetPort
    );
    
    // 연결 오류인지 확인
    const errorClassification = classifyError(err);
    const isConnectionError = errorClassification.source === 'SERVER_DB' && 
                             errorClassification.description === 'Database connection problem';
    
    // 연결 오류인 경우 상세 정보 출력
    if (isConnectionError) {
        const originalErrorMsg = err.original ? err.original.message : err.message;
        console.error(`\n❌ 데이터베이스 연결 오류 발생 (${operation})`);
        console.error(`   에러 타입: ${errorName}`);
        console.error(`   에러 코드: ${errorCode || 'N/A'}`);
        console.error(`   에러 메시지: ${originalErrorMsg}`);
        console.error(`   연결 시도: ${targetHost}:${targetPort}`);
        console.error(`   데이터베이스: ${database}`);
        console.error(`   테이블: ${tableName || 'N/A'}`);
        
        if (connectionDiagnosis) {
            console.error(`   환경: ${connectionDiagnosis.connectionInfo.environment}`);
            console.error(`   진단 요약: ${connectionDiagnosis.diagnosis.summary}`);
            console.error(`   가장 가능성 높은 원인: ${connectionDiagnosis.diagnosis.mostLikelyCause}`);
            console.error(`\n   가능한 원인:`);
            connectionDiagnosis.diagnosis.possibleCauses.forEach((cause, index) => {
                console.error(`   ${index + 1}. [${cause.probability}] ${cause.cause}`);
                console.error(`      ${cause.description}`);
            });
        } else {
            // 연결 거부가 아닌 다른 연결 오류인 경우
            console.error(`   원인 분석:`);
            if (originalErrorMsg.toLowerCase().includes('timeout')) {
                console.error(`   - 연결 타임아웃: 데이터베이스 서버가 응답하지 않거나 네트워크가 느립니다.`);
            } else if (originalErrorMsg.toLowerCase().includes('enotfound') || originalErrorMsg.toLowerCase().includes('host not found')) {
                console.error(`   - 호스트를 찾을 수 없음: 호스트 주소(${targetHost})가 올바른지 확인하세요.`);
            } else if (originalErrorMsg.toLowerCase().includes('econnrefused')) {
                console.error(`   - 연결 거부: PostgreSQL 서버가 ${targetHost}:${targetPort}에서 실행 중인지 확인하세요.`);
            } else {
                console.error(`   - 연결 실패: 데이터베이스 서버 상태와 네트워크 연결을 확인하세요.`);
            }
            console.error(`   - 확인 사항:`);
            console.error(`     1. PostgreSQL 서버가 실행 중인지 확인`);
            console.error(`     2. 호스트 주소(${targetHost})와 포트(${targetPort})가 올바른지 확인`);
            console.error(`     3. 방화벽이나 네트워크 설정 확인`);
            console.error(`     4. Docker 환경인 경우 호스트 주소 설정 확인 (host.docker.internal 등)`);
        }
        console.error('');
    }
    
    // 외래키 제약 조건 위반 감지
    const isForeignKeyError = err.constructor.name.includes('ForeignKeyConstraintError') ||
                             errorMsg.includes('foreign key constraint') ||
                             errorMsg.includes('violates foreign key') ||
                             errorMsg.includes('is not present in table');
    
    // 기본 에러 메시지 생성
    let message = errorMsg;
    if (connectionDiagnosis) {
        // 연결 거부 오류인 경우 더 명확한 메시지
        message = `Database connection refused: ${connectionDiagnosis.diagnosis.summary}`;
    } else if (isConnectionError) {
        // 연결 오류인 경우 간단한 메시지
        message = `Database connection failed: ${errorMsg}`;
    } else if (isForeignKeyError) {
        // 외래키 오류인 경우 더 명확한 메시지
        const keyMatch = errorMsg.match(/Key \(([^)]+)\)=\(([^)]+)\)/i);
        const tableMatch = errorMsg.match(/is not present in table ['"]([^'"]+)['"]/i);
        if (keyMatch && tableMatch) {
            message = `Foreign key violation: Value '${keyMatch[2].trim()}' in column '${keyMatch[1].trim()}' does not exist in table '${tableMatch[1]}'`;
        }
    }
    
    // 원본 에러 메시지도 간소화 (details 필드용)
    const originalErrorMsg = err.original ? err.original.message : err.message;
    const simplifiedOriginalError = simplifyConnectionLimitError(originalErrorMsg);
    
    const errorResponse = {
        error: `Failed to ${operation}`,
        message: message,
        details: errorMsg,
        errorType: err.constructor.name,
        errorCode: errorCode,
        errorName: errorName,
        originalError: simplifiedOriginalError
    };
    
    // 연결 거부 오류인 경우 상세 진단 정보 추가 (해결 방법 제외)
    if (connectionDiagnosis) {
        // 해결 방법(recommendedSolutions)은 제외하고 진단 정보만 포함
        const { recommendedSolutions, ...diagnosisWithoutSolutions } = connectionDiagnosis.diagnosis;
        errorResponse.diagnosis = diagnosisWithoutSolutions;
        errorResponse.connectionInfo = connectionDiagnosis.connectionInfo;
        errorResponse.mostLikelyCause = connectionDiagnosis.diagnosis.mostLikelyCause;
    }
    
    // 외래키 제약 조건 위반인 경우 상세 정보 추가
    if (isForeignKeyError) {
        const keyMatch = errorMsg.match(/Key \(([^)]+)\)=\(([^)]+)\)/i);
        const tableMatch = errorMsg.match(/is not present in table ['"]([^'"]+)['"]/i) ||
                          errorMsg.match(/table ['"]([^'"]+)['"]/i);
        const constraintMatch = errorMsg.match(/constraint ['"]([^'"]+)['"]/i);
        
        if (keyMatch && tableMatch) {
            errorResponse.foreignKeyError = {
                column: keyMatch[1].trim(),
                value: keyMatch[2].trim(),
                referencedTable: tableMatch[1],
                constraintName: constraintMatch ? constraintMatch[1] : null
            };
        }
    }
    
    return errorResponse;
}

module.exports = { handleInsertUpdateError, buildDatabaseErrorResponse };

