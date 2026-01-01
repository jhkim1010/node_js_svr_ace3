const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getItemsReport(req) {
    const Vdetalle = getModelForRequest(req, 'Vdetalle');
    const sequelize = Vdetalle.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    const startDate = req.query.fecha_inicio || req.query.start_date;
    const endDate = req.query.fecha_fin || req.query.end_date;

    // 날짜가 없으면 에러 반환
    if (!startDate || !endDate) {
        throw new Error('fecha_inicio and fecha_fin are required');
    }

    // SQL injection 방지를 위해 이스케이프 처리
    const escapedStartDate = startDate.replace(/'/g, "''");
    const escapedEndDate = endDate.replace(/'/g, "''");

    // Company별 집계 쿼리
    const companyQuery = `
        SELECT 
            e1.id_empresa as "CompanyCode", 
            MAX(e1.empdesc) as "CompanyName", 
            SUM(v1.cant1) as "totalCantidad" 
        FROM vdetalle v1 
        LEFT JOIN codigos c 
            ON v1.ref_id_codigo = c.id_codigo AND v1.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN empresas e1 
            ON e1.id_empresa = t.ref_id_empresa AND e1.borrado IS FALSE AND e1.empdesc != '' 
        WHERE v1.fecha1 BETWEEN '${escapedStartDate}' AND '${escapedEndDate}'
            AND v1.borrado IS FALSE
        GROUP BY e1.id_empresa
        ORDER BY e1.id_empresa
    `;

    // Category별 집계 쿼리
    const categoryQuery = `
        SELECT 
            t1.id_tipo as "CategoryCode", 
            MAX(t1.tpdesc) as "CategoryName", 
            SUM(v1.cant1) as "totalCantidad" 
        FROM vdetalle v1 
        LEFT JOIN codigos c 
            ON v1.ref_id_codigo = c.id_codigo AND v1.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN tipos t1 
            ON t1.id_tipo = t.ref_id_tipo AND t1.borrado IS FALSE AND t1.tpdesc != '' 
        WHERE v1.fecha1 BETWEEN '${escapedStartDate}' AND '${escapedEndDate}'
            AND v1.borrado IS FALSE
        GROUP BY t1.id_tipo
        ORDER BY t1.id_tipo
    `;

    // 제품별 상세 내역 쿼리
    const productQuery = `
        SELECT 
            codigo1 as "codigo1", 
            MAX(v1.desc1) as "ProductName", 
            SUM(v1.cant1) as "totalCantidad", 
            MAX(t1.id_tipo) as "CategoryCode", 
            MAX(e1.id_empresa) as "CompanyCode" 
        FROM vdetalle v1 
        LEFT JOIN codigos c 
            ON v1.ref_id_codigo = c.id_codigo AND v1.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN tipos t1 
            ON t1.id_tipo = t.ref_id_tipo AND t1.borrado IS FALSE AND t1.tpdesc != '' 
        LEFT JOIN empresas e1 
            ON e1.id_empresa = t.ref_id_empresa AND e1.borrado IS FALSE AND e1.empdesc != '' 
        WHERE v1.fecha1 BETWEEN '${escapedStartDate}' AND '${escapedEndDate}'
            AND v1.borrado IS FALSE
        GROUP BY codigo1
        ORDER BY codigo1
    `;

    // 세 가지 쿼리 병렬 실행
    let companySummary = [];
    let categorySummary = [];
    let productDetails = [];

    try {
        const [companyResults, categoryResults, productResults] = await Promise.all([
            sequelize.query(companyQuery, {
                type: Sequelize.QueryTypes.SELECT
            }),
            sequelize.query(categoryQuery, {
                type: Sequelize.QueryTypes.SELECT
            }),
            sequelize.query(productQuery, {
                type: Sequelize.QueryTypes.SELECT
            })
        ]);

        companySummary = Array.isArray(companyResults) ? companyResults : [];
        categorySummary = Array.isArray(categoryResults) ? categoryResults : [];
        productDetails = Array.isArray(productResults) ? productResults : [];
    } catch (err) {
        console.error('[Items 보고서] 쿼리 실행 실패:');
        console.error('   Error:', err.message);
        throw err;
    }

    // 집계 결과가 1개인 경우 제외
    const filteredCompanySummary = companySummary.length > 1 ? companySummary : [];
    const filteredCategorySummary = categorySummary.length > 1 ? categorySummary : [];

    // 집계 정보 계산
    const totalCantidad = productDetails.reduce((sum, item) => sum + (parseFloat(item.totalCantidad || 0)), 0);

    return {
        filters: {
            fecha_inicio: startDate,
            fecha_fin: endDate,
            start_date: startDate,
            end_date: endDate
        },
        summary: {
            total_companies: filteredCompanySummary.length,
            total_categories: filteredCategorySummary.length,
            total_products: productDetails.length,
            total_cantidad: totalCantidad
        },
        data: {
            summary_by_company: filteredCompanySummary,
            summary_by_category: filteredCategorySummary,
            products: productDetails
        }
    };
}

module.exports = { getItemsReport };

