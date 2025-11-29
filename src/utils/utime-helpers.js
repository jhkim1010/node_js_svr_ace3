// utime 관련 헬퍼 함수들
const { Sequelize } = require('sequelize');

/**
 * utime 값을 문자열로 변환 (timezone 변환 없음)
 * @param {Date|string} utime - utime 값 (Date 객체 또는 문자열)
 * @returns {string|null} 변환된 utime 문자열 또는 null
 */
function convertUtimeToString(utime) {
    if (!utime) return null;
    
    if (utime instanceof Date) {
        // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
        // YYYY-MM-DD HH:mm:ss.SSS 형식으로 변환
        const year = utime.getFullYear();
        const month = String(utime.getMonth() + 1).padStart(2, '0');
        const day = String(utime.getDate()).padStart(2, '0');
        const hours = String(utime.getHours()).padStart(2, '0');
        const minutes = String(utime.getMinutes()).padStart(2, '0');
        const seconds = String(utime.getSeconds()).padStart(2, '0');
        const ms = String(utime.getMilliseconds()).padStart(3, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
    } else {
        // 문자열인 경우 ISO 8601 형식의 'T'를 공백으로 변환하여 통일된 형식으로 비교
        // "2025-11-27T19:20:52.615" -> "2025-11-27 19:20:52.615"
        let utimeStr = String(utime);
        // 'T'를 공백으로 변환 (ISO 8601 형식 처리)
        utimeStr = utimeStr.replace(/T/, ' ');
        // 시간대 정보 제거 (Z, +09:00 등)
        utimeStr = utimeStr.replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
        return utimeStr.trim();
    }
}

/**
 * utime을 Sequelize.literal로 변환하여 저장 (timezone 변환 방지)
 * @param {Date|string} utime - utime 값
 * @returns {Object} Sequelize.literal 객체
 */
function convertUtimeToSequelizeLiteral(utime) {
    if (!utime) return null;
    
    const utimeStr = convertUtimeToString(utime);
    if (!utimeStr) return null;
    
    return Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
}

/**
 * 레코드에서 utime 문자열 추출
 * @param {Object} record - 데이터베이스 레코드 (raw: true)
 * @param {Object} Model - Sequelize 모델
 * @param {Object} whereCondition - WHERE 조건
 * @param {Object} transaction - 트랜잭션 객체
 * @returns {Promise<string|null>} utime 문자열 또는 null
 */
async function extractUtimeStringFromRecord(record, Model, whereCondition, transaction) {
    if (!record) return null;
    
    // utime_str 필드가 있으면 사용 (Sequelize.literal로 가져온 값)
    if (record.utime_str) {
        return String(record.utime_str).trim();
    }
    
    // utime 필드가 있는 경우
    if (record.utime) {
        if (record.utime instanceof Date) {
            // Date 객체인 경우 - 원본 데이터베이스 값을 가져오기 위해 다시 조회
            const rawRecord = await Model.findOne({ 
                where: whereCondition, 
                transaction,
                attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                raw: true
            });
            if (rawRecord && rawRecord.utime) {
                return String(rawRecord.utime).trim();
            }
        } else {
            // 문자열인 경우 그대로 사용 (timezone 변환 없음)
            return String(record.utime).trim();
        }
    }
    
    return null;
}

/**
 * utime 비교하여 업데이트 여부 결정
 * @param {string|null} clientUtimeStr - 클라이언트 utime 문자열
 * @param {string|null} serverUtimeStr - 서버 utime 문자열
 * @returns {boolean} 업데이트 여부
 */
function shouldUpdateBasedOnUtime(clientUtimeStr, serverUtimeStr) {
    if (!clientUtimeStr && !serverUtimeStr) {
        // 둘 다 utime이 없으면 업데이트
        return true;
    } else if (clientUtimeStr && !serverUtimeStr) {
        // 클라이언트에만 utime이 있으면 업데이트
        return true;
    } else if (clientUtimeStr && serverUtimeStr) {
        // 둘 다 utime이 있으면 문자열 직접 비교 (timezone 변환 없음)
        return clientUtimeStr > serverUtimeStr;
    } else {
        // 서버에만 utime이 있으면 업데이트하지 않음
        return false;
    }
}

module.exports = {
    convertUtimeToString,
    convertUtimeToSequelizeLiteral,
    extractUtimeStringFromRecord,
    shouldUpdateBasedOnUtime
};

