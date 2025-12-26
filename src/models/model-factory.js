const { getDynamicSequelize } = require('../db/dynamic-sequelize');
const { defineVcodeModel } = require('./Vcode');
const { defineVdetalleModel } = require('./Vdetalle');
const { defineIngresosModel } = require('./Ingresos');
const { defineCodigosModel } = require('./Codigos');
const { defineParametrosModel } = require('./Parametros');
const { defineTodocodigosModel } = require('./Todocodigos');
const { defineGastoInfoModel } = require('./GastoInfo');
const { defineGastosModel } = require('./Gastos');
const { defineColorModel } = require('./Color');
const { defineCreditoventasModel } = require('./Creditoventas');
const { defineClientesModel } = require('./Clientes');
const { defineTiposModel } = require('./Tipos');
const { defineVtagsModel } = require('./Vtags');
const { defineOnlineVentasModel } = require('./OnlineVentas');
const { defineLogsModel } = require('./Logs');
const { defineVendedoresModel } = require('./Vendedores');
const { defineManagersModel } = require('./Managers');
const { defineFventasModel } = require('./Fventas');
const { defineSeniasVinculadosModel } = require('./SeniasVinculados');
const { defineTemporadasModel } = require('./Temporadas');
const { defineCuentasModel } = require('./Cuentas');

// 모델 정의 함수들
const modelDefinitions = {
    'Vcode': defineVcodeModel,
    'Vdetalle': defineVdetalleModel,
    'Ingresos': defineIngresosModel,
    'Codigos': defineCodigosModel,
    'Parametros': defineParametrosModel,
    'Todocodigos': defineTodocodigosModel,
    'GastoInfo': defineGastoInfoModel,
    'Gastos': defineGastosModel,
    'Color': defineColorModel,
    'Creditoventas': defineCreditoventasModel,
    'Clientes': defineClientesModel,
    'Tipos': defineTiposModel,
    'Vtags': defineVtagsModel,
    'OnlineVentas': defineOnlineVentasModel,
    'Logs': defineLogsModel,
    'Vendedores': defineVendedoresModel,
    'Managers': defineManagersModel,
    'Fventas': defineFventasModel,
    'SeniasVinculados': defineSeniasVinculadosModel,
    'Temporadas': defineTemporadasModel,
    'Cuentas': defineCuentasModel,
};

function getModelForRequest(req, modelName) {
    if (!req.dbConfig) {
        throw new Error('DB configuration not found in request. Ensure db-header middleware is applied.');
    }
    
    const { host, port, database, user, password, ssl } = req.dbConfig;
    const sequelize = getDynamicSequelize(host, port, database, user, password, ssl);
    
    if (!modelDefinitions[modelName]) {
        throw new Error(`Model definition not found: ${modelName}`);
    }
    
    // 동적 모델 인스턴스 생성 (요청별 캐싱)
    const cacheKey = `${modelName}_${host}_${port}_${database}_${user}`;
    
    if (!req._modelCache) {
        req._modelCache = new Map();
    }
    
    if (req._modelCache.has(cacheKey)) {
        return req._modelCache.get(cacheKey);
    }
    
    const Model = modelDefinitions[modelName](sequelize);
    req._modelCache.set(cacheKey, Model);
    return Model;
}

module.exports = { getModelForRequest };

