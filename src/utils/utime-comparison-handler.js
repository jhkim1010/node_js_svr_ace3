// utime 비교를 통한 업데이트 처리 핸들러 (codigos, todocodigos 전용)
const { Sequelize } = require('sequelize');
const { removeSyncField, filterModelFields, getUniqueKeys, findAvailableUniqueKey, buildWhereCondition, isUniqueConstraintError } = require('./batch-sync-handler');
const { processBatchedArray } = require('./batch-processor');
const { convertUtimeToString, convertUtimeToSequelizeLiteral } = require('./utime-helpers');
const { findRecordByPrimaryKey, processRecordWithUtimeComparison, handlePrimaryKeyConflict } = require('./utime-record-operations');
const { logErrorWithLocation, logInfoWithLocation } = require('./log-utils');

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
                const clientUtimeStr = convertUtimeToString(filteredItem.utime);

                /**
                 * Codigos, Todocodigos 전용: 새로운 처리 순서
                 * 1) primary key로 기존 레코드 조회 후 utime 비교 → UPDATE / SKIP
                 * 2) 기존 레코드 없으면 INSERT 시도
                 * 3) INSERT 중 UNIQUE 에러 → 어떤 unique constraint 인지 출력 후 SKIP
                 * 4) INSERT 중 FOREIGN KEY 에러 → 어떤 외래키 인지 출력 후 SKIP
                 */
                if (['Codigos', 'Todocodigos', 'Clientes', 'Color', 'Tipos', 'Gastos', 'Vtags'].includes(modelName)) {
                    const primaryKeyArray = Array.isArray(primaryKey) ? primaryKey : [primaryKey];
                    
                    // 1단계: primary key로 기존 레코드 조회
                    let canUsePrimaryKey = true;
                    const primaryKeyWhere = primaryKeyArray.reduce((acc, key) => {
                        const value = filteredItem[key];
                        if (value === undefined || value === null) {
                            canUsePrimaryKey = false;
                        } else {
                            acc[key] = value;
                        }
                        return acc;
                    }, {});

                    if (canUsePrimaryKey && Object.keys(primaryKeyWhere).length === primaryKeyArray.length) {
                        try {
                            const resultPk = await processRecordWithUtimeComparison(
                                Model,
                                filteredItem,
                                clientUtimeStr,
                                primaryKeyWhere,
                                primaryKeyArray,
                                transaction,
                                savepointName,
                                sequelize
                            );

                            if (resultPk.action === 'updated') {
                                results.push({ index: i, action: 'updated', data: resultPk.data });
                                updatedCount++;
                                
                                // primary key 기반 처리 완료 → 다음 아이템으로
                                continue;
                            }

                            if (resultPk.action === 'skipped') {
                                // 서버 utime이 더 높아서 skip하는 경우는 정상 동작이므로 로그 출력하지 않음
                                results.push({
                                    index: i,
                                    action: 'skipped',
                                    reason: resultPk.reason || 'server_utime_newer',
                                    serverUtime: resultPk.serverUtime,
                                    clientUtime: resultPk.clientUtime,
                                    data: resultPk.data
                                });
                                skippedCount++;
                                
                                // primary key 기반 처리 완료 → 다음 아이템으로
                                continue;
                            }
                            // resultPk.action === 'not_found' 인 경우만 INSERT 시도로 진행
                        } catch (pkErr) {
                            // processRecordWithUtimeComparison에서 에러 발생 시
                            // unique constraint 에러인지 확인하고 SKIP 처리
                            const pkErrorMsg = pkErr.original ? pkErr.original.message : pkErr.message || '';
                            const pkLowerMsg = pkErrorMsg.toLowerCase();
                            const isPkUniqueError = isUniqueConstraintError(pkErr) || 
                                                   pkLowerMsg.includes('duplicate key') ||
                                                   pkLowerMsg.includes('unique constraint') ||
                                                   pkLowerMsg.includes('violates unique constraint');
                            
                            if (isPkUniqueError) {
                                const constraintMatch = pkErrorMsg.match(/constraint "([^"]+)"/i);
                                const constraintName = constraintMatch ? constraintMatch[1] : '알 수 없는 제약 조건';
                                
                                // Codigos, Todocodigos 테이블에 대해서 skip 이유 표시 (데이터 손실이므로 ERROR)
                                if (['Codigos', 'Todocodigos'].includes(modelName)) {
                                    const codigo = filteredItem.codigo || filteredItem.id_todocodigo || 'N/A';
                                    const descripcion = filteredItem.descripcion || 'N/A';
                                    logErrorWithLocation(`${modelName} SKIP | codigo: ${codigo}, descripcion: ${descripcion} | 이유: unique constraint (${constraintName})`);
                                }
                                
                                try {
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                } catch (rollbackErr) {
                                    // 무시
                                }
                                
                                results.push({
                                    index: i,
                                    action: 'skipped',
                                    reason: 'unique_constraint_violation',
                                    constraint: constraintName,
                                    error: pkErrorMsg
                                });
                                skippedCount++;
                                continue;
                            } else {
                                // unique constraint 에러가 아니면 다시 throw
                                throw pkErr;
                            }
                        }
                    }

                    // 2단계: primary key로 레코드를 찾지 못했으면 INSERT 시도
                    const createData = { ...filteredItem };
                    if (createData.utime) {
                        createData.utime = convertUtimeToSequelizeLiteral(createData.utime);
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
                        const errorMsg = createErr.original ? createErr.original.message : createErr.message || '';
                        const lowerMsg = errorMsg.toLowerCase();

                        // 3단계: UNIQUE 제약 조건 에러 → 어떤 unique key 인지 출력 후 SKIP
                        // isUniqueConstraintError 함수와 직접 메시지 체크 모두 수행
                        const isUniqueError = isUniqueConstraintError(createErr) || 
                                             lowerMsg.includes('duplicate key') ||
                                             lowerMsg.includes('unique constraint') ||
                                             lowerMsg.includes('violates unique constraint');
                        if (isUniqueError) {
                            const constraintMatch = errorMsg.match(/constraint "([^"]+)"/i);
                            const constraintName = constraintMatch ? constraintMatch[1] : '알 수 없는 제약 조건';

                            // 실패한 INSERT로 인해 트랜잭션이 abort 상태가 되지 않도록 SAVEPOINT로 롤백
                            try {
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            } catch (rollbackErr) {
                                // 무시
                            }

                            // 모든 unique key (primary key + 복합 unique key 포함)로 레코드를 다시 조회하여 utime 비교 시도
                            let retrySuccess = false;
                            
                            // 1. Primary key로 먼저 시도
                            let canRetryWithPrimaryKey = true;
                            const primaryKeyWhereRetry = primaryKeyArray.reduce((acc, key) => {
                                const value = filteredItem[key];
                                if (value === undefined || value === null) {
                                    canRetryWithPrimaryKey = false;
                                } else {
                                    acc[key] = value;
                                }
                                return acc;
                            }, {});

                            if (canRetryWithPrimaryKey && Object.keys(primaryKeyWhereRetry).length === primaryKeyArray.length) {
                                try {
                                    const resultRetry = await processRecordWithUtimeComparison(
                                        Model,
                                        filteredItem,
                                        clientUtimeStr,
                                        primaryKeyWhereRetry,
                                        primaryKeyArray,
                                        transaction,
                                        savepointName,
                                        sequelize
                                    );

                                    if (resultRetry.action === 'updated') {
                                        results.push({ index: i, action: 'updated', data: resultRetry.data });
                                        updatedCount++;
                                        retrySuccess = true;
                                        continue;
                                    }

                                    if (resultRetry.action === 'skipped') {
                                        // 서버 utime이 더 높아서 skip하는 경우는 정상 동작이므로 로그 출력하지 않음
                                        results.push({
                                            index: i,
                                            action: 'skipped',
                                            reason: resultRetry.reason || 'server_utime_newer',
                                            serverUtime: resultRetry.serverUtime,
                                            clientUtime: resultRetry.clientUtime,
                                            data: resultRetry.data
                                        });
                                        skippedCount++;
                                        retrySuccess = true;
                                        continue;
                                    }
                                } catch (retryErr) {
                                    // retry 실패 시 다른 unique key로 시도
                                }
                            }
                            
                            // 2. Primary key로 실패했으면 다른 unique key (복합 포함)로 시도
                            if (!retrySuccess) {
                                for (const uniqueKey of uniqueKeys) {
                                    // Primary key는 이미 시도했으므로 건너뛰기
                                    const isPrimaryKey = Array.isArray(uniqueKey)
                                        ? Array.isArray(primaryKey) && uniqueKey.length === primaryKey.length && 
                                          uniqueKey.every(key => primaryKeyArray.includes(key))
                                        : uniqueKey === primaryKey;
                                    
                                    if (isPrimaryKey) {
                                        continue;
                                    }
                                    
                                    // Unique key에 필요한 모든 값이 있는지 확인
                                    const uniqueKeyArray = Array.isArray(uniqueKey) ? uniqueKey : [uniqueKey];
                                    let canUseUniqueKey = true;
                                    const uniqueKeyWhere = uniqueKeyArray.reduce((acc, key) => {
                                        const value = filteredItem[key];
                                        if (value === undefined || value === null) {
                                            canUseUniqueKey = false;
                                        } else {
                                            acc[key] = value;
                                        }
                                        return acc;
                                    }, {});
                                    
                                    if (canUseUniqueKey && Object.keys(uniqueKeyWhere).length === uniqueKeyArray.length) {
                                        try {
                                            const resultRetry = await processRecordWithUtimeComparison(
                                                Model,
                                                filteredItem,
                                                clientUtimeStr,
                                                uniqueKeyWhere,
                                                uniqueKeyArray,
                                                transaction,
                                                savepointName,
                                                sequelize
                                            );

                                            if (resultRetry.action === 'updated') {
                                                results.push({ index: i, action: 'updated', data: resultRetry.data });
                                                updatedCount++;
                                                retrySuccess = true;
                                                break; // 성공했으면 루프 종료
                                            }

                                            if (resultRetry.action === 'skipped') {
                                                results.push({
                                                    index: i,
                                                    action: 'skipped',
                                                    reason: resultRetry.reason || 'server_utime_newer',
                                                    serverUtime: resultRetry.serverUtime,
                                                    clientUtime: resultRetry.clientUtime,
                                                    data: resultRetry.data
                                                });
                                                skippedCount++;
                                                retrySuccess = true;
                                                break; // 성공했으면 루프 종료
                                            }
                                        } catch (retryErr) {
                                            // 이 unique key로 실패했으면 다음 unique key로 시도
                                            continue;
                                        }
                                    }
                                }
                            }
                            
                            // 3. 모든 unique key로 시도했지만 실패한 경우에만 skip 처리
                            if (retrySuccess) {
                                continue;
                            }

                            // Primary key로 retry 실패하거나 primary key를 사용할 수 없는 경우
                            // Codigos, Todocodigos 테이블에 대해서 skip 이유 표시 (데이터 손실이므로 ERROR)
                            if (['Codigos', 'Todocodigos'].includes(modelName)) {
                                const codigo = filteredItem.codigo || filteredItem.id_todocodigo || 'N/A';
                                const descripcion = filteredItem.descripcion || 'N/A';
                                logErrorWithLocation(`${modelName} SKIP | codigo: ${codigo}, descripcion: ${descripcion} | 이유: unique constraint (${constraintName})`);
                            }

                            results.push({
                                index: i,
                                action: 'skipped',
                                reason: 'unique_constraint_violation',
                                constraint: constraintName,
                                error: errorMsg
                            });
                            skippedCount++;

                            // 이후 작업은 다음 루프로 진행 (새 SAVEPOINT를 생성)
                        }
                        // 4단계: FOREIGN KEY 제약 조건 에러 → 어떤 외래키 인지 출력 후 SKIP
                        else if (
                            createErr.constructor.name.includes('ForeignKeyConstraintError') ||
                            lowerMsg.includes('foreign key constraint') ||
                            lowerMsg.includes('violates foreign key') ||
                            lowerMsg.includes('is not present in table')
                        ) {
                            const keyMatch = errorMsg.match(/Key \(([^)]+)\)=\(([^)]+)\)/i);
                            const tableMatch =
                                errorMsg.match(/is not present in table ['"]([^'"]+)['"]/i) ||
                                errorMsg.match(/table ['"]([^'"]+)['"]/i);
                            const constraintMatch = errorMsg.match(/constraint ['"]([^'"]+)['"]/i);

                            const fkColumn = keyMatch ? keyMatch[1].trim() : '알 수 없는 컬럼';
                            const invalidValue = keyMatch ? keyMatch[2].trim() : '알 수 없는 값';
                            const referencedTable = tableMatch ? tableMatch[1] : '알 수 없는 테이블';
                            const constraintName = constraintMatch ? constraintMatch[1] : '알 수 없는 제약 조건';

                            // Codigos, Todocodigos 테이블에 대해서 skip 이유 표시 (데이터 손실이므로 ERROR)
                            if (['Codigos', 'Todocodigos'].includes(modelName)) {
                                const codigo = filteredItem.codigo || filteredItem.id_todocodigo || 'N/A';
                                const descripcion = filteredItem.descripcion || 'N/A';
                                logErrorWithLocation(`${modelName} SKIP | codigo: ${codigo}, descripcion: ${descripcion} | 이유: foreign key constraint (${fkColumn}=${invalidValue} → ${referencedTable})`);
                            }

                            // 실패한 INSERT로 인해 트랜잭션이 abort 상태가 되지 않도록 SAVEPOINT로 롤백
                            try {
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            } catch (rollbackErr) {
                                // 무시
                            }

                            results.push({
                                index: i,
                                action: 'skipped',
                                reason: 'foreign_key_constraint_violation',
                                constraint: constraintName,
                                column: fkColumn,
                                value: invalidValue,
                                referencedTable: referencedTable,
                                error: errorMsg
                            });
                            skippedCount++;

                            // SAVEPOINT 해제
                            try {
                                await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                            } catch (releaseErr) {
                                // 무시
                            }
                    } else {
                            // 그 외 에러는 SAVEPOINT 롤백 후 그대로 throw (실패로 처리)
                            try {
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            } catch (rollbackErr) {
                                // 무시
                            }
                            throw createErr;
                        }
                    }

                    // Codigos, Todocodigos 에 대해서는 여기까지 처리했으므로 다음 아이템으로
                    continue;
                }
                
                // UPDATE operation 처리 (기존 공통 로직 - Codigos, Todocodigos 이외에서 사용)
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
                                    updateData.utime = convertUtimeToSequelizeLiteral(updateData.utime);
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
                            // availableUniqueKey로 레코드를 찾지 못했을 때, primary key로도 확인
                            let existingRecordByPk = null;
                            if (primaryKey) {
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
                                    
                                    // availableUniqueKey가 primary key와 다른 경우에만 primary key로 조회
                                    const isPrimaryKeySameAsUniqueKey = Array.isArray(availableUniqueKey)
                                        ? Array.isArray(primaryKey) && availableUniqueKey.length === primaryKey.length && 
                                          availableUniqueKey.every(key => primaryKey.includes(key))
                                        : availableUniqueKey === primaryKey;
                                    
                                    if (!isPrimaryKeySameAsUniqueKey) {
                                        existingRecordByPk = await Model.findOne({ 
                                            where: primaryKeyWhere, 
                                            transaction,
                                            attributes: {
                                                include: [
                                                    [Sequelize.literal(`utime::text`), 'utime_str']
                                                ]
                                            },
                                            raw: true
                                        });
                                    }
                                }
                            }
                            
                            if (existingRecordByPk) {
                                // primary key로 레코드를 찾았으면 utime 비교 수행
                                let serverUtimeStr = null;
                                if (existingRecordByPk.utime_str) {
                                    serverUtimeStr = String(existingRecordByPk.utime_str).trim();
                                } else if (existingRecordByPk.utime) {
                                    if (existingRecordByPk.utime instanceof Date) {
                                        const primaryKeyWhere = Array.isArray(primaryKey)
                                            ? primaryKey.reduce((acc, key) => {
                                                if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                                                    acc[key] = filteredItem[key];
                                                }
                                                return acc;
                                            }, {})
                                            : { [primaryKey]: filteredItem[primaryKey] };
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
                                        serverUtimeStr = String(existingRecordByPk.utime).trim();
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
                                    
                                    const primaryKeyWhere = Array.isArray(primaryKey)
                                        ? primaryKey.reduce((acc, key) => {
                                            if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                                                acc[key] = filteredItem[key];
                                            }
                                            return acc;
                                        }, {})
                                        : { [primaryKey]: filteredItem[primaryKey] };
                                    
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
                                        data: existingRecordByPk 
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
                                    createData.utime = convertUtimeToSequelizeLiteral(createData.utime);
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
                                        
                                        // 모든 unique key (primary key + 복합 unique key 포함)로 레코드 조회 시도
                                        let retryRecord = null;
                                        let retryWhereCondition = null;
                                        let retryKeysToRemove = null;
                                        
                                        // 1. Primary key로 먼저 시도
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
                                            
                                            retryRecord = await Model.findOne({ 
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
                                                retryWhereCondition = primaryKeyWhere;
                                                retryKeysToRemove = primaryKey;
                                            }
                                        }
                                        
                                        // 2. Primary key로 찾지 못했으면 모든 unique key로 시도
                                        if (!retryRecord) {
                                            for (const uniqueKey of uniqueKeys) {
                                                // Primary key는 이미 시도했으므로 건너뛰기
                                                const isPrimaryKey = Array.isArray(uniqueKey)
                                                    ? Array.isArray(primaryKey) && uniqueKey.length === primaryKey.length && 
                                                      uniqueKey.every(key => (Array.isArray(primaryKey) ? primaryKey : [primaryKey]).includes(key))
                                                    : uniqueKey === primaryKey;
                                                
                                                if (isPrimaryKey) {
                                                    continue;
                                                }
                                                
                                                // Unique key에 필요한 모든 값이 있는지 확인
                                                const uniqueKeyArray = Array.isArray(uniqueKey) ? uniqueKey : [uniqueKey];
                                                let canUseUniqueKey = true;
                                                const uniqueKeyWhere = uniqueKeyArray.reduce((acc, key) => {
                                                    const value = filteredItem[key];
                                                    if (value === undefined || value === null) {
                                                        canUseUniqueKey = false;
                                                    } else {
                                                        acc[key] = value;
                                                    }
                                                    return acc;
                                                }, {});
                                                
                                                if (canUseUniqueKey && Object.keys(uniqueKeyWhere).length === uniqueKeyArray.length) {
                                                    retryRecord = await Model.findOne({ 
                                                        where: uniqueKeyWhere, 
                                                        transaction,
                                                        attributes: {
                                                            include: [
                                                                [Sequelize.literal(`utime::text`), 'utime_str']
                                                            ]
                                                        },
                                                        raw: true
                                                    });
                                                    
                                                    if (retryRecord) {
                                                        retryWhereCondition = uniqueKeyWhere;
                                                        retryKeysToRemove = uniqueKeyArray;
                                                        break; // 레코드를 찾았으면 루프 종료
                                                    }
                                                }
                                            }
                                        }
                                        
                                        // 3. availableUniqueKey로도 시도 (기존 로직 유지)
                                        if (!retryRecord && availableUniqueKey) {
                                            retryRecord = Array.isArray(availableUniqueKey)
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
                                                retryWhereCondition = whereCondition;
                                                retryKeysToRemove = availableUniqueKey;
                                            }
                                        }
                                        
                                        if (retryRecord) {
                                            // 기존 레코드의 utime 값 (데이터베이스에서 문자열로 직접 가져옴)
                                            let serverUtimeStr = null;
                                            if (retryRecord.utime_str) {
                                                serverUtimeStr = String(retryRecord.utime_str).trim();
                                            } else if (retryRecord.utime) {
                                                if (retryRecord.utime instanceof Date) {
                                                    const primaryKeyWhereForUtime = Array.isArray(primaryKey)
                                                        ? primaryKey.reduce((acc, key) => {
                                                            if (filteredItem[key] !== undefined && filteredItem[key] !== null) {
                                                                acc[key] = filteredItem[key];
                                                            }
                                                            return acc;
                                                        }, {})
                                                        : { [primaryKey]: filteredItem[primaryKey] };
                                                    const rawRecord = await Model.findOne({ 
                                                        where: primaryKeyWhereForUtime, 
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
                                                
                                                // retryWhereCondition과 retryKeysToRemove 사용 (모든 unique key 시도 결과)
                                                const updateWhere = retryWhereCondition;
                                                const keysToRemove = Array.isArray(retryKeysToRemove) ? retryKeysToRemove : [retryKeysToRemove];
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
                                                
                                                if (updateWhere) {
                                                    await Model.update(updateData, { where: updateWhere, transaction });
                                                    const updated = await Model.findOne({ where: updateWhere, transaction });
                                                    results.push({ index: i, action: 'updated', data: updated });
                                                    updatedCount++;
                                                    
                                                    // SAVEPOINT 해제
                                                    try {
                                                        await sequelize.query(`RELEASE SAVEPOINT ${savepointName}`, { transaction });
                                                    } catch (releaseErr) {
                                                        // 무시
                                                    }
                                                } else {
                                                    throw new Error('Cannot determine update condition');
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
                            // unique constraint 에러인 경우 SAVEPOINT로 롤백 후 모든 unique key로 레코드를 조회하여 utime 비교 수행
                            if (isUniqueConstraintError(createErr) && primaryKey) {
                                try {
                                    // SAVEPOINT로 롤백하여 트랜잭션 상태 복구
                                    await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                                } catch (rollbackErr) {
                                    // 롤백 실패는 무시 (이미 롤백되었을 수 있음)
                                }
                                
                                // 모든 unique key (primary key + 복합 unique key 포함)로 레코드 조회 시도
                                let retryRecord = null;
                                let retryWhereCondition = null;
                                let retryKeysToRemove = null;
                                
                                // 1. Primary key로 먼저 시도
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
                                    
                                    retryRecord = await Model.findOne({ 
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
                                        retryWhereCondition = primaryKeyWhere;
                                        retryKeysToRemove = primaryKey;
                                    }
                                }
                                
                                // 2. Primary key로 찾지 못했으면 모든 unique key로 시도
                                if (!retryRecord) {
                                    for (const uniqueKey of uniqueKeys) {
                                        // Primary key는 이미 시도했으므로 건너뛰기
                                        const isPrimaryKey = Array.isArray(uniqueKey)
                                            ? Array.isArray(primaryKey) && uniqueKey.length === primaryKey.length && 
                                              uniqueKey.every(key => (Array.isArray(primaryKey) ? primaryKey : [primaryKey]).includes(key))
                                            : uniqueKey === primaryKey;
                                        
                                        if (isPrimaryKey) {
                                            continue;
                                        }
                                        
                                        // Unique key에 필요한 모든 값이 있는지 확인
                                        const uniqueKeyArray = Array.isArray(uniqueKey) ? uniqueKey : [uniqueKey];
                                        let canUseUniqueKey = true;
                                        const uniqueKeyWhere = uniqueKeyArray.reduce((acc, key) => {
                                            const value = filteredItem[key];
                                            if (value === undefined || value === null) {
                                                canUseUniqueKey = false;
                                            } else {
                                                acc[key] = value;
                                            }
                                            return acc;
                                        }, {});
                                        
                                        if (canUseUniqueKey && Object.keys(uniqueKeyWhere).length === uniqueKeyArray.length) {
                                            retryRecord = await Model.findOne({ 
                                                where: uniqueKeyWhere, 
                                                transaction,
                                                attributes: {
                                                    include: [
                                                        [Sequelize.literal(`utime::text`), 'utime_str']
                                                    ]
                                                },
                                                raw: true
                                            });
                                            
                                            if (retryRecord) {
                                                retryWhereCondition = uniqueKeyWhere;
                                                retryKeysToRemove = uniqueKeyArray;
                                                break; // 레코드를 찾았으면 루프 종료
                                            }
                                        }
                                    }
                                }
                                
                                if (retryRecord) {
                                    
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
                                            const keysToRemove = Array.isArray(retryKeysToRemove) ? retryKeysToRemove : [retryKeysToRemove];
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
                                            
                                            await Model.update(updateData, { where: retryWhereCondition, transaction });
                                            const updated = await Model.findOne({ where: retryWhereCondition, transaction });
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
                        // unique constraint 에러인 경우 SAVEPOINT로 롤백 후 모든 unique key로 레코드를 조회하여 utime 비교 수행
                        if (isUniqueConstraintError(createErr) && primaryKey) {
                            try {
                                // SAVEPOINT로 롤백하여 트랜잭션 상태 복구
                                await sequelize.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, { transaction });
                            } catch (rollbackErr) {
                                // 롤백 실패는 무시 (이미 롤백되었을 수 있음)
                            }
                            
                            // 모든 unique key (primary key + 복합 unique key 포함)로 레코드 조회 시도
                            let retryRecord = null;
                            let retryWhereCondition = null;
                            let retryKeysToRemove = null;
                            
                            // 1. Primary key로 먼저 시도
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
                                
                                retryRecord = await Model.findOne({ 
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
                                    retryWhereCondition = primaryKeyWhere;
                                    retryKeysToRemove = primaryKey;
                                }
                            }
                            
                            // 2. Primary key로 찾지 못했으면 모든 unique key로 시도
                            if (!retryRecord) {
                                for (const uniqueKey of uniqueKeys) {
                                    // Primary key는 이미 시도했으므로 건너뛰기
                                    const isPrimaryKey = Array.isArray(uniqueKey)
                                        ? Array.isArray(primaryKey) && uniqueKey.length === primaryKey.length && 
                                          uniqueKey.every(key => (Array.isArray(primaryKey) ? primaryKey : [primaryKey]).includes(key))
                                        : uniqueKey === primaryKey;
                                    
                                    if (isPrimaryKey) {
                                        continue;
                                    }
                                    
                                    // Unique key에 필요한 모든 값이 있는지 확인
                                    const uniqueKeyArray = Array.isArray(uniqueKey) ? uniqueKey : [uniqueKey];
                                    let canUseUniqueKey = true;
                                    const uniqueKeyWhere = uniqueKeyArray.reduce((acc, key) => {
                                        const value = filteredItem[key];
                                        if (value === undefined || value === null) {
                                            canUseUniqueKey = false;
                                        } else {
                                            acc[key] = value;
                                        }
                                        return acc;
                                    }, {});
                                    
                                    if (canUseUniqueKey && Object.keys(uniqueKeyWhere).length === uniqueKeyArray.length) {
                                        retryRecord = await Model.findOne({ 
                                            where: uniqueKeyWhere, 
                                            transaction,
                                            attributes: {
                                                include: [
                                                    [Sequelize.literal(`utime::text`), 'utime_str']
                                                ]
                                            },
                                            raw: true
                                        });
                                        
                                        if (retryRecord) {
                                            retryWhereCondition = uniqueKeyWhere;
                                            retryKeysToRemove = uniqueKeyArray;
                                            break; // 레코드를 찾았으면 루프 종료
                                        }
                                    }
                                }
                            }
                            
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
                                        const keysToRemove = Array.isArray(retryKeysToRemove) ? retryKeysToRemove : [retryKeysToRemove];
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
                                        
                                        await Model.update(updateData, { where: retryWhereCondition, transaction });
                                        const updated = await Model.findOne({ where: retryWhereCondition, transaction });
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

