// utime 비교를 통한 업데이트 처리 핸들러 (codigos, todocodigos 전용)
const { Sequelize } = require('sequelize');
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition, isUniqueConstraintError } = require('./batch-sync-handler');
const { processBatchedArray } = require('./batch-processor');

/**
 * utime을 비교하여 클라이언트 utime이 더 높을 때만 업데이트하는 핸들러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 * @param {Object} Model - Sequelize 모델
 * @param {string|Array} primaryKey - Primary key
 * @param {string} modelName - 모델 이름
 * @returns {Promise<Object>} 처리 결과
 */
async function handleUtimeComparisonArrayData(req, res, Model, primaryKey, modelName) {
    const operation = (req.body.operation || req.body.trigger_operation || '').toUpperCase();
    
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
    let skippedCount = 0; // utime 비교로 스킵된 항목 수
    
    try {
        const uniqueKeys = getUniqueKeys(Model, primaryKey);
        
        for (let i = 0; i < req.body.data.length; i++) {
            // 각 항목 처리 전에 SAVEPOINT 생성 (에러 발생 시 롤백용)
            const savepointName = `sp_utime_${i}_${Date.now()}`;
            try {
                await sequelize.query(`SAVEPOINT ${savepointName}`, { transaction });
            } catch (spErr) {
                // SAVEPOINT 생성 실패는 무시하고 계속 진행
            }
            
            try {
                const item = req.body.data[i];
                const cleanedData = removeSyncField(item);
                const filteredItem = filterModelFields(Model, cleanedData);
                
                // 클라이언트에서 온 utime 값 (문자열로 직접 비교, timezone 변환 없음)
                let clientUtimeStr = null;
                if (filteredItem.utime) {
                    if (filteredItem.utime instanceof Date) {
                        // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                        // YYYY-MM-DD HH:mm:ss.SSS 형식으로 변환
                        const year = filteredItem.utime.getFullYear();
                        const month = String(filteredItem.utime.getMonth() + 1).padStart(2, '0');
                        const day = String(filteredItem.utime.getDate()).padStart(2, '0');
                        const hours = String(filteredItem.utime.getHours()).padStart(2, '0');
                        const minutes = String(filteredItem.utime.getMinutes()).padStart(2, '0');
                        const seconds = String(filteredItem.utime.getSeconds()).padStart(2, '0');
                        const ms = String(filteredItem.utime.getMilliseconds()).padStart(3, '0');
                        clientUtimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                    } else {
                        // 문자열인 경우 ISO 8601 형식의 'T'를 공백으로 변환하여 통일된 형식으로 비교
                        // "2025-11-27T19:20:52.615" -> "2025-11-27 19:20:52.615"
                        let utimeStr = String(filteredItem.utime);
                        // 'T'를 공백으로 변환 (ISO 8601 형식 처리)
                        utimeStr = utimeStr.replace(/T/, ' ');
                        // 시간대 정보 제거 (Z, +09:00 등)
                        utimeStr = utimeStr.replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
                        clientUtimeStr = utimeStr.trim();
                    }
                }
                
                // UPDATE operation 처리
                if (operation === 'UPDATE' || operation === 'INSERT' || operation === 'CREATE') {
                    const availableUniqueKey = findAvailableUniqueKey(filteredItem, uniqueKeys);
                    
                    if (availableUniqueKey) {
                        const whereCondition = buildWhereCondition(filteredItem, availableUniqueKey);
                        
                        // 기존 레코드 조회 (utime을 문자열로 직접 가져오기 위해 raw 옵션 사용)
                        const Sequelize = require('sequelize');
                        const existingRecord = Array.isArray(availableUniqueKey)
                            ? await Model.findOne({ 
                                where: whereCondition, 
                                transaction,
                                attributes: {
                                    include: [
                                        [Sequelize.literal(`utime::text`), 'utime_str']
                                    ]
                                },
                                raw: true // 원본 데이터베이스 값을 그대로 가져오기
                            })
                            : await Model.findByPk(filteredItem[availableUniqueKey], { 
                                transaction,
                                attributes: {
                                    include: [
                                        [Sequelize.literal(`utime::text`), 'utime_str']
                                    ]
                                },
                                raw: true // 원본 데이터베이스 값을 그대로 가져오기
                            });
                        
                        if (existingRecord) {
                            // 기존 레코드의 utime 값 (데이터베이스에서 문자열로 직접 가져옴, timezone 변환 없음)
                            let serverUtimeStr = null;
                            // raw: true를 사용했으므로 utime_str 필드에서 직접 가져오거나, utime 필드가 문자열일 수 있음
                            if (existingRecord.utime_str) {
                                // Sequelize.literal로 가져온 문자열 값 사용
                                serverUtimeStr = String(existingRecord.utime_str).trim();
                            } else if (existingRecord.utime) {
                                // utime 필드가 있는 경우 (문자열 또는 Date 객체)
                                if (existingRecord.utime instanceof Date) {
                                    // Date 객체인 경우 - 이 경우는 raw: true를 사용했으므로 발생하지 않아야 하지만 안전을 위해 처리
                                    // 원본 데이터베이스 값을 가져오기 위해 다시 조회
                                    const rawRecord = await Model.findOne({ 
                                        where: whereCondition, 
                                        transaction,
                                        attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                                        raw: true
                                    });
                                    if (rawRecord && rawRecord.utime) {
                                        serverUtimeStr = String(rawRecord.utime).trim();
                                    }
                                } else {
                                    // 문자열인 경우 그대로 사용 (timezone 변환 없음)
                                    serverUtimeStr = String(existingRecord.utime).trim();
                                }
                            }
                            
                            // utime 비교: 클라이언트 utime이 더 높을 때만 업데이트 (문자열 직접 비교)
                            let shouldUpdate = false;
                            
                            if (!clientUtimeStr && !serverUtimeStr) {
                                // 둘 다 utime이 없으면 업데이트
                                shouldUpdate = true;
                            } else if (clientUtimeStr && !serverUtimeStr) {
                                // 클라이언트에만 utime이 있으면 업데이트
                                shouldUpdate = true;
                            } else if (clientUtimeStr && serverUtimeStr) {
                                // 둘 다 utime이 있으면 문자열 직접 비교 (timezone 변환 없음)
                                shouldUpdate = clientUtimeStr > serverUtimeStr;
                            } else {
                                // 서버에만 utime이 있으면 업데이트하지 않음
                                shouldUpdate = false;
                            }
                            
                            if (shouldUpdate) {
                                // 업데이트 수행
                                const updateData = { ...filteredItem };
                                const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                                keysToRemove.forEach(key => delete updateData[key]);
                                
                                // utime을 문자열로 보장하여 timezone 변환 방지 (Sequelize.literal 사용)
                                if (updateData.utime) {
                                    let utimeStr = null;
                                    if (updateData.utime instanceof Date) {
                                        // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                                        const year = updateData.utime.getFullYear();
                                        const month = String(updateData.utime.getMonth() + 1).padStart(2, '0');
                                        const day = String(updateData.utime.getDate()).padStart(2, '0');
                                        const hours = String(updateData.utime.getHours()).padStart(2, '0');
                                        const minutes = String(updateData.utime.getMinutes()).padStart(2, '0');
                                        const seconds = String(updateData.utime.getSeconds()).padStart(2, '0');
                                        const ms = String(updateData.utime.getMilliseconds()).padStart(3, '0');
                                        utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                                    } else {
                                        // 문자열인 경우 그대로 사용 (timezone 변환 없음)
                                        utimeStr = String(updateData.utime);
                                    }
                                    // Sequelize.literal을 사용하여 문자열을 그대로 저장 (timezone 변환 방지)
                                    updateData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                                }
                                
                                await Model.update(updateData, { where: whereCondition, transaction });
                                const updated = Array.isArray(availableUniqueKey)
                                    ? await Model.findOne({ where: whereCondition, transaction })
                                    : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                results.push({ index: i, action: 'updated', data: updated });
                                updatedCount++;
                                
                                // SAVEPOINT 해제
                                try {
                                    await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                } catch (releaseErr) {
                                    // 무시
                                }
                            } else {
                                // 서버 utime이 더 높거나 같으면 스킵
                                results.push({ 
                                    index: i, 
                                    action: 'skipped', 
                                    reason: 'server_utime_newer',
                                    serverUtime: serverUtimeStr,
                                    clientUtime: clientUtimeStr,
                                    data: existingRecord 
                                });
                                skippedCount++;
                                
                                // SAVEPOINT 해제
                                try {
                                    await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                } catch (releaseErr) {
                                    // 무시
                                }
                            }
                        } else {
                            // 레코드가 없으면 INSERT 시도
                            // utime을 문자열로 보장하여 timezone 변환 방지 (Sequelize.literal 사용)
                            const createData = { ...filteredItem };
                            if (createData.utime) {
                                let utimeStr = null;
                                if (createData.utime instanceof Date) {
                                    // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                                    const year = createData.utime.getFullYear();
                                    const month = String(createData.utime.getMonth() + 1).padStart(2, '0');
                                    const day = String(createData.utime.getDate()).padStart(2, '0');
                                    const hours = String(createData.utime.getHours()).padStart(2, '0');
                                    const minutes = String(createData.utime.getMinutes()).padStart(2, '0');
                                    const seconds = String(createData.utime.getSeconds()).padStart(2, '0');
                                    const ms = String(createData.utime.getMilliseconds()).padStart(3, '0');
                                    utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                                } else {
                                    // 문자열인 경우 그대로 사용 (timezone 변환 없음)
                                    utimeStr = String(createData.utime);
                                }
                                // Sequelize.literal을 사용하여 문자열을 그대로 저장 (timezone 변환 방지)
                                createData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                            }
                            try {
                                const created = await Model.create(createData, { transaction });
                                results.push({ index: i, action: 'created', data: created });
                                createdCount++;
                                
                                // SAVEPOINT 해제
                                try {
                                    await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                } catch (releaseErr) {
                                    // 무시
                                }
                            } catch (createErr) {
                                // unique constraint 에러인 경우 SAVEPOINT로 롤백 후 레코드를 다시 조회하여 utime 비교 수행
                                if (isUniqueConstraintError(createErr)) {
                                    try {
                                        // SAVEPOINT로 롤백하여 트랜잭션 상태 복구
                                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    } catch (rollbackErr) {
                                        // 롤백 실패는 무시 (이미 롤백되었을 수 있음)
                                    }
                                    
                                    // 레코드가 실제로 존재하는지 다시 확인
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
                                        // 기존 레코드의 utime 값 (데이터베이스에서 문자열로 직접 가져옴)
                                        let serverUtimeStr = null;
                                        if (retryRecord.utime_str) {
                                            serverUtimeStr = String(retryRecord.utime_str).trim();
                                        } else if (retryRecord.utime) {
                                            if (retryRecord.utime instanceof Date) {
                                                const rawRecord = await Model.findOne({ 
                                                    where: whereCondition, 
                                                    transaction,
                                                    attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                                                    raw: true
                                                });
                                                if (rawRecord && rawRecord.utime) {
                                                    serverUtimeStr = String(rawRecord.utime).trim();
                                                }
                                            } else {
                                                serverUtimeStr = String(retryRecord.utime).trim();
                                            }
                                        }
                                        
                                        // utime 비교: 클라이언트 utime이 더 높을 때만 업데이트
                                        let shouldUpdate = false;
                                        
                                        if (!clientUtimeStr && !serverUtimeStr) {
                                            shouldUpdate = true;
                                        } else if (clientUtimeStr && !serverUtimeStr) {
                                            shouldUpdate = true;
                                        } else if (clientUtimeStr && serverUtimeStr) {
                                            shouldUpdate = clientUtimeStr > serverUtimeStr;
                                        } else {
                                            shouldUpdate = false;
                                        }
                                        
                                        if (shouldUpdate) {
                                            // 업데이트 수행
                                            const updateData = { ...filteredItem };
                                            const keysToRemove = Array.isArray(availableUniqueKey) ? availableUniqueKey : [availableUniqueKey];
                                            keysToRemove.forEach(key => delete updateData[key]);
                                            
                                            // utime을 문자열로 보장하여 timezone 변환 방지
                                            if (updateData.utime) {
                                                let utimeStr = null;
                                                if (updateData.utime instanceof Date) {
                                                    const year = updateData.utime.getFullYear();
                                                    const month = String(updateData.utime.getMonth() + 1).padStart(2, '0');
                                                    const day = String(updateData.utime.getDate()).padStart(2, '0');
                                                    const hours = String(updateData.utime.getHours()).padStart(2, '0');
                                                    const minutes = String(updateData.utime.getMinutes()).padStart(2, '0');
                                                    const seconds = String(updateData.utime.getSeconds()).padStart(2, '0');
                                                    const ms = String(updateData.utime.getMilliseconds()).padStart(3, '0');
                                                    utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                                                } else {
                                                    utimeStr = String(updateData.utime);
                                                }
                                                updateData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                                            }
                                            
                                            await Model.update(updateData, { where: whereCondition, transaction });
                                            const updated = Array.isArray(availableUniqueKey)
                                                ? await Model.findOne({ where: whereCondition, transaction })
                                                : await Model.findByPk(filteredItem[availableUniqueKey], { transaction });
                                            results.push({ index: i, action: 'updated', data: updated });
                                            updatedCount++;
                                            
                                            // SAVEPOINT 해제
                                            try {
                                                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                            } catch (releaseErr) {
                                                // 무시
                                            }
                                        } else {
                                            // 서버 utime이 더 높거나 같으면 스킵
                                            results.push({ 
                                                index: i, 
                                                action: 'skipped', 
                                                reason: 'server_utime_newer',
                                                serverUtime: serverUtimeStr,
                                                clientUtime: clientUtimeStr,
                                                data: retryRecord 
                                            });
                                            skippedCount++;
                                            
                                            // SAVEPOINT 해제
                                            try {
                                                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                            } catch (releaseErr) {
                                                // 무시
                                            }
                                        }
                                    } else {
                                        // 레코드를 찾을 수 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                        try {
                                            await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                        } catch (rollbackErr) {
                                            // 무시
                                        }
                                        throw createErr;
                                    }
                                } else {
                                    // unique constraint 에러가 아니면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                    try {
                                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    } catch (rollbackErr) {
                                        // 무시
                                    }
                                    throw createErr;
                                }
                            }
                        }
                    } else {
                        // unique key가 없으면 INSERT 시도
                        // utime을 문자열로 보장하여 timezone 변환 방지 (Sequelize.literal 사용)
                        const createData = { ...filteredItem };
                        if (createData.utime) {
                            let utimeStr = null;
                            if (createData.utime instanceof Date) {
                                // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                                const year = createData.utime.getFullYear();
                                const month = String(createData.utime.getMonth() + 1).padStart(2, '0');
                                const day = String(createData.utime.getDate()).padStart(2, '0');
                                const hours = String(createData.utime.getHours()).padStart(2, '0');
                                const minutes = String(createData.utime.getMinutes()).padStart(2, '0');
                                const seconds = String(createData.utime.getSeconds()).padStart(2, '0');
                                const ms = String(createData.utime.getMilliseconds()).padStart(3, '0');
                                utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                            } else {
                                // 문자열인 경우 그대로 사용 (timezone 변환 없음)
                                utimeStr = String(createData.utime);
                            }
                            // Sequelize.literal을 사용하여 문자열을 그대로 저장 (timezone 변환 방지)
                            const Sequelize = require('sequelize');
                            createData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                        }
                        try {
                            const created = await Model.create(createData, { transaction });
                            results.push({ index: i, action: 'created', data: created });
                            createdCount++;
                            
                            // SAVEPOINT 해제
                            try {
                                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                            } catch (releaseErr) {
                                // 무시
                            }
                        } catch (createErr) {
                            // unique constraint 에러인 경우 SAVEPOINT로 롤백 후 primary key로 레코드를 조회하여 utime 비교 수행
                            if (isUniqueConstraintError(createErr) && primaryKey) {
                                try {
                                    // SAVEPOINT로 롤백하여 트랜잭션 상태 복구
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                } catch (rollbackErr) {
                                    // 롤백 실패는 무시 (이미 롤백되었을 수 있음)
                                }
                                
                                // primary key로 레코드 조회
                                const primaryKeyValue = Array.isArray(primaryKey) 
                                    ? primaryKey.map(key => filteredItem[key]).filter(v => v !== undefined && v !== null)
                                    : filteredItem[primaryKey];
                                
                                if (primaryKeyValue) {
                                    const primaryKeyWhere = Array.isArray(primaryKey)
                                        ? primaryKey.reduce((acc, key) => {
                                            if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                                                acc[key] = filteredItem[key];
                                            }
                                            return acc;
                                        }, {})
                                        : { [primaryKey]: filteredItem[primaryKey] };
                                    
                                    const retryRecord = await Model.findOne({ 
                                        where: primaryKeyWhere, 
                                        transaction,
                                        attributes: {
                                            include: [
                                                [Sequelize.literal(`utime::text`), 'utime_str']
                                            ]
                                        },
                                        raw: true
                                    });
                                    
                                    if (retryRecord) {
                                        // 기존 레코드의 utime 값
                                        let serverUtimeStr = null;
                                        if (retryRecord.utime_str) {
                                            serverUtimeStr = String(retryRecord.utime_str).trim();
                                        } else if (retryRecord.utime) {
                                            if (retryRecord.utime instanceof Date) {
                                                const rawRecord = await Model.findOne({ 
                                                    where: primaryKeyWhere, 
                                                    transaction,
                                                    attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                                                    raw: true
                                                });
                                                if (rawRecord && rawRecord.utime) {
                                                    serverUtimeStr = String(rawRecord.utime).trim();
                                                }
                                            } else {
                                                serverUtimeStr = String(retryRecord.utime).trim();
                                            }
                                        }
                                        
                                        // utime 비교
                                        let shouldUpdate = false;
                                        
                                        if (!clientUtimeStr && !serverUtimeStr) {
                                            shouldUpdate = true;
                                        } else if (clientUtimeStr && !serverUtimeStr) {
                                            shouldUpdate = true;
                                        } else if (clientUtimeStr && serverUtimeStr) {
                                            shouldUpdate = clientUtimeStr > serverUtimeStr;
                                        } else {
                                            shouldUpdate = false;
                                        }
                                        
                                        if (shouldUpdate) {
                                            // 업데이트 수행
                                            const updateData = { ...filteredItem };
                                            const keysToRemove = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
                                            keysToRemove.forEach(key => delete updateData[key]);
                                            
                                            // utime을 문자열로 보장하여 timezone 변환 방지
                                            if (updateData.utime) {
                                                let utimeStr = null;
                                                if (updateData.utime instanceof Date) {
                                                    const year = updateData.utime.getFullYear();
                                                    const month = String(updateData.utime.getMonth() + 1).padStart(2, '0');
                                                    const day = String(updateData.utime.getDate()).padStart(2, '0');
                                                    const hours = String(updateData.utime.getHours()).padStart(2, '0');
                                                    const minutes = String(updateData.utime.getMinutes()).padStart(2, '0');
                                                    const seconds = String(updateData.utime.getSeconds()).padStart(2, '0');
                                                    const ms = String(updateData.utime.getMilliseconds()).padStart(3, '0');
                                                    utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                                                } else {
                                                    utimeStr = String(updateData.utime);
                                                }
                                                updateData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                                            }
                                            
                                            await Model.update(updateData, { where: primaryKeyWhere, transaction });
                                            const updated = await Model.findOne({ where: primaryKeyWhere, transaction });
                                            results.push({ index: i, action: 'updated', data: updated });
                                            updatedCount++;
                                            
                                            // SAVEPOINT 해제
                                            try {
                                                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                            } catch (releaseErr) {
                                                // 무시
                                            }
                                        } else {
                                            // 서버 utime이 더 높거나 같으면 스킵
                                            results.push({ 
                                                index: i, 
                                                action: 'skipped', 
                                                reason: 'server_utime_newer',
                                                serverUtime: serverUtimeStr,
                                                clientUtime: clientUtimeStr,
                                                data: retryRecord 
                                            });
                                            skippedCount++;
                                            
                                            // SAVEPOINT 해제
                                            try {
                                                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                            } catch (releaseErr) {
                                                // 무시
                                            }
                                        }
                                    } else {
                                        // 레코드를 찾을 수 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                        try {
                                            await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                        } catch (rollbackErr) {
                                            // 무시
                                        }
                                        throw createErr;
                                    }
                                } else {
                                    // primary key 값이 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                    try {
                                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    } catch (rollbackErr) {
                                        // 무시
                                    }
                                    throw createErr;
                                }
                            } else {
                                // unique constraint 에러가 아니거나 primary key가 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                try {
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                } catch (rollbackErr) {
                                    // 무시
                                }
                                throw createErr;
                            }
                        }
                    }
                } else {
                    // UPDATE가 아닌 경우 기본 처리
                    // utime을 문자열로 보장하여 timezone 변환 방지 (Sequelize.literal 사용)
                    const createData = { ...filteredItem };
                    if (createData.utime) {
                        let utimeStr = null;
                        if (createData.utime instanceof Date) {
                            // Date 객체인 경우 원본 문자열 형식으로 변환 (timezone 변환 없이)
                            const year = createData.utime.getFullYear();
                            const month = String(createData.utime.getMonth() + 1).padStart(2, '0');
                            const day = String(createData.utime.getDate()).padStart(2, '0');
                            const hours = String(createData.utime.getHours()).padStart(2, '0');
                            const minutes = String(createData.utime.getMinutes()).padStart(2, '0');
                            const seconds = String(createData.utime.getSeconds()).padStart(2, '0');
                            const ms = String(createData.utime.getMilliseconds()).padStart(3, '0');
                            utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                        } else {
                            // 문자열인 경우 그대로 사용 (timezone 변환 없음)
                            utimeStr = String(createData.utime);
                        }
                        // Sequelize.literal을 사용하여 문자열을 그대로 저장 (timezone 변환 방지)
                        const Sequelize = require('sequelize');
                        createData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                    }
                    try {
                        const created = await Model.create(createData, { transaction });
                        results.push({ index: i, action: 'created', data: created });
                        createdCount++;
                        
                        // SAVEPOINT 해제
                        try {
                            await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                        } catch (releaseErr) {
                            // 무시
                        }
                    } catch (createErr) {
                        // unique constraint 에러인 경우 SAVEPOINT로 롤백 후 primary key로 레코드를 조회하여 utime 비교 수행
                        if (isUniqueConstraintError(createErr) && primaryKey) {
                            try {
                                // SAVEPOINT로 롤백하여 트랜잭션 상태 복구
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            } catch (rollbackErr) {
                                // 롤백 실패는 무시 (이미 롤백되었을 수 있음)
                            }
                            
                            // primary key로 레코드 조회
                            const primaryKeyValue = Array.isArray(primaryKey) 
                                ? primaryKey.map(key => filteredItem[key]).filter(v => v !== undefined && v !== null)
                                : filteredItem[primaryKey];
                            
                            if (primaryKeyValue) {
                                const primaryKeyWhere = Array.isArray(primaryKey)
                                    ? primaryKey.reduce((acc, key) => {
                                        if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                                            acc[key] = filteredItem[key];
                                        }
                                        return acc;
                                    }, {})
                                    : { [primaryKey]: filteredItem[primaryKey] };
                                
                                const retryRecord = await Model.findOne({ 
                                    where: primaryKeyWhere, 
                                    transaction,
                                    attributes: {
                                        include: [
                                            [Sequelize.literal(`utime::text`), 'utime_str']
                                        ]
                                    },
                                    raw: true
                                });
                                
                                if (retryRecord) {
                                    // 기존 레코드의 utime 값
                                    let serverUtimeStr = null;
                                    if (retryRecord.utime_str) {
                                        serverUtimeStr = String(retryRecord.utime_str).trim();
                                    } else if (retryRecord.utime) {
                                        if (retryRecord.utime instanceof Date) {
                                            const rawRecord = await Model.findOne({ 
                                                where: primaryKeyWhere, 
                                                transaction,
                                                attributes: [[Sequelize.literal(`utime::text`), 'utime']],
                                                raw: true
                                            });
                                            if (rawRecord && rawRecord.utime) {
                                                serverUtimeStr = String(rawRecord.utime).trim();
                                            }
                                        } else {
                                            serverUtimeStr = String(retryRecord.utime).trim();
                                        }
                                    }
                                    
                                    // utime 비교
                                    let shouldUpdate = false;
                                    
                                    if (!clientUtimeStr && !serverUtimeStr) {
                                        shouldUpdate = true;
                                    } else if (clientUtimeStr && !serverUtimeStr) {
                                        shouldUpdate = true;
                                    } else if (clientUtimeStr && serverUtimeStr) {
                                        shouldUpdate = clientUtimeStr > serverUtimeStr;
                                    } else {
                                        shouldUpdate = false;
                                    }
                                    
                                    if (shouldUpdate) {
                                        // 업데이트 수행
                                        const updateData = { ...filteredItem };
                                        const keysToRemove = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
                                        keysToRemove.forEach(key => delete updateData[key]);
                                        
                                        // utime을 문자열로 보장하여 timezone 변환 방지
                                        if (updateData.utime) {
                                            let utimeStr = null;
                                            if (updateData.utime instanceof Date) {
                                                const year = updateData.utime.getFullYear();
                                                const month = String(updateData.utime.getMonth() + 1).padStart(2, '0');
                                                const day = String(updateData.utime.getDate()).padStart(2, '0');
                                                const hours = String(updateData.utime.getHours()).padStart(2, '0');
                                                const minutes = String(updateData.utime.getMinutes()).padStart(2, '0');
                                                const seconds = String(updateData.utime.getSeconds()).padStart(2, '0');
                                                const ms = String(updateData.utime.getMilliseconds()).padStart(3, '0');
                                                utimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
                                            } else {
                                                utimeStr = String(updateData.utime);
                                            }
                                            updateData.utime = Sequelize.literal(`'${utimeStr.replace(/'/g, "''")}'::timestamp`);
                                        }
                                        
                                        await Model.update(updateData, { where: primaryKeyWhere, transaction });
                                        const updated = await Model.findOne({ where: primaryKeyWhere, transaction });
                                        results.push({ index: i, action: 'updated', data: updated });
                                        updatedCount++;
                                        
                                        // SAVEPOINT 해제
                                        try {
                                            await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                        } catch (releaseErr) {
                                            // 무시
                                        }
                                    } else {
                                        // 서버 utime이 더 높거나 같으면 스킵
                                        results.push({ 
                                            index: i, 
                                            action: 'skipped', 
                                            reason: 'server_utime_newer',
                                            serverUtime: serverUtimeStr,
                                            clientUtime: clientUtimeStr,
                                            data: retryRecord 
                                        });
                                        skippedCount++;
                                        
                                        // SAVEPOINT 해제
                                        try {
                                            await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                        } catch (releaseErr) {
                                            // 무시
                                        }
                                    }
                                } else {
                                    // 레코드를 찾을 수 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                    try {
                                        await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                    } catch (rollbackErr) {
                                        // 무시
                                    }
                                    throw createErr;
                                }
                            } else {
                                // primary key 값이 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                                try {
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                } catch (rollbackErr) {
                                    // 무시
                                }
                                throw createErr;
                            }
                        } else {
                            // unique constraint 에러가 아니거나 primary key가 없으면 SAVEPOINT 롤백 후 원래 에러를 다시 던짐
                            try {
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            } catch (rollbackErr) {
                                // 무시
                            }
                            throw createErr;
                        }
                    }
                }
            } catch (itemErr) {
                // SAVEPOINT 롤백 시도
                try {
                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                } catch (rollbackErr) {
                    // 무시
                }
                
                errors.push({ 
                    index: i, 
                    error: itemErr.message,
                    errorType: itemErr.constructor.name,
                    data: req.body.data[i] 
                });
                // 에러 발생 시 즉시 중단하고 롤백 (원자성 보장)
                await transaction.rollback();
                throw itemErr;
            }
        }
        
        // 모든 작업이 성공하면 트랜잭션 커밋
        await transaction.commit();
        
        if (results.length > 0) {
            const totalCount = req.body.data.length;
            
            const result = {
                success: true,
                message: `Processing complete: ${results.length} succeeded (${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped), ${errors.length} failed`,
                processed: results.length,
                failed: errors.length,
                total: totalCount,
                created: createdCount,
                updated: updatedCount,
                skipped: skippedCount,
                results: results,
                errors: errors.length > 0 ? errors : undefined
            };
            
            // req에 통계 정보 저장
            req._processingStats = {
                total: totalCount,
                created: createdCount,
                updated: updatedCount,
                deleted: 0,
                failed: errors.length,
                skipped: skippedCount
            };
            
            await require('./websocket-notifier').notifyBatchSync(req, Model, result);
            return result;
        } else {
            throw new Error('All items failed to process');
        }
    } catch (err) {
        // 에러 발생 시 트랜잭션 롤백
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            // 롤백 에러는 무시 (이미 롤백되었을 수 있음)
        }
        throw err;
    }
}

module.exports = { handleUtimeComparisonArrayData };

