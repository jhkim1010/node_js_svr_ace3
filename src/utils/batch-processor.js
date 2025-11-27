// 배열을 배치로 나눠서 처리하는 유틸리티 함수
const BATCH_SIZE = 50;

/**
 * 배열을 지정된 크기의 배치로 나눕니다
 * @param {Array} array - 나눌 배열
 * @param {number} batchSize - 배치 크기
 * @returns {Array<Array>} 배치 배열
 */
function chunkArray(array, batchSize = BATCH_SIZE) {
    if (!Array.isArray(array) || array.length === 0) {
        return [];
    }
    
    const chunks = [];
    for (let i = 0; i < array.length; i += batchSize) {
        chunks.push(array.slice(i, i + batchSize));
    }
    return chunks;
}

/**
 * 큰 배열을 배치로 나눠서 처리합니다
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 * @param {Function} handler - 각 배치를 처리할 핸들러 함수 (handleArrayData 등)
 * @param {Object} Model - Sequelize 모델
 * @param {string|Array} primaryKey - Primary key
 * @param {string} modelName - 모델 이름
 * @returns {Promise<Object>} 통합된 결과 객체
 */
async function processBatchedArray(req, res, handler, Model, primaryKey, modelName) {
    const originalData = req.body.data;
    
    // 50개 이하면 일반 처리
    if (originalData.length <= BATCH_SIZE) {
        return await handler(req, res, Model, primaryKey, modelName);
    }
    
    // 50개를 넘으면 배치로 나눠서 처리
    const chunks = chunkArray(originalData, BATCH_SIZE);
    const allResults = [];
    const allErrors = [];
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalDeleted = 0;
    let totalProcessed = 0;
    let totalFailed = 0;
    let globalIndex = 0;
    
    // 각 배치를 순차적으로 처리
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        
        // 요청 본문을 현재 배치로 교체
        const originalBody = { ...req.body };
        req.body.data = chunk;
        
        try {
            const result = await handler(req, res, Model, primaryKey, modelName);
            
            // 결과의 인덱스를 원래 배열 기준으로 조정
            if (result.results) {
                result.results.forEach(item => {
                    item.index = globalIndex + item.index;
                    allResults.push(item);
                });
            }
            
            if (result.errors) {
                result.errors.forEach(error => {
                    error.index = globalIndex + error.index;
                    allErrors.push(error);
                });
            }
            
            totalCreated += result.created || 0;
            totalUpdated += result.updated || 0;
            totalDeleted += result.deleted || 0;
            totalProcessed += result.processed || 0;
            totalFailed += result.failed || 0;
            
            globalIndex += chunk.length;
        } catch (err) {
            // 배치 처리 중 에러 발생 시, 현재 배치의 모든 항목을 에러로 표시
            chunk.forEach((item, localIndex) => {
                allErrors.push({
                    index: globalIndex + localIndex,
                    error: err.message,
                    errorType: err.constructor.name,
                    data: item
                });
                totalFailed++;
            });
            globalIndex += chunk.length;
            
            // 에러가 발생해도 다음 배치는 계속 처리
            console.error(`Batch ${chunkIndex + 1}/${chunks.length} failed:`, err.message);
        } finally {
            // 원래 요청 본문 복원
            req.body = originalBody;
        }
    }
    
    // 결과를 원래 인덱스 순서로 정렬
    allResults.sort((a, b) => a.index - b.index);
    allErrors.sort((a, b) => a.index - b.index);
    
    const totalCount = originalData.length;
    const finalResult = {
        success: totalFailed === 0,
        message: `Batched processing complete: ${totalProcessed} succeeded (${totalCreated} created, ${totalUpdated} updated, ${totalDeleted} deleted), ${totalFailed} failed across ${chunks.length} batches`,
        processed: totalProcessed,
        failed: totalFailed,
        total: totalCount,
        created: totalCreated,
        updated: totalUpdated,
        deleted: totalDeleted,
        batches: chunks.length,
        batchSize: BATCH_SIZE,
        results: allResults,
        errors: allErrors.length > 0 ? allErrors : undefined
    };
    
    // req에 통계 정보 저장
    req._processingStats = {
        total: totalCount,
        created: totalCreated,
        updated: totalUpdated,
        deleted: totalDeleted,
        failed: totalFailed
    };
    
    return finalResult;
}

module.exports = {
    chunkArray,
    processBatchedArray,
    BATCH_SIZE
};

