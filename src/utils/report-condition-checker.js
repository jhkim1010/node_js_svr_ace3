const { Sequelize } = require('sequelize');

/**
 * 보고서 집계 쿼리 실행 여부를 결정하기 위한 조건 확인 유틸리티
 */

/**
 * empresas 테이블의 총 개수를 확인
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @returns {Promise<{count: number, shouldRun: boolean}>} 개수와 실행 여부
 */
async function checkCompanyCount(sequelize) {
    try {
        const checkCompanyCountQuery = `SELECT COUNT(*) as count FROM empresas`;
        const result = await sequelize.query(checkCompanyCountQuery, {
            type: Sequelize.QueryTypes.SELECT
        });
        const count = parseInt(result[0]?.count || 0);
        return {
            count,
            shouldRun: count >= 2
        };
    } catch (err) {
        console.error('[Report Condition Checker] Empresas 개수 확인 실패:', err.message);
        // 에러 발생 시 기본값으로 실행 허용
        return {
            count: 0,
            shouldRun: true
        };
    }
}

/**
 * tipos 테이블의 유효한 카테고리 개수를 확인
 * (tpdesc가 'NONE'이 아니고, 빈 문자열이 아니며, NULL이 아닌 경우)
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @returns {Promise<{count: number, shouldRun: boolean}>} 개수와 실행 여부
 */
async function checkCategoryCount(sequelize) {
    try {
        const checkCategoryCountQuery = `SELECT COUNT(*) as count FROM tipos WHERE tpdesc != 'NONE' AND tpdesc != '' AND tpdesc IS NOT NULL`;
        const result = await sequelize.query(checkCategoryCountQuery, {
            type: Sequelize.QueryTypes.SELECT
        });
        const count = parseInt(result[0]?.count || 0);
        return {
            count,
            shouldRun: count >= 2
        };
    } catch (err) {
        console.error('[Report Condition Checker] Tipos 개수 확인 실패:', err.message);
        // 에러 발생 시 기본값으로 실행 허용
        return {
            count: 0,
            shouldRun: true
        };
    }
}

/**
 * color 테이블의 유효한 색상 개수를 확인
 * (descripcioncolor가 'UNICO'가 아니고, NULL이 아니며, idcolor가 빈 문자열이 아닌 경우)
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @returns {Promise<{count: number, shouldRun: boolean}>} 개수와 실행 여부
 */
async function checkColorCount(sequelize) {
    try {
        const checkColorCountQuery = `SELECT COUNT(*) as count FROM color c WHERE c.descripcioncolor != 'UNICO' AND descripcioncolor IS NOT NULL AND c.idcolor != ''`;
        const result = await sequelize.query(checkColorCountQuery, {
            type: Sequelize.QueryTypes.SELECT
        });
        const count = parseInt(result[0]?.count || 0);
        return {
            count,
            shouldRun: count >= 2
        };
    } catch (err) {
        console.error('[Report Condition Checker] Color 개수 확인 실패:', err.message);
        // 에러 발생 시 기본값으로 실행 허용
        return {
            count: 0,
            shouldRun: true
        };
    }
}

/**
 * 모든 보고서 조건을 한번에 확인
 * @param {Sequelize} sequelize - Sequelize 인스턴스
 * @param {Object} options - 옵션
 * @param {boolean} options.logResults - 결과를 로그로 출력할지 여부 (기본값: false)
 * @param {string} options.logPrefix - 로그 접두사 (기본값: '보고서')
 * @returns {Promise<{company: {count: number, shouldRun: boolean}, category: {count: number, shouldRun: boolean}, color: {count: number, shouldRun: boolean}}>}
 */
async function checkAllReportConditions(sequelize, options = {}) {
    const { logResults = false, logPrefix = '보고서' } = options;

    try {
        const [companyResult, categoryResult, colorResult] = await Promise.all([
            checkCompanyCount(sequelize),
            checkCategoryCount(sequelize),
            checkColorCount(sequelize)
        ]);

        if (logResults) {
            console.log(`[${logPrefix}] 조건 확인:`);
            console.log(`   Empresas 개수: ${companyResult.count} (${companyResult.shouldRun ? '실행' : '건너뜀'})`);
            console.log(`   Tipos 개수: ${categoryResult.count} (${categoryResult.shouldRun ? '실행' : '건너뜀'})`);
            console.log(`   Color 개수: ${colorResult.count} (${colorResult.shouldRun ? '실행' : '건너뜀'})`);
        }

        return {
            company: companyResult,
            category: categoryResult,
            color: colorResult
        };
    } catch (err) {
        console.error(`[${logPrefix}] 조건 확인 실패:`, err.message);
        // 에러 발생 시 기본값으로 모든 조건 실행 허용
        return {
            company: { count: 0, shouldRun: true },
            category: { count: 0, shouldRun: true },
            color: { count: 0, shouldRun: true }
        };
    }
}

/**
 * 그룹핑 결과에서 제외할 이름 여부 (category/color 이름이 NONE 또는 비어있는 경우)
 * @param {string|null|undefined} name - CategoryName 또는 ColorName
 * @returns {boolean} true면 제외
 */
function isExcludedCategoryOrColorName(name) {
    if (name == null) return true;
    const s = String(name).trim();
    return s === '' || s.toUpperCase() === 'NONE';
}

module.exports = {
    checkCompanyCount,
    checkCategoryCount,
    checkColorCount,
    checkAllReportConditions,
    isExcludedCategoryOrColorName
};

