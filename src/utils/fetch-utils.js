/**
 * Fetch 관련 공통 유틸리티 함수들
 */

/**
 * 페이지네이션 정보 계산
 * @param {number} totalCount - 전체 레코드 수
 * @param {number} limit - 페이지당 레코드 수
 * @param {number} offset - 현재 오프셋
 * @returns {Object} 페이지네이션 정보
 */
function calculatePagination(totalCount, limit, offset) {
    const currentPage = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = offset + limit < totalCount;
    
    return {
        count: Math.min(limit, totalCount - offset), // 현재 페이지의 실제 레코드 수
        total: totalCount,
        currentPage,
        totalPages,
        hasMore,
        limit,
        offset
    };
}

/**
 * 페이지네이션 파라미터 검증 및 기본값 설정
 * @param {Object} query - 요청 쿼리 파라미터
 * @param {number} defaultLimit - 기본 limit 값
 * @param {number} maxLimit - 최대 limit 값
 * @returns {Object} { limit, offset, page }
 */
function parsePaginationParams(query, defaultLimit = 100, maxLimit = 1000) {
    let limit = parseInt(query.limit || query.page_size || defaultLimit, 10);
    let page = parseInt(query.page || query.page_number || 1, 10);
    
    // limit 검증
    if (isNaN(limit) || limit < 1) {
        limit = defaultLimit;
    }
    if (limit > maxLimit) {
        limit = maxLimit;
    }
    
    // page 검증
    if (isNaN(page) || page < 1) {
        page = 1;
    }
    
    const offset = (page - 1) * limit;
    
    return { limit, offset, page };
}

module.exports = {
    calculatePagination,
    parsePaginationParams
};

