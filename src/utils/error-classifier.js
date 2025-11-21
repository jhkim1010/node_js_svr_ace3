/**
 * 에러의 원인을 분석하여 클라이언트 데이터 문제인지 서버 DB 문제인지 구별
 */
function classifyError(err) {
    const errorName = err.constructor.name;
    const errorMessage = (err.original ? err.original.message : err.message) || '';
    const lowerMessage = errorMessage.toLowerCase();
    
    // Validation error - 클라이언트 데이터 문제
    if (errorName === 'SequelizeValidationError' || errorName === 'ValidationError') {
        return {
            source: 'CLIENT_DATA',
            description: 'Client data validation failed',
            reason: 'The data sent from client does not meet the validation requirements'
        };
    }
    
    // Connection errors - 서버 DB 문제
    if (errorName.includes('Connection') || 
        errorName.includes('ConnectionError') ||
        errorName.includes('ConnectionRefused') ||
        errorName.includes('HostNotFound') ||
        errorName.includes('HostNotReachable') ||
        errorName.includes('ConnectionTimedOut') ||
        lowerMessage.includes('connection') ||
        lowerMessage.includes('connect econnrefused') ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('network') ||
        lowerMessage.includes('host') ||
        lowerMessage.includes('refused')) {
        return {
            source: 'SERVER_DB',
            description: 'Database connection problem',
            reason: 'Cannot connect to the database server or network issue'
        };
    }
    
    // Constraint violations - 대부분 클라이언트 데이터 문제 (중복, 외래키 등)
    if (errorName.includes('UniqueConstraintError') ||
        errorName.includes('ForeignKeyConstraintError') ||
        errorName.includes('CheckConstraintError') ||
        errorName.includes('ExclusionConstraintError') ||
        lowerMessage.includes('unique constraint') ||
        lowerMessage.includes('duplicate key') ||
        lowerMessage.includes('foreign key constraint') ||
        lowerMessage.includes('violates foreign key') ||
        lowerMessage.includes('violates check constraint') ||
        lowerMessage.includes('already exists')) {
        return {
            source: 'CLIENT_DATA',
            description: 'Database constraint violation',
            reason: 'The data violates database constraints (unique, foreign key, etc.)'
        };
    }
    
    // Database errors - 서버 DB 문제
    if (errorName.includes('DatabaseError') ||
        errorName.includes('QueryError') ||
        errorName.includes('TimeoutError') ||
        lowerMessage.includes('syntax error') ||
        lowerMessage.includes('relation') && lowerMessage.includes('does not exist') ||
        lowerMessage.includes('column') && lowerMessage.includes('does not exist') ||
        lowerMessage.includes('permission denied') ||
        lowerMessage.includes('insufficient privilege')) {
        return {
            source: 'SERVER_DB',
            description: 'Database server error',
            reason: 'Database server returned an error (schema, permissions, query syntax, etc.)'
        };
    }
    
    // Empty value errors - 클라이언트 데이터 문제
    if (lowerMessage.includes('cannot be null') ||
        lowerMessage.includes('notnull violation') ||
        lowerMessage.includes('required')) {
        return {
            source: 'CLIENT_DATA',
            description: 'Required field missing',
            reason: 'Required field is missing or null in the client data'
        };
    }
    
    // Type errors - 클라이언트 데이터 문제
    if (errorName.includes('TypeError') ||
        lowerMessage.includes('invalid input') ||
        lowerMessage.includes('invalid value') ||
        lowerMessage.includes('type mismatch')) {
        return {
            source: 'CLIENT_DATA',
            description: 'Data type mismatch',
            reason: 'The data type does not match the expected type'
        };
    }
    
    // 기타 에러는 서버 DB 문제로 간주
    return {
        source: 'SERVER_DB',
        description: 'Unknown database error',
        reason: 'An unexpected error occurred, likely a server-side database issue'
    };
}

module.exports = { classifyError };

