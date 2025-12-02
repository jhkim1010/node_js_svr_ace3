/**
 * bcolorview 및 is_mayorista 관련 유틸리티 함수
 * 
 * bcolorview와 is_mayorista는 미들웨어(bcolorview-loader)에서 자동으로 req 객체에 로드됩니다.
 * 이 함수들은 보고서 서비스에서 이 값들을 쉽게 사용할 수 있도록 도와줍니다.
 */

/**
 * req 객체에서 bcolorview 값을 가져옵니다.
 * 미들웨어에서 이미 로드되었으므로 직접 req.bcolorview를 사용해도 됩니다.
 * 
 * @param {Object} req - Express 요청 객체
 * @returns {boolean} bcolorview 값 (기본값: false)
 */
function getBcolorview(req) {
    return req.bcolorview || false;
}

/**
 * req 객체에서 bcolorview의 valor1 값을 가져옵니다.
 * 
 * @param {Object} req - Express 요청 객체
 * @returns {string|null} valor1 값 (기본값: null)
 */
function getBcolorviewValor1(req) {
    return req.bcolorviewValor1 || null;
}

/**
 * bcolorview가 활성화되어 있는지 확인합니다.
 * 
 * @param {Object} req - Express 요청 객체
 * @returns {boolean} bcolorview가 활성화되어 있으면 true
 */
function isBcolorviewEnabled(req) {
    return getBcolorview(req) === true;
}

/**
 * req 객체에서 is_mayorista 값을 가져옵니다.
 * 미들웨어에서 이미 로드되었으므로 직접 req.is_mayorista를 사용해도 됩니다.
 * 
 * @param {Object} req - Express 요청 객체
 * @returns {boolean} is_mayorista 값 (기본값: false)
 */
function getIsMayorista(req) {
    return req.is_mayorista || false;
}

/**
 * req 객체에서 is_mayorista의 valor1 값을 가져옵니다.
 * 
 * @param {Object} req - Express 요청 객체
 * @returns {string|null} valor1 값 (기본값: null)
 */
function getIsMayoristaValor1(req) {
    return req.is_mayoristaValor1 || null;
}

/**
 * is_mayorista가 활성화되어 있는지 확인합니다.
 * 
 * @param {Object} req - Express 요청 객체
 * @returns {boolean} is_mayorista가 활성화되어 있으면 true
 */
function isMayoristaEnabled(req) {
    return getIsMayorista(req) === true;
}

module.exports = {
    getBcolorview,
    getBcolorviewValor1,
    isBcolorviewEnabled,
    getIsMayorista,
    getIsMayoristaValor1,
    isMayoristaEnabled
};

