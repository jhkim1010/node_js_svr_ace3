const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getGastosReport(req) {
    const Gastos = getModelForRequest(req, 'Gastos');
    const sequelize = Gastos.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    const fechaInicio = req.query.fecha_inicio || req.query.start_date || req.query.fecha_desde;
    const fechaFin = req.query.fecha_fin || req.query.end_date || req.query.fecha_hasta;

    // sucursal 파라미터 확인
    const sucursal = req.query.sucursal || req.body?.sucursal;
    const sucursalInt = sucursal ? parseInt(sucursal, 10) : null;

    // 날짜가 없으면 에러 반환
    if (!fechaInicio) {
        throw new Error('fecha_inicio is required');
    }
    
    // 디버깅: 파라미터 로깅
    console.log('[Gastos 보고서] 파라미터 확인:');
    console.log(`   sucursal (raw): ${sucursal}`);
    console.log(`   sucursal (parsed): ${sucursalInt || '없음'}`);

    // WHERE 조건 구성
    let whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // 날짜 필터 (fecha >= fechaInicio) - 시작일 포함
    whereConditions.push(`g.fecha >= $${paramIndex}`);
    queryParams.push(fechaInicio);
    paramIndex++;

    // 종료일이 있으면 추가 필터
    if (fechaFin) {
        whereConditions.push(`g.fecha <= $${paramIndex}`);
        queryParams.push(fechaFin);
        paramIndex++;
    }

    // 삭제되지 않은 항목만 조회
    whereConditions.push(`g.borrado IS FALSE`);

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // 첫 번째 쿼리: 그룹화된 집계 (left(g.codigo, 1)로 그룹화)
    const summaryQuery = `
        SELECT 
            COUNT(*) as count,
            MAX(gi.desc_gasto) as desc_gasto,
            SUM(g.costo) as sum_costo,
            LEFT(g.codigo, 1) as codigo_rubro
        FROM gastos g
        INNER JOIN gasto_info gi 
            ON gi.codigo = LEFT(g.codigo, 1)
        ${whereClause}
        GROUP BY LEFT(g.codigo, 1)
        ORDER BY LEFT(g.codigo, 1)
    `;

    // 두 번째 쿼리: 상세 데이터
    // WHERE 조건 재구성 (g1 별칭 사용)
    let detailWhereConditions = [];
    const detailQueryParams = [];
    let detailParamIndex = 1;

    // 날짜 필터 (fecha >= fechaInicio) - 시작일 포함
    detailWhereConditions.push(`g1.fecha >= $${detailParamIndex}`);
    detailQueryParams.push(fechaInicio);
    detailParamIndex++;

    // 종료일이 있으면 추가 필터
    if (fechaFin) {
        detailWhereConditions.push(`g1.fecha <= $${detailParamIndex}`);
        detailQueryParams.push(fechaFin);
        detailParamIndex++;
    }

    // 삭제되지 않은 항목만 조회
    detailWhereConditions.push(`g1.borrado IS FALSE`);
    
    // sucursal 필터 추가 (있을 경우)
    if (sucursalInt !== null && !isNaN(sucursalInt)) {
        detailWhereConditions.push(`g1.sucursal = $${detailParamIndex}`);
        detailQueryParams.push(sucursalInt);
        detailParamIndex++;
    }

    const detailWhereClause = 'WHERE ' + detailWhereConditions.join(' AND ');

    // 디버깅: 쿼리 정보 로깅
    console.log('[Gastos 보고서] 쿼리 구성:');
    console.log(`   Summary 쿼리: rubro별 집계 (GROUP BY LEFT(codigo, 1))`);
    if (sucursalInt !== null && !isNaN(sucursalInt)) {
        console.log(`   Detail 쿼리: codigo와 sucursal로 GROUP BY 처리됨 (sucursal=${sucursalInt} 필터 적용)`);
    } else {
        console.log(`   Detail 쿼리: codigo로만 GROUP BY 처리됨`);
    }

    // sucursal 파라미터에 따라 SELECT와 GROUP BY 조건부 구성
    const sucursalSelect = sucursalInt !== null && !isNaN(sucursalInt) 
        ? 'g1.sucursal as sucursal,' 
        : '';
    const sucursalGroupBy = sucursalInt !== null && !isNaN(sucursalInt) 
        ? ', g1.sucursal' 
        : '';
    const sucursalOrderBy = sucursalInt !== null && !isNaN(sucursalInt) 
        ? ', g1.sucursal' 
        : '';

    const detailQuery = `
        SELECT 
            MAX(g1.fecha) as fecha,
            MAX(g1.hora) as hora,
            MAX(g1.tema) as tema,
            SUM(g1.costo) as costo,
            ${sucursalSelect ? sucursalSelect + '\n            ' : ''}g1.codigo as codigo,
            MAX(gi.desc_gasto) as rubro,
            MAX(g1.id_ga) as id_ga
        FROM gastos g1
        INNER JOIN gasto_info gi 
            ON gi.codigo = g1.codigo
        ${detailWhereClause}
        GROUP BY g1.codigo${sucursalGroupBy}
        ORDER BY g1.codigo${sucursalOrderBy}
    `;

    // 두 쿼리 실행
    const [summaryResults, detailResults] = await Promise.all([
        sequelize.query(summaryQuery, {
            bind: queryParams.length > 0 ? queryParams : undefined,
            type: Sequelize.QueryTypes.SELECT
        }),
        sequelize.query(detailQuery, {
            bind: detailQueryParams.length > 0 ? detailQueryParams : undefined,
            type: Sequelize.QueryTypes.SELECT
        })
    ]);

    // 결과가 배열인지 확인
    const summary = Array.isArray(summaryResults) ? summaryResults : [];
    const detail = Array.isArray(detailResults) ? detailResults : [];

    return {
        filters: {
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin || null,
            start_date: fechaInicio,
            end_date: fechaFin || null,
            sucursal: sucursalInt
        },
        summary: {
            total_rubros: summary.length,
            total_items: detail.length,
            total_costo: summary.reduce((sum, item) => sum + (parseFloat(item.sum_costo) || 0), 0)
        },
        data: {
            summary: summary,
            detail: detail
        }
    };
}

module.exports = { getGastosReport };

