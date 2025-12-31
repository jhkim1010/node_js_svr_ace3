const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getIngresosReport(req) {
    const Ingresos = getModelForRequest(req, 'Ingresos');
    const sequelize = Ingresos.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    const startDate = req.query.fecha_inicio || req.query.start_date;
    const endDate = req.query.fecha_fin || req.query.end_date;

    // 검색어 파라미터 확인
    const filteringWord = req.query.filtering_word || req.query.filteringWord || req.query.search;

    // 날짜 범위 필터 (필수)
    if (!startDate || !endDate) {
        throw new Error('fecha_inicio and fecha_fin are required');
    }

    // SQL injection 방지를 위해 이스케이프 처리
    const escapedStartDate = startDate.replace(/'/g, "''");
    const escapedEndDate = endDate.replace(/'/g, "''");

    // WHERE 조건 구성 (공통)
    let whereConditions = [
        `i.fecha BETWEEN '${escapedStartDate}' AND '${escapedEndDate}'`,
        'i.borrado IS FALSE'
    ];

    // filteringWord 검색 조건 추가 (대소문자 구분 없음)
    if (filteringWord && filteringWord.trim()) {
        const escapedWord = filteringWord.trim().replace(/'/g, "''");
        whereConditions.push(`(i.codigo ILIKE '%${escapedWord}%' OR i.desc3 ILIKE '%${escapedWord}%')`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Company별 집계 쿼리
    const companyQuery = `
        SELECT 
            e1.id_empresa as "CompanyCode", 
            MAX(e1.empdesc) as "CompanyName", 
            SUM(i.cant3) as "totalCantidad" 
        FROM ingresos i
        LEFT JOIN codigos c 
            ON i.ref_id_codigo = c.id_codigo AND i.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN empresas e1 
            ON e1.id_empresa = t.ref_id_empresa AND e1.borrado IS FALSE 
        WHERE ${whereClause}
        GROUP BY e1.id_empresa
        ORDER BY e1.id_empresa
    `;

    // Category별 집계 쿼리
    const categoryQuery = `
        SELECT 
            t1.id_tipo as "CategoryCode", 
            MAX(t1.tpdesc) as "CategoryName", 
            SUM(i.cant3) as "totalCantidad" 
        FROM ingresos i 
        LEFT JOIN codigos c 
            ON i.ref_id_codigo = c.id_codigo AND i.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN tipos t1 
            ON t1.id_tipo = t.ref_id_tipo AND t1.borrado IS FALSE 
        WHERE ${whereClause}
        GROUP BY t1.id_tipo
        ORDER BY t1.id_tipo
    `;

    // 제품별 상세 내역 쿼리
    const productQuery = `
        SELECT 
            i.codigo as "codigo", 
            MAX(i.desc3) as "ProductName", 
            SUM(i.cant3) as "totalCantidad", 
            MAX(t1.id_tipo) as "CategoryCode", 
            MAX(e1.id_empresa) as "CompanyCode" 
        FROM ingresos i 
        LEFT JOIN codigos c 
            ON i.ref_id_codigo = c.id_codigo AND i.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN tipos t1 
            ON t1.id_tipo = t.ref_id_tipo AND t1.borrado IS FALSE 
        LEFT JOIN empresas e1 
            ON e1.id_empresa = t.ref_id_empresa AND e1.borrado IS FALSE 
        WHERE ${whereClause}
        GROUP BY i.codigo
        ORDER BY i.codigo
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
        console.error('[Ingresos 보고서] 쿼리 실행 실패:');
        console.error('   Error:', err.message);
        throw err;
    }

    // 집계 정보 계산
    const totalCantidad = productDetails.reduce((sum, item) => sum + (parseFloat(item.totalCantidad || 0)), 0);

    return {
        filters: {
            fecha_inicio: startDate,
            fecha_fin: endDate,
            start_date: startDate,
            end_date: endDate,
            filtering_word: filteringWord || null
        },
        summary: {
            total_companies: companySummary.length,
            total_categories: categorySummary.length,
            total_products: productDetails.length,
            total_cantidad: totalCantidad
        },
        data: {
            summary_by_company: companySummary,
            summary_by_category: categorySummary,
            products: productDetails
        }
    };
}

module.exports = { getIngresosReport };
