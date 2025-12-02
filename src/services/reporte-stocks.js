const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getStocksReport(req) {
    const Parametros = getModelForRequest(req, 'Parametros');
    const sequelize = Parametros.sequelize;

    // 쿼리 파라미터 파싱
    const sucursal = req.query.sucursal ? parseInt(req.query.sucursal, 10) : null;

    // 1. 먼저 parametros 테이블에서 valor1 값 조회
    const parametro = await Parametros.findOne({
        where: {
            progname: 'SControl',
            pname: 'bcolorview',
            opcion: '1'
        },
        raw: true
    });

    const valor1 = parametro ? parametro.valor1 : null;
    const bcolorview = valor1 === '1' || valor1 === 1;

    // 2. valor1 값에 따라 다른 테이블 조회
    let query;
    let whereClause = '';
    const queryParams = [];

    if (bcolorview) {
        // valor1이 1인 경우: screendetails2_total_id 조회
        query = `
            SELECT 
                tcode, 
                tdesc, 
                fecha1 as first_date, 
                fecha2 as last_date, 
                pre1, 
                pre2, 
                pre3, 
                pre4, 
                pre5,
                totaling3, 
                totalventa3, 
                todaying3, 
                todayvnt3, 
                totalreservado3, 
                cntoffset3, 
                stockreal3, 
                porcentaje, 
                sucursal, 
                ref_id_todocodigo
            FROM public.screendetails2_total_id
        `;
    } else {
        // valor1이 0이거나 없는 경우: screendetails2_id 조회
        query = `
            SELECT 
                codigo, 
                descripcion, 
                fecha1 as first_date, 
                fecha2 as last_date, 
                pre1, 
                pre2, 
                pre3, 
                pre4, 
                pre5, 
                totaling, 
                totalventa, 
                todayingreso, 
                todayventa, 
                totalreservado, 
                cntoffset, 
                stockreal, 
                porcentaje, 
                sucursal, 
                id_codigo1 
            FROM public.screendetails2_id
        `;
    }

    // sucursal 필터 추가
    if (sucursal) {
        whereClause = ' WHERE sucursal = $1';
        queryParams.push(sucursal);
    }

    query += whereClause;

    // SQL 쿼리 실행
    const results = await sequelize.query(query, {
        bind: queryParams,
        type: Sequelize.QueryTypes.SELECT
    });

    // 결과가 배열인지 확인
    const stocks = Array.isArray(results) ? results : [];

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
            valor1: valor1
        },
        summary: {
            total_items: stocks.length,
            source_table: bcolorview ? 'screendetails2_total_id' : 'screendetails2_id'
        },
        data: stocks
    };
}

module.exports = { getStocksReport };

