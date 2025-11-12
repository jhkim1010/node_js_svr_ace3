// b_sincronizado_node_svr 필드를 제거하는 헬퍼 함수
function removeSyncField(data) {
    if (!data || typeof data !== 'object') return data;
    
    // 객체 복사
    const cleaned = { ...data };
    
    // b_sincronizado_node_svr 필드 제거
    delete cleaned.b_sincronizado_node_svr;
    
    return cleaned;
}

// BATCH_SYNC 처리를 위한 공통 함수
async function handleBatchSync(req, res, Model, primaryKey, modelName) {
    console.log(`\n🔄 BATCH_SYNC 요청 수신 (${modelName}): ${req.body.data.length}개 항목`);
    console.log('Received batch data:', JSON.stringify(req.body, null, 2));
    
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
        
        // primary key 확인 (단일 키 또는 복합 키)
        const hasPrimaryKey = Array.isArray(primaryKey) 
            ? primaryKey.every(key => cleanedItem[key] !== undefined && cleanedItem[key] !== null)
            : cleanedItem[primaryKey] !== undefined && cleanedItem[primaryKey] !== null;
        
        if (hasPrimaryKey) {
            itemsToUpdate.push({ item: cleanedItem, index: i });
            updateIndices.push(i);
        } else {
            itemsToInsert.push({ item: cleanedItem, index: i });
            insertIndices.push(i);
        }
    });
    
    // Insert 항목들을 bulkCreate로 일괄 처리
    if (itemsToInsert.length > 0) {
        try {
            const insertData = itemsToInsert.map(({ item }) => item);
            console.log(`📦 일괄 생성 시도 (${modelName}): ${insertData.length}개 항목`);
            console.log('Insert data sample:', JSON.stringify(insertData[0], null, 2));
            
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
            console.log(`✅ ${itemsToInsert.length}개 항목 일괄 생성 완료 (${modelName})`);
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
            console.log(`🔄 개별 처리로 전환 (${modelName})...`);
            for (const { item, index } of itemsToInsert) {
                try {
                    console.log(`   처리 중: 인덱스 ${index}`);
                    const result = await Model.create(item);
                    results.push({ index, action: 'created', data: result });
                    console.log(`   ✅ 인덱스 ${index} 성공`);
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
            
            const [count] = await Model.update(item, { where: whereCondition });
            
            if (count > 0) {
                const result = Array.isArray(primaryKey)
                    ? await Model.findOne({ where: whereCondition })
                    : await Model.findByPk(item[primaryKey]);
                results.push({ index, action: 'updated', data: result });
            } else {
                // primary key가 있지만 레코드가 없으면 insert
                const result = await Model.create(item);
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
    
    console.log(`✅ BATCH_SYNC 완료 (${modelName}): 성공 ${results.length}개, 실패 ${errors.length}개\n`);
    
    return {
        success: true,
        message: `처리 완료: 성공 ${results.length}개, 실패 ${errors.length}개`,
        processed: results.length,
        failed: errors.length,
        results: results,
        errors: errors.length > 0 ? errors : undefined
    };
}

module.exports = { removeSyncField, handleBatchSync };

