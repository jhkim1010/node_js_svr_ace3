// utime 비교를 통한 레코드 조회 및 처리 헬퍼 함수들
const { Sequelize } = require('sequelize');
const { buildWhereCondition } = require('./batch-sync-handler');
const { convertUtimeToString, convertUtimeToSequelizeLiteral, extractUtimeStringFromRecord, shouldUpdateBasedOnUtime } = require('./utime-helpers');
const { logInfoWithLocation } = require('./log-utils');

/** utime 비교용 최소 attributes: PK + utime_str (일부 DB에 없는 컬럼 선택 방지) */
function getMinimalUtimeAttributes(Model) {
    const pk = Model.primaryKeyAttributes && Model.primaryKeyAttributes.length
        ? Model.primaryKeyAttributes
        : (Model.primaryKeyAttribute ? [Model.primaryKeyAttribute] : []);
    return [...pk, [Sequelize.literal('utime::text'), 'utime_str']];
}

/**
 * Primary key로 레코드 조회
 * @param {Object} Model - Sequelize 모델
 * @param {Object} filteredItem - 필터링된 데이터
 * @param {string|Array} primaryKey - Primary key
 * @param {Object} transaction - 트랜잭션 객체
 * @returns {Promise<Object|null>} 레코드 또는 null
 */
async function findRecordByPrimaryKey(Model, filteredItem, primaryKey, transaction) {
    if (!primaryKey) return null;
    
    const primaryKeyValue = Array.isArray(primaryKey) 
        ? primaryKey.map(key => filteredItem[key]).filter(v => v !== undefined && v !== null)
        : filteredItem[primaryKey];
    
    if (!primaryKeyValue) return null;
    
    const primaryKeyWhere = Array.isArray(primaryKey)
        ? primaryKey.reduce((acc, key) => {
            if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                acc[key] = filteredItem[key];
            }
            return acc;
        }, {})
        : { [primaryKey]: filteredItem[primaryKey] };
    
    return await Model.findOne({ 
        where: primaryKeyWhere, 
        transaction,
        attributes: getMinimalUtimeAttributes(Model),
        raw: true
    });
}

/**
 * 레코드를 업데이트하고 결과 반환
 * @param {Object} Model - Sequelize 모델
 * @param {Object} filteredItem - 필터링된 데이터
 * @param {Object} whereCondition - WHERE 조건
 * @param {string|Array} keysToRemove - 업데이트 데이터에서 제거할 키들
 * @param {Object} transaction - 트랜잭션 객체
 * @returns {Promise<Object>} 업데이트된 레코드
 */
async function updateRecord(Model, filteredItem, whereCondition, keysToRemove, transaction) {
    const updateData = { ...filteredItem };
    const keysToRemoveArray = Array.isArray(keysToRemove) ? keysToRemove : [keysToRemove];
    keysToRemoveArray.forEach(key => delete updateData[key]);
    
    // utime을 문자열로 보장하여 timezone 변환 방지
    if (updateData.utime) {
        updateData.utime = convertUtimeToSequelizeLiteral(updateData.utime);
    }
    
    await Model.update(updateData, { where: whereCondition, transaction });
    return await Model.findOne({
        where: whereCondition,
        transaction,
        attributes: getMinimalUtimeAttributes(Model),
        raw: true
    });
}

/**
 * 레코드를 조회하고 utime 비교를 수행하여 업데이트 또는 스킵 결정
 * @param {Object} Model - Sequelize 모델
 * @param {Object} filteredItem - 필터링된 데이터
 * @param {string|null} clientUtimeStr - 클라이언트 utime 문자열
 * @param {Object} whereCondition - WHERE 조건
 * @param {string|Array} keysToRemove - 업데이트 데이터에서 제거할 키들
 * @param {Object} transaction - 트랜잭션 객체
 * @param {string} savepointName - SAVEPOINT 이름
 * @param {Object} sequelize - Sequelize 인스턴스
 * @returns {Promise<Object>} 처리 결과 { action: 'updated'|'skipped', data, serverUtime, clientUtime }
 */
