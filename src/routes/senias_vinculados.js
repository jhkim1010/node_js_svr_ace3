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
        const SeniasVinculados = getModelForRequest(req, 'SeniasVinculados');
        const sequelize = SeniasVinculados.sequelize;
        const { Op } = Sequelize;
        
        // sucursal 파라미터 확인
        const sucursal = req.query.sucursal || req.body.sucursal;
        
        // 페이지네이션 파라미터 확인 (id_senia_vinculado 기준)
        const lastIdSeniaVinculado = req.query.last_id_senia_vinculado || req.body.last_id_senia_vinculado;
        
        // 필터링 파라미터 확인
        const refIdVcode = req.query.ref_id_vcode || req.body.ref_id_vcode;
        const refIdCliente = req.query.ref_id_cliente || req.body.ref_id_cliente;
        const refIdSenia = req.query.ref_id_senia || req.body.ref_id_senia;
        const refIdReservado = req.query.ref_id_reservado || req.body.ref_id_reservado;
        const bUsadoXDescuento = req.query.b_usado_x_descuento || req.body.b_usado_x_descuento;
        
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
        
        // ref_id_cliente 필터링 추가 (제공된 경우)
        if (refIdCliente !== undefined && refIdCliente !== null) {
            const refIdClienteNum = parseInt(refIdCliente, 10);
            if (!isNaN(refIdClienteNum)) {
                whereConditions.push({ ref_id_cliente: refIdClienteNum });
            }
        }
        
        // ref_id_senia 필터링 추가 (제공된 경우)
        if (refIdSenia !== undefined && refIdSenia !== null) {
            const refIdSeniaNum = parseInt(refIdSenia, 10);
            if (!isNaN(refIdSeniaNum)) {
                whereConditions.push({ ref_id_senia: refIdSeniaNum });
            }
        }
        
        // ref_id_reservado 필터링 추가 (제공된 경우)
        if (refIdReservado !== undefined && refIdReservado !== null) {
            const refIdReservadoNum = parseInt(refIdReservado, 10);
            if (!isNaN(refIdReservadoNum)) {
                whereConditions.push({ ref_id_reservado: refIdReservadoNum });
            }
        }
        
        // b_usado_x_descuento 필터링 추가 (제공된 경우)
        if (bUsadoXDescuento !== undefined && bUsadoXDescuento !== null) {
            const bUsado = bUsadoXDescuento === 'true' || bUsadoXDescuento === true || bUsadoXDescuento === '1' || bUsadoXDescuento === 1;
            whereConditions.push({ b_usado_x_descuento: bUsado });
        }
        
        // 페이지네이션: id_senia_vinculado가 제공되면 해당 ID보다 큰 것만 조회
        if (lastIdSeniaVinculado) {
            const idSeniaVinculado = parseInt(lastIdSeniaVinculado, 10);
            if (isNaN(idSeniaVinculado)) {
                return res.status(400).json({ error: 'Invalid last_id_senia_vinculado format' });
            }
            whereConditions.push({ id_senia_vinculado: { [Op.gt]: idSeniaVinculado } });
        }
        
        // 총 데이터 개수 조회
        const totalCount = await SeniasVinculados.count({ 
            where: {
                [Op.and]: whereConditions
            }
        });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await SeniasVinculados.findAll({ 
            where: {
                [Op.and]: whereConditions
            },
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_senia_vinculado', 'DESC']] // id_senia_vinculado 내림차순 정렬
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 last_id_senia_vinculado 계산 (마지막 레코드의 id_senia_vinculado)
        let nextLastIdSeniaVinculado = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_senia_vinculado !== null && lastRecord.id_senia_vinculado !== undefined) {
                nextLastIdSeniaVinculado = String(lastRecord.id_senia_vinculado);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                nextLastIdSeniaVinculado: nextLastIdSeniaVinculado // id_senia_vinculado 기반 페이징을 위한 nextLastIdSeniaVinculado
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error('\nERROR: SeniasVinculados fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        
        const errorResponse = buildDatabaseErrorResponse(err, req, 'list senias_vinculados');
        res.status(500).json(errorResponse);
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const SeniasVinculados = getModelForRequest(req, 'SeniasVinculados');
        const record = await SeniasVinculados.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch senia_vinculado', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const SeniasVinculados = getModelForRequest(req, 'SeniasVinculados');
        // SeniasVinculados 동기화 로직에서는 id_senia_vinculado를 기본 식별자로 사용
        const primaryKey = 'id_senia_vinculado';
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleUtimeComparisonArrayData(req, res, SeniasVinculados, primaryKey, 'SeniasVinculados');
            await notifyBatchSync(req, SeniasVinculados, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            // utime 비교 + primary key 우선 순서 적용
            const result = await handleUtimeComparisonArrayData(req, res, SeniasVinculados, primaryKey, 'SeniasVinculados');
            await notifyBatchSync(req, SeniasVinculados, result);
            return res.status(200).json(result);
        }
        
        // 단일 생성/업데이트 요청도 utime 비교 + primary key 우선 순서 적용
        const rawData = req.body.new_data || req.body;
        req.body.data = Array.isArray(rawData) ? rawData : [rawData];

        const result = await handleUtimeComparisonArrayData(req, res, SeniasVinculados, primaryKey, 'SeniasVinculados');

        // 첫 번째 결과를 기반으로 응답 구성
        const first = result.results && result.results[0];
        const action = first?.action || 'created';
        const data = first?.data || rawData;

        if (action === 'skipped') {
            // 중복(unique) 또는 FK 문제로 스킵된 경우도 에러가 아닌 정상 응답으로 처리
            await notifyDbChange(req, SeniasVinculados, 'skip', data);
            return res.status(200).json(first);
        }

        await notifyDbChange(req, SeniasVinculados, action === 'created' ? 'create' : 'update', data);
        res.status(action === 'created' ? 201 : 200).json(data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'SeniasVinculados', 'id_senia_vinculado', 'senias_vinculados');
        res.status(400).json({ 
            error: 'Failed to create senia_vinculado', 
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
        const SeniasVinculados = getModelForRequest(req, 'SeniasVinculados');
        
        // 배열 형태의 데이터 처리 (req.body.data가 배열인 경우)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            req.body.operation = req.body.operation || 'UPDATE';
            // 50개를 넘으면 배치로 나눠서 처리
            const result = await processBatchedArray(req, res, handleArrayData, SeniasVinculados, 'id_senia_vinculado', 'SeniasVinculados');
            await notifyBatchSync(req, SeniasVinculados, result);
            return res.status(200).json(result);
        }
        
        // 단일 항목 처리 (기존 로직)
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(SeniasVinculados, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = SeniasVinculados.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await SeniasVinculados.update(dataToUpdate, { where: { id_senia_vinculado: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await SeniasVinculados.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, SeniasVinculados, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update senia_vinculado', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const SeniasVinculados = getModelForRequest(req, 'SeniasVinculados');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = SeniasVinculados.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await SeniasVinculados.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await SeniasVinculados.destroy({ where: { id_senia_vinculado: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, SeniasVinculados, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete senia_vinculado', details: err.message });
    }
});

module.exports = router;

