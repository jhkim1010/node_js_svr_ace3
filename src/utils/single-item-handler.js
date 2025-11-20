// 단일 항목 처리 함수 (unique key 기반으로 UPDATE/CREATE 결정)
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition } = require('./batch-sync-handler');

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
            // unique key가 있으면 UPDATE 시도
            const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
            
            // unique key 필드를 업데이트 데이터에서 제거
            const updateData = { ...filteredItem };
            const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
            keysToRemove.forEach(key => delete updateData[key]);
            
            const [count] = await Model.update(updateData, { where: whereCondition, transaction });
            if (count > 0) {
                const updated = Array.isArray(availableUniqueKey)
                    ? await Model.findOne({ where: whereCondition, transaction })
                    : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                await transaction.commit();
                return { action: 'updated', data: updated };
            } else {
                // 레코드가 없으면 INSERT
                const created = await Model.create(filteredItem, { transaction });
                await transaction.commit();
                return { action: 'created', data: created };
            }
        } else {
            // unique key가 없으면 INSERT
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

