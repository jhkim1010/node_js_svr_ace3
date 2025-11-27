// 단일 항목 처리 함수 (unique key 기반으로 UPDATE/CREATE 결정)
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition, isUniqueConstraintError } = require('./batch-sync-handler');

async function handleSingleItem(req, res, Model, primaryKey, modelName) {
    const rawData = req.body.new_data || req.body;
    const cleanedData = removeSyncField(rawData);
    const filteredItem = filterModelFields(Model, cleanedData);
    
    // Sequelize 인스턴스 가져오기 (트랜잭션용)
    const sequelize = Model.sequelize;
    if (!sequelize) {
        throw new Error('Sequelize instance not found in Model');
    }
    
    // 트랜잭션 시작
    const transaction = await sequelize.transaction();
    
    try {
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
                await transaction.commit();
                return { action: 'updated', data: updated };
            } else {
                // 레코드가 없으면 INSERT 시도
                try {
                    const created = await Model.create(filteredItem, { transaction });
                    await transaction.commit();
                    return { action: 'created', data: created };
                } catch (createErr) {
                    // unique constraint 에러가 발생하면 트랜잭션 롤백 후 UPDATE로 재시도
                    if (isUniqueConstraintError(createErr)) {
                        // 트랜잭션 롤백 (abort된 트랜잭션에서 재시도 불가)
                        await transaction.rollback();
                        
                        // 새로운 트랜잭션으로 재시도
                        const retryTransaction = await sequelize.transaction();
                        try {
                            // 모든 unique key를 시도하여 레코드 찾기
                            let retryRecord = null;
                            let retryUniqueKey = null;
                            let retryWhereCondition = null;
                            
                            // 먼저 원래 사용한 unique key로 시도
                            retryRecord = Array.isArray(availableUniqueKey)
                                ? await Model.findOne({ where: whereCondition, transaction: retryTransaction })
                                : await Model.findByPk(filteredItem[availableUniqueKey], { transaction: retryTransaction });
                            
                            if (retryRecord) {
                                retryUniqueKey = availableUniqueKey;
                                retryWhereCondition = whereCondition;
                            } else {
                                // 원래 unique key로 찾지 못하면 다른 unique key로 시도
                                for (const uniqueKey of uniqueKeys) {
                                    const testWhereCondition = buildWhereCondition(filteredItem, uniqueKey);
                                    if (Object.keys(testWhereCondition).length > 0) {
                                        retryRecord = Array.isArray(uniqueKey)
                                            ? await Model.findOne({ where: testWhereCondition, transaction: retryTransaction })
                                            : await Model.findByPk(filteredItem[uniqueKey], { transaction: retryTransaction });
                                        
                                        if (retryRecord) {
                                            retryUniqueKey = uniqueKey;
                                            retryWhereCondition = testWhereCondition;
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            if (retryRecord) {
                                // 레코드가 존재하면 UPDATE
                                const updateData = { ...filteredItem };
                                const keysToRemove = Array.isArray(retryUniqueKey) ? retryUniqueKey : [retryUniqueKey];
                                keysToRemove.forEach(key => delete updateData[key]);
                                
                                await Model.update(updateData, { where: retryWhereCondition, transaction: retryTransaction });
                                const updated = Array.isArray(retryUniqueKey)
                                    ? await Model.findOne({ where: retryWhereCondition, transaction: retryTransaction })
                                    : await Model.findByPk(filteredItem[retryUniqueKey], { transaction: retryTransaction });
                                await retryTransaction.commit();
                                return { action: 'updated', data: updated };
                            } else {
                                // 레코드를 찾을 수 없으면 다시 INSERT 시도 (동시성 문제로 인해 발생할 수 있음)
                                try {
                                    const created = await Model.create(filteredItem, { transaction: retryTransaction });
                                    await retryTransaction.commit();
                                    return { action: 'created', data: created };
                                } catch (retryCreateErr) {
                                    // 재시도 INSERT도 실패하면 원래 에러를 다시 던짐
                                    await retryTransaction.rollback();
                                    throw createErr;
                                }
                            }
                        } catch (retryErr) {
                            await retryTransaction.rollback();
                            throw retryErr;
                        }
                    }
                    // unique constraint 에러가 아니면 원래 에러를 다시 던짐
                    throw createErr;
                }
            }
        } else {
            // unique key가 없으면 INSERT 시도
            const created = await Model.create(filteredItem, { transaction });
            await transaction.commit();
            return { action: 'created', data: created };
        }
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
}

module.exports = { handleSingleItem };

