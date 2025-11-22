// Vdetalle 테이블 전용 핸들러
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition, isUniqueConstraintError } = require('./batch-sync-handler');
const { classifyError } = require('./error-classifier');

async function handleVdetalleBatchSync(req, res, Model, primaryKey, modelName) {
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
            const savepointName = `sp_vdetalle_${i}`;
            
            try {
                // SAVEPOINT 생성 - 각 항목별로 독립적인 롤백 가능
                await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
                
                item = req.body.data[i];
                const cleanedItem = removeSyncField(item);
                const filteredItem = filterModelFields(Model, cleanedItem);
                
                // Vdetalle 특화: vcode1, codigo1 조합으로도 확인 가능
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
                        // 레코드가 없으면 INSERT 시도
                        try {
                            const created = await Model.create(filteredItem, { transaction });
                            results.push({ index: i, action: 'created', data: created });
                            createdCount++;
                        } catch (createErr) {
                            // unique constraint 에러가 발생하면 SAVEPOINT로 롤백 후 UPDATE로 재시도
                            if (isUniqueConstraintError(createErr)) {
                                try {
                                    // SAVEPOINT로 롤백
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    
                                    // 레코드가 실제로 존재하는지 다시 확인 (동시성 문제 대비)
                                    const retryRecord = Array.isArray(availableUniqueKey)
                                        ? await Model.findOne({ where: whereCondition, transaction })
                                        : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                    
                                    if (retryRecord) {
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
                                        // 레코드를 찾을 수 없으면 원래 에러를 다시 던짐
                                        throw createErr;
                                    }
                                } catch (retryErr) {
                                    // 재시도 실패 시 원래 에러를 다시 던짐
                                    throw retryErr;
                                }
                            } else {
                                // unique constraint 에러가 아니면 원래 에러를 다시 던짐
                                throw createErr;
                            }
                        }
                    }
                } else {
                    // unique key가 없으면 INSERT 시도
                    try {
                        const created = await Model.create(filteredItem, { transaction });
                        results.push({ index: i, action: 'created', data: created });
                        createdCount++;
                    } catch (createErr) {
                        // unique constraint 에러가 발생하면 SAVEPOINT로 롤백 후 재시도
                        if (isUniqueConstraintError(createErr)) {
                            try {
                                // SAVEPOINT로 롤백
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                // unique key가 없으므로 재시도 불가, 에러를 다시 던짐
                                throw createErr;
                            } catch (retryErr) {
                                throw retryErr;
                            }
                        } else {
                            // unique constraint 에러가 아니면 원래 에러를 다시 던짐
                            throw createErr;
                        }
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
                
                const errorClassification = classifyError(err);
                console.error(`ERROR: Vdetalle INSERT/UPDATE failed (item ${i}) [${errorClassification.source}]: ${err.message}`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
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
            message: `Vdetalle processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated), ${errors.length} failed`,
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

async function handleVdetalleArrayData(req, res, Model, primaryKey, modelName) {
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
            const savepointName = `sp_vdetalle_${i}`;
            
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
                                // UPDATE count가 0이면 INSERT 시도
                                try {
                                    const created = await Model.create(filteredItem, { transaction });
                                    results.push({ index: i, action: 'created', data: created });
                                    createdCount++;
                                } catch (createErr) {
                                    // unique constraint 에러가 발생하면 SAVEPOINT로 롤백 후 UPDATE로 재시도
                                    if (isUniqueConstraintError(createErr)) {
                                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                        const retryRecord = Array.isArray(availableUniqueKey)
                                            ? await Model.findOne({ where: whereCondition, transaction })
                                            : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                        if (retryRecord) {
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
                                            throw createErr;
                                        }
                                    } else {
                                        throw createErr;
                                    }
                                }
                            }
                        } else {
                            // 레코드가 없으면 INSERT 시도
                            try {
                                const created = await Model.create(filteredItem, { transaction });
                                results.push({ index: i, action: 'created', data: created });
                                createdCount++;
                            } catch (createErr) {
                                // unique constraint 에러가 발생하면 SAVEPOINT로 롤백 후 UPDATE로 재시도
                                if (isUniqueConstraintError(createErr)) {
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    const retryRecord = Array.isArray(availableUniqueKey)
                                        ? await Model.findOne({ where: whereCondition, transaction })
                                        : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                    if (retryRecord) {
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
                                        throw createErr;
                                    }
                                } else {
                                    throw createErr;
                                }
                            }
                        }
                    } else {
                        // unique key가 없으면 INSERT 시도
                        try {
                            const created = await Model.create(filteredItem, { transaction });
                            results.push({ index: i, action: 'created', data: created });
                            createdCount++;
                        } catch (createErr) {
                            // unique constraint 에러가 발생하면 SAVEPOINT로 롤백
                            if (isUniqueConstraintError(createErr)) {
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            }
                            throw createErr;
                        }
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
                
                const errorClassification = classifyError(err);
                console.error(`ERROR: Vdetalle INSERT/UPDATE failed (item ${i}) [${errorClassification.source}]: ${err.message}`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
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
            message: `Vdetalle processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated, ${deletedCount} deleted), ${errors.length} failed`,
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

module.exports = { handleVdetalleBatchSync, handleVdetalleArrayData };

