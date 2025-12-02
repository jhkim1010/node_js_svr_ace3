const { getModelForRequest } = require('../models/model-factory');

/**
 * bcolorview와 b4mayor 값을 데이터베이스에서 조회하여 req 객체에 저장하는 미들웨어
 * 이 미들웨어는 db-header 미들웨어 이후에 실행되어야 합니다.
 * 
 * req.bcolorview: boolean - valor1이 '1'인지 여부
 * req.bcolorviewValor1: string | null - Parametros에서 조회한 valor1 값
 * req.is_mayorista: boolean - b4mayor의 valor1이 '1'인지 여부
 * req.is_mayoristaValor1: string | null - Parametros에서 조회한 b4mayor의 valor1 값
 */
async function loadBcolorview(req, res, next) {
    try {
        // dbConfig가 없으면 파라미터 조회 건너뛰기 (헤더 검증 실패 시)
        if (!req.dbConfig) {
            req.bcolorview = false;
            req.bcolorviewValor1 = null;
            req.is_mayorista = false;
            req.is_mayoristaValor1 = null;
            return next();
        }

        // Parametros 모델 가져오기
        const Parametros = getModelForRequest(req, 'Parametros');

        // 두 파라미터를 병렬로 조회
        const [bcolorviewParam, b4mayorParam] = await Promise.all([
            Parametros.findOne({
                where: {
                    progname: 'SControl',
                    pname: 'bcolorview',
                    opcion: '1'
                },
                raw: true
            }),
            Parametros.findOne({
                where: {
                    pname: 'b4mayor',
                    opcion: '1'
                },
                raw: true
            })
        ]);

        // bcolorview 처리
        const bcolorviewValor1 = bcolorviewParam ? bcolorviewParam.valor1 : null;
        const bcolorview = bcolorviewValor1 === '1' || bcolorviewValor1 === 1;

        // b4mayor 처리 (is_mayorista)
        const is_mayoristaValor1 = b4mayorParam ? b4mayorParam.valor1 : null;
        const is_mayorista = is_mayoristaValor1 === '1' || is_mayoristaValor1 === 1;

        // req 객체에 저장
        req.bcolorview = bcolorview;
        req.bcolorviewValor1 = bcolorviewValor1;
        req.is_mayorista = is_mayorista;
        req.is_mayoristaValor1 = is_mayoristaValor1;

        next();
    } catch (err) {
        // 오류 발생 시 기본값 설정하고 계속 진행
        console.error('Error loading parameters (bcolorview, b4mayor):', err.message);
        req.bcolorview = false;
        req.bcolorviewValor1 = null;
        req.is_mayorista = false;
        req.is_mayoristaValor1 = null;
        next();
    }
}

module.exports = { loadBcolorview };

