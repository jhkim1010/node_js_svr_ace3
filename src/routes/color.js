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
        const Color = getModelForRequest(req, 'Color');
        
        // max_utime 파라미터 확인 (바디 또는 쿼리 파라미터)
        const maxUtime = req.body?.max_utime || req.query?.max_utime;
        
        let whereCondition = {};
        if (maxUtime) {
            // utime이 max_utime보다 큰 데이터만 조회
            whereCondition.utime = {
                [Op.gt]: new Date(maxUtime)
            };
        }
        
        // 총 데이터 개수 조회
        const totalCount = await Color.count({ where: whereCondition });
        
        // 100개 단위로 제한
        const limit = 100;
        const records = await Color.findAll({
            where: whereCondition,
            limit: limit + 1, // 다음 배치 존재 여부 확인을 위해 1개 더 조회
            order: [['utime', 'ASC']]
        });
        
        // 다음 배치가 있는지 확인
        const hasMore = records.length > limit;
        const data = hasMore ? records.slice(0, limit) : records;
        
        // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 utime)
        let nextMaxUtime = null;
        if (data.length > 0 && data[data.length - 1].utime) {
            nextMaxUtime = data[data.length - 1].utime.toISOString();
        }
        
        // 페이지네이션 정보와 함께 응답
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
        res.status(500).json({ error: 'Failed to list colors', details: err.message });
    }
});

router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Color = getModelForRequest(req, 'Color');
        const record = await Color.findByPk(id);
        if (!record) return res.status(404).json({ error: 'Not found' });
        res.json(record);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch color', details: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const Color = getModelForRequest(req, 'Color');
        
        // BATCH_SYNC 작업 처리
        if (req.body.operation === 'BATCH_SYNC' && Array.isArray(req.body.data)) {
            // color는 idcolor만 기본 키로 사용
            const result = await handleBatchSync(req, res, Color, 'idcolor', 'Color');
            await notifyBatchSync(req, Color, result);
            return res.status(200).json(result);
        }
        
        // data가 배열인 경우 처리 (UPDATE, CREATE 등 다른 operation에서도)
        if (Array.isArray(req.body.data) && req.body.data.length > 0) {
            const result = await handleArrayData(req, res, Color, 'idcolor', 'Color');
            return res.status(200).json(result);
        }
        
        // 배열 형태의 데이터 처리 (new_data 또는 req.body가 배열인 경우)
        const rawData = req.body.new_data || req.body;
        if (Array.isArray(rawData)) {
            // 배열인 경우 BATCH_SYNC와 동일하게 처리
            req.body.data = rawData;
            const result = await handleBatchSync(req, res, Color, 'idcolor', 'Color');
            await notifyBatchSync(req, Color, result);
            return res.status(200).json(result);
        }
        
        // 일반 단일 생성 요청 처리 (unique key 기반으로 UPDATE/CREATE 결정)
        const result = await handleSingleItem(req, res, Color, 'idcolor', 'Color');
        await notifyDbChange(req, Color, result.action === 'created' ? 'create' : 'update', result.data);
        res.status(result.action === 'created' ? 201 : 200).json(result.data);
    } catch (err) {
        handleInsertUpdateError(err, req, 'Color', 'idcolor', 'color');
        res.status(400).json({ 
            error: 'Failed to create color', 
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

router.put('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Color = getModelForRequest(req, 'Color');
        const cleanedData = removeSyncField(req.body);
        const dataToUpdate = filterModelFields(Color, cleanedData);
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Color.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const [count] = await Color.update(dataToUpdate, { where: { idcolor: id }, transaction });
            if (count === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const updated = await Color.findByPk(id, { transaction });
            await transaction.commit();
            await notifyDbChange(req, Color, 'update', updated);
            res.json(updated);
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to update color', details: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    try {
        const Color = getModelForRequest(req, 'Color');
        
        // 트랜잭션 사용하여 원자성 보장
        const sequelize = Color.sequelize;
        const transaction = await sequelize.transaction();
        try {
            const toDelete = await Color.findByPk(id, { transaction });
            if (!toDelete) {
                await transaction.rollback();
                return res.status(404).json({ error: 'Not found' });
            }
            const count = await Color.destroy({ where: { idcolor: id }, transaction });
            await transaction.commit();
            await notifyDbChange(req, Color, 'delete', toDelete);
            res.status(204).end();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: 'Failed to delete color', details: err.message });
    }
});

module.exports = router;

