const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { getBcolorviewValor1 } = require('../utils/bcolorview-helper');

async function getItemsReport(req) {
    const Vdetalle = getModelForRequest(req, 'Vdetalle');
    const sequelize = Vdetalle.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    // 기본값: 오늘 날짜 (YYYY-MM-DD 형식)
    const today = new Date().toISOString().split('T')[0];
    
    // 파라미터 인식 로그 출력
    console.log('\n[Items 보고서] 날짜 파라미터 인식:');
    console.log(`  - req.query.fecha_inicio: ${req.query.fecha_inicio || '없음'}`);
    console.log(`  - req.query.fecha_fin: ${req.query.fecha_fin || '없음'}`);
    console.log(`  - req.query.start_date: ${req.query.start_date || '없음'}`);
    console.log(`  - req.query.end_date: ${req.query.end_date || '없음'}`);
    console.log(`  - 오늘 날짜 (기본값): ${today}`);
    
    const startDate = req.query.fecha_inicio || req.query.start_date || today;
    const endDate = req.query.fecha_fin || req.query.end_date || today;
    
    console.log(`  - 최종 사용 startDate: ${startDate}`);
    console.log(`  - 최종 사용 endDate: ${endDate}\n`);

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
            fecha_inicio: startDate,
            fecha_fin: endDate,
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

