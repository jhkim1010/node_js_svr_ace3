const { getDynamicSequelize } = require('../db/dynamic-sequelize');
const { Sequelize } = require('sequelize');
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

// DB별 테이블 실제 컬럼 캐시: "host:port/database:tableName" -> Set<columnName>
const tableColumnsCache = new Map();

// DB별 전체 스키마 로드 완료 여부: "host:port/database" -> Promise
const schemaLoadPromises = new Map();

// DB의 모든 테이블 컬럼을 한 번에 조회하여 캐시
async function loadAllTableColumns(sequelize) {
    const dbKey = `${sequelize.config.host}:${sequelize.config.port}/${sequelize.config.database}`;

    try {
        const rows = await sequelize.query(
            `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
            { type: Sequelize.QueryTypes.SELECT }
        );

        for (const row of rows) {
            const cacheKey = `${dbKey}:${row.table_name}`;
            if (!tableColumnsCache.has(cacheKey)) {
                tableColumnsCache.set(cacheKey, new Set());
            }
            tableColumnsCache.get(cacheKey).add(row.column_name);
        }

        console.log(`[Model Validator] ${sequelize.config.database}: 스키마 로드 완료 (${rows.length}개 컬럼)`);

        // 이미 캐시된 모델들도 검증 (스키마 로드 전에 정의된 모델)
        for (const modelName of Object.keys(sequelize.models)) {
            removeNonExistentColumns(sequelize.models[modelName], sequelize);
        }
    } catch (err) {
        console.warn(`[Model Validator] ${sequelize.config.database}: 스키마 로드 실패 (무시) - ${err.message}`);
    }
}

// DB 스키마가 로드되었는지 확인하고, 아직이면 로드 시작
function ensureSchemaLoaded(sequelize) {
    const dbKey = `${sequelize.config.host}:${sequelize.config.port}/${sequelize.config.database}`;
    if (!schemaLoadPromises.has(dbKey)) {
        schemaLoadPromises.set(dbKey, loadAllTableColumns(sequelize));
    }
    return schemaLoadPromises.get(dbKey);
}

// 모델에서 DB에 존재하지 않는 컬럼 제거 (동기 - 캐시가 있을 때만)
function removeNonExistentColumns(model, sequelize) {
    const dbKey = `${sequelize.config.host}:${sequelize.config.port}/${sequelize.config.database}`;
    const tableName = (typeof model.getTableName() === 'object') ? model.getTableName().tableName : model.getTableName();
    const cacheKey = `${dbKey}:${tableName}`;

    const actualColumns = tableColumnsCache.get(cacheKey);
    if (!actualColumns) return; // 캐시가 없으면 건너뜀 (아직 로드 안 됨)

    const toRemove = [];
    for (const attr of Object.keys(model.rawAttributes)) {
        const field = model.rawAttributes[attr].field || attr;
        if (!actualColumns.has(field)) {
            toRemove.push(attr);
        }
    }

    if (toRemove.length > 0) {
        for (const attr of toRemove) {
            model.removeAttribute(attr);
        }
        console.log(`[Model Validator] ${model.name} (${tableName}): DB에 없는 컬럼 ${toRemove.length}개 제거 → ${toRemove.join(', ')}`);
    }
}

function getModelForRequest(req, modelName) {
    if (!req.dbConfig) {
        throw new Error('DB configuration not found in request. Ensure db-header middleware is applied.');
    }

    const { host, port, database, user, password, ssl } = req.dbConfig;
    const sequelize = getDynamicSequelize(host, port, database, user, password, ssl);

    if (!modelDefinitions[modelName]) {
        throw new Error(`Model definition not found: ${modelName}`);
    }

    // Sequelize 인스턴스가 sequelize.models[name]에 모델을 캐싱하므로 재사용
    if (sequelize.models[modelName]) {
        return sequelize.models[modelName];
    }

    // 스키마 로드 시작 (백그라운드, 이미 로드 중이면 중복 실행 안 함)
    ensureSchemaLoaded(sequelize);

    // 모델 정의
    const model = modelDefinitions[modelName](sequelize);

    // 캐시가 이미 있으면 동기적으로 존재하지 않는 컬럼 제거
    removeNonExistentColumns(model, sequelize);

    return model;
}

// 비동기 버전: 스키마 로드 완료 후 모델 반환 (첫 요청에서 에러 방지)
async function getValidatedModelForRequest(req, modelName) {
    if (!req.dbConfig) {
        throw new Error('DB configuration not found in request. Ensure db-header middleware is applied.');
    }

    const { host, port, database, user, password, ssl } = req.dbConfig;
    const sequelize = getDynamicSequelize(host, port, database, user, password, ssl);

    if (!modelDefinitions[modelName]) {
        throw new Error(`Model definition not found: ${modelName}`);
    }

    // 스키마 로드 완료 대기
    await ensureSchemaLoaded(sequelize);

    // 이미 캐시된 모델이 있고 검증 완료된 경우
    if (sequelize.models[modelName]) {
        return sequelize.models[modelName];
    }

    // 모델 정의 후 검증
    const model = modelDefinitions[modelName](sequelize);
    removeNonExistentColumns(model, sequelize);

    return model;
}

module.exports = { getModelForRequest, getValidatedModelForRequest };
