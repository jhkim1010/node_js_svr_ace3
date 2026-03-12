/**
 * fetch 테이블 응답 후 connection pool 반환 확인용 디버깅
 * DEBUG_POOL_AFTER_FETCH=1 일 때만 응답 직후 풀 사용량(used/size/pending)을 한 줄 로그
 */

/**
 * 응답 전송 직후 풀 상태를 setImmediate로 로그 (연결이 풀에 반환되었는지 확인용)
 * @param {Object} sequelize - Sequelize 인스턴스 (해당 DB의 풀 사용)
 * @param {string} label - 로그에 표시할 라벨 (예: 'ingresos', 'movidos', 'codigos')
 */
function logPoolAfterResponse(sequelize, label) {
    if (process.env.DEBUG_POOL_AFTER_FETCH !== '1') return;
    if (!sequelize || !sequelize.connectionManager || !sequelize.connectionManager.pool) return;

    const pool = sequelize.connectionManager.pool;
    const dbName = sequelize.config && sequelize.config.database ? sequelize.config.database : '';

    setImmediate(() => {
        const used = pool.used ?? 0;
        const size = pool.size ?? 0;
        const pending = pool.pending ?? 0;
        const tag = label || 'fetch';
        const dbPart = dbName ? ` db=${dbName}` : '';
        console.log(`[pool] ${tag} after response${dbPart} | used=${used} size=${size} pending=${pending}`);
    });
}

module.exports = {
    logPoolAfterResponse
};
