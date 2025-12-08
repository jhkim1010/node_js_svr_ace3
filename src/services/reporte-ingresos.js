const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { getBcolorviewValor1 } = require('../utils/bcolorview-helper');

async function getIngresosReport(req) {
    const Ingresos = getModelForRequest(req, 'Ingresos');
    const sequelize = Ingresos.sequelize;

    // 쿼리 파라미터 파싱 (날짜 범위)
    // fecha_inicio, fecha_fin 또는 start_date, end_date 모두 지원
    const startDate = req.query.fecha_inicio || req.query.start_date;
    const endDate = req.query.fecha_fin || req.query.end_date;

    // 검색어 파라미터 확인
    const filteringWord = req.query.filtering_word || req.query.filteringWord || req.query.search;

    // bcolorview 값 확인 (valor1이 '0' 또는 '1')
    const bcolorviewValor1 = getBcolorviewValor1(req);
    const isBcolorviewEnabled = bcolorviewValor1 === '1' || bcolorviewValor1 === 1;

    // WHERE 조건 구성
    let whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // 날짜 범위 필터 (필수)
    if (startDate && endDate) {
        whereConditions.push(`i.fecha BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
        queryParams.push(startDate);
        queryParams.push(endDate);
        paramIndex += 2;
    } else if (startDate) {
        // 시작일만 있는 경우
        whereConditions.push(`i.fecha >= $${paramIndex}`);
        queryParams.push(startDate);
        paramIndex++;
    } else if (endDate) {
        // 종료일만 있는 경우
        whereConditions.push(`i.fecha <= $${paramIndex}`);
        queryParams.push(endDate);
        paramIndex++;
    }

    // 삭제되지 않은 항목만 조회
    whereConditions.push(`i.borrado IS FALSE`);

    // 자동 추가된 항목 제외
    whereConditions.push(`i.b_autoagregado IS FALSE`);

    // FilteringWord 검색 조건 추가
    if (filteringWord && filteringWord.trim()) {
        const searchTerm = `%${filteringWord.trim()}%`;
        if (isBcolorviewEnabled) {
            // bcolorview가 true인 경우: tcodigo 또는 tdesc에서 검색
            whereConditions.push(`(
                t.tcodigo ILIKE $${paramIndex} OR 
                t.tdesc ILIKE $${paramIndex}
            )`);
        } else {
            // bcolorview가 false인 경우: codigo 또는 desc3에서 검색
            whereConditions.push(`(
                i.codigo ILIKE $${paramIndex} OR 
                i.desc3 ILIKE $${paramIndex}
            )`);
        }
        queryParams.push(searchTerm);
        paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
        ? 'WHERE ' + whereConditions.join(' AND ')
        : '';

    let query;
    let countQuery;

    if (isBcolorviewEnabled) {
        // bcolorview가 true인 경우: todocodigos와 조인하여 tcodigo로 그룹화
        query = `
            SELECT 
                t.tcodigo as codigo,
                MAX(t.tdesc) as descripcion,
                SUM(i.cant3) as tIngreso,
                MIN(i.fecha) as startDate,
                MAX(i.fecha) as endDate,
                COUNT(*) as cntEvent,
                MAX(i.ref_id_codigo) as id_codigo
            FROM ingresos i
            INNER JOIN todocodigos t 
                ON i.ref_id_todocodigo = t.id_todocodigo
            ${whereClause}
            GROUP BY t.tcodigo
            ORDER BY t.tcodigo ASC
        `;

        // 총 그룹 개수 조회
        countQuery = `
            SELECT COUNT(*) as total
            FROM (
                SELECT t.tcodigo
                FROM ingresos i
                INNER JOIN todocodigos t 
                    ON i.ref_id_todocodigo = t.id_todocodigo
                ${whereClause}
                GROUP BY t.tcodigo
            ) as grouped
        `;
    } else {
        // bcolorview가 false인 경우: codigo로 그룹화
        query = `
            SELECT 
                i.codigo,
                MAX(i.desc3) as descripcion,
                SUM(i.cant3) as tIngreso,
                MIN(i.fecha) as startDate,
                MAX(i.fecha) as endDate,
                COUNT(*) as cntEvent,
                MAX(i.ref_id_codigo) as id_codigo
            FROM ingresos i
            ${whereClause}
            GROUP BY i.codigo
            ORDER BY i.codigo ASC
        `;

        // 총 그룹 개수 조회
        countQuery = `
            SELECT COUNT(*) as total
            FROM (
                SELECT i.codigo
                FROM ingresos i
                ${whereClause}
                GROUP BY i.codigo
            ) as grouped
        `;
    }

    // 총 데이터 개수 조회
    const [countResult] = await sequelize.query(countQuery, {
        bind: queryParams.length > 0 ? queryParams : undefined,
        type: Sequelize.QueryTypes.SELECT
    });
    const totalCount = parseInt(countResult.total, 10);

    // SQL 쿼리 실행
    const results = await sequelize.query(query, {
        bind: queryParams.length > 0 ? queryParams : undefined,
        type: Sequelize.QueryTypes.SELECT
    });

    // 결과가 배열인지 확인
    const ingresos = Array.isArray(results) ? results : [];

    // 집계 정보 계산
    const totalCantidad = ingresos.reduce((sum, item) => sum + (parseInt(item.tingreso) || 0), 0);
    const totalEventos = ingresos.reduce((sum, item) => sum + (parseInt(item.cntevent) || 0), 0);

    return {
        filters: {
            fecha_inicio: startDate || null,
            fecha_fin: endDate || null,
            start_date: startDate || null,
            end_date: endDate || null,
            filtering_word: filteringWord || null,
            bcolorview: bcolorviewValor1 || '0'
        },
        summary: {
            total_items: ingresos.length,
            total_cantidad: totalCantidad,
            total_eventos: totalEventos
        },
        data: ingresos
    };
}

module.exports = { getIngresosReport };
