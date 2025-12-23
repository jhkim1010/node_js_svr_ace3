const { Router } = require('express');
const { Sequelize } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { handleUtimeComparisonArrayData } = require('../utils/utime-comparison-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError, buildDatabaseErrorResponse } = require('../utils/error-handler');
const { processBatchedArray } = require('../utils/batch-processor');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Fventas = getModelForRequest(req, 'Fventas');
        const sequelize = Fventas.sequelize;
        const { Op } = Sequelize;
        
        // req.query와 req.body가 undefined일 수 있으므로 안전하게 처리
        const query = req.query || {};
        const body = req.body || {};
        
        // 날짜 파라미터 확인 (query 또는 body)
        const fecha = query.fecha || body.fecha;
        const fechaInicio = query.fecha_inicio || query.start_date || body.fecha_inicio || body.start_date;
        const fechaFin = query.fecha_fin || query.end_date || body.fecha_fin || body.end_date;
        
        // sucursal 파라미터 확인
        const sucursal = query.sucursal || body.sucursal;
        
        // 검색어 파라미터 확인
        const filteringWord = query.filtering_word || query.filteringWord || body.filtering_word || body.filteringWord || query.search || body.search;
        
        // WHERE 조건 구성
        let whereConditions = [];
        
        // 날짜 필터링
        if (fecha) {
            // 특정 날짜만 조회 (정확히 일치)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(fecha)) {
                return res.status(400).json({ 
                    error: 'Invalid fecha format. Expected YYYY-MM-DD',
                    received: fecha
                });
            }
            whereConditions.push(
                Sequelize.where(
                    Sequelize.fn('DATE', Sequelize.col('fecha')),
                    fecha
                )
            );
        } else if (fechaInicio) {
            // 날짜 범위 조회
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(fechaInicio)) {
                return res.status(400).json({ 
                    error: 'Invalid fecha_inicio format. Expected YYYY-MM-DD',
                    received: fechaInicio
                });
            }
            
            whereConditions.push(
                Sequelize.where(
                    Sequelize.fn('DATE', Sequelize.col('fecha')),
                    { [Op.gte]: fechaInicio }
                )
            );
            
            if (fechaFin) {
                if (!dateRegex.test(fechaFin)) {
                    return res.status(400).json({ 
                        error: 'Invalid fecha_fin format. Expected YYYY-MM-DD',
                        received: fechaFin
                    });
                }
                whereConditions.push(
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        { [Op.lte]: fechaFin }
                    )
                );
            }
        }
        
        // 삭제되지 않은 항목만 조회
        whereConditions.push({ borrado: false });
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            const sucursalNum = parseInt(sucursal, 10);
            if (!isNaN(sucursalNum)) {
                whereConditions.push({ sucursal: sucursalNum });
            }
        }
        
        // filtering_word 검색 조건 추가 (clientenombre, dni, numfactura, tipofactura에서 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereConditions.push({
                [Op.or]: [
                    { clientenombre: { [Op.iLike]: searchTerm } },
                    { dni: { [Op.iLike]: searchTerm } },
                    { numfactura: { [Op.iLike]: searchTerm } },
                    { tipofactura: { [Op.iLike]: searchTerm } }
                ]
            });
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Fventas.count({ 
            where: {
                [Op.and]: whereConditions
            }
        });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Fventas.findAll({ 
            where: {
                [Op.and]: whereConditions
            },
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['fecha', 'DESC'], ['tipofactura', 'DESC'], ['numfactura', 'DESC']] // 날짜, tipofactura, numfactura 내림차순 정렬
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error('\nERROR: Fventas fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list fventas');
        res.status(500).json(errorResponse);
    }
});

// 복합 키로 특정 항목 조회 (tipofactura, numfactura)
router.get('/:tipofactura/:numfactura', async (req, res) => {
    const { tipofactura, numfactura } = req.params;
    try {
        const Fventas = getModelForRequest(req, 'Fventas');
        const record = await Fventas.findOne({
            where: {
                tipofactura: tipofactura,
                numfactura: numfactura
            }
        });
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch fventa', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Fventas = getModelForRequest(req, 'Fventas');
        // Fventas 동기화 로직에서는 (tipofactura, numfactura) 복합 키를 기본 식별자로 사용
        const compositePrimaryKey = ['tipofactura', 'numfactura'];
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleUtimeComparisonArrayData(req, res, Fventas, compositePrimaryKey, 'Fventas');
            await notifyBatchSync(req, Fventas, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            // utime 비교 + primary key 우선 순서 적용
            const result = await handleUtimeComparisonArrayData(req, res, Fventas, compositePrimaryKey, 'Fventas');
            await notifyBatchSync(req, Fventas, result);
            return res.status(200).json(result);
        }
        
        // 단일 생성/업데이트 요청도 utime 비교 + primary key 우선 순서 적용
        const rawData = req.body.new_data || req.body;
        req.body.data = Array.isArray(rawData) ? rawData : [rawData];
        image.png   
        const result = await handleUtimeComparisonArrayData(req, res, Fventas, compositePrimaryKey, 'Fventas');

        // 첫 번째 결과를 기반으로 응답 구성
        const first = result.results && result.results[0];
        const action = first?.action || 'created';
        const data = first?.data || rawData;

        if (action === 'skipped') {
            // 중복(unique) 또는 FK 문제로 스킵된 경우도 에러가 아닌 정상 응답으로 처리
            await notifyDbChange(req, Fventas, 'skip', data);
            return res.status(200).json(first);
        }

        await notifyDbChange(req, Fventas, action === 'created' ? 'create' : 'update', data);
        res.status(action === 'created' ? 201 : 200).json(data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Fventas', ['tipofactura', 'numfactura'], 'fventas');
        res.status(400).json({ 
            error: 'Failed to create fventa', 
            details: err.message,
            errorType: err.constructor.name,
            validationErrors: err.errors ? err.errors.map(e => ({
                field: e.path,
                value: e.value,
                message: e.message
            })) : undefined,
            originalError: err.original ? err.original.message : null
        });
    }
});

// 복합 키로 업데이트 (tipofactura, numfactura)
router.put('/:tipofactura/:numfactura', async (req, res) => {
    const { tipofactura, numfactura } = req.params;
    try {
        const Fventas = getModelForRequest(req, 'Fventas');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, Fventas, ['tipofactura', 'numfactura'], 'Fventas');
            await notifyBatchSync(req, Fventas, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Fventas, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Fventas.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Fventas.update(
                dataToUpdate, 
                { 
                    where: { 
                        tipofactura: tipofactura,
                        numfactura: numfactura
                    }, 
                    transaction 
                }
            );
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Fventas.findOne({
                where: {
                    tipofactura: tipofactura,
                    numfactura: numfactura
                },
                transaction
            });
            await transaction.commit();
            await notifyDbChange(req, Fventas, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update fventa', details: err.message });
    }
});

// 복합 키로 삭제 (tipofactura, numfactura)
router.delete('/:tipofactura/:numfactura', async (req, res) => {
    const { tipofactura, numfactura } = req.params;
    try {
        const Fventas = getModelForRequest(req, 'Fventas');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Fventas.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Fventas.findOne({
                where: {
                    tipofactura: tipofactura,
                    numfactura: numfactura
                },
                transaction
            });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Fventas.destroy({ 
                where: { 
                    tipofactura: tipofactura,
                    numfactura: numfactura
                }, 
                transaction 
            });
            await transaction.commit();
            await notifyDbChange(req, Fventas, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete fventa', details: err.message });
    }
});

module.exports = router;

