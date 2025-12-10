const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getVdetalleReport(req) {
    const Vdetalle = getModelForRequest(req, 'Vdetalle');
    const sequelize = Vdetalle.sequelize;

    // 쿼리 파라미터 파싱
    const id = req.query.id || req.query.ref_id_vcode || req.query.id_vdetalle;
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;

    // id와 sucursal은 필수 파라미터
    if (!id) {
        throw new Error('id parameter is required (use id, ref_id_vcode, or id_vdetalle)');
    }

    // WHERE 조건 구성
    const whereConditions = {};
    
    // id 파라미터 처리 (ref_id_vcode 또는 id_vdetalle)
    if (req.query.ref_id_vcode) {
        whereConditions.ref_id_vcode = parseInt(req.query.ref_id_vcode, 10);
    } else if (req.query.id_vdetalle) {
        whereConditions.id_vdetalle = parseInt(req.query.id_vdetalle, 10);
    } else {
        // 기본적으로 ref_id_vcode로 조회 (vcode와 연결된 vdetalle 조회)
        whereConditions.ref_id_vcode = parseInt(id, 10);
    }

    // sucursal 필터 추가
    if (sucursal) {
        whereConditions.sucursal = sucursal;
    }

    // borrado가 false인 것만 조회
    whereConditions.borrado = false;

    // Vdetalle 조회
    const vdetalleRecords = await Vdetalle.findAll({
        where: whereConditions,
        order: [['id_vdetalle', 'ASC']],
        raw: true
    });

    // 결과가 배열인지 확인
    const data = Array.isArray(vdetalleRecords) ? vdetalleRecords : [];

    // 집계 정보 계산
    const totalCantidad = data.reduce((sum, item) => sum + (parseInt(item.cant1) || 0), 0);
    const totalImporte = data.reduce((sum, item) => sum + (parseFloat(item.precio) || 0), 0);
    const totalGanancia = data.reduce((sum, item) => sum + (parseFloat(item.ganancia) || 0), 0);

    return {
        filters: {
            id: id,
            ref_id_vcode: whereConditions.ref_id_vcode || null,
            id_vdetalle: whereConditions.id_vdetalle || null,
            sucursal: sucursal || 'all'
        },
        summary: {
            total_items: data.length,
            total_cantidad: totalCantidad,
            total_importe: totalImporte,
            total_ganancia: totalGanancia
        },
        data: data
    };
}

module.exports = { getVdetalleReport };
