// b_sincronizado_node_svr 필드를 제거하는 헬퍼 함수
function removeSyncField(data) {
    if (!data || typeof data !== 'object') return data;
    
    // 객체 복사
    const cleaned = { ...data };
    
    // b_sincronizado_node_svr 필드 제거
    delete cleaned.b_sincronizado_node_svr;
    
    return cleaned;
}

// 모델에 정의된 필드만 남기는 함수
function filterModelFields(Model, data) {
    if (!data || typeof data !== 'object') return data;
    if (!Model || !Model.rawAttributes) return data;
    
    // 모델에 정의된 필드명 목록 가져오기
    const definedFields = Object.keys(Model.rawAttributes);
    
    // 정의된 필드만 필터링
    const filtered = {};
    for (const key of definedFields) {
        if (key in data) {
            filtered[key] = data[key];
        }
    }
    
    return filtered;
}

// 모델에서 unique key 목록 추출 (primary key + unique constraints)
function getUniqueKeys(Model, primaryKey) {
    const uniqueKeys = [];
    
    // primary key 추가
    if (primaryKey) {
        uniqueKeys.push(Array.isArray(primaryKey) ? primaryKey : [primaryKey]);
    }
    
    // Model.rawAttributes에서 unique: true인 필드 찾기
    if (Model.rawAttributes) {
        for (const [fieldName, attr] of Object.entries(Model.rawAttributes)) {
            if (attr.unique === true) {
                uniqueKeys.push([fieldName]);
            }
        }
    }
    
    // Model.options.indexes에서 unique: true인 인덱스 찾기
    if (Model.options && Model.options.indexes) {
        for (const index of Model.options.indexes) {
            if (index.unique === true && index.fields && Array.isArray(index.fields)) {
                uniqueKeys.push(index.fields);
            }
        }
    }
    
    return uniqueKeys;
}

// 데이터에 unique key가 모두 있는지 확인
function hasUniqueKey(data, uniqueKey) {
    if (!Array.isArray(uniqueKey)) {
        return data[uniqueKey] !== undefined && data[uniqueKey] !== null;
    }
    return uniqueKey.every(key => data[key] !== undefined && data[key] !== null);
}

// 데이터에서 사용 가능한 unique key 찾기 (primary key 우선)
function findAvailableUniqueKey(data, uniqueKeys) {
    for (const uniqueKey of uniqueKeys) {
        if (hasUniqueKey(data, uniqueKey)) {
            return uniqueKey;
        }
    }
    return null;
}

// unique key로 where 조건 구성
function buildWhereCondition(data, uniqueKey) {
    if (!Array.isArray(uniqueKey)) {
        return { [uniqueKey]: data[uniqueKey] };
    }
    return uniqueKey.reduce((acc, key) => {
        if (data[key] !== undefined && data[key] !== null) {
            acc[key] = data[key];
        }
        return acc;
    }, {});
}

// BATCH_SYNC 처리를 위한 공통 함수
const { classifyError } = require('./error-classifier');

