const { Router } = require('express');
const { Op } = require('sequelize');
const { getModelForRequest } = require('../models/model-factory');
const { removeSyncField, filterModelFields, handleBatchSync, handleArrayData } = require('../utils/batch-sync-handler');
const { handleSingleItem } = require('../utils/single-item-handler');
const { notifyDbChange, notifyBatchSync } = require('../utils/websocket-notifier');
const { handleInsertUpdateError } = require('../utils/error-handler');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // max_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        // 실제로는 id_todocodigo 값을 받음 (호환성을 위해 max_utime 이름 유지)
        const maxUtime = req.body?.max_utime || req.query?.max_utime;
        
        let whereCondition = {};
        let maxIdTodocodigo = null;
        
        if (maxUtime) {
            // max_utime 값이 실제로는 id_todocodigo 값임
            maxIdTodocodigo = parseInt(maxUtime, 10);
            if (isNaN(maxIdTodocodigo)) {
                console.error(`ERROR: Invalid id_todocodigo format: ${maxUtime}`);
            } else {
                // id_todocodigo가 maxIdTodocodigo보다 큰 레코드만 조회
                whereCondition.id_todocodigo = {
                    [Op.gt]: maxIdTodocodigo
                };
            }
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Todocodigos.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        // id_todocodigo로 정렬 (일관된 정렬 보장)
        // raw: true를 사용하여 원본 데이터베이스 데이터를 그대로 반환 (모든 필드 포함)
        const records = await Todocodigos.findAll({
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['id_todocodigo', 'ASC']],
            attributes: [
                'id_todocodigo', 'tcodigo', 'tdesc', 'tpre1', 'tpre2', 'tpre3', 'torgpre',
                'ttelacodigo', 'ttelakg', 'tinfo1', 'tinfo2', 'tinfo3', 'utime', 'borrado',
                'fotonombre', 'tpre4', 'tpre5', 'pubip', 'ip', 'mac', 'bmobile',
                'ref_id_temporada', 'ref_id_tipo', 'ref_id_origen', 'ref_id_empresa', 'memo',
                'estatus_precios', 'tprecio_dolar', 'utime_modificado', 'id_todocodigo_centralizado',
                'b_mostrar_vcontrol', 'd_oferta_mode', 'id_serial', 'str_prefijo'
            ],
            raw: true // 원본 데이터베이스 데이터를 그대로 반환 (변환 없음)
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 id_todocodigo)
        let nextMaxUtime = null;
        if (data.length > 0) {
            const lastRecord = data[data.length - 1];
            if (lastRecord.id_todocodigo !== null && lastRecord.id_todocodigo !== undefined) {
                // id_todocodigo 값을 문자열로 변환하여 반환
                nextMaxUtime = String(lastRecord.id_todocodigo);
            }
        }
        
        // 페이지네이션 정보와 함께 응답
        // data는 원본 데이터베이스에서 가져온 형태 그대로 반환 (변환 없음)
        const responseData = {
            data: data,
            pagination: {
                count: data.length,
                total: totalCount,
                hasMore: hasMore,
                nextMaxUtime: nextMaxUtime
            }
        };
        
        // 응답 로거에서 사용할 데이터 개수 저장
        req._responseDataCount = data.length;
        
        res.json(responseData);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list todocodigos', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const record = await Todocodigos.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch todocodigo', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            const result = await handleBatchSync(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
            await notifyBatchSync(req, Todocodigos, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Todocodigos, 'id_todocodigo', 'Todocodigos');
        await notifyDbChange(req, Todocodigos, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Todocodigos', 'id_todocodigo', 'todocodigos');
        res.status(400).json({ 
            error: 'Failed to create todocodigo', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Todocodigos, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Todocodigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Todocodigos.update(dataToUpdate, { where: { id_todocodigo: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Todocodigos.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Todocodigos, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update todocodigo', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Todocodigos = getModelForRequest(req, 'Todocodigos');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Todocodigos.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Todocodigos.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Todocodigos.destroy({ where: { id_todocodigo: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Todocodigos, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete todocodigo', details: err.message });
    }
});

module.exports = router;

