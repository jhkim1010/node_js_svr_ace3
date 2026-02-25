const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { checkAllReportConditions, isExcludedCategoryOrColorName } = require('../utils/report-condition-checker');

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

    // 날짜 형식 검증
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
        throw new Error(`Invalid fecha_inicio format. Expected YYYY-MM-DD, received: ${startDate}`);
    }
    if (!dateRegex.test(endDate)) {
        throw new Error(`Invalid fecha_fin format. Expected YYYY-MM-DD, received: ${endDate}`);
    }

    // 날짜 범위 검증
    if (startDate > endDate) {
        throw new Error(`Invalid date range: fecha_inicio (${startDate}) must be less than or equal to fecha_fin (${endDate})`);
    }

    // SQL injection 방지를 위해 이스케이프 처리
    const escapedStartDate = startDate.replace(/'/g, "''");
    const escapedEndDate = endDate.replace(/'/g, "''");

    // 기간 변경 감지: date_changed 플래그 확인
    // 기간이 변경되면 color_id와 tipo_id를 무시해야 함
    const dateChanged = req.query.date_changed === 'true' || req.body?.date_changed === true || req.query.date_changed === true;
    
    // color_id 파라미터 확인 (ref_id_color 필터링용)
    // 주의: color_id 필터는 제품 상세 내역(products)에만 적용되고,
    // resumen x tipo, resumen x color 집계에는 적용되지 않음
    // 기간이 변경되면 color_id를 무시
    const colorId = dateChanged ? null : (req.query.color_id || req.body?.color_id);
    const colorIdInt = colorId ? parseInt(colorId, 10) : null;
    
    // tipo_id 파라미터 확인 (ref_id_tipo 필터링용)
    // 주의: tipo_id 필터는 제품 상세 내역(products)에만 적용되고,
    // resumen x tipo, resumen x color 집계에는 적용되지 않음
    // 기간이 변경되면 tipo_id를 무시
    const tipoId = dateChanged ? null : (req.query.tipo_id || req.body?.tipo_id || req.query.category_id || req.body?.category_id);
    const tipoIdInt = tipoId ? parseInt(tipoId, 10) : null;
    
    // sucursal 파라미터 확인
    const sucursal = req.query.sucursal || req.body?.sucursal;
    const sucursalInt = sucursal ? parseInt(sucursal, 10) : null;
    
    // 조건 확인 (유틸리티 함수 사용)
    const conditions = await checkAllReportConditions(sequelize, {
        logResults: false, // 로그 출력 비활성화
        logPrefix: 'Items 보고서'
    });

    const shouldRunCompanyQuery = conditions.company.shouldRun;
    // Category와 Color resumen은 항상 실행 (color_id 필터와 무관하게 항상 유지)
    // 기간이 변경되지 않는 한 resumen은 항상 표시되어야 함
    const shouldRunCategoryQuery = true; // 항상 실행
    const shouldRunColorQuery = true; // 항상 실행

    // resumen 쿼리용 WHERE 조건 구성 (sucursal 필터 포함)
    const resumenWhereConditions = [
        `v1.fecha1 BETWEEN '${escapedStartDate}' AND '${escapedEndDate}'`,
        'v1.borrado IS FALSE'
    ];
    
    // sucursal 필터 추가 (있을 경우 resumen에도 적용)
    if (sucursalInt !== null && !isNaN(sucursalInt)) {
        resumenWhereConditions.push(`v1.sucursal = ${sucursalInt}`);
    }
    
    const resumenWhereClause = resumenWhereConditions.join(' AND ');

    // Company별 집계 쿼리
    // 주의: color_id 필터는 적용하지 않음 (resumen은 전체 데이터 기준)
    // sucursal 필터는 적용함 (있을 경우)
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
        WHERE ${resumenWhereClause}
        GROUP BY e1.id_empresa
        ORDER BY e1.id_empresa
    `;

    // Category별 집계 쿼리 (resumen x tipo)
    // 주의: color_id 필터는 적용하지 않음 (resumen은 전체 데이터 기준으로 유지)
    // sucursal 필터는 적용함 (있을 경우)
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
        WHERE ${resumenWhereClause}
        GROUP BY t1.id_tipo
        ORDER BY t1.id_tipo
    `;

    // Color별 집계 쿼리 (resumen x color)
    // 주의: color_id 필터는 적용하지 않음 (resumen은 전체 데이터 기준으로 유지)
    // sucursal 필터는 적용함 (있을 경우)
    const colorQuery = `
        SELECT 
            cl.id_color as "ColorCode", 
            MAX(cl.descripcioncolor) as "ColorName", 
            SUM(v1.cant1) as "totalCantidad" 
        FROM vdetalle v1 
        LEFT JOIN codigos c 
            ON v1.ref_id_codigo = c.id_codigo AND v1.borrado IS FALSE 
        LEFT JOIN color cl
            ON c.ref_id_color = cl.id_color AND cl.borrado IS FALSE
        WHERE ${resumenWhereClause}
        GROUP BY cl.id_color
        ORDER BY cl.id_color
    `;

    // 제품별 상세 내역 쿼리
    // 주의: color_id와 tipo_id 필터는 여기에만 적용됨 (제품 상세 내역만 필터링)
    // 기간이 변경되면 필터를 무시
    let productWhereConditions = [
        `v1.fecha1 BETWEEN '${escapedStartDate}' AND '${escapedEndDate}'`,
        'v1.borrado IS FALSE'
    ];
    
    // sucursal 필터 추가 (있을 경우)
    if (sucursalInt !== null && !isNaN(sucursalInt)) {
        productWhereConditions.push(`v1.sucursal = ${sucursalInt}`);
    }
    
    // color_id와 tipo_id 필터는 기간이 변경되지 않았을 때만 적용
    if (!dateChanged) {
        if (colorIdInt !== null && !isNaN(colorIdInt)) {
            productWhereConditions.push(`c.ref_id_color = ${colorIdInt}`);
        }
        
        if (tipoIdInt !== null && !isNaN(tipoIdInt)) {
            productWhereConditions.push(`t.ref_id_tipo = ${tipoIdInt}`);
        }
    }
    
    const productWhereClause = productWhereConditions.join(' AND ');
    
    // sucursal 파라미터에 따라 SELECT와 GROUP BY 조건부 구성
    const includeSucursal = sucursalInt !== null && !isNaN(sucursalInt);
    
    const productQuery = `
        SELECT 
            codigo1 as "codigo1", 
            MAX(v1.desc1) as "ProductName", 
            SUM(v1.cant1) as "totalCantidad", 
            MAX(t1.id_tipo) as "CategoryCode", 
            MAX(e1.id_empresa) as "CompanyCode"${includeSucursal ? ',\n            v1.sucursal as "sucursal"' : ''}
        FROM vdetalle v1 
        LEFT JOIN codigos c 
            ON v1.ref_id_codigo = c.id_codigo AND v1.borrado IS FALSE 
        LEFT JOIN todocodigos t  
            ON c.ref_id_todocodigo = t.id_todocodigo AND t.borrado IS FALSE
        LEFT JOIN tipos t1 
            ON t1.id_tipo = t.ref_id_tipo AND t1.borrado IS FALSE AND t1.tpdesc != '' 
        LEFT JOIN empresas e1 
            ON e1.id_empresa = t.ref_id_empresa AND e1.borrado IS FALSE AND e1.empdesc != '' 
        WHERE ${productWhereClause}
        GROUP BY codigo1${includeSucursal ? ', v1.sucursal' : ''}
        ORDER BY codigo1${includeSucursal ? ', v1.sucursal' : ''}
    `;
    

    // 조건에 따라 쿼리 실행
    let companySummary = [];
    let categorySummary = [];
    let colorSummary = [];
    let productDetails = [];

    try {
        const queryPromises = [
            sequelize.query(productQuery, {
                type: Sequelize.QueryTypes.SELECT
            })
        ];

        if (shouldRunCompanyQuery) {
            queryPromises.push(
                sequelize.query(companyQuery, {
                    type: Sequelize.QueryTypes.SELECT
                })
            );
        } else {
            queryPromises.push(Promise.resolve([]));
        }

        if (shouldRunCategoryQuery) {
            queryPromises.push(
                sequelize.query(categoryQuery, {
                    type: Sequelize.QueryTypes.SELECT
                })
            );
        } else {
            queryPromises.push(Promise.resolve([]));
        }

        if (shouldRunColorQuery) {
            queryPromises.push(
                sequelize.query(colorQuery, {
                    type: Sequelize.QueryTypes.SELECT
                })
            );
        } else {
            queryPromises.push(Promise.resolve([]));
        }

        const [productResults, companyResults, categoryResults, colorResults] = await Promise.all(queryPromises);

        companySummary = Array.isArray(companyResults) ? companyResults : [];
        categorySummary = Array.isArray(categoryResults) ? categoryResults : [];
        colorSummary = Array.isArray(colorResults) ? colorResults : [];
        productDetails = Array.isArray(productResults) ? productResults : [];
    } catch (err) {
        console.error(`[Items 보고서] 쿼리 실행 실패: ${err.message}`);
        throw err;
    }

    // 집계 결과 처리
    // 주의: color_id 필터가 적용되어도 resumen x tipo와 resumen x color는 항상 유지
    // 기간이 변경되지 않는 한 resumen은 항상 표시되어야 함
    const filteredCompanySummary = companySummary.length > 1 ? companySummary : [];
    // Category/Color: 이름이 NONE이거나 비어있는 그룹은 제외
    const filteredCategorySummary = (categorySummary || []).filter(
        c => !isExcludedCategoryOrColorName(c.CategoryName)
    );
    const filteredColorSummary = (colorSummary || []).filter(
        c => !isExcludedCategoryOrColorName(c.ColorName)
    );

    // 집계 정보 계산
    const totalCantidad = productDetails.reduce((sum, item) => sum + (parseFloat(item.totalCantidad || 0)), 0);

    // 응답 로거에서 사용할 정보 저장
    const filters = [];
    if (colorIdInt !== null) filters.push(`color_id=${colorIdInt}`);
    if (tipoIdInt !== null) filters.push(`tipo_id=${tipoIdInt}`);
    if (sucursalInt !== null && !isNaN(sucursalInt)) filters.push(`sucursal=${sucursalInt}`);
    if (dateChanged) filters.push('date_changed=1');
    req._itemsInfo = `resumen: ${filteredCategorySummary.length} categories, ${filteredColorSummary.length} colors | products: ${productDetails.length}${filters.length > 0 ? ` | ${filters.join(', ')}` : ''}`;
    req._responseDataCount = productDetails.length;

    const responseData = {
        filters: {
            fecha_inicio: startDate,
            fecha_fin: endDate,
            start_date: startDate,
            end_date: endDate,
            color_id: colorIdInt,
            tipo_id: tipoIdInt,
            sucursal: sucursalInt,
            date_changed: dateChanged
        },
        summary: {
            total_companies: filteredCompanySummary.length,
            total_categories: filteredCategorySummary.length,
            total_colors: filteredColorSummary.length,
            total_products: productDetails.length,
            total_cantidad: totalCantidad
        },
        data: {
            summary_by_company: filteredCompanySummary,
            summary_by_category: filteredCategorySummary,
            summary_by_color: filteredColorSummary,
            products: productDetails
        }
    };
    
    return responseData;
}

module.exports = { getItemsReport };

