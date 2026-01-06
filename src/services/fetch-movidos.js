const { Sequelize } = require('sequelize');
const { parsePaginationParams, calculatePagination } = require('../utils/fetch-utils');

/**
 * movidos fetch 서비스
 * ingresos 테이블에서 bmovido가 true이고, sucursal이 일치하며, utime이 지정된 시간 이후인 레코드를 조회
 * ID 기반 페이지네이션 또는 utime 기반 페이지네이션 지원
 * 
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @param {Object} params - 파라미터 객체
 * @param {string} params.utimeMovidosFetch - utime 기준 시간 (ID 기반 페이지네이션 사용 시 선택적, 예: '2026-01-01 00:00:00')
 * @param {number} params.idIngreso - ID 기반 페이지네이션용 ingreso_id (선택적)
 * @param {number} params.sucursal - sucursal 값
 * @param {number} params.limit - 페이지당 레코드 수 (기본값: 100)
 * @param {number} params.offset - 오프셋 (기본값: 0, ID 기반 페이지네이션 사용 시 무시됨)
 * @returns {Promise<Object>} { data, pagination }
 */
async function fetchMovidos(sequelize, params) {
    const { utimeMovidosFetch, idIngreso, sucursal, limit = 100, offset = 0 } = params;
    
    // 파라미터 검증
    // ID 기반 페이지네이션을 사용하지 않는 경우에만 utimeMovidosFetch가 필수
    if (!idIngreso && !utimeMovidosFetch) {
        throw new Error('utime_movidos_fetch 파라미터가 필요합니다. 또는 ingreso_id를 사용한 ID 기반 페이지네이션을 사용하세요.');
    }
    
    if (sucursal === undefined || sucursal === null) {
        throw new Error('sucursal 파라미터가 필요합니다.');
    }
    
    const sucursalNum = parseInt(sucursal, 10);
    if (isNaN(sucursalNum)) {
        throw new Error('sucursal은 숫자여야 합니다.');
    }
    
    // ID 기반 페이지네이션 사용 여부 확인
    const useIdPagination = !!idIngreso;
    
    // WHERE 조건 구성
    let whereConditions = ['bmovido IS TRUE', 'sucursal = $1'];
    let bindParams = [sucursalNum];
    let paramIndex = 2;
    
    // ID 기반 페이지네이션 사용 시
    if (useIdPagination) {
        const idIngresoNum = parseInt(idIngreso, 10);
        if (isNaN(idIngresoNum)) {
            throw new Error('ingreso_id는 숫자여야 합니다.');
        }
        whereConditions.push(`ingreso_id > $${paramIndex}`);
        bindParams.push(idIngresoNum);
        paramIndex++;
    }
    
    // utime 필터 추가 (utimeMovidosFetch가 제공된 경우)
    if (utimeMovidosFetch) {
        // SQL injection 방지를 위해 utime 값 이스케이프
        const escapedUtime = utimeMovidosFetch.replace(/'/g, "''");
        whereConditions.push(`utime > $${paramIndex}`);
        bindParams.push(escapedUtime);
        paramIndex++;
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    // 정렬: ID 기반 페이지네이션 사용 시 ingreso_id로, 그 외에는 utime으로 정렬
    const orderBy = useIdPagination ? 'ingreso_id ASC' : 'utime ASC';
    
    // 전체 개수 조회 쿼리 (ID 기반 페이지네이션 사용 시에는 정확한 개수 계산 불가, 대략적인 값만 반환)
    const countQuery = `
        SELECT COUNT(*) as count
        FROM ingresos
        WHERE ${whereClause}
    `;
    
    // 데이터 조회 쿼리
    // ID 기반 페이지네이션 사용 시 limit + 1개 조회하여 hasMore 확인
    const queryLimit = useIdPagination ? limit + 1 : limit;
    const dataQuery = `
        SELECT *
        FROM ingresos
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    try {
        let totalCount = null;
        
        // utime 기반 페이지네이션 사용 시에만 전체 개수 조회 (ID 기반 페이지네이션은 정확한 개수 계산 불가)
        if (!useIdPagination) {
            const countResult = await sequelize.query(countQuery, {
                bind: bindParams,
                type: Sequelize.QueryTypes.SELECT
            });
            totalCount = parseInt(countResult[0]?.count || 0, 10);
        }
        
        // 데이터 조회
        const bindParamsForQuery = [...bindParams, queryLimit, offset];
        const dataResult = await sequelize.query(dataQuery, {
            bind: bindParamsForQuery,
            type: Sequelize.QueryTypes.SELECT
        });
        
        // ID 기반 페이지네이션 사용 시 hasMore 확인 및 데이터 조정
        let finalData = dataResult;
        let hasMore = false;
        let nextIdIngreso = null;
        
        if (useIdPagination) {
            hasMore = dataResult.length > limit;
            finalData = hasMore ? dataResult.slice(0, limit) : dataResult;
            
            // 다음 요청을 위한 ingreso_id 계산 (마지막 레코드의 ingreso_id)
            if (finalData.length > 0) {
                const lastRecord = finalData[finalData.length - 1];
                if (lastRecord.ingreso_id !== null && lastRecord.ingreso_id !== undefined) {
                    nextIdIngreso = lastRecord.ingreso_id;
                }
            }
        }
        
        // 페이지네이션 정보 계산
        let pagination;
        if (useIdPagination) {
            pagination = {
                count: finalData.length,
                hasMore: hasMore,
                ingreso_id: nextIdIngreso
            };
        } else {
            pagination = calculatePagination(totalCount, limit, offset);
        }
        
        return {
            data: finalData,
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

