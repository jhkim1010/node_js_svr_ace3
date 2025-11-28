/**
 * 연결 거부 오류의 원인을 상세히 분석
 * @param {Error} err - 발생한 에러
 * @param {string} host - 연결 시도한 호스트 주소
 * @param {number|string} port - 연결 시도한 포트
 * @returns {Object} 상세한 원인 분석 결과
 */
function diagnoseConnectionRefusedError(err, host = 'localhost', port = 5432) {
    const errorMessage = (err.original ? err.original.message : err.message) || '';
    const errorCode = (err.original ? err.original.code : err.code) || '';
    const lowerMessage = errorMessage.toLowerCase();
    
    // Docker 환경 감지
    let isDocker = false;
    try {
        const fs = require('fs');
        isDocker = process.env.DOCKER === 'true' || 
                   process.env.IN_DOCKER === 'true' ||
                   fs.existsSync('/.dockerenv') ||
                   process.env.HOSTNAME?.includes('docker') ||
                   process.cwd() === '/home/node/app';
    } catch (e) {
        // fs 모듈 로드 실패 시 환경 변수만 확인
        isDocker = process.env.DOCKER === 'true' || 
                   process.env.IN_DOCKER === 'true' ||
                   process.env.HOSTNAME?.includes('docker') ||
                   process.cwd() === '/home/node/app';
    }
    
    // 연결 거부 오류인지 확인
    const isConnectionRefused = errorCode === 'ECONNREFUSED' ||
                                lowerMessage.includes('econnrefused') ||
                                lowerMessage.includes('connection refused') ||
                                err.constructor.name.includes('ConnectionRefused');
    
    if (!isConnectionRefused) {
        return null;
    }
    
    // 호스트와 포트 정보 추출
    const targetHost = host || 'localhost';
    const targetPort = parseInt(port, 10) || 5432;
    
    // 가능한 원인 분석
    const possibleCauses = [];
    const solutions = [];
    
    // 1. Docker 환경에서 localhost 사용 문제
    if (isDocker && (targetHost === 'localhost' || targetHost === '127.0.0.1')) {
        possibleCauses.push({
            cause: 'Docker 환경에서 localhost 사용',
            description: 'Docker 컨테이너 내부에서 localhost는 컨테이너 자체를 가리킵니다. 호스트 머신의 PostgreSQL에 접근하려면 다른 주소를 사용해야 합니다.',
            probability: '높음'
        });
        solutions.push({
            solution: '호스트 주소 변경',
            description: 'Docker 환경에서는 host.docker.internal 또는 호스트의 실제 IP 주소를 사용하세요.',
            example: 'host.docker.internal 또는 172.17.0.1 (Docker 기본 브리지 네트워크)'
        });
    }
    
    // 2. PostgreSQL 서비스 미실행
    possibleCauses.push({
        cause: 'PostgreSQL 서비스가 실행되지 않음',
        description: `PostgreSQL이 ${targetHost}:${targetPort}에서 실행되고 있지 않습니다.`,
        probability: '매우 높음'
    });
    solutions.push({
        solution: 'PostgreSQL 서비스 시작',
        description: 'PostgreSQL 서비스를 시작하세요.',
        commands: {
            linux: 'sudo systemctl start postgresql',
            macos: 'brew services start postgresql',
            docker: 'docker-compose up -d postgres (또는 docker start <postgres-container>)'
        }
    });
    
    // 3. 잘못된 포트 번호
    if (targetPort !== 5432) {
        possibleCauses.push({
            cause: '잘못된 포트 번호',
            description: `PostgreSQL이 포트 ${targetPort}에서 실행되고 있지 않을 수 있습니다.`,
            probability: '중간'
        });
        solutions.push({
            solution: '포트 번호 확인',
            description: 'PostgreSQL이 실제로 실행 중인 포트를 확인하세요.',
            commands: {
                linux: 'sudo netstat -tlnp | grep postgres 또는 sudo ss -tlnp | grep postgres',
                macos: 'lsof -i -P | grep postgres',
                docker: 'docker ps 및 docker-compose.yml의 포트 설정 확인'
            }
        });
    }
    
    // 4. 방화벽/네트워크 문제
    possibleCauses.push({
        cause: '방화벽 또는 네트워크 설정 문제',
        description: '방화벽이 포트를 차단하거나 네트워크 설정이 잘못되었을 수 있습니다.',
        probability: '낮음'
    });
    solutions.push({
        solution: '방화벽 및 네트워크 확인',
        description: '방화벽 규칙과 네트워크 연결을 확인하세요.'
    });
    
    // 5. 잘못된 호스트 주소
    if (targetHost !== 'localhost' && targetHost !== '127.0.0.1' && !targetHost.includes('docker')) {
        possibleCauses.push({
            cause: '잘못된 호스트 주소',
            description: `호스트 주소 ${targetHost}에 접근할 수 없습니다.`,
            probability: '중간'
        });
        solutions.push({
            solution: '호스트 주소 확인',
            description: '호스트 주소가 올바른지, DNS가 올바르게 설정되어 있는지 확인하세요.',
            commands: {
                ping: `ping ${targetHost}`,
                nslookup: `nslookup ${targetHost}`
            }
        });
    }
    
    return {
        errorType: 'ConnectionRefused',
        errorCode: errorCode,
        errorMessage: errorMessage,
        connectionInfo: {
            host: targetHost,
            port: targetPort,
            environment: isDocker ? 'Docker' : 'Local'
        },
        diagnosis: {
            summary: isDocker && targetHost === 'localhost' 
                ? 'Docker 환경에서 localhost를 사용하여 호스트의 PostgreSQL에 접근할 수 없습니다.'
                : `PostgreSQL 서버에 연결할 수 없습니다. (${targetHost}:${targetPort})`,
            possibleCauses: possibleCauses,
            recommendedSolutions: solutions,
            mostLikelyCause: possibleCauses[0]?.cause || '알 수 없음'
        }
    };
}

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

module.exports = { classifyError, diagnoseConnectionRefusedError };

