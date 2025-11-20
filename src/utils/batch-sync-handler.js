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

// BATCH_SYNC 처리를 위한 공통 함수
async function handleBatchSync(req, res, Model, primaryKey, modelName) {
    // 데이터 개수를 req에 저장 (로깅용)
    req._dataCount = Array.isArray(req.body.data) ? req.body.data.length : 1;
    
    const results = [];
    const errors = [];
    
    // primary key가 있는 항목과 없는 항목 분리
    const itemsToUpdate = [];
    const itemsToInsert = [];
    const updateIndices = [];
    const insertIndices = [];
    
    req.body.data.forEach((item, i) => {
        // b_sincronizado_node_svr 필드 제거
        const cleanedItem = removeSyncField(item);
        
        // 모델에 정의되지 않은 필드 제거
        const filteredItem = filterModelFields(Model, cleanedItem);
        
        // primary key 확인 (단일 키 또는 복합 키)
        const hasPrimaryKey = Array.isArray(primaryKey) 
            ? primaryKey.every(key => filteredItem[key] !== undefined && filteredItem[key] !== null)
            : filteredItem[primaryKey] !== undefined && filteredItem[primaryKey] !== null;
        
        if (hasPrimaryKey) {
            itemsToUpdate.push({ item: filteredItem, index: i });
            updateIndices.push(i);
        } else {
            itemsToInsert.push({ item: filteredItem, index: i });
            insertIndices.push(i);
        }
    });
    
    // Insert 항목들을 bulkCreate로 일괄 처리
    if (itemsToInsert.length > 0) {
        try {
            const insertData = itemsToInsert.map(({ item }) => item);
            
            const created = await Model.bulkCreate(insertData, { 
                returning: true,
                validate: false,
                ignoreDuplicates: false
            });
            created.forEach((record, idx) => {
                results.push({ 
                    index: insertIndices[idx], 
                    action: 'created', 
                    data: record 
                });
            });
        } catch (err) {
            console.error(`\n❌ Bulk creation failed (${modelName}):`);
            console.error('   Error type:', err.constructor.name);
            console.error('   Error message:', err.message);
            if (err.errors && Array.isArray(err.errors)) {
                console.error('   Detailed validation errors:');
                err.errors.forEach((validationError, idx) => {
                    console.error(`     [${idx}] Field: ${validationError.path}, Value: ${validationError.value}, Message: ${validationError.message}`);
                });
            }
            if (err.original) {
                console.error('   Original error:', err.original);
            }
            console.error('   Full error:', err);
            console.error('');
            
            // bulkCreate 실패 시 개별 처리
            for (const { item, index } of itemsToInsert) {
                try {
                    const filteredItem = filterModelFields(Model, item);
                    const result = await Model.create(filteredItem);
                    results.push({ index, action: 'created', data: result });
                } catch (individualErr) {
                    console.error(`   ❌ Index ${index} failed:`, individualErr.message);
                    if (individualErr.errors && Array.isArray(individualErr.errors)) {
                        individualErr.errors.forEach((validationError) => {
                            console.error(`      - Field: ${validationError.path}, Value: ${validationError.value}, Message: ${validationError.message}`);
                        });
                    }
                    errors.push({ 
                        index, 
                        error: individualErr.message,
                        errorType: individualErr.constructor.name,
                        validationErrors: individualErr.errors ? individualErr.errors.map(e => ({
                            field: e.path,
                            value: e.value,
                            message: e.message
                        })) : undefined,
                        data: item
                    });
                }
            }
        }
    }
    
    // Update 항목들을 개별 처리
    for (const { item, index } of itemsToUpdate) {
        try {
            // 복합 키인 경우 where 조건 구성
            const whereCondition = Array.isArray(primaryKey)
                ? primaryKey.reduce((acc, key) => {
                    acc[key] = item[key];
                    return acc;
                }, {})
                : { [primaryKey]: item[primaryKey] };
            
            // 모델에 정의된 필드만 필터링
            const filteredItem = filterModelFields(Model, item);
            const [count] = await Model.update(filteredItem, { where: whereCondition });
            
            if (count > 0) {
                const result = Array.isArray(primaryKey)
                    ? await Model.findOne({ where: whereCondition })
                    : await Model.findByPk(item[primaryKey]);
                results.push({ index, action: 'updated', data: result });
            } else {
                // primary key가 있지만 레코드가 없으면 insert
                const result = await Model.create(filteredItem);
                results.push({ index, action: 'created', data: result });
            }
        } catch (err) {
            console.error(`❌ Item ${index} processing failed (${modelName}):`, err.message);
            errors.push({ 
                index, 
                error: err.message,
                errorType: err.constructor.name,
                data: item
            });
        }
    }
    
    // 결과를 원래 인덱스 순서로 정렬
    results.sort((a, b) => a.index - b.index);
    errors.sort((a, b) => a.index - b.index);
    
    return {
        success: true,
        message: `Processing complete: ${results.length} succeeded, ${errors.length} failed`,
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors.length > 0 ? errors : undefined
    };
}

