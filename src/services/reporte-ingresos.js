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

    // 날짜 범위 필터 (필수)
    if (!startDate || !endDate) {
        throw new Error('fecha_inicio and fecha_fin are required');
    }

    // WHERE 조건 구성
    let whereConditions = [
        'fecha BETWEEN $1 AND $2',
        'borrado IS FALSE',
        'i.b_autoagregado IS FALSE'
    ];
    const queryParams = [startDate, endDate];
    let paramIndex = 3;

    // filteringWord 검색 조건 추가 (대소문자 구분 없음)
    if (filteringWord && filteringWord.trim()) {
        const searchTerm = `%${filteringWord.trim()}%`;
        // SQL injection 방지를 위해 이스케이프 처리
        const escapedWord = filteringWord.trim().replace(/'/g, "''");
        whereConditions.push(`(codigo ILIKE $${paramIndex} OR desc3 ILIKE $${paramIndex})`);
        queryParams.push(searchTerm);
        paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // 사용자가 제공한 쿼리 형식 사용
    const query = `
        SELECT 
            codigo,
            MAX(desc3) as descripcion,
            COUNT(*) as tEvent,
            SUM(i.cant3) as tCant,
            MAX(i.ref_id_codigo) as id_codigo,
            sucursal
        FROM ingresos i
        WHERE ${whereClause}
        GROUP BY codigo, sucursal
        ORDER BY codigo ASC, sucursal ASC
    `;

    // SQL 쿼리 실행
    const results = await sequelize.query(query, {
        bind: queryParams,
        type: Sequelize.QueryTypes.SELECT
    });

    // 결과가 배열인지 확인
    const ingresos = Array.isArray(results) ? results : [];

    // 집계 정보 계산
    const totalCantidad = ingresos.reduce((sum, item) => sum + (parseFloat(item.tcant) || 0), 0);
    const totalEventos = ingresos.reduce((sum, item) => sum + (parseInt(item.tevent) || 0), 0);

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
