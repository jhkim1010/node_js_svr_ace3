const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { checkAllReportConditions } = require('../utils/report-condition-checker');

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
    
    // 디버깅: 파라미터 로깅
    console.log('[Items 보고서] 파라미터 확인:');
    console.log(`   date_changed: ${dateChanged}`);
    console.log(`   color_id (raw): ${colorId}`);
    console.log(`   color_id (parsed): ${colorIdInt} ${dateChanged ? '(기간 변경으로 무시됨)' : ''}`);
    console.log(`   tipo_id (raw): ${tipoId}`);
    console.log(`   tipo_id (parsed): ${tipoIdInt} ${dateChanged ? '(기간 변경으로 무시됨)' : ''}`);
    console.log(`   sucursal (raw): ${sucursal}`);
    console.log(`   sucursal (parsed): ${sucursalInt || '없음'}`);
    console.log(`   필터 적용 대상: 제품 상세 내역만 (resumen 집계는 제외)`);

    // 조건 확인 (유틸리티 함수 사용)
    const conditions = await checkAllReportConditions(sequelize, {
        logResults: true,
        logPrefix: 'Items 보고서'
    });

    const shouldRunCompanyQuery = conditions.company.shouldRun;
    // Category와 Color resumen은 항상 실행 (color_id 필터와 무관하게 항상 유지)
    // 기간이 변경되지 않는 한 resumen은 항상 표시되어야 함
    const shouldRunCategoryQuery = true; // 항상 실행
    const shouldRunColorQuery = true; // 항상 실행
    
    // 디버깅: 쿼리 실행 조건 확인
    console.log('[Items 보고서] 쿼리 실행 조건:');
    console.log(`   Company 쿼리: ${shouldRunCompanyQuery ? '실행' : '건너뜀'}`);
    console.log(`   Category 쿼리: 항상 실행 (resumen 유지)`);
    console.log(`   Color 쿼리: 항상 실행 (resumen 유지)`);

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
    
    // 디버깅: 쿼리 정보 로깅
    console.log('[Items 보고서] 쿼리 구성:');
    if (sucursalInt !== null && !isNaN(sucursalInt)) {
        console.log(`   Company 쿼리: sucursal=${sucursalInt} 필터 적용`);
        console.log(`   Category 쿼리: sucursal=${sucursalInt} 필터 적용`);
        console.log(`   Color 쿼리: sucursal=${sucursalInt} 필터 적용`);
    } else {
        console.log(`   Company 쿼리: 필터 없음 (resumen은 전체 데이터)`);
        console.log(`   Category 쿼리: 필터 없음 (resumen은 전체 데이터)`);
        console.log(`   Color 쿼리: 필터 없음 (resumen은 전체 데이터)`);
    }
    console.log(`   Product 쿼리: color_id=${colorIdInt || '없음'}, tipo_id=${tipoIdInt || '없음'}, sucursal=${sucursalInt || '없음'} ${dateChanged ? '(기간 변경으로 필터 무시)' : ''}`);
    if (includeSucursal) {
        console.log(`   [중요] Product 쿼리는 codigo1과 sucursal로 GROUP BY 처리됨`);
    } else {
        console.log(`   [중요] Product 쿼리는 codigo1로만 GROUP BY 처리됨`);
    }

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
        
        // 디버깅: 쿼리 결과 상세 로깅
        console.log('[Items 보고서] 쿼리 실행 결과 (상세):');
        console.log(`   Company 결과: ${companySummary.length}개 (타입: ${Array.isArray(companyResults) ? 'Array' : typeof companyResults})`);
        console.log(`   Category 결과: ${categorySummary.length}개 (타입: ${Array.isArray(categoryResults) ? 'Array' : typeof categoryResults})`);
        console.log(`   Color 결과: ${colorSummary.length}개 (타입: ${Array.isArray(colorResults) ? 'Array' : typeof colorResults})`);
        console.log(`   Product 결과: ${productDetails.length}개 (타입: ${Array.isArray(productResults) ? 'Array' : typeof productResults})`);
        
        // Category와 Color 결과의 실제 데이터 샘플 출력 (최대 3개)
        if (categorySummary.length > 0) {
            console.log(`   [Category 샘플] 첫 3개:`, categorySummary.slice(0, 3).map(c => ({ 
                CategoryCode: c.CategoryCode, 
                CategoryName: c.CategoryName, 
                totalCantidad: c.totalCantidad 
            })));
        } else {
            console.log(`   [Category 샘플] 데이터 없음 (빈 배열)`);
        }
        
        if (colorSummary.length > 0) {
            console.log(`   [Color 샘플] 첫 3개:`, colorSummary.slice(0, 3).map(c => ({ 
                ColorCode: c.ColorCode, 
                ColorName: c.ColorName, 
                totalCantidad: c.totalCantidad 
            })));
        } else {
            console.log(`   [Color 샘플] 데이터 없음 (빈 배열)`);
        }
        if (colorIdInt !== null || tipoIdInt !== null) {
            const filters = [];
            if (colorIdInt !== null) filters.push(`color_id=${colorIdInt}`);
            if (tipoIdInt !== null) filters.push(`tipo_id=${tipoIdInt}`);
            console.log(`   [필터 적용] ${filters.join(', ')}로 필터링된 제품: ${productDetails.length}개`);
            console.log(`   [필터 미적용] resumen 집계는 전체 데이터 기준 (Category: ${categorySummary.length}개, Color: ${colorSummary.length}개)`);
        }
        if (dateChanged) {
            console.log(`   [중요] 기간이 변경되어 color_id와 tipo_id 필터가 무시되었습니다.`);
        }
    } catch (err) {
        console.error('[Items 보고서] 쿼리 실행 실패:');
        console.error('   Error:', err.message);
        console.error('   Stack:', err.stack);
        if (err.original) {
            console.error('   Original Error:', err.original.message);
        }
        throw err;
    }

    // 집계 결과 처리
    // 주의: color_id 필터가 적용되어도 resumen x tipo와 resumen x color는 항상 유지
    // 기간이 변경되지 않는 한 resumen은 항상 표시되어야 함
    const filteredCompanySummary = companySummary.length > 1 ? companySummary : [];
    // Category와 Color resumen은 항상 반환 (color_id 필터와 무관하게 전체 데이터 기준)
    // length > 1 조건도 제거하여 항상 반환 (빈 배열이어도 반환)
    const filteredCategorySummary = categorySummary || []; // 항상 반환 (빈 배열도 허용)
    const filteredColorSummary = colorSummary || []; // 항상 반환 (빈 배열도 허용)
    
    // 디버깅: resumen 필터링 로직 상세 확인
    console.log('[Items 보고서] Resumen 필터링 (상세):');
    console.log(`   Company 원본: ${companySummary.length}개 → 필터링 후: ${filteredCompanySummary.length}개 (length > 1 조건 적용)`);
    console.log(`   Category 원본: ${categorySummary.length}개 → 필터링 후: ${filteredCategorySummary.length}개 (항상 반환, 조건 없음)`);
    console.log(`   Color 원본: ${colorSummary.length}개 → 필터링 후: ${filteredColorSummary.length}개 (항상 반환, 조건 없음)`);
    console.log(`   [검증] categorySummary === filteredCategorySummary: ${categorySummary === filteredCategorySummary}`);
    console.log(`   [검증] colorSummary === filteredColorSummary: ${colorSummary === filteredColorSummary}`);
    console.log(`   [검증] filteredCategorySummary가 배열인가: ${Array.isArray(filteredCategorySummary)}`);
    console.log(`   [검증] filteredColorSummary가 배열인가: ${Array.isArray(filteredColorSummary)}`);
    console.log(`   [중요] color_id 필터와 무관하게 resumen은 항상 반환됩니다.`);
    console.log(`   [중요] 기간이 변경되지 않는 한 resumen은 유지됩니다.`);

    // 로그 기록: resumen x empresas, x category, x color, 세부 데이터 개수
    console.log('[Items 보고서] 최종 데이터 개수:');
    console.log(`   Resumen x Empresas: ${filteredCompanySummary.length}개`);
    console.log(`   Resumen x Category: ${filteredCategorySummary.length}개 (항상 반환)`);
    console.log(`   Resumen x Color: ${filteredColorSummary.length}개 (항상 반환)`);
    console.log(`   세부 데이터 (Products): ${productDetails.length}개`);
    if (colorIdInt !== null || tipoIdInt !== null) {
        const filters = [];
        if (colorIdInt !== null) filters.push(`color_id=${colorIdInt}`);
        if (tipoIdInt !== null) filters.push(`tipo_id=${tipoIdInt}`);
        console.log(`   [참고] ${filters.join(', ')} 필터가 적용된 것은 Products만입니다.`);
        console.log(`   [참고] Resumen x Category와 Resumen x Color는 전체 데이터 기준이며 항상 표시됩니다.`);
        console.log(`   [참고] 기간이 변경되지 않는 한 resumen은 유지됩니다.`);
        console.log(`   [참고] color_id나 tipo_id를 변경해도 resumen은 삭제되지 않고 유지됩니다.`);
    } else {
        console.log(`   [참고] 필터가 없으므로 모든 데이터가 표시됩니다.`);
        console.log(`   [참고] 기간을 변경하면 resumen이 새로운 기간 기준으로 갱신됩니다.`);
    }
    if (dateChanged) {
        console.log(`   [중요] 기간이 변경되어 color_id와 tipo_id가 무시되었습니다.`);
    }

    // 집계 정보 계산
    const totalCantidad = productDetails.reduce((sum, item) => sum + (parseFloat(item.totalCantidad || 0)), 0);

    // 디버깅: 최종 응답 구조 확인
    console.log('[Items 보고서] 최종 응답 구조 확인:');
    console.log(`   data.summary_by_category 타입: ${Array.isArray(filteredCategorySummary) ? 'Array' : typeof filteredCategorySummary}`);
    console.log(`   data.summary_by_category 길이: ${filteredCategorySummary.length}`);
    console.log(`   data.summary_by_color 타입: ${Array.isArray(filteredColorSummary) ? 'Array' : typeof filteredColorSummary}`);
    console.log(`   data.summary_by_color 길이: ${filteredColorSummary.length}`);
    console.log(`   data.products 길이: ${productDetails.length}`);
    if (colorIdInt !== null) {
        console.log(`   [중요] color_id=${colorIdInt}가 설정되었지만, summary_by_category와 summary_by_color는 여전히 반환됩니다.`);
        console.log(`   [중요] 클라이언트에서 이 데이터를 사용하여 왼쪽 resumen을 유지해야 합니다.`);
    }

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
    
    // 디버깅: 응답 데이터 최종 확인
    console.log('[Items 보고서] 응답 데이터 최종 확인:');
    console.log(`   responseData.data.summary_by_category 존재: ${responseData.data.hasOwnProperty('summary_by_category')}`);
    console.log(`   responseData.data.summary_by_color 존재: ${responseData.data.hasOwnProperty('summary_by_color')}`);
    console.log(`   responseData.data.products 존재: ${responseData.data.hasOwnProperty('products')}`);
    console.log(`   [최종] summary_by_category: ${responseData.data.summary_by_category.length}개 항목`);
    console.log(`   [최종] summary_by_color: ${responseData.data.summary_by_color.length}개 항목`);
    console.log(`   [최종] products: ${responseData.data.products.length}개 항목`);
    
    return responseData;
}

module.exports = { getItemsReport };

