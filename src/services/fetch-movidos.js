const { Sequelize } = require('sequelize');
const { calculatePagination } = require('../utils/fetch-utils');

/**
 * movidos fetch 서비스
 * ingresos 테이블에서 bmovido가 true이고, sucursal이 일치하며, utime이 지정된 시간 이후이고,
 * ref_vcode가 prefix로 시작하지 않는 레코드를 조회 (prefix 기준 제외)
 * ID 기반 페이지네이션 또는 utime 기반 페이지네이션 지원
 *
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @param {Object} params - 파라미터 객체
 * @param {string} params.lastGetUtime - utime 기준 시간 (예: '2026-03-06 12:00:00'), last_get_utime 우선
 * @param {string} params.utimeMovidosFetch - utime 기준 시간 (lastGetUtime 없을 때 사용)
 * @param {string} params.prefix - ref_vcode NOT LIKE prefix% 로 제외할 접두사 (예: 'LOCAL2')
 * @param {number} params.idIngreso - ID 기반 페이지네이션용 ingreso_id (선택적)
 * @param {number} params.sucursal - sucursal 값
 * @param {number} params.limit - 페이지당 레코드 수 (기본값: 20)
 * @param {number} params.offset - 오프셋 (기본값: 0, ID 기반 페이지네이션 사용 시 무시됨)
 * @returns {Promise<Object>} { data, pagination }
 */
async function fetchMovidos(sequelize, params) {
    const {
        lastGetUtime,
        utimeMovidosFetch,
        prefix,
        idIngreso,
        sucursal,
        limit = 20,
        offset = 0
    } = params;

    const utimeFilter = lastGetUtime ?? utimeMovidosFetch;

    // 파라미터 검증: ID 기반 페이지네이션을 쓰지 않으면 utime 필터 필수
    if (!idIngreso && !utimeFilter) {
        throw new Error('utime_movidos_fetch 또는 last_get_utime 파라미터가 필요합니다. 또는 ingreso_id를 사용한 ID 기반 페이지네이션을 사용하세요.');
    }

    if (sucursal === undefined || sucursal === null) {
        throw new Error('sucursal 파라미터가 필요합니다.');
    }

    const sucursalNum = parseInt(sucursal, 10);
    if (isNaN(sucursalNum)) {
        throw new Error('sucursal은 숫자여야 합니다.');
    }

    const useIdPagination = !!idIngreso;

    // WHERE: bmovido IS TRUE, sucursal, (선택) ref_vcode NOT LIKE prefix%, utime > ?, (선택) ingreso_id > ?
    const whereConditions = ['bmovido IS TRUE', 'sucursal = $1'];
    const bindParams = [sucursalNum];
    let paramIndex = 2;

    if (prefix != null && String(prefix).trim() !== '') {
        const pattern = String(prefix).trim() + '%';
        whereConditions.push(`ref_vcode NOT LIKE $${paramIndex}`);
        bindParams.push(pattern);
        paramIndex++;
    }

    if (useIdPagination) {
        const idIngresoNum = parseInt(idIngreso, 10);
        if (isNaN(idIngresoNum)) {
            throw new Error('ingreso_id는 숫자여야 합니다.');
        }
        whereConditions.push(`ingreso_id > $${paramIndex}`);
        bindParams.push(idIngresoNum);
        paramIndex++;
    }

    if (utimeFilter) {
        whereConditions.push(`utime > $${paramIndex}`);
        bindParams.push(String(utimeFilter).trim());
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

