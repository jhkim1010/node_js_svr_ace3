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
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        const sequelize = OnlineVentas.sequelize;
        const { Op } = Sequelize;
        
        // sucursal 파라미터 확인
        const sucursal = req.query.sucursal || req.body.sucursal;
        
        // 필터링 파라미터 확인
        const refIdVcode = req.query.ref_id_vcode || req.body.ref_id_vcode;
        const numPedido = req.query.num_pedido || req.body.num_pedido;
        const numEnvio = req.query.num_envio || req.body.num_envio;
        const bPorCobranza = req.query.b_por_cobranza || req.body.b_por_cobranza;
        const cuentaNombre = req.query.cuenta_nombre || req.body.cuenta_nombre;
        
        // 검색어 파라미터 확인
        const filteringWord = req.query.filtering_word || req.query.filteringWord || req.body.filtering_word || req.body.filteringWord || req.query.search || req.body.search;
        
        // 페이지네이션 파라미터 확인 (online_venta_id 기준)
        const lastOnlineVentaId = req.query.last_online_venta_id || req.body.last_online_venta_id;
        
        // WHERE 조건 구성
        let whereConditions = [];
        
        // 삭제되지 않은 항목만 조회
        whereConditions.push({ borrado: false });
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            const sucursalNum = parseInt(sucursal, 10);
            if (!isNaN(sucursalNum)) {
                whereConditions.push({ sucursal: sucursalNum });
            }
        }
        
        // ref_id_vcode 필터링 추가 (제공된 경우)
        if (refIdVcode !== undefined && refIdVcode !== null) {
            const refIdVcodeNum = parseInt(refIdVcode, 10);
            if (!isNaN(refIdVcodeNum)) {
                whereConditions.push({ ref_id_vcode: refIdVcodeNum });
            }
        }
        
        // num_pedido 필터링 추가 (제공된 경우)
        if (numPedido) {
            whereConditions.push({ num_pedido: numPedido });
        }
        
        // num_envio 필터링 추가 (제공된 경우)
        if (numEnvio) {
            whereConditions.push({ num_envio: numEnvio });
        }
        
        // b_por_cobranza 필터링 추가 (제공된 경우)
        if (bPorCobranza !== undefined && bPorCobranza !== null) {
            const bPorCobranzaBool = bPorCobranza === 'true' || bPorCobranza === true || bPorCobranza === '1' || bPorCobranza === 1;
            whereConditions.push({ b_por_cobranza: bPorCobranzaBool });
        }
        
        // cuenta_nombre 필터링 추가 (제공된 경우)
        if (cuentaNombre) {
            whereConditions.push({ cuenta_nombre: cuentaNombre });
        }
        
        // filtering_word 검색 조건 추가 (num_pedido, num_envio, cuenta_nombre에서 검색)
        if (filteringWord && filteringWord.trim()) {
            const searchTerm = `%${filteringWord.trim()}%`;
            whereConditions.push({
                [Op.or]: [
                    { num_pedido: { [Op.iLike]: searchTerm } },
                    { num_envio: { [Op.iLike]: searchTerm } },
                    { cuenta_nombre: { [Op.iLike]: searchTerm } }
                ]
            });
        }
        
        // 페이지네이션: online_venta_id가 제공되면 해당 ID보다 큰 것만 조회
        if (lastOnlineVentaId) {
            const onlineVentaId = parseInt(lastOnlineVentaId, 10);
            if (isNaN(onlineVentaId)) {
                return res.status(400).json({ error: 'Invalid last_online_venta_id format' });
            }
            whereConditions.push({ online_venta_id: { [Op.gt]: onlineVentaId } });
        }
        
        // 총 데이터 개수 조회
        const totalCount = await OnlineVentas.count({ 
            where: {
                [Op.and]: whereConditions
            }
        });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await OnlineVentas.findAll({ 
            where: {
                [Op.and]: whereConditions
            },
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['online_venta_id', 'DESC']] // online_venta_id 내림차순 정렬
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 last_online_venta_id 계산 (마지막 레코드의 online_venta_id)
        let nextLastOnlineVentaId = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.online_venta_id !== null && lastRecord.online_venta_id !== undefined) {
                nextLastOnlineVentaId = String(lastRecord.online_venta_id);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                nextLastOnlineVentaId: nextLastOnlineVentaId // online_venta_id 기반 페이징을 위한 nextLastOnlineVentaId
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error('\nERROR: OnlineVentas fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list online_ventas');
        res.status(500).json(errorResponse);
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        const record = await OnlineVentas.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch online_venta', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        // OnlineVentas 동기화 로직에서는 (online_venta_id, sucursal) 복합 키를 기본 식별자로 사용
        const compositePrimaryKey = ['online_venta_id', 'sucursal'];
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleUtimeComparisonArrayData(req, res, OnlineVentas, compositePrimaryKey, 'OnlineVentas');
            await notifyBatchSync(req, OnlineVentas, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            // utime 비교 + primary key 우선 순서 적용
            const result = await handleUtimeComparisonArrayData(req, res, OnlineVentas, compositePrimaryKey, 'OnlineVentas');
            await notifyBatchSync(req, OnlineVentas, result);
            return res.status(200).json(result);
        }
        
        // 단일 생성/업데이트 요청도 utime 비교 + primary key 우선 순서 적용
        const rawData = req.body.new_data || req.body;
        req.body.data = Array.isArray(rawData) ? rawData : [rawData];

        const result = await handleUtimeComparisonArrayData(req, res, OnlineVentas, compositePrimaryKey, 'OnlineVentas');

        // 첫 번째 결과를 기반으로 응답 구성
        const first = result.results && result.results[0];
        const action = first?.action || 'created';
        const data = first?.data || rawData;

        if (action === 'skipped') {
            // 중복(unique) 또는 FK 문제로 스킵된 경우도 에러가 아닌 정상 응답으로 처리
            await notifyDbChange(req, OnlineVentas, 'skip', data);
            return res.status(200).json(first);
        }

        await notifyDbChange(req, OnlineVentas, action === 'created' ? 'create' : 'update', data);
        res.status(action === 'created' ? 201 : 200).json(data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'OnlineVentas', ['online_venta_id', 'sucursal'], 'online_ventas');
        res.status(400).json({ 
            error: 'Failed to create online_venta', 
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

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, OnlineVentas, 'online_venta_id', 'OnlineVentas');
            await notifyBatchSync(req, OnlineVentas, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(OnlineVentas, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = OnlineVentas.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await OnlineVentas.update(dataToUpdate, { where: { online_venta_id: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await OnlineVentas.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, OnlineVentas, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update online_venta', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const OnlineVentas = getModelForRequest(req, 'OnlineVentas');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = OnlineVentas.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await OnlineVentas.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await OnlineVentas.destroy({ where: { online_venta_id: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, OnlineVentas, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete online_venta', details: err.message });
    }
});

module.exports = router;