// 배열 형태의 data를 처리하는 공통 함수 (operation 파라미터 기반)
async function handleArrayData(req, res, Model, primaryKey, modelName) {
    // operation에 따라 처리 방식 결정 (primary key 기반이 아닌 operation 값 기반)
    const operation = (req.body.operation || req.body.trigger_operation || '').toUpperCase();
    
    const results = [];
    const errors = [];
    
    // operation에 따라 각 항목 처리
    for (let i = 0; i < req.body.data.length; i++) {
        try {
            const item = req.body.data[i];
            const cleanedData = removeSyncField(item);
            const filteredItem = filterModelFields(Model, cleanedData);
            
            if (operation === 'CREATE') {
                // CREATE: 무조건 INSERT
                const created = await Model.create(filteredItem);
                results.push({ index: i, action: 'created', data: created });
            } else if (operation === 'UPDATE') {
                // UPDATE: primary key를 기반으로 업데이트
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
                    throw new Error(`Primary key(s) missing for UPDATE operation`);
                }
                
                // primary key 필드를 업데이트 데이터에서 제거 (일부 DB에서는 primary key 업데이트 불가)
                const updateData = { ...filteredItem };
                if (Array.isArray(primaryKey)) {
                    primaryKey.forEach(key => delete updateData[key]);
                } else {
                    delete updateData[primaryKey];
                }
                
                const [count] = await Model.update(updateData, { where: whereCondition });
                if (count > 0) {
                    const updated = Array.isArray(primaryKey)
                        ? await Model.findOne({ where: whereCondition })
                        : await Model.findByPk(filteredItem[primaryKey]);
                    results.push({ index: i, action: 'updated', data: updated });
                } else {
                    throw new Error(`Record not found for UPDATE operation`);
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
                    ? await Model.findOne({ where: whereCondition })
                    : await Model.findByPk(filteredItem[primaryKey]);
                
                if (!toDelete) {
                    throw new Error(`Record not found for DELETE operation`);
                }
                
                const count = await Model.destroy({ where: whereCondition });
                if (count > 0) {
                    results.push({ index: i, action: 'deleted', data: toDelete });
                } else {
                    throw new Error(`Failed to delete record`);
                }
            } else {
                // operation이 없거나 알 수 없는 경우 기본적으로 CREATE
                const created = await Model.create(filteredItem);
                results.push({ index: i, action: 'created', data: created });
            }
        } catch (itemErr) {
            errors.push({ 
                index: i, 
                error: itemErr.message,
                errorType: itemErr.constructor.name,
                data: req.body.data[i] 
            });
        }
    }
    
    if (results.length > 0 || errors.length > 0) {
        const result = {
            success: true,
            message: `Processing complete: ${results.length} succeeded, ${errors.length} failed`,
            processed: results.length,
            failed: errors.length,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        };
        await require('../utils/websocket-notifier').notifyBatchSync(req, Model, result);
        return result;
    } else {
        throw new Error('All items failed to process');
    }
}

module.exports = { removeSyncField, filterModelFields, handleBatchSync, handleArrayData };

