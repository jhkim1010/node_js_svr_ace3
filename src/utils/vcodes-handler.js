// Vcodes 테이블 전용 핸들러
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition } = require('./batch-sync-handler');

async function handleVcodesBatchSync(req, res, Model, primaryKey, modelName) {
    // 데이터 개수를 req에 저장 (로깅용)
    if (req.body && req.body.count !== undefined && req.body.count !== null) {
        req._dataCount = parseInt(req.body.count, 10) || 1;
    } else {
        req._dataCount = Array.isArray(req.body.data) ? req.body.data.length : 1;
    }
    
    const sequelize = Model.sequelize;
    if (!sequelize) {
        throw new Error('Sequelize instance not found in Model');
    }
    
    const transaction = await sequelize.transaction();
    const results = [];
    const errors = [];
    let createdCount = 0;
    let updatedCount = 0;
    
    try {
        const uniqueKeys = getUniqueKeys(Model, primaryKey);
        
        // 각 항목을 하나씩 조사하여 처리
        for (let i = 0; i < req.body.data.length; i++) {
            let item = null;
            const savepointName = `sp_vcodes_${i}`;
            
            try {
                // SAVEPOINT 생성 - 각 항목별로 독립적인 롤백 가능
                await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
                
                item = req.body.data[i];
                const cleanedItem = removeSyncField(item);
                const filteredItem = filterModelFields(Model, cleanedItem);
                
                // Vcodes 특화: vcode 필드로도 확인 가능
                const availableUniqueKey = findAvailableUniqueKey(filteredItem, uniqueKeys);
                
                if (availableUniqueKey) {
                    const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
                    
                    // 먼저 기존 레코드 조회
                    const existingRecord = Array.isArray(availableUniqueKey)
                        ? await Model.findOne({ where: whereCondition, transaction })
                        : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                    
                    if (existingRecord) {
                        const updateData = { ...filteredItem };
                        const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                        keysToRemove.forEach(key => delete updateData[key]);
                        
                        const [count] = await Model.update(updateData, { where: whereCondition, transaction });
                        
                        if (count > 0) {
                            const updated = Array.isArray(availableUniqueKey)
                                ? await Model.findOne({ where: whereCondition, transaction })
                                : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                            results.push({ index: i, action: 'updated', data: updated });
                            updatedCount++;
                        } else {
                            const created = await Model.create(filteredItem, { transaction });
                            results.push({ index: i, action: 'created', data: created });
                            createdCount++;
                        }
                    } else {
                        const created = await Model.create(filteredItem, { transaction });
                        results.push({ index: i, action: 'created', data: created });
                        createdCount++;
                    }
                } else {
                    const created = await Model.create(filteredItem, { transaction });
                    results.push({ index: i, action: 'created', data: created });
                    createdCount++;
                }
                
                // 성공 시 SAVEPOINT 해제
                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
            } catch (err) {
                // 에러 발생 시 해당 SAVEPOINT로만 롤백 (트랜잭션은 계속 진행)
                try {
                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                } catch (rollbackErr) {
                    // SAVEPOINT가 없거나 이미 롤백된 경우 무시
                }
                
                console.error(`ERROR: Vcodes INSERT/UPDATE failed (item ${i}): ${err.message}`);
                errors.push({ 
                    index: i, 
                    error: err.message,
                    errorType: err.constructor.name,
                    data: item || req.body.data[i] || null
                });
            }
        }
        
        if (errors.length > 0) {
            await transaction.rollback();
        } else {
            await transaction.commit();
        }
        
        const totalCount = req.body.data.length;
        const result = {
            success: true,
            message: `Vcodes processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated), ${errors.length} failed`,
            processed: results.length,
            failed: errors.length,
            total: totalCount,
            created: createdCount,
            updated: updatedCount,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        };
        
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
        await transaction.rollback();
        throw err;
    }
}

