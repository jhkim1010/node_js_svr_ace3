const { connectionPool } = require('../db/dynamic-sequelize');

/**
 * PostgreSQL idle 프로세스 종료
 * 10분 이상 idle 상태인 프로세스를 찾아서 종료합니다.
 * 
 * @param {number} idleMinutes - idle 시간 임계값 (분 단위, 기본값: 10)
 * @returns {Promise<{killedCount: number, failedCount: number, killedPids: number[], failedPids: number[]}>}
 */
async function killIdleProcesses(idleMinutes = 10) {
    try {
        // 연결 풀이 비어있으면 조회 불가
        if (connectionPool.size === 0) {
            console.log(`[DB Idle Killer] 연결 풀이 비어있어 조회할 수 없습니다.`);
            return {
                killedCount: 0,
                failedCount: 0,
                killedPids: [],
                failedPids: []
            };
        }
        
        // 첫 번째 연결을 사용하여 전체 PostgreSQL 서버의 idle 연결 조회
        const firstSequelize = Array.from(connectionPool.values())[0];
        
        // Step 1: 10분 이상 idle 상태인 연결 찾기
        const [idleConnections] = await firstSequelize.query(`
            SELECT 
                pid, 
                state, 
                now() - state_change AS idle_time,
                datname as database,
                usename as username
            FROM pg_stat_activity
            WHERE state = 'idle' 
                AND now() - state_change > interval '${idleMinutes} minutes'
                AND pid <> pg_backend_pid()
            ORDER BY state_change ASC
        `);
        
        if (!idleConnections || idleConnections.length === 0) {
            console.log(`[DB Idle Killer] ${idleMinutes}분 이상 idle 상태인 연결이 없습니다.`);
            return {
                killedCount: 0,
                failedCount: 0,
                killedPids: [],
                failedPids: []
            };
        }
        
        console.log(`[DB Idle Killer] ${idleConnections.length}개의 idle 연결 발견 (${idleMinutes}분 이상)`);
        
        // Step 2: 각 idle 연결 종료
        let killedCount = 0;
        let failedCount = 0;
        const killedPids = [];
        const failedPids = [];
        
        for (const conn of idleConnections) {
            try {
                const pid = conn.pid;
                
                // 연결 종료
                const [terminateResult] = await firstSequelize.query(
                    `SELECT pg_terminate_backend($1) as terminated`,
                    { replacements: [pid] }
                );
                
                if (terminateResult && terminateResult[0] && terminateResult[0].terminated) {
                    killedCount++;
                    killedPids.push(pid);
                    console.log(`[DB Idle Killer] ✅ PID ${pid} 종료 (${conn.database || 'unknown'}, ${conn.username || 'unknown'})`);
                } else {
                    failedCount++;
                    failedPids.push(pid);
                    console.log(`[DB Idle Killer] ❌ PID ${pid} 종료 실패`);
                }
            } catch (err) {
                failedCount++;
                failedPids.push(conn.pid);
                console.error(`[DB Idle Killer] ❌ PID ${conn.pid} 종료 중 오류: ${err.message}`);
            }
        }
        
        console.log(`[DB Idle Killer] 완료: ${killedCount}개 종료, ${failedCount}개 실패`);
        
        return {
            killedCount,
            failedCount,
            killedPids,
            failedPids
        };
    } catch (err) {
        console.error(`[DB Idle Killer] ❌ Idle 프로세스 종료 오류: ${err.message}`);
        return {
            killedCount: 0,
            failedCount: 0,
            killedPids: [],
            failedPids: [],
            error: err.message
        };
    }
}

module.exports = {
    killIdleProcesses
};
