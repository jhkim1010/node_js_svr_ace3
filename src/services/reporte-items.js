const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { getBcolorviewValor1 } = require('../utils/bcolorview-helper');

async function getItemsReport(req) {
    const Vdetalle = getModelForRequest(req, 'Vdetalle');
    const sequelize = Vdetalle.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    const startDate = req.query.start_date || '2025-11-01';
    const endDate = req.query.end_date || '2025-12-01';

    // bcolorview 값 확인 (valor1이 '0' 또는 '1')
    const bcolorviewValor1 = getBcolorviewValor1(req);
    const isBcolorviewEnabled = bcolorviewValor1 === '1' || bcolorviewValor1 === 1;

    let query;
    let queryParams = [startDate, endDate];

    if (!isBcolorviewEnabled) {
        // bcolorview가 0인 경우: codigo1, max(desc1) 사용
        query = `
            SELECT 
                codigo1, 
                MAX(desc1) as desc1, 
                SUM(cant1) as TPrendas, 
                SUM(precio) as TImporte, 
                MIN(fecha1) as start_date, 
                MAX(fecha1) as end_date,
                sucursal
            FROM vdetalle v
            WHERE fecha1 BETWEEN $1 AND $2 
                AND v.ref_id_codigo > 0
            GROUP BY codigo1, sucursal 
            ORDER BY TPrendas DESC
        `;
    } else {
        // bcolorview가 1인 경우: todocodigos와 조인하여 tcodigo, tdesc 사용
        query = `
            SELECT 
                t.tcodigo as codigo1,
                t.tdesc as desc1,
                SUM(cant1) as TPrendas, 
                SUM(precio) as TImporte, 
                MIN(fecha1) as start_date, 
                MAX(fecha1) as end_date,
                v.sucursal
            FROM vdetalle v
            INNER JOIN todocodigos t 
                ON v.ref_id_todocodigo = t.id_todocodigo 
            WHERE fecha1 BETWEEN $1 AND $2 
                AND v.ref_id_codigo > 0 
            GROUP BY t.tcodigo, t.tdesc, v.sucursal 
            ORDER BY TPrendas DESC
        `;
    }

    // SQL 쿼리 실행
    const results = await sequelize.query(query, {
        bind: queryParams,
        type: Sequelize.QueryTypes.SELECT
    });

    // 결과가 배열인지 확인
    const items = Array.isArray(results) ? results : [];

    return {
        filters: {
            start_date: startDate,
            end_date: endDate,
            bcolorview: bcolorviewValor1 || '0'
        },
        summary: {
            total_items: items.length,
            total_prendas: items.reduce((sum, item) => sum + (parseInt(item.tprendas) || 0), 0),
            total_importe: items.reduce((sum, item) => sum + (parseFloat(item.timporte) || 0), 0)
        },
        data: items
    };
}

module.exports = { getItemsReport };

