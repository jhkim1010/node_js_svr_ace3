/**
 * 각 테이블별 특수 처리 로직 설정
 * 
 * 각 테이블의 특수한 요구사항을 정의합니다:
 * - usePrimaryKeyFirst: primary key로 먼저 조회할지 여부
 * - useUtimeComparison: utime 비교를 사용할지 여부
 * - retryWithAllUniqueKeys: INSERT 실패 시 모든 unique key로 재시도할지 여부
 * - skipOnUniqueConstraintError: unique constraint 에러 발생 시 skip할지 여부
 * - customHandler: 커스텀 핸들러 함수 (선택사항)
 */

const tableHandlerConfigs = {
    // Codigos: primary key 먼저 조회, utime 비교, unique constraint 에러 시 skip
    Codigos: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: true,
        logSkipReason: true
    },
    
    // Todocodigos: primary key 먼저 조회, utime 비교, unique constraint 에러 시 skip
    Todocodigos: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: true,
        logSkipReason: true
    },
    
    // Clientes: primary key 먼저 조회, utime 비교
    Clientes: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: false
    },
    
    // Color: primary key 먼저 조회, utime 비교
    Color: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: false
    },
    
    // Tipos: primary key 먼저 조회, utime 비교
    Tipos: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: false
    },
    
    // Gastos: primary key 먼저 조회, utime 비교
    Gastos: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: false
    },
    
    // Vtags: primary key 먼저 조회, utime 비교
    Vtags: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: false
    },
    
    // Ingresos: primary key 먼저 조회, utime 비교, 복합 unique key 지원
    Ingresos: {
        usePrimaryKeyFirst: true,
        useUtimeComparison: true,
        retryWithAllUniqueKeys: true,
        skipOnUniqueConstraintError: false,
        // 복합 unique key: ['ingreso_id', 'sucursal']
        preferredUniqueKeys: [['ingreso_id', 'sucursal']]
    },
    
    // Vcodes: 전용 핸들러 사용 (vcodes-handler.js)
    Vcodes: {
        useCustomHandler: true,
        handlerModule: './vcodes-handler'
    },
    
    // Vdetalle: 전용 핸들러 사용 (vdetalle-handler.js)
    Vdetalle: {
        useCustomHandler: true,
        handlerModule: './vdetalle-handler'
    },
    
    // 기본 설정 (설정되지 않은 테이블용)
    default: {
        usePrimaryKeyFirst: false,
        useUtimeComparison: false,
        retryWithAllUniqueKeys: false,
        skipOnUniqueConstraintError: false
    }
};

/**
 * 테이블별 설정 가져오기
 * @param {string} modelName - 모델 이름
 * @returns {Object} 테이블 설정
 */
function getTableHandlerConfig(modelName) {
    return tableHandlerConfigs[modelName] || tableHandlerConfigs.default;
}

/**
 * 테이블이 특수 처리 리스트에 포함되어 있는지 확인
 * @param {string} modelName - 모델 이름
 * @returns {boolean} 특수 처리 여부
 */
function requiresSpecialHandling(modelName) {
    const config = getTableHandlerConfig(modelName);
    return config.usePrimaryKeyFirst || config.useCustomHandler || false;
}

/**
 * 테이블이 커스텀 핸들러를 사용하는지 확인
 * @param {string} modelName - 모델 이름
 * @returns {boolean} 커스텀 핸들러 사용 여부
 */
function usesCustomHandler(modelName) {
    const config = getTableHandlerConfig(modelName);
    return config.useCustomHandler === true;
}

/**
 * 커스텀 핸들러 모듈 경로 가져오기
 * @param {string} modelName - 모델 이름
 * @returns {string|null} 핸들러 모듈 경로
 */
function getCustomHandlerModule(modelName) {
    const config = getTableHandlerConfig(modelName);
    return config.handlerModule || null;
}

module.exports = {
    tableHandlerConfigs,
    getTableHandlerConfig,
    requiresSpecialHandling,
    usesCustomHandler,
    getCustomHandlerModule
};