async function processRecordWithUtimeComparison(
    Model, 
    filteredItem, 
    clientUtimeStr, 
    whereCondition, 
    keysToRemove, 
    transaction, 
    savepointName, 
    sequelize
) {
    let record;
    if (Model.name === 'Ingresos') {
        logInfoWithLocation(`[Ingresos DEBUG] processRecordWithUtimeComparison | findOne 직전 | where=${JSON.stringify(whereCondition)}`);
    }
    try {
        record = await Model.findOne({
            where: whereCondition,
            transaction,
            attributes: getMinimalUtimeAttributes(Model),
            raw: true
        });
    } catch (findErr) {
        if (Model.name === 'Ingresos') {
            const c = findErr?.original?.code || findErr?.code;
            const msg = (findErr?.original?.message || findErr?.message || '').slice(0, 150);
            logInfoWithLocation(`[Ingresos DEBUG] processRecordWithUtimeComparison | findOne 예외 | code=${c} | message=${msg}`);
            if (c === '25P02') {
                logInfoWithLocation(`[Ingresos DEBUG] 25P02 가능 원인: 1)이 연결이 이미 중단된 상태로 풀에서 나옴 2)동일 연결을 다른 요청이 사용 중 3)트랜잭션과 쿼리 연결 불일치`);
            }
        }
        throw findErr;
    }
    if (Model.name === 'Ingresos' && record != null) {
        logInfoWithLocation(`[Ingresos DEBUG] processRecordWithUtimeComparison | findOne 성공 (record 있음)`);
    }

    if (!record) {
        if (Model.name === 'Ingresos') {
            const idPart = filteredItem.ingreso_id != null || filteredItem.sucursal != null
                ? `ingreso_id=${filteredItem.ingreso_id}, sucursal=${filteredItem.sucursal}`
                : JSON.stringify(whereCondition);
            logInfoWithLocation(`[Ingresos DEBUG] processRecordWithUtimeComparison | not_found | where=${idPart} | client_utime=${clientUtimeStr || 'null'}`);
        }
        return { action: 'not_found', data: null };
    }

    const serverUtimeStr = await extractUtimeStringFromRecord(record, Model, whereCondition, transaction);
    const shouldUpdate = shouldUpdateBasedOnUtime(clientUtimeStr, serverUtimeStr);

    if (Model.name === 'Ingresos') {
        const idPart = filteredItem.ingreso_id != null || filteredItem.sucursal != null
            ? `ingreso_id=${filteredItem.ingreso_id}, sucursal=${filteredItem.sucursal}`
            : JSON.stringify(whereCondition);
        logInfoWithLocation(`[Ingresos DEBUG] processRecordWithUtimeComparison | record found | ${idPart} | client_utime=${clientUtimeStr || 'null'} | server_utime=${serverUtimeStr || 'null'} | shouldUpdate=${shouldUpdate} → action=${shouldUpdate ? 'updated' : 'skipped'}`);
    }

    if (shouldUpdate) {
        const updated = await updateRecord(Model, filteredItem, whereCondition, keysToRemove, transaction);
        if (savepointName) {
            try {
                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
            } catch (releaseErr) {
                // 무시
            }
        }
        return {
            action: 'updated',
            data: updated,
            serverUtime: serverUtimeStr,
            clientUtime: clientUtimeStr
        };
    } else {
        if (savepointName) {
            try {
                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
            } catch (releaseErr) {
                // 무시
            }
        }
        return {
            action: 'skipped',
            reason: 'server_utime_newer',
            data: record,
            serverUtime: serverUtimeStr,
            clientUtime: clientUtimeStr
        };
    }
}

/**
 * Primary key 충돌 시 레코드를 조회하고 utime 비교 수행
 * @param {Object} Model - Sequelize 모델
 * @param {Object} filteredItem - 필터링된 데이터
 * @param {string|null} clientUtimeStr - 클라이언트 utime 문자열
 * @param {string|Array} primaryKey - Primary key
 * @param {string|Array} availableUniqueKey - Available unique key (optional)
 * @param {Object} whereCondition - WHERE 조건 (availableUniqueKey용, optional)
 * @param {Object} transaction - 트랜잭션 객체
 * @param {string} savepointName - SAVEPOINT 이름
 * @param {Object} sequelize - Sequelize 인스턴스
 * @returns {Promise<Object>} 처리 결과 { action: 'updated'|'skipped'|'not_found', data, serverUtime, clientUtime }
 */
async function handlePrimaryKeyConflict(
    Model,
    filteredItem,
    clientUtimeStr,
    primaryKey,
    availableUniqueKey,
    whereCondition,
    transaction,
    savepointName,
    sequelize
) {
    // Primary key로 먼저 조회
    let retryRecord = await findRecordByPrimaryKey(Model, filteredItem, primaryKey, transaction);
    let updateWhere = null;
    let keysToRemove = null;
    
    if (retryRecord) {
        // Primary key로 레코드를 찾았으면 primary key로 업데이트
        const primaryKeyWhere = Array.isArray(primaryKey)
            ? primaryKey.reduce((acc, key) => {
                if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                    acc[key] = filteredItem[key];
                }
                return acc;
            }, {})
            : { [primaryKey]: filteredItem[primaryKey] };
        updateWhere = primaryKeyWhere;
        keysToRemove = primaryKey;
    } else if (availableUniqueKey) {
        // Primary key로 찾지 못했으면 availableUniqueKey로 시도
        retryRecord = Array.isArray(availableUniqueKey)
            ? await Model.findOne({
                where: whereCondition,
                transaction,
                attributes: getMinimalUtimeAttributes(Model),
                raw: true
            })
            : await Model.findByPk(filteredItem[availableUniqueKey], {
                transaction,
                attributes: getMinimalUtimeAttributes(Model),
                raw: true
            });
        
        if (retryRecord) {
            updateWhere = whereCondition;
            keysToRemove = availableUniqueKey;
        }
    }
    
    if (!retryRecord || !updateWhere) {
        return { action: 'not_found', data: null };
    }
    
    // 서버 utime 추출
    const serverUtimeStr = await extractUtimeStringFromRecord(retryRecord, Model, updateWhere, transaction);
    
    // utime 비교
    const shouldUpdate = shouldUpdateBasedOnUtime(clientUtimeStr, serverUtimeStr);
    
    if (shouldUpdate) {
        // 업데이트 수행
        const updated = await updateRecord(Model, filteredItem, updateWhere, keysToRemove, transaction);
        
        // SAVEPOINT 해제
        try {
            await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
        } catch (releaseErr) {
            // 무시
        }
        
        return {
            action: 'updated',
            data: updated,
            serverUtime: serverUtimeStr,
            clientUtime: clientUtimeStr
        };
    } else {
        // 서버 utime이 더 높거나 같으면 스킵
        // SAVEPOINT 해제
        try {
            await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
        } catch (releaseErr) {
            // 무시
        }
        
        return {
            action: 'skipped',
            reason: 'server_utime_newer',
            data: retryRecord,
            serverUtime: serverUtimeStr,
            clientUtime: clientUtimeStr
        };
    }
}

module.exports = {
    findRecordByPrimaryKey,
    updateRecord,
    processRecordWithUtimeComparison,
    handlePrimaryKeyConflict
};

