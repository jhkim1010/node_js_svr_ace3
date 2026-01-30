const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getStocksReport(req) {
    // bcolorview는 미들웨어에서 이미 로드됨 (req.bcolorview, req.bcolorviewValor1)
    const bcolorview = req.bcolorview || false;
    const valor1 = req.bcolorviewValor1 || null;

    // Parametros 모델은 더 이상 필요 없지만, sequelize는 다른 모델에서 가져옴
    const Parametros = getModelForRequest(req, 'Parametros');
    const sequelize = Parametros.sequelize;

    // 쿼리 파라미터 파싱
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;
    
    // 페이지네이션 파라미터 확인 (바디 또는 쿼리 파라미터)
    const maxUtime = req.body?.max_utime || req.query?.max_utime;
    const lastGetUtime = req.body?.last_get_utime || req.query?.last_get_utime;
    
    // 검색 및 정렬 파라미터 확인
    const filteringWord = req.body?.filtering_word || req.query?.filtering_word || req.body?.filteringWord || req.query?.filteringWord || req.body?.search || req.query?.search;
    
    // color_id 파라미터 확인 (ref_id_color 필터링용)
    const colorId = req.body?.color_id || req.query?.color_id;
    const colorIdInt = colorId ? parseInt(colorId, 10) : null;
    
    const sortColumn = req.body?.sort_column || req.query?.sort_column || req.body?.sortBy || req.query?.sortBy;
    const sortAscending = req.body?.sort_ascending !== undefined 
        ? (req.body?.sort_ascending === 'true' || req.body?.sort_ascending === true)
        : (req.query?.sort_ascending !== undefined 
            ? (req.query?.sort_ascending === 'true' || req.query?.sort_ascending === true)
            : (req.body?.sortOrder || req.query?.sortOrder 
                ? (req.body?.sortOrder || req.query?.sortOrder).toUpperCase() === 'ASC'
                : true)); // 기본값: 오름차순
    const sortOrder = sortAscending ? 'ASC' : 'DESC';

    // WHERE 조건 구성
    let whereConditions = [];
    const queryParams = [];
    let paramIndex = 1;

    // 2. valor1 값에 따라 다른 테이블 조회
    let query;
    let orderByField;
    let idField;

    if (bcolorview) {
        // valor1이 1인 경우: screendetails2_total_id 조회
        orderByField = 'ref_id_todocodigo';
        idField = 'ref_id_todocodigo';
        query = `
            SELECT 
                s.tcode, 
                s.tdesc, 
                s.fecha1 as first_date, 
                s.fecha2 as last_date, 
                s.pre1, 
                s.pre2, 
                s.pre3, 
                s.pre4, 
                s.pre5,
                s.totaling3, 
                s.totalventa3, 
                s.todaying3, 
                s.todayvnt3, 
                s.totalreservado3, 
                s.cntoffset3, 
                s.stockreal3, 
                s.porcentaje, 
                s.sucursal, 
                s.ref_id_todocodigo
            FROM public.screendetails2_total_id s
        `;
    } else {
        // valor1이 0이거나 없는 경우: screendetails2_id 조회
        orderByField = 'id_codigo1';
        idField = 'id_codigo1';
        query = `
            SELECT 
                s.codigo, 
                s.descripcion, 
                s.fecha1 as first_date, 
                s.fecha2 as last_date, 
                s.pre1, 
                s.pre2, 
                s.pre3, 
                s.pre4, 
                s.pre5, 
                s.totaling, 
                s.totalventa, 
                s.todayingreso, 
                s.todayventa, 
                s.totalreservado, 
                s.cntoffset, 
                s.stockreal, 
                s.porcentaje, 
                s.sucursal, 
                s.id_codigo1 
            FROM public.screendetails2_id s
            ${colorIdInt !== null ? 'LEFT JOIN codigos c ON s.id_codigo1 = c.id_codigo' : ''}
        `;
    }

    // sucursal 필터 추가
    if (sucursal) {
        whereConditions.push(`s.sucursal = $${paramIndex}`);
        queryParams.push(sucursal);
        paramIndex++;
    }
    
    // color_id 필터 추가
    if (colorIdInt !== null && !isNaN(colorIdInt)) {
        if (bcolorview) {
            // screendetails2_total_id의 경우: ref_id_todocodigo를 통해 codigos의 ref_id_color 확인
            whereConditions.push(`EXISTS (SELECT 1 FROM codigos WHERE ref_id_todocodigo = s.ref_id_todocodigo AND ref_id_color = $${paramIndex})`);
        } else {
            // screendetails2_id의 경우: id_codigo1을 통해 codigos의 ref_id_color 확인
            whereConditions.push(`c.ref_id_color = $${paramIndex}`);
        }
        queryParams.push(colorIdInt);
        paramIndex++;
    }

    // max_utime 파라미터 처리 (페이지네이션용)
    if (maxUtime) {
        const maxId = parseInt(maxUtime, 10);
        if (!isNaN(maxId)) {
            whereConditions.push(`s.${idField} > $${paramIndex}`);
            queryParams.push(maxId);
            paramIndex++;
        }
    }

    // last_get_utime 파라미터 처리 (시간 기반 필터링)
    if (lastGetUtime) {
        // ISO 8601 형식의 'T'를 공백으로 변환하고 시간대 정보 제거
        let utimeStr = String(lastGetUtime);
        utimeStr = utimeStr.replace(/T/, ' ').replace(/[Zz]/, '').replace(/[+-]\d{2}:?\d{2}$/, '').trim();
        // fecha1 또는 fecha2를 사용하여 필터링 (테이블에 utime 필드가 없으므로 fecha1 사용)
        whereConditions.push(`s.fecha1::text > $${paramIndex}`);
        queryParams.push(utimeStr);
        paramIndex++;
    }
    
    // FilteringWord 검색 조건 추가 (codigo 또는 descripcion에서만 검색)
    if (filteringWord && filteringWord.trim()) {
        const searchTerm = `%${filteringWord.trim()}%`;
        if (bcolorview) {
            // screendetails2_total_id 테이블의 경우: tcode, tdesc (todocodigo의 codigo, descripcion에 해당)
            whereConditions.push(`(
                s.tcode ILIKE $${paramIndex} OR 
                s.tdesc ILIKE $${paramIndex}
            )`);
        } else {
            // screendetails2_id 테이블의 경우: codigo, descripcion
            whereConditions.push(`(
                s.codigo ILIKE $${paramIndex} OR 
                s.descripcion ILIKE $${paramIndex}
            )`);
        }
        queryParams.push(searchTerm);
        paramIndex++;
    }
    
    // 정렬 가능한 컬럼 화이트리스트 (SQL injection 방지)
    let allowedSortColumns;
    if (bcolorview) {
        allowedSortColumns = [
            'tcode', 'tdesc', 'pre1', 'pre2', 'pre3', 'pre4', 'pre5',
            'totaling3', 'totalventa3', 'stockreal3', 'porcentaje', 'sucursal',
            'ref_id_todocodigo'
        ];
    } else {
        allowedSortColumns = [
            'codigo', 'descripcion', 'pre1', 'pre2', 'pre3', 'pre4', 'pre5',
            'totaling', 'totalventa', 'stockreal', 'porcentaje', 'sucursal',
            'id_codigo1'
        ];
    }
    
    // 정렬 컬럼 검증 및 기본값 설정
    // 파라미터가 없으면 codigo를 중심으로 오름차순 정렬
    let defaultSortColumn;
    if (bcolorview) {
        defaultSortColumn = 'tcode'; // screendetails2_total_id의 경우 tcode
    } else {
        defaultSortColumn = 'codigo'; // screendetails2_id의 경우 codigo
    }
    const validSortBy = sortColumn && allowedSortColumns.includes(sortColumn) ? sortColumn : defaultSortColumn;

    // WHERE 절 구성
    const whereClause = whereConditions.length > 0 
        ? ' WHERE ' + whereConditions.join(' AND ')
        : '';

    // 총 데이터 개수 조회
    let countQuery;
    if (bcolorview) {
        countQuery = `
            SELECT COUNT(*) as total
            FROM public.screendetails2_total_id s
            ${whereClause}
        `;
    } else {
        countQuery = `
            SELECT COUNT(*) as total
            FROM public.screendetails2_id s
            ${colorIdInt !== null ? 'LEFT JOIN codigos c ON s.id_codigo1 = c.id_codigo' : ''}
            ${whereClause}
        `;
    }
    const [countResult] = await sequelize.query(countQuery, {
        bind: queryParams,
        type: Sequelize.QueryTypes.SELECT
    });
    const totalCount = parseInt(countResult.total, 10);

    // 100개 단위로 제한
    const limit = 100;

    // ORDER BY 및 LIMIT 추가
    query += whereClause;
    query += ` ORDER BY s.${validSortBy} ${sortOrder}`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    queryParams.push(limit + 1); // 다음 배치 존재 여부 확인을 위해 1개 더 조회
    queryParams.push(0);

    // SQL 쿼리 실행
    const results = await sequelize.query(query, {
        bind: queryParams,
        type: Sequelize.QueryTypes.SELECT
    });

    // 다음 배치가 있는지 확인
    const hasMore = results.length > limit;
    const allRecords = hasMore ? results.slice(0, limit) : results;

    // 결과가 배열인지 확인
    const stocks = Array.isArray(allRecords) ? allRecords : [];
    
    // 다음 요청을 위한 max_utime 계산 (마지막 레코드의 id 값)
    let nextMaxUtime = null;
    if (stocks.length > 0) {
        const lastRecord = stocks[stocks.length - 1];
        const lastId = bcolorview ? lastRecord.ref_id_todocodigo : lastRecord.id_codigo1;
        if (lastId !== null && lastId !== undefined) {
            nextMaxUtime = String(lastId);
        }
    }

    // Resumen del día (일일 요약) 쿼리 실행 - 항상 screendetails2_id 테이블 사용
    const resumenQueryParams = [];
    let resumenParamIndex = 1;
    let resumenWhereConditions = ['si.sucursal >= 1'];
    
    // sucursal 필터가 있으면 WHERE 절에 추가
    if (sucursal) {
        resumenWhereConditions.push(`si.sucursal = $${resumenParamIndex}`);
        resumenQueryParams.push(sucursal);
        resumenParamIndex++;
    }

    const resumenDelDiaQuery = `
        SELECT 
            COUNT(*) as item_count, 
            SUM(si.totalventa) as tVentas, 
            SUM(si.totaling) as tIngresos, 
            SUM(si.cntoffset) as tOffset, 
            SUM(si.todayventa) as hVentas, 
            SUM(si.todayingreso) as hIngresos, 
            SUM(si.stockreal) as finalStock, 
            si.sucursal
        FROM public.screendetails2_id si 
        WHERE ${resumenWhereConditions.join(' AND ')}
        GROUP BY si.sucursal
    `;

    const resumenDelDia = await sequelize.query(resumenDelDiaQuery, {
        bind: resumenQueryParams.length > 0 ? resumenQueryParams : undefined,
        type: Sequelize.QueryTypes.SELECT
    });

    /**
     * 응답 데이터 구조:
     * {
     *   filters: {
     *     sucursal: number | 'all',      // 필터링된 지점 번호 또는 'all'
     *     bcolorview: boolean,            // valor1이 '1'인지 여부
     *     valor1: string | null           // Parametros에서 조회한 valor1 값
     *   },
     *   summary: {
     *     total_items: number,            // 조회된 데이터 개수
     *     source_table: string            // 사용된 소스 테이블 이름
     *   },
     *   data: Array<StockItem>            // 재고 데이터 배열
     *   pagination: {
     *     count: number,                  // 현재 반환된 개수
     *     total: number,                  // 전체 데이터 개수
     *     hasMore: boolean,               // 다음 배치 존재 여부
     *     nextMaxUtime: string | null     // 다음 요청을 위한 커서 값
     *   },
     *   resumen_del_dia: Array<{          // 일일 요약 데이터 (지점별)
     *     item_count: number,             // 아이템 개수
     *     tVentas: number,                // 총 판매량 합계
     *     tIngresos: number,              // 총 입고량 합계
     *     tOffset: number,                // 오프셋 합계
     *     hVentas: number,                // 오늘 판매량 합계
     *     hIngresos: number,              // 오늘 입고량 합계
     *     finalStock: number,             // 최종 재고 합계
     *     sucursal: number                 // 지점 번호
     *   }>
     * }
     * 
     * StockItem 구조 (bcolorview = false, screendetails2_id):
     * {
     *   codigo: string,                   // 상품 코드
     *   descripcion: string,               // 상품 설명
     *   first_date: Date,                  // 첫 날짜 (fecha1)
     *   last_date: Date,                   // 마지막 날짜 (fecha2)
     *   pre1: number,                      // 가격1
     *   pre2: number,                      // 가격2
     *   pre3: number,                      // 가격3
     *   pre4: number,                      // 가격4
     *   pre5: number,                      // 가격5
     *   totaling: number,                  // 총 입고량
     *   totalventa: number,                // 총 판매량
     *   todayingreso: number,              // 오늘 입고량
     *   todayventa: number,               // 오늘 판매량
     *   totalreservado: number,            // 총 예약량
     *   cntoffset: number,                 // 카운트 오프셋
     *   stockreal: number,                 // 실제 재고
     *   porcentaje: number,                 // 퍼센트
     *   sucursal: number,                  // 지점 번호
     *   id_codigo1: number                  // 코드 ID
     * }
     * 
     * StockItem 구조 (bcolorview = true, screendetails2_total_id):
     * {
     *   tcode: string,                     // 상품 코드 (todocodigo)
     *   tdesc: string,                      // 상품 설명 (todocodigo)
     *   first_date: Date,                   // 첫 날짜 (fecha1)
     *   last_date: Date,                    // 마지막 날짜 (fecha2)
     *   pre1: number,                       // 가격1
     *   pre2: number,                       // 가격2
     *   pre3: number,                       // 가격3
     *   pre4: number,                       // 가격4
     *   pre5: number,                       // 가격5
     *   totaling3: number,                  // 총 입고량
     *   totalventa3: number,                 // 총 판매량
     *   todaying3: number,                  // 오늘 입고량
     *   todayvnt3: number,                  // 오늘 판매량
     *   totalreservado3: number,             // 총 예약량
     *   cntoffset3: number,                  // 카운트 오프셋
     *   stockreal3: number,                 // 실제 재고
     *   porcentaje: number,                  // 퍼센트
     *   sucursal: number,                    // 지점 번호
     *   ref_id_todocodigo: number            // Todocodigo 참조 ID
     * }
     */
    return {
        filters: {
            sucursal: sucursal || 'all',
            bcolorview: bcolorview,
            valor1: valor1,
            filtering_word: filteringWord || null,
            sort_column: validSortBy,
            sort_ascending: sortAscending,
            color_id: colorIdInt
        },
        summary: {
            total_items: stocks.length,
            source_table: bcolorview ? 'screendetails2_total_id' : 'screendetails2_id'
        },
        data: stocks,
        pagination: {
            count: stocks.length,
            total: totalCount,
            hasMore: hasMore,
            nextMaxUtime: nextMaxUtime
        },
        resumen_del_dia: resumenDelDia || []
    };
}

module.exports = { getStocksReport };