async function handleBatchSync(req, res, Model, primaryKey, modelName) {
    // 데이터 개수를 req에 저장 (로깅용)
    // req.body.count를 우선 사용, 없으면 배열 길이 계산
    if (req.body && req.body.count !== undefined && req.body.count !== null) {
        req._dataCount = parseInt(req.body.count, 10) || 1;
    } else {
        req._dataCount = Array.isArray(req.body.data) ? req.body.data.length : 1;
    }
    
    // Sequelize 인스턴스 가져오기 (트랜잭션용)
    const sequelize = Model.sequelize;
    if (!sequelize) {
        throw new Error('Sequelize instance not found in Model');
    }
    
    // 트랜잭션 시작 - 모든 작업을 하나의 트랜잭션으로 묶어서 원자성 보장
    const transaction = await sequelize.transaction();
    
    const results = [];
    const errors = [];
    let createdCount = 0;
    let updatedCount = 0;
    
    try {
        // unique key 목록 가져오기 (primary key + unique constraints)
        const uniqueKeys = getUniqueKeys(Model, primaryKey);
        
        // 각 항목을 하나씩 조사하여 실제 DB에 존재하는지 확인
        for (let i = 0; i < req.body.data.length; i++) {
            try {
                const item = req.body.data[i];
                // b_sincronizado_node_svr 필드 제거
                const cleanedItem = removeSyncField(item);
                
                // 모델에 정의되지 않은 필드 제거
                const filteredItem = filterModelFields(Model, cleanedItem);
                
                // 사용 가능한 unique key 찾기
                const availableUniqueKey = findAvailableUniqueKey(filteredItem, uniqueKeys);
                
                if (availableUniqueKey) {
                    // unique key가 있으면 먼저 레코드 존재 여부 확인
                    const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
                    
                    // 레코드 조회
                    const existingRecord = Array.isArray(availableUniqueKey)
                        ? await Model.findOne({ where: whereCondition, transaction })
                        : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                    
                    if (existingRecord) {
                        // 레코드가 존재하면 UPDATE
                        const updateData = { ...filteredItem };
                        const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                        keysToRemove.forEach(key => delete updateData[key]);
                        
                        await Model.update(updateData, { where: whereCondition, transaction });
                        const updated = Array.isArray(availableUniqueKey)
                            ? await Model.findOne({ where: whereCondition, transaction })
                            : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                        results.push({ index: i, action: 'updated', data: updated });
                        updatedCount++;
                    } else {
                        // 레코드가 없으면 INSERT
                        const created = await Model.create(filteredItem, { transaction });
                        results.push({ index: i, action: 'created', data: created });
                        createdCount++;
                    }
                } else {
                    // unique key가 없으면 INSERT
                    const created = await Model.create(filteredItem, { transaction });
                    results.push({ index: i, action: 'created', data: created });
                    createdCount++;
                }
            } catch (err) {
                const errorClassification = classifyError(err);
                console.error(`ERROR: ${modelName} INSERT/UPDATE failed (item ${i}) [${errorClassification.source}]: ${err.message}`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
                errors.push({ 
                    index: i, 
                    error: err.message,
                    errorType: err.constructor.name,
                    data: item
                });
            }
        }
    
        // 결과를 원래 인덱스 순서로 정렬
        results.sort((a, b) => a.index - b.index);
        errors.sort((a, b) => a.index - b.index);
        
        // 에러가 있으면 트랜잭션 롤백
        if (errors.length > 0) {
            await transaction.rollback();
        } else {
            // 모든 작업이 성공하면 트랜잭션 커밋
            await transaction.commit();
        }
        
        const totalCount = req.body.data.length;
        const result = {
            success: true,
            message: `Processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated), ${errors.length} failed`,
            processed: results.length,
            failed: errors.length,
            total: totalCount,
            created: createdCount,
            updated: updatedCount,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        };
        
        // req에 통계 정보 저장 (response-logger에서 사용)
        if (errors.length === 0) {
            req._processingStats = {
                total: totalCount,
                created: createdCount,
                updated: updatedCount,
                deleted: 0,
                failed: errors.length
            };
        }
        
        return result;
    } catch (err) {
        // 에러 발생 시 트랜잭션 롤백
        await transaction.rollback();
        throw err;
    }
}

// 배열 형태의 data를 처리하는 공통 함수 (operation 파라미터 기반)
async function handleArrayData(req, res, Model, primaryKey, modelName) {
    // operation에 따라 처리 방식 결정 (primary key 기반이 아닌 operation 값 기반)
    const operation = (req.body.operation || req.body.trigger_operation || '').toUpperCase();
    
    // 데이터 개수를 req에 저장 (로깅용)
    // req.body.count를 우선 사용, 없으면 배열 길이 계산
    if (req.body && req.body.count !== undefined && req.body.count !== null) {
        req._dataCount = parseInt(req.body.count, 10) || 1;
    } else {
        req._dataCount = Array.isArray(req.body.data) ? req.body.data.length : 1;
    }
    
    // Sequelize 인스턴스 가져오기 (트랜잭션용)
    const sequelize = Model.sequelize;
    if (!sequelize) {
        throw new Error('Sequelize instance not found in Model');
    }
    
    // 트랜잭션 시작 - 모든 작업을 하나의 트랜잭션으로 묶어서 원자성 보장
    const transaction = await sequelize.transaction();
    
    const results = [];
    const errors = [];
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    
    try {
        // operation에 따라 각 항목 처리
        for (let i = 0; i < req.body.data.length; i++) {
        try {
            const item = req.body.data[i];
            const cleanedData = removeSyncField(item);
            const filteredItem = filterModelFields(Model, cleanedData);
            
            // INSERT 또는 UPDATE operation: primary key 또는 unique key 기반으로 INSERT/UPDATE 결정
            if (operation === 'INSERT' || operation === 'UPDATE' || operation === 'CREATE') {
                // unique key 목록 가져오기 (primary key + unique constraints)
                const uniqueKeys = getUniqueKeys(Model, primaryKey);
                
                // 사용 가능한 unique key 찾기
                const availableUniqueKey = findAvailableUniqueKey(filteredItem, uniqueKeys);
                
                if (availableUniqueKey) {
                    // unique key가 있으면 먼저 레코드 존재 여부 확인
                    const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
                    
                    // 레코드 조회
                    const existingRecord = Array.isArray(availableUniqueKey)
                        ? await Model.findOne({ where: whereCondition, transaction })
                        : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                    
                    if (existingRecord) {
                        // 레코드가 존재하면 UPDATE
                        const updateData = { ...filteredItem };
                        const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                        keysToRemove.forEach(key => delete updateData[key]);
                        
                        await Model.update(updateData, { where: whereCondition, transaction });
                        const updated = Array.isArray(availableUniqueKey)
                            ? await Model.findOne({ where: whereCondition, transaction })
                            : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                        results.push({ index: i, action: 'updated', data: updated });
                        updatedCount++;
                    } else {
                        // 레코드가 없으면 INSERT
                        const created = await Model.create(filteredItem, { transaction });
                        results.push({ index: i, action: 'created', data: created });
                        createdCount++;
                    }
                } else {
                    // unique key가 없으면 INSERT
                    const created = await Model.create(filteredItem, { transaction });
                    results.push({ index: i, action: 'created', data: created });
                    createdCount++;
                }
            } else if (operation === 'DELETE') {
                // DELETE: primary key를 기반으로 삭제
                const whereCondition = Array.isArray(primaryKey)
                    ? primaryKey.reduce((acc, key) => {
                        if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                            acc[key] = filteredItem[key];
                        }
                        return acc;
                    }, {})
                    : { [primaryKey]: filteredItem[primaryKey] };
                
                // primary key가 모두 있는지 확인
                const hasAllKeys = Array.isArray(primaryKey)
                    ? primaryKey.every(key => filteredItem[key] !== undefined && filteredItem[key] !== null)
                    : filteredItem[primaryKey] !== undefined && filteredItem[primaryKey] !== null;
                
                if (!hasAllKeys) {
                    throw new Error(`Primary key(s) missing for DELETE operation`);
                }
                
                // 삭제 전에 데이터 가져오기 (알림용)
                const toDelete = Array.isArray(primaryKey)
                    ? await Model.findOne({ where: whereCondition, transaction })
                    : await Model.findByPk(filteredItem[primaryKey], { transaction });
                
                if (!toDelete) {
                    throw new Error(`Record not found for DELETE operation`);
                }
                
                const count = await Model.destroy({ where: whereCondition, transaction });
                if (count > 0) {
                    results.push({ index: i, action: 'deleted', data: toDelete });
                    deletedCount++;
                } else {
                    throw new Error(`Failed to delete record`);
                }
            } else {
                // operation이 없거나 알 수 없는 경우 기본적으로 CREATE
                const created = await Model.create(filteredItem, { transaction });
                results.push({ index: i, action: 'created', data: created });
                createdCount++;
            }
        } catch (itemErr) {
            errors.push({ 
                index: i, 
                error: itemErr.message,
                errorType: itemErr.constructor.name,
                data: req.body.data[i] 
            });
            // 에러 발생 시 즉시 중단하고 롤백 (원자성 보장)
            await transaction.rollback();
            throw itemErr;
        }
        }
        
        // 모든 작업이 성공하면 트랜잭션 커밋
        await transaction.commit();
        
        if (results.length > 0) {
            const totalCount = req.body.data.length;
            const result = {
                success: true,
                message: `Processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted), ${errors.length} failed`,
                processed: results.length,
                failed: errors.length,
                total: totalCount,
                created: createdCount,
                updated: updatedCount,
                deleted: deletedCount,
                results: results,
                errors: errors.length > 0 ? errors : undefined
            };
            
            // req에 통계 정보 저장 (response-logger에서 사용)
            req._processingStats = {
                total: totalCount,
                created: createdCount,
                updated: updatedCount,
                deleted: deletedCount,
                failed: errors.length
            };
            
            await require('../utils/websocket-notifier').notifyBatchSync(req, Model, result);
            return result;
        } else {
            throw new Error('All items failed to process');
        }
    } catch (err) {
        // 에러 발생 시 트랜잭션 롤백 (이미 롤백된 경우 무시)
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            // 롤백 에러는 무시 (이미 롤백되었을 수 있음)
        }
        throw err;
    }
}

module.exports = { 
    removeSyncField, 
    filterModelFields, 
    handleBatchSync, 
    handleArrayData,
    getUniqueKeys,
    findAvailableUniqueKey,
    buildWhereCondition
};

