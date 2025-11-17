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
            console.error(`\n❌ 일괄 생성 실패 (${modelName}):`);
            console.error('   에러 타입:', err.constructor.name);
            console.error('   에러 메시지:', err.message);
            if (err.errors && Array.isArray(err.errors)) {
                console.error('   상세 Validation 에러:');
                err.errors.forEach((validationError, idx) => {
                    console.error(`     [${idx}] 필드: ${validationError.path}, 값: ${validationError.value}, 메시지: ${validationError.message}`);
                });
            }
            if (err.original) {
                console.error('   원본 에러:', err.original);
            }
            console.error('   전체 에러:', err);
            console.error('');
            
            // bulkCreate 실패 시 개별 처리
            for (const { item, index } of itemsToInsert) {
                try {
                    const filteredItem = filterModelFields(Model, item);
                    const result = await Model.create(filteredItem);
                    results.push({ index, action: 'created', data: result });
                } catch (individualErr) {
                    console.error(`   ❌ 인덱스 ${index} 실패:`, individualErr.message);
                    if (individualErr.errors && Array.isArray(individualErr.errors)) {
                        individualErr.errors.forEach((validationError) => {
                            console.error(`      - 필드: ${validationError.path}, 값: ${validationError.value}, 메시지: ${validationError.message}`);
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
            console.error(`❌ 항목 ${index} 처리 실패 (${modelName}):`, err.message);
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
        message: `처리 완료: 성공 ${results.length}개, 실패 ${errors.length}개`,
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors.length > 0 ? errors : undefined
    };
}

module.exports = { removeSyncField, filterModelFields, handleBatchSync };

