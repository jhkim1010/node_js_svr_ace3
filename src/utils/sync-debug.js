// vcodes / vdetalle UPDATE 동기화 디버깅용 헬퍼
// 기본 활성화 (Vcode, Vdetalle 만). 끄려면 DEBUG_VSYNC=0
// 다른 모델도 보려면 DEBUG_VSYNC_MODELS=Vcode,Vdetalle,Clientes
const { Sequelize } = require('sequelize');
const { normalizeUtimeStringForCompare } = require('./utime-helpers');

const DEFAULT_MODELS = ['Vcode', 'Vdetalle'];

function isSyncDebugEnabled(modelName) {
    if (process.env.DEBUG_VSYNC === '0') return false;
    const models = process.env.DEBUG_VSYNC_MODELS
        ? process.env.DEBUG_VSYNC_MODELS.split(',').map(s => s.trim())
        : DEFAULT_MODELS;
    return models.includes(modelName);
}

function syncDebug(modelName, message, extra) {
    if (!isSyncDebugEnabled(modelName)) return;
    const suffix = extra === undefined ? '' : ` | ${JSON.stringify(extra)}`;
    console.log(`[VSYNC-DEBUG] ${modelName} | ${message}${suffix}`);
}

// 키 값과 utime만 요약 (전체 row 출력 방지)
function summarizeItem(item, keys) {
    if (!item) return null;
    const summary = {};
    for (const key of keys) summary[key] = item[key];
    summary.utime = item.utime;
    return summary;
}

// utime 비교 과정을 원본/정규화 값과 함께 설명
function explainUtimeCompare(clientUtimeStr, serverUtimeStr) {
    const a = normalizeUtimeStringForCompare(clientUtimeStr);
    const b = normalizeUtimeStringForCompare(serverUtimeStr);
    const warnings = [];
    if (serverUtimeStr && /[+-]\d{2}(:?\d{2})?$/.test(serverUtimeStr)) {
        warnings.push('server utime에 timezone offset 포함 (timestamptz) - 문자열 비교 부정확');
    }
    if (a && b && a.slice(0, 19) === b.slice(0, 19)) {
        warnings.push('초 단위까지 동일 - 클라이언트가 수정 시 utime을 갱신하지 않았을 가능성');
    }
    return {
        clientRaw: clientUtimeStr,
        serverRaw: serverUtimeStr,
        clientNormalized: a,
        serverNormalized: b,
        clientNewer: !!(a && b && a > b),
        warnings
    };
}

// INSERT 직전: 같은 키의 레코드가 이미 있는지 조회 (있으면 INSERT는 unique 에러가 나고 UPDATE는 절대 안 됨)
async function probeExistingRecord(Model, modelName, filteredItem, keys, clientUtimeStr, transaction) {
    if (!isSyncDebugEnabled(modelName)) return;
    const where = {};
    for (const key of keys) {
        if (filteredItem[key] === undefined || filteredItem[key] === null) {
            syncDebug(modelName, `probe 생략: 키 '${key}' 값 없음`, summarizeItem(filteredItem, keys));
            return;
        }
        where[key] = filteredItem[key];
    }
    // probe 실패가 트랜잭션을 abort(25P02) 시키지 않도록 savepoint로 격리
    const sp = `sp_vsync_probe_${Date.now()}`;
    const sequelize = Model.sequelize;
    try {
        await sequelize.query(`SAVEPOINT ${sp}`, { transaction });
    } catch (_) {
        return;
    }
    try {
        const existing = await Model.findOne({
            where,
            transaction,
            attributes: [[Sequelize.literal('utime::text'), 'utime_str']],
            raw: true
        });
        if (existing) {
            syncDebug(modelName, '⚠️ 기존 레코드가 있는데 UPDATE 대신 INSERT 경로로 진입 → unique 에러로 실패 예상', {
                where,
                utime: explainUtimeCompare(clientUtimeStr, existing.utime_str)
            });
        } else {
            syncDebug(modelName, '기존 레코드 없음 → INSERT 정상', { where });
        }
        await sequelize.query(`RELEASE SAVEPOINT ${sp}`, { transaction });
    } catch (probeErr) {
        syncDebug(modelName, `probe 조회 실패: ${probeErr.message}`, { where });
        try {
            await sequelize.query(`ROLLBACK TO SAVEPOINT ${sp}`, { transaction });
        } catch (_) {
            // 무시
        }
    }
}

// UPDATE 대상 행이 정말 "같은" 레코드인지 확인하기 위한 식별 필드
const IDENTITY_FIELDS = {
    Vcode: ['vcode', 'fecha', 'tpago', 'cntropas', 'd_num_terminal', 'borrado'],
    Vdetalle: ['vcode1', 'codigo1', 'cant1', 'precio', 'fecha1', 'ref_id_vcode', 'borrado']
};

// primary key 로 찾은 기존 행과 들어온 행을 비교: 키만 같고 내용이 다른 판매면 id 충돌(다른 단말기/시퀀스 리셋) 의심
async function probeUpdateTarget(Model, modelName, dbName, index, filteredItem, where, clientUtimeStr, transaction) {
    if (!isSyncDebugEnabled(modelName)) return;
    const fields = (IDENTITY_FIELDS[modelName] || []).filter(f => Model.rawAttributes && Model.rawAttributes[f]);
    const sequelize = Model.sequelize;
    const sp = `sp_vsync_target_${Date.now()}`;
    try {
        await sequelize.query(`SAVEPOINT ${sp}`, { transaction });
    } catch (_) {
        return;
    }
    try {
        const existing = await Model.findOne({
            where,
            transaction,
            attributes: [...fields, [Sequelize.literal('utime::text'), 'utime_str']],
            raw: true
        });
        await sequelize.query(`RELEASE SAVEPOINT ${sp}`, { transaction });
        if (!existing) {
            syncDebug(modelName, `${dbName} Item ${index + 1}: 기존 행 없음 → INSERT 예정`, { where });
            return;
        }
        const diffs = {};
        for (const f of fields) {
            if (!(f in filteredItem)) continue;
            const incoming = filteredItem[f];
            const stored = existing[f];
            if (String(incoming ?? '') !== String(stored ?? '')) diffs[f] = { incoming, stored };
        }
        const identityKey = modelName === 'Vdetalle' ? 'vcode1' : 'vcode';
        const collision = identityKey in diffs;
        syncDebug(modelName, `${dbName} Item ${index + 1}: 기존 행 발견${collision ? ` ⚠️ ${identityKey} 다름 → 다른 판매와 id 충돌 의심 (덮어쓰기 위험)` : ''}`, {
            where,
            diffs,
            utime: explainUtimeCompare(clientUtimeStr, existing.utime_str)
        });
    } catch (probeErr) {
        syncDebug(modelName, `${dbName} Item ${index + 1}: target probe 실패: ${probeErr.message}`, { where });
        try {
            await sequelize.query(`ROLLBACK TO SAVEPOINT ${sp}`, { transaction });
        } catch (_) {
            // 무시
        }
    }
}

module.exports = {
    probeUpdateTarget,
    isSyncDebugEnabled,
    syncDebug,
    summarizeItem,
    explainUtimeCompare,
    probeExistingRecord
};
