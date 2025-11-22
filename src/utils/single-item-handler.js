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
                    // unique constraint 에러가 발생하면 UPDATE로 재시도
                    if (isUniqueConstraintError(createErr)) {
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
                            await transaction.commit();
                            return { action: 'updated', data: updated };
                        }
                    }
                    // unique constraint 에러가 아니거나 레코드를 찾을 수 없으면 원래 에러를 다시 던짐
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

