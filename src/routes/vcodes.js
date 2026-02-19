const { Router } = require('express');
const { Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields } = require('../utils/batch-sync-handler');
const { handleVcodesBatchSync } = require('../utils/vcodes-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse, logTableError } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const records = await Vcode.findAll({ limit: 100, order: [['vcode_id', 'DESC']] });
        res.json(records);
    } catch (err) {
        logTableError('vcodes', 'list vcodes', err, req);
        res.status(500).json({
            error: 'Failed to list vcodes',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const record = await Vcode.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        logTableError('vcodes', 'fetch vcode', err, req);
        res.status(500).json({
            error: 'Failed to fetch vcode',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

router.post('/', async (req, res) => {
    // Set timeout and keep-alive headers to prevent 502 errors
    res.setTimeout(300000); // 5 minutes timeout
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=300');
    
    const dbName = req.dbConfig?.database ? `[${req.dbConfig.database}]` : '[N/A]';
    const dataCount = Array.isArray(req.body.data) ? req.body.data.length : (req.body.data ? 1 : 0);
    const operation = req.body.operation || 'CREATE';
    
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // BATCH_SYNC 작업 처리 (Vcodes 전용 핸들러 사용)
        // vcodes는 vcode_id와 sucursal의 복합 unique key를 사용
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleVcodesBatchSync(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            console.log(`[Vcodes POST] ${dbName} | BATCH_SYNC: ${dataCount} items → ${result.processed} processed (${result.created} created, ${result.updated} updated, ${result.skipped || 0} skipped, ${result.failed} failed)`);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도) (utime 비교를 통한 개별 처리)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleUtimeComparisonArrayData(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            console.log(`[Vcodes POST] ${dbName} | ${operation}: ${dataCount} items → ${result.processed || 0} processed (${result.created || 0} created, ${result.updated || 0} updated, ${result.skipped || 0} skipped, ${result.failed || 0} failed)`);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (복합 unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
        await notifyDbChange(req, Vcode, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        if (res.headersSent) {
            return;
        }
        logTableError('vcodes', 'create/update vcode (POST)', err, req);
        handleInsertUpdateError(err, req, 'Vcode', ['vcode_id', 'sucursal'], 'vcodes');
        const errorResponse = buildDatabaseErrorResponse(err, req, 'create vcode');
        
        // 외래키 제약 조건 위반 감지 및 정보 추가
        const errorMsg = err.original ? err.original.message : err.message;
        const isForeignKeyError = err.constructor.name.includes('ForeignKeyConstraintError') ||
                                 errorMsg.includes('foreign key constraint') ||
                                 errorMsg.includes('violates foreign key') ||
                                 errorMsg.includes('is not present in table');
        
        if (isForeignKeyError) {
            const keyMatch = errorMsg.match(/Key \(([^)]+)\)=\(([^)]+)\)/i);
            const tableMatch = errorMsg.match(/is not present in table ['"]([^'"]+)['"]/i) ||
                              errorMsg.match(/table ['"]([^'"]+)['"]/i);
            const constraintMatch = errorMsg.match(/constraint ['"]([^'"]+)['"]/i);
            
            if (keyMatch && tableMatch) {
                errorResponse.foreignKeyError = {
                    column: keyMatch[1].trim(),
                    value: keyMatch[2].trim(),
                    referencedTable: tableMatch[1],
                    constraintName: constraintMatch ? constraintMatch[1] : null
                };
            }
        }
        
        // Validation 에러인 경우 상세 정보 추가
        if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
            errorResponse.validationErrors = err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message,
                type: e.type,
                validator: e.validatorKey || e.validatorName
            }));
            
            // 누락된 필수 컬럼 목록 추가
            const missingColumns = err.errors
                .filter(e => e.type === 'notNull Violation' || 
                           e.message?.toLowerCase().includes('cannot be null'))
                .map(e => e.path);
            if (missingColumns.length > 0) {
                errorResponse.missingColumns = missingColumns;
            }
        }
        
        res.status(400).json(errorResponse);
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우) - utime 비교를 통한 개별 처리
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleUtimeComparisonArrayData, Vcode, ['vcode_id', 'sucursal'], 'Vcode');
            await notifyBatchSync(req, Vcode, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Vcode, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vcode.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Vcode.update(dataToUpdate, { where: { vcode_id: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Vcode.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Vcode, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        logTableError('vcodes', 'update vcode', err, req);
        res.status(400).json({
            error: 'Failed to update vcode',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Vcode.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Vcode.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Vcode.destroy({ where: { vcode_id: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Vcode, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        logTableError('vcodes', 'delete vcode', err, req);
        res.status(400).json({
            error: 'Failed to delete vcode',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

// 특정 날짜의 판매 데이터 조회 (페이지네이션)
router.get('/ventas_x_a_day', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const sequelize = Vcode.sequelize;
        
        // 날짜 파라미터 확인 (query 또는 body)
        const fecha = req.query.fecha || req.body.fecha;
        if (!fecha) {
            return res.status(400).json({ error: 'fecha parameter is required' });
        }
        
        // 날짜 형식 검증 (YYYY-MM-DD)
        const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!fechaRegex.test(fecha)) {
            return res.status(400).json({ error: 'Invalid fecha format. Expected YYYY-MM-DD' });
        }
        
        // 페이지네이션 파라미터 확인 (vcode_id 기준)
        const lastVcodeId = req.query.last_vcode_id || req.body.last_vcode_id;
        
        // WHERE 조건 구성
        let whereConditions = ['fecha = :fecha', 'borrado = false'];
        const replacements = { fecha };
        
        // 페이지네이션: vcode_id가 제공되면 해당 ID보다 큰 것만 조회
        if (lastVcodeId) {
            const vcodeId = parseInt(lastVcodeId, 10);
            if (isNaN(vcodeId)) {
                return res.status(400).json({ error: 'Invalid last_vcode_id format' });
            }
            whereConditions.push('vcode_id > :lastVcodeId');
            replacements.lastVcodeId = vcodeId;
        }
        
        const whereClause = 'WHERE ' + whereConditions.join(' AND ');
        
        // 총 데이터 개수 조회
        const countQuery = `
            SELECT COUNT(*) as total
            FROM public.vcodes
            ${whereClause}
        `;
        const [countResult] = await sequelize.query(countQuery, {
            replacements: replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        const totalCount = parseInt(countResult.total, 10);
        
        // 50개 단위로 제한
        const limit = 50;
        
        // 쿼리 실행 (요청한 필드들)
        const query = `
            SELECT 
                vcode_id as id,
                right(vcode, 5) as vcode,
                hora,
                tpago,
                cntropas,
                clientenombre,
                tefectivo,
                tcredito,
                tbanco,
                treservado,
                tfavor,
                vendedor,
                tipo,
                dni,
                resiva,
                casoesp,
                nencargado,
                cretmp,
                fecha,
                sucursal,
                ntiqrepetir,
                b_mercadopago,
                d_num_caja,
                d_num_terminal
            FROM public.vcodes
            ${whereClause}
            ORDER BY vcode_id ASC
            LIMIT :limit
        `;
        
        // 다음 배치 존재 여부 확인을 위해 limit + 1개 조회
        const records = await sequelize.query(query, {
            replacements: {
                ...replacements,
                limit: limit + 1
            },
            type: Sequelize.QueryTypes.SELECT
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 vcode_id 계산 (마지막 레코드의 vcode_id)
        let nextVcodeId = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.vcode_id !== null && lastRecord.vcode_id !== undefined) {
                nextVcodeId = lastRecord.vcode_id;
            }
        }
        
        // 응답 구성
        const response = {
            success: true,
            fecha: fecha,
            total: totalCount,
            count: data.length,
            hasMore: hasMore,
            data: data
        };
        
        // 다음 페이지가 있으면 next_vcode_id 포함
        if (hasMore && nextVcodeId !== null) {
            response.next_vcode_id = nextVcodeId;
        }
        
        res.json(response);
    } catch (err) {
        logTableError('vcodes', 'ventas_x_a_day', err, req);
        res.status(500).json({
            error: 'Failed to get ventas_x_a_day',
            details: err.message,
            errorType: err.constructor?.name,
            originalMessage: err.original?.message ?? null,
            errorCode: err.original?.code ?? err.code ?? null
        });
    }
});

module.exports = router;


