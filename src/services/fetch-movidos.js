const { Sequelize } = require('sequelize');
const { parsePaginationParams, calculatePagination } = require('../utils/fetch-utils');

/**
 * movidos fetch 서비스
 * ingresos 테이블에서 bmovido가 true이고, sucursal이 일치하며, utime이 지정된 시간 이후인 레코드를 조회
 * 
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @param {Object} params - 파라미터 객체
 * @param {string} params.utimeMovidosFetch - utime 기준 시간 (예: '2026-01-01 00:00:00')
 * @param {number} params.sucursal - sucursal 값
 * @param {number} params.limit - 페이지당 레코드 수 (기본값: 100)
 * @param {number} params.offset - 오프셋 (기본값: 0)
 * @returns {Promise<Object>} { data, pagination }
 */
async function fetchMovidos(sequelize, params) {
    const { utimeMovidosFetch, sucursal, limit = 100, offset = 0 } = params;
    
    // 파라미터 검증
    if (!utimeMovidosFetch) {
        throw new Error('utime_movidos_fetch 파라미터가 필요합니다.');
    }
    
    if (sucursal === undefined || sucursal === null) {
        throw new Error('sucursal 파라미터가 필요합니다.');
    }
    
    const sucursalNum = parseInt(sucursal, 10);
    if (isNaN(sucursalNum)) {
        throw new Error('sucursal은 숫자여야 합니다.');
    }
    
    // SQL injection 방지를 위해 utime 값 이스케이프
    const escapedUtime = utimeMovidosFetch.replace(/'/g, "''");
    
    // 전체 개수 조회 쿼리
    const countQuery = `
        SELECT COUNT(*) as count
        FROM ingresos
        WHERE bmovido IS TRUE 
          AND sucursal = $1 
          AND utime > $2
    `;
    
    // 데이터 조회 쿼리
    const dataQuery = `
        SELECT *
        FROM ingresos
        WHERE bmovido IS TRUE 
          AND sucursal = $1 
          AND utime > $2
        ORDER BY utime ASC
        LIMIT $3 OFFSET $4
    `;
    
    try {
        // 전체 개수 조회
        const countResult = await sequelize.query(countQuery, {
            bind: [sucursalNum, escapedUtime],
            type: Sequelize.QueryTypes.SELECT
        });
        
        const totalCount = parseInt(countResult[0]?.count || 0, 10);
        
        // 데이터 조회
        const dataResult = await sequelize.query(dataQuery, {
            bind: [sucursalNum, escapedUtime, limit, offset],
            type: Sequelize.QueryTypes.SELECT
        });
        
        // 페이지네이션 정보 계산
        const pagination = calculatePagination(totalCount, limit, offset);
        
        return {
            data: dataResult,
            pagination
        };
    } catch (err) {
        console.error('[Fetch Movidos] 쿼리 실행 오류:', err.message);
        throw err;
    }
}

module.exports = {
    fetchMovidos
};

