// Vcodes 테이블 전용 핸들러
const { Sequelize } = require('sequelize');
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition, isUniqueConstraintError } = require('./batch-sync-handler');
const { classifyError } = require('./error-classifier');
const { convertUtimeToString, extractUtimeStringFromRecord, shouldUpdateBasedOnUtime } = require('./utime-helpers');
const { convertUtimeToSequelizeLiteral } = require('./utime-helpers');

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
    let skippedCount = 0;
    
    try {
        const uniqueKeys = getUniqueKeys(Model, primaryKey);
        const dbName = req.dbConfig?.database ? `[${req.dbConfig.database}]` : '[N/A]';
        
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
                
                // 클라이언트 utime 추출
                const clientUtimeStr = convertUtimeToString(filteredItem.utime);
                
                // Vcodes 특화: vcode 필드로도 확인 가능
                const availableUniqueKey = findAvailableUniqueKey(filteredItem, uniqueKeys);
                
                if (availableUniqueKey) {
                    const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
                    
                    // 먼저 기존 레코드 조회 (utime_str 포함)
                    const existingRecord = Array.isArray(availableUniqueKey)
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
                    
                    if (existingRecord) {
                        // 서버 utime 추출
                        const serverUtimeStr = await extractUtimeStringFromRecord(existingRecord, Model, whereCondition, transaction);
                        
                        // utime 비교: 클라이언트 utime이 더 높을 때만 업데이트
                        const shouldUpdate = shouldUpdateBasedOnUtime(clientUtimeStr, serverUtimeStr);
                        
                        if (shouldUpdate) {
                            const updateData = { ...filteredItem };
                            const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                            keysToRemove.forEach(key => delete updateData[key]);
                            
                            // utime을 문자열로 보장하여 timezone 변환 방지
                            if (updateData.utime) {
                                updateData.utime = convertUtimeToSequelizeLiteral(updateData.utime);
                            }
                            
                            const [count] = await Model.update(updateData, { where: whereCondition, transaction });
                            
                            if (count > 0) {
                                const updated = Array.isArray(availableUniqueKey)
                                    ? await Model.findOne({ where: whereCondition, transaction })
                                    : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                
                                // 식별 정보 추출
                                const identifier = {
                                    vcode_id: filteredItem.vcode_id || existingRecord.vcode_id,
                                    sucursal: filteredItem.sucursal || existingRecord.sucursal,
                                    vcode: filteredItem.vcode || existingRecord.vcode
                                };
                                
                                // utime comparison description
                                let utimeComparison = '';
                                if (clientUtimeStr && serverUtimeStr) {
                                    utimeComparison = `Client utime(${clientUtimeStr}) > Server utime(${serverUtimeStr})`;
                                } else if (clientUtimeStr && !serverUtimeStr) {
                                    utimeComparison = `Client utime(${clientUtimeStr}) exists, Server utime missing`;
                                } else if (!clientUtimeStr && !serverUtimeStr) {
                                    utimeComparison = `Both client and server have no utime`;
                                }
                                
                                const resultItem = { 
                                    index: i, 
                                    action: 'updated', 
                                    reason: 'client_utime_newer',
                                    reason_en: 'Updated because client utime is newer',
                                    utime_comparison: utimeComparison,
                                    identifier: identifier,
                                    data: updated,
                                    serverUtime: serverUtimeStr,
                                    clientUtime: clientUtimeStr
                                };
                                results.push(resultItem);
                                updatedCount++;
                                console.log(`[Vcodes BatchSync] ${dbName} | Item ${i + 1}/${req.body.data.length}: UPDATED | vcode_id=${identifier.vcode_id}, sucursal=${identifier.sucursal} | ${resultItem.reason_en}`);
                            } else {
                                const createData = { ...filteredItem };
                                // utime을 문자열로 보장하여 timezone 변환 방지
                                if (createData.utime) {
                                    createData.utime = convertUtimeToSequelizeLiteral(createData.utime);
                                }
                                const created = await Model.create(createData, { transaction });
                                
                                // 식별 정보 추출
                                const identifier = {
                                    vcode_id: filteredItem.vcode_id || created.vcode_id,
                                    sucursal: filteredItem.sucursal || created.sucursal,
                                    vcode: filteredItem.vcode || created.vcode
                                };
                                
                                const resultItem = { 
                                    index: i, 
                                    action: 'created', 
                                    reason: 'new_record',
                                    reason_en: 'Created new record (UPDATE count was 0, so INSERT was performed)',
                                    identifier: identifier,
                                    data: created 
                                };
                                results.push(resultItem);
                                createdCount++;
                                console.log(`[Vcodes BatchSync] ${dbName} | Item ${i + 1}/${req.body.data.length}: CREATED | vcode_id=${identifier.vcode_id}, sucursal=${identifier.sucursal} | ${resultItem.reason_en}`);
                            }
                        } else {
                            // 서버 utime이 더 높거나 같으면 스킵
                            
                            // 식별 정보 추출
                            const identifier = {
                                vcode_id: filteredItem.vcode_id || existingRecord.vcode_id,
                                sucursal: filteredItem.sucursal || existingRecord.sucursal,
                                vcode: filteredItem.vcode || existingRecord.vcode
                            };
                            
                            // utime comparison description
                            let utimeComparison = '';
                            let reasonEn = '';
                            if (clientUtimeStr && serverUtimeStr) {
                                utimeComparison = `Client utime(${clientUtimeStr}) <= Server utime(${serverUtimeStr})`;
                                reasonEn = `Skipped because server utime(${serverUtimeStr}) is newer than or equal to client utime(${clientUtimeStr})`;
                            } else if (!clientUtimeStr && serverUtimeStr) {
                                utimeComparison = `Client utime missing, Server utime(${serverUtimeStr}) exists`;
                                reasonEn = `Skipped because only server has utime`;
                            } else {
                                utimeComparison = `Both client and server have no utime`;
                                reasonEn = `Skipped because utime comparison is not possible`;
                            }
                            
                            const resultItem = { 
                                index: i, 
                                action: 'skipped', 
                                reason: 'server_utime_newer',
                                reason_en: reasonEn,
                                utime_comparison: utimeComparison,
                                identifier: identifier,
                                data: existingRecord,
                                serverUtime: serverUtimeStr,
                                clientUtime: clientUtimeStr
                            };
                            results.push(resultItem);
                            skippedCount++;
                            console.log(`[Vcodes BatchSync] ${dbName} | Item ${i + 1}/${req.body.data.length}: SKIPPED | vcode_id=${identifier.vcode_id}, sucursal=${identifier.sucursal} | ${resultItem.reason_en}`);
                        }
                    } else {
                        // 레코드가 없으면 INSERT 시도
                        try {
                            const createData = { ...filteredItem };
                            // utime을 문자열로 보장하여 timezone 변환 방지
                            if (createData.utime) {
                                createData.utime = convertUtimeToSequelizeLiteral(createData.utime);
                            }
                            const created = await Model.create(createData, { transaction });
                            
                            // 식별 정보 추출
                            const identifier = {
                                vcode_id: filteredItem.vcode_id || created.vcode_id,
                                sucursal: filteredItem.sucursal || created.sucursal,
                                vcode: filteredItem.vcode || created.vcode
                            };
                            
                            const resultItem = { 
                                index: i, 
                                action: 'created', 
                                reason: 'new_record',
                                reason_en: 'Created new record because no existing record was found',
                                identifier: identifier,
                                data: created 
                            };
                            results.push(resultItem);
                            createdCount++;
                            console.log(`[Vcodes BatchSync] ${dbName} | Item ${i + 1}/${req.body.data.length}: CREATED | vcode_id=${identifier.vcode_id}, sucursal=${identifier.sucursal} | ${resultItem.reason_en}`);
                        } catch (createErr) {
                            // unique constraint 에러가 발생하면 SAVEPOINT로 롤백 후 UPDATE로 재시도
                            if (isUniqueConstraintError(createErr)) {
                                try {
                                    // SAVEPOINT로 롤백
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    
                                    // 레코드가 실제로 존재하는지 다시 확인 (동시성 문제 대비)
                                    const retryRecord = Array.isArray(availableUniqueKey)
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
                                        // 서버 utime 추출
                                        const serverUtimeStr = await extractUtimeStringFromRecord(retryRecord, Model, whereCondition, transaction);
                                        
                                        // utime 비교: 클라이언트 utime이 더 높을 때만 업데이트
                                        const shouldUpdate = shouldUpdateBasedOnUtime(clientUtimeStr, serverUtimeStr);
                                        
                                        if (shouldUpdate) {
                                            // 레코드가 존재하면 UPDATE
                                            const updateData = { ...filteredItem };
                                            const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                                            keysToRemove.forEach(key => delete updateData[key]);
                                            
                                            // utime을 문자열로 보장하여 timezone 변환 방지
                                            if (updateData.utime) {
                                                updateData.utime = convertUtimeToSequelizeLiteral(updateData.utime);
                                            }
                                            
                                            await Model.update(updateData, { where: whereCondition, transaction });
                                            const updated = Array.isArray(availableUniqueKey)
                                                ? await Model.findOne({ where: whereCondition, transaction })
                                                : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                            
                                            // 식별 정보 추출
                                            const identifier = {
                                                vcode_id: filteredItem.vcode_id || updated.vcode_id,
                                                sucursal: filteredItem.sucursal || updated.sucursal,
                                                vcode: filteredItem.vcode || updated.vcode
                                            };
                                            
                                            // utime comparison description
                                            let utimeComparison = '';
                                            if (clientUtimeStr && serverUtimeStr) {
                                                utimeComparison = `Client utime(${clientUtimeStr}) > Server utime(${serverUtimeStr})`;
                                            } else if (clientUtimeStr && !serverUtimeStr) {
                                                utimeComparison = `Client utime(${clientUtimeStr}) exists, Server utime missing`;
                                            } else if (!clientUtimeStr && !serverUtimeStr) {
                                                utimeComparison = `Both client and server have no utime`;
                                            }
                                            
                                            results.push({ 
                                                index: i, 
                                                action: 'updated', 
                                                reason: 'client_utime_newer_retry',
                                                reason_en: 'Retry after INSERT failure: Updated because client utime is newer',
                                                utime_comparison: utimeComparison,
                                                identifier: identifier,
                                                data: updated,
                                                serverUtime: serverUtimeStr,
                                                clientUtime: clientUtimeStr
                                            });
                                            updatedCount++;
                                        } else {
                                            // 서버 utime이 더 높거나 같으면 스킵
                                            
                                            // 식별 정보 추출
                                            const identifier = {
                                                vcode_id: filteredItem.vcode_id || retryRecord.vcode_id,
                                                sucursal: filteredItem.sucursal || retryRecord.sucursal,
                                                vcode: filteredItem.vcode || retryRecord.vcode
                                            };
                                            
                                            // utime comparison description
                                            let utimeComparison = '';
                                            let reasonEn = '';
                                            if (clientUtimeStr && serverUtimeStr) {
                                                utimeComparison = `Client utime(${clientUtimeStr}) <= Server utime(${serverUtimeStr})`;
                                                reasonEn = `Retry after INSERT failure: Skipped because server utime(${serverUtimeStr}) is newer than or equal to client utime(${clientUtimeStr})`;
                                            } else if (!clientUtimeStr && serverUtimeStr) {
                                                utimeComparison = `Client utime missing, Server utime(${serverUtimeStr}) exists`;
                                                reasonEn = `Retry after INSERT failure: Skipped because only server has utime`;
                                            } else {
                                                utimeComparison = `Both client and server have no utime`;
                                                reasonEn = `Retry after INSERT failure: Skipped because utime comparison is not possible`;
                                            }
                                            
                                            results.push({ 
                                                index: i, 
                                                action: 'skipped', 
                                                reason: 'server_utime_newer_retry',
                                                reason_en: reasonEn,
                                                utime_comparison: utimeComparison,
                                                identifier: identifier,
                                                data: retryRecord,
                                                serverUtime: serverUtimeStr,
                                                clientUtime: clientUtimeStr
                                            });
                                            skippedCount++;
                                        }
                                    } else {
                                        // 레코드를 찾을 수 없으면 다시 INSERT 시도 (동시성 문제로 인해 발생할 수 있음)
                                        try {
                                            const createData = { ...filteredItem };
                                            // utime을 문자열로 보장하여 timezone 변환 방지
                                            if (createData.utime) {
                                                createData.utime = convertUtimeToSequelizeLiteral(createData.utime);
                                            }
                                            const created = await Model.create(createData, { transaction });
                                            
                                            // 식별 정보 추출
                                            const identifier = {
                                                vcode_id: filteredItem.vcode_id || created.vcode_id,
                                                sucursal: filteredItem.sucursal || created.sucursal,
                                                vcode: filteredItem.vcode || created.vcode
                                            };
                                            
                                            results.push({ 
                                                index: i, 
                                                action: 'created', 
                                                reason: 'new_record_retry',
                                                reason_en: 'Retry after INSERT failure: Created new record because record was not found',
                                                identifier: identifier,
                                                data: created 
                                            });
                                            createdCount++;
                                        } catch (retryCreateErr) {
                                            // 재시도 INSERT도 실패하면 원래 에러를 다시 던짐
                                            throw createErr;
                                        }
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
                        const createData = { ...filteredItem };
                        // utime을 문자열로 보장하여 timezone 변환 방지
                        if (createData.utime) {
                            createData.utime = convertUtimeToSequelizeLiteral(createData.utime);
                        }
                        const created = await Model.create(createData, { transaction });
                        
                        // 식별 정보 추출
                        const identifier = {
                            vcode_id: filteredItem.vcode_id || created.vcode_id,
                            sucursal: filteredItem.sucursal || created.sucursal,
                            vcode: filteredItem.vcode || created.vcode
                        };
                        
                        results.push({ 
                            index: i, 
                            action: 'created', 
                            reason: 'new_record_no_unique_key',
                            reason_en: 'Created new record because no unique key was found',
                            identifier: identifier,
                            data: created 
                        });
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
                console.error(`ERROR: Vcodes INSERT/UPDATE failed (item ${i}) [${errorClassification.source}]: ${err.message}`);
                console.error(`   Problem Source: ${errorClassification.description}`);
                console.error(`   Reason: ${errorClassification.reason}`);
                
                // 에러 발생 시에도 식별 정보 추출 시도
                const errorItem = item || req.body.data[i] || null;
                const errorIdentifier = errorItem ? {
                    vcode_id: errorItem.vcode_id,
                    sucursal: errorItem.sucursal,
                    vcode: errorItem.vcode
                } : null;
                
                const errorItem_result = { 
                    index: i, 
                    action: 'failed',
                    reason: 'error_occurred',
                    reason_en: `Error occurred during processing: ${err.message}`,
                    error: err.message,
                    errorType: err.constructor.name,
                    errorClassification: {
                        source: errorClassification.source,
                        description: errorClassification.description,
                        reason: errorClassification.reason
                    },
                    identifier: errorIdentifier,
                    data: errorItem
                };
                errors.push(errorItem_result);
                const errorVcodeId = errorIdentifier?.vcode_id || 'N/A';
                const errorSucursal = errorIdentifier?.sucursal || 'N/A';
                console.log(`[Vcodes BatchSync] ${dbName} | Item ${i + 1}/${req.body.data.length}: FAILED | vcode_id=${errorVcodeId}, sucursal=${errorSucursal} | ${errorItem_result.reason_en}`);
            }
        }
        
        if (errors.length > 0) {
            // 트랜잭션이 아직 완료되지 않았는지 확인
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
        } else {
            // 트랜잭션이 아직 완료되지 않았는지 확인
            if (transaction && !transaction.finished) {
                await transaction.commit();
            }
        }
        
        const totalCount = req.body.data.length;
        const skippedMessage = skippedCount > 0 ? `, ${skippedCount} skipped` : '';
        const result = {
            success: true,
            message: `Vcodes processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated${skippedMessage}), ${errors.length} failed`,
            processed: results.length,
            failed: errors.length,
            total: totalCount,
            created: createdCount,
            updated: updatedCount,
            skipped: skippedCount,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        };
        
        if (errors.length === 0) {
            req._processingStats = {
                total: totalCount,
                created: createdCount,
                updated: updatedCount,
                deleted: 0,
                skipped: skippedCount,
                failed: errors.length
            };
        }
        
        return result;
    } catch (err) {
        // 에러 발생 시 트랜잭션 롤백
        // 트랜잭션이 아직 활성 상태인지 확인하고 롤백
        // 이렇게 하면 "idle in transaction" 상태를 방지할 수 있음
        try {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
        } catch (rollbackErr) {
            console.error(`[Transaction Rollback Error] ${rollbackErr.message}`);
        }
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
                console.error(`ERROR: Vcodes INSERT/UPDATE failed (item ${i}) [${errorClassification.source}]: ${err.message}`);
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
            // 트랜잭션이 아직 완료되지 않았는지 확인
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
        } else {
            // 트랜잭션이 아직 완료되지 않았는지 확인
            if (transaction && !transaction.finished) {
                await transaction.commit();
            }
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
        // 에러 발생 시 트랜잭션 롤백
        // 트랜잭션이 아직 활성 상태인지 확인하고 롤백
        // 이렇게 하면 "idle in transaction" 상태를 방지할 수 있음
        try {
            if (transaction && !transaction.finished) {
                await transaction.rollback();
            }
        } catch (rollbackErr) {
            console.error(`[Transaction Rollback Error] ${rollbackErr.message}`);
        }
        throw err;
    }
}

module.exports = { handleVcodesBatchSync, handleVcodesArrayData };

