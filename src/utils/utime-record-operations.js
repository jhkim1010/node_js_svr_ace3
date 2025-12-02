// utime 비교를 통한 레코드 조회 및 처리 헬퍼 함수들
const { Sequelize } = require('sequelize');
const { buildWhereCondition } = require('./batch-sync-handler');
const { convertUtimeToString, convertUtimeToSequelizeLiteral, extractUtimeStringFromRecord, shouldUpdateBasedOnUtime } = require('./utime-helpers');

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
        attributes: {
            include: [
                [Sequelize.literal(`utime::text`), 'utime_str']
            ]
        },
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
    return await Model.findOne({ where: whereCondition, transaction });
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
    const record = await Model.findOne({ 
        where: whereCondition, 
        transaction,
        attributes: {
            include: [
                [Sequelize.literal(`utime::text`), 'utime_str']
            ]
        },
        raw: true
    });
    
    if (!record) {
        return { action: 'not_found', data: null };
    }
    
    // 서버 utime 추출
    const serverUtimeStr = await extractUtimeStringFromRecord(record, Model, whereCondition, transaction);
    
    // utime 비교
    const shouldUpdate = shouldUpdateBasedOnUtime(clientUtimeStr, serverUtimeStr);
    
    if (shouldUpdate) {
        // 업데이트 수행
        const updated = await updateRecord(Model, filteredItem, whereCondition, keysToRemove, transaction);
        
        // 독립 트랜잭션 사용 중이므로 SAVEPOINT 해제 불필요
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
        // 서버 utime이 더 높거나 같으면 스킵
        // 독립 트랜잭션 사용 중이므로 SAVEPOINT 해제 불필요
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
                attributes: {
                    include: [
                        [Sequelize.literal(`utime::text`), 'utime_str']
                    ]
                },
                raw: true
            })
            : await Model.findByPk(filteredItem[availableUniqueKey], { 
                transaction,
                attributes: {
                    include: [
                        [Sequelize.literal(`utime::text`), 'utime_str']
                    ]
                },
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