async function handleVcodesArrayData(req, res, Model, primaryKey, modelName) {
    const operation = (req.body.operation || req.body.trigger_operation || '').toUpperCase();
    
    if (req.body && req.body.count !== undefined && req.body.count !== null) {
        req._dataCount = parseInt(req.body.count, 10) || 1;
    } else {
        req._dataCount = Array.isArray(req.body.data) ? req.body.data.length : 1;
    }
    
    const sequelize = Model.sequelize;
    if (!sequelize) {
        throw new Error('Sequelize instance not found in Model');
    }
    
    const transaction = await sequelize.transaction();
    const results = [];
    const errors = [];
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    
    try {
        const uniqueKeys = getUniqueKeys(Model, primaryKey);
        
        for (let i = 0; i < req.body.data.length; i++) {
            let item = null;
            const savepointName = `sp_vcodes_${i}`;
            
            try {
                // SAVEPOINT 생성 - 각 항목별로 독립적인 롤백 가능
                await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
                
                item = req.body.data[i];
                const cleanedData = removeSyncField(item);
                const filteredItem = filterModelFields(Model, cleanedData);
                
                if (operation === 'INSERT' || operation === 'UPDATE' || operation === 'CREATE') {
                    const availableUniqueKey = findAvailableUniqueKey(filteredItem, uniqueKeys);
                    
                    if (availableUniqueKey) {
                        const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
                        
                        // 먼저 기존 레코드 조회
                        const existingRecord = Array.isArray(availableUniqueKey)
                            ? await Model.findOne({ where: whereCondition, transaction })
                            : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                        
                        if (existingRecord) {
                            const updateData = { ...filteredItem };
                            const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                            keysToRemove.forEach(key => delete updateData[key]);
                            
                            const [count] = await Model.update(updateData, { where: whereCondition, transaction });
                            if (count > 0) {
                                const updated = Array.isArray(availableUniqueKey)
                                    ? await Model.findOne({ where: whereCondition, transaction })
                                    : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                results.push({ index: i, action: 'updated', data: updated });
                                updatedCount++;
                            } else {
                                const created = await Model.create(filteredItem, { transaction });
                                results.push({ index: i, action: 'created', data: created });
                                createdCount++;
                            }
                        } else {
                            const created = await Model.create(filteredItem, { transaction });
                            results.push({ index: i, action: 'created', data: created });
                            createdCount++;
                        }
                    } else {
                        const created = await Model.create(filteredItem, { transaction });
                        results.push({ index: i, action: 'created', data: created });
                        createdCount++;
                    }
                } else if (operation === 'DELETE') {
                    const whereCondition = Array.isArray(primaryKey)
                        ? primaryKey.reduce((acc, key) => {
                            if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                                acc[key] = filteredItem[key];
                            }
                            return acc;
                        }, {})
                        : { [primaryKey]: filteredItem[primaryKey] };
                    
                    const count = await Model.destroy({ where: whereCondition, transaction });
                    if (count > 0) {
                        results.push({ index: i, action: 'deleted' });
                        deletedCount++;
                    } else {
                        errors.push({ 
                            index: i, 
                            error: 'Record not found for deletion',
                            errorType: 'NotFoundError',
                            data: item
                        });
                    }
                }
                
                // 성공 시 SAVEPOINT 해제
                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
            } catch (err) {
                // 에러 발생 시 해당 SAVEPOINT로만 롤백 (트랜잭션은 계속 진행)
                try {
                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                } catch (rollbackErr) {
                    // SAVEPOINT가 없거나 이미 롤백된 경우 무시
                }
                
                console.error(`ERROR: Vcodes INSERT/UPDATE failed (item ${i}): ${err.message}`);
                errors.push({ 
                    index: i, 
                    error: err.message,
                    errorType: err.constructor.name,
                    data: item || req.body.data[i] || null
                });
            }
        }
        
        if (errors.length > 0) {
            await transaction.rollback();
        } else {
            await transaction.commit();
        }
        
        const totalCount = req.body.data.length;
        const result = {
            success: true,
            message: `Vcodes processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted), ${errors.length} failed`,
            processed: results.length,
            failed: errors.length,
            total: totalCount,
            created: createdCount,
            updated: updatedCount,
            deleted: deletedCount,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        };
        
        req._processingStats = {
            total: totalCount,
            created: createdCount,
            updated: updatedCount,
            deleted: deletedCount,
            failed: errors.length
        };
        
        return result;
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
}

module.exports = { handleVcodesBatchSync, handleVcodesArrayData };

