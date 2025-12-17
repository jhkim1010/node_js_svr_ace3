const https = require('https');
const http = require('http');
const { connectionPool, getTotalPoolUsage, TOTAL_POOL_MAX } = require('../db/dynamic-sequelize');
const { killIdleProcesses } = require('../utils/db-idle-killer');

// 아르헨티나 시간대(GMT-3)로 시간 포맷팅하는 헬퍼 함수
function getArgentinaTime() {
    return new Date().toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

// 알림 설정 (환경 변수로 구성)
const MONITORING_CONFIG = {
    enabled: process.env.MONITORING_ENABLED === 'true',
    checkInterval: parseInt(process.env.MONITORING_CHECK_INTERVAL || '60000', 10), // 기본 60초
    connectionThreshold: parseInt(process.env.MONITORING_CONNECTION_THRESHOLD || '1000', 10),
    memoryThresholdMB: parseInt(process.env.MONITORING_MEMORY_THRESHOLD_MB || '500', 10),
    memoryCriticalMB: parseInt(process.env.MONITORING_MEMORY_CRITICAL_MB || '1000', 10),
    
    // Telegram 설정
    telegram: {
        enabled: process.env.TELEGRAM_ENABLED === 'true',
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || ''
    }
};

// 알림 상태 추적 (중복 알림 방지)
const alertState = {
    connectionAlert: false,
    memoryWarningAlert: false,
    memoryCriticalAlert: false,
    poolUsageAlert: {}, // 데이터베이스별 풀 사용률 알림 상태
    lastAlertTime: {},
    lastIdleKillTime: 0, // 마지막 idle kill 시도 시간
    lastConnectionCountBeforeKill: 0 // idle kill 전 연결 수
};

// Telegram 메시지 전송 (Fallback - telegram-command-handler의 bot이 없을 때 사용)
async function sendTelegramMessageFallback(message) {
    if (!MONITORING_CONFIG.telegram.enabled || !MONITORING_CONFIG.telegram.botToken || !MONITORING_CONFIG.telegram.chatId) {
        return false;
    }
    
    const url = `https://api.telegram.org/bot${MONITORING_CONFIG.telegram.botToken}/sendMessage`;
    const data = JSON.stringify({
        chat_id: MONITORING_CONFIG.telegram.chatId,
        text: message,
        parse_mode: 'HTML'
    });
    
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`[Monitoring] ✅ Telegram 알림 전송 성공`);
                    resolve(true);
                } else {
                    console.error(`[Monitoring] ❌ Telegram 알림 전송 실패: ${res.statusCode} - ${responseData}`);
                    resolve(false);
                }
            });
        });
        
        req.on('error', (err) => {
            console.error(`[Monitoring] ❌ Telegram 요청 오류: ${err.message}`);
            resolve(false);
        });
        
        req.write(data);
        req.end();
    });
}

// Telegram 메시지 전송 (telegram-command-handler의 sendTelegramMessage 사용, 없으면 fallback)
async function sendTelegramMessage(message) {
    try {
        // telegram-command-handler의 sendTelegramMessage 사용 시도 (lazy loading)
        const { sendTelegramMessage: handlerSendMessage } = require('./telegram-command-handler');
        const result = await handlerSendMessage(message);
        if (result) {
            return result;
        }
    } catch (err) {
        // telegram-command-handler가 없거나 오류 발생 시 fallback 사용
    }
    
    // Fallback to direct API call
    return await sendTelegramMessageFallback(message);
}

// 알림 전송 (Telegram)
async function sendAlert(message, alertType) {
    const now = Date.now();
    const lastAlertTime = alertState.lastAlertTime[alertType] || 0;
    const cooldownPeriod = 5 * 60 * 1000; // 5분 쿨다운 (중복 알림 방지)
    
    // 쿨다운 기간 내이면 알림 전송하지 않음
    if (now - lastAlertTime < cooldownPeriod) {
        return;
    }
    
    alertState.lastAlertTime[alertType] = now;
    
    console.log(`[Monitoring] 🚨 알림 전송: ${alertType}`);
    console.log(`[Monitoring] 메시지: ${message}`);
    
    // Telegram으로 알림 전송
    const success = await sendTelegramMessage(message);
    if (!success) {
        console.warn(`[Monitoring] ⚠️ Telegram 알림 전송 실패`);
    }
}

// 메모리 사용량 확인
function checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // 메모리 사용량이 임계값을 초과하는지 확인
    if (heapUsedMB >= MONITORING_CONFIG.memoryCriticalMB) {
        if (!alertState.memoryCriticalAlert) {
            const message = `🚨 <b>서버 메모리 위험!</b>\n\n` +
                          `현재 메모리 사용량: ${heapUsedMB}MB\n` +
                          `임계값: ${MONITORING_CONFIG.memoryCriticalMB}MB\n` +
                          `RSS: ${rssMB}MB\n` +
                          `Heap Total: ${heapTotalMB}MB\n` +
                          `시간: ${getArgentinaTime()} (GMT-3)`;
            sendAlert(message, 'memory_critical');
            alertState.memoryCriticalAlert = true;
        }
    } else if (heapUsedMB >= MONITORING_CONFIG.memoryThresholdMB) {
        if (!alertState.memoryWarningAlert) {
            const message = `⚠️ <b>서버 메모리 경고</b>\n\n` +
                          `현재 메모리 사용량: ${heapUsedMB}MB\n` +
                          `임계값: ${MONITORING_CONFIG.memoryThresholdMB}MB\n` +
                          `RSS: ${rssMB}MB\n` +
                          `Heap Total: ${heapTotalMB}MB\n` +
                          `시간: ${getArgentinaTime()} (GMT-3)`;
            sendAlert(message, 'memory_warning');
            alertState.memoryWarningAlert = true;
        }
    } else {
        // 메모리가 정상 범위로 돌아오면 알림 상태 리셋
        alertState.memoryWarningAlert = false;
        alertState.memoryCriticalAlert = false;
    }
    
    return { heapUsedMB, heapTotalMB, rssMB };
}

// WebSocket 연결 수 확인
function checkWebSocketConnections(getWebSocketServer) {
    if (!getWebSocketServer) return 0;
    
    const wss = getWebSocketServer();
    if (!wss) return 0;
    
    const connectionCount = wss.clients.size;
    
    // 연결 수가 임계값을 초과하는지 확인
    if (connectionCount >= MONITORING_CONFIG.connectionThreshold) {
        if (!alertState.connectionAlert) {
            const message = `🚨 <b>WebSocket 연결 수 경고!</b>\n\n` +
                          `현재 연결 수: ${connectionCount}\n` +
                          `임계값: ${MONITORING_CONFIG.connectionThreshold}\n` +
                          `시간: ${getArgentinaTime()} (GMT-3)`;
            sendAlert(message, 'connection');
            alertState.connectionAlert = true;
        }
    } else {
        // 연결 수가 정상 범위로 돌아오면 알림 상태 리셋
        alertState.connectionAlert = false;
    }
    
    return connectionCount;
}

// 모니터링 시작
function startMonitoring(getWebSocketServer) {
    // 모니터링 일시 중지
    console.log(`[Monitoring] 모니터링이 일시 중지되었습니다.`);
    return;
    
    if (!MONITORING_CONFIG.enabled) {
        console.log(`[Monitoring] 모니터링이 비활성화되어 있습니다.`);
        return;
    }
    
    console.log(`[Monitoring] ✅ 모니터링 시작`);
    console.log(`[Monitoring] 설정:`);
    console.log(`   - 체크 간격: ${MONITORING_CONFIG.checkInterval / 1000}초`);
    console.log(`   - 연결 수 임계값: ${MONITORING_CONFIG.connectionThreshold}`);
    console.log(`   - 메모리 경고 임계값: ${MONITORING_CONFIG.memoryThresholdMB}MB`);
    console.log(`   - 메모리 위험 임계값: ${MONITORING_CONFIG.memoryCriticalMB}MB`);
    console.log(`   - Telegram: ${MONITORING_CONFIG.telegram.enabled ? '활성화' : '비활성화'}`);
    
    if (MONITORING_CONFIG.telegram.enabled) {
        if (!MONITORING_CONFIG.telegram.botToken) {
            console.warn(`[Monitoring] ⚠️ Telegram Bot Token이 설정되지 않았습니다.`);
        }
        if (!MONITORING_CONFIG.telegram.chatId) {
            console.warn(`[Monitoring] ⚠️ Telegram Chat ID가 설정되지 않았습니다.`);
        }
    }
    
    // 주기적으로 체크
    const monitoringInterval = setInterval(() => {
        try {
            // 메모리 사용량 확인
            const memInfo = checkMemoryUsage();
            
            // WebSocket 연결 수 확인
            const connectionCount = checkWebSocketConnections(getWebSocketServer);
            
            // 정기 상태 로그 (5분마다)
            if (Date.now() % (5 * 60 * 1000) < MONITORING_CONFIG.checkInterval) {
                console.log(`[Monitoring] 상태 - 연결: ${connectionCount}, 메모리: ${memInfo.heapUsedMB}MB/${memInfo.heapTotalMB}MB, RSS: ${memInfo.rssMB}MB`);
            }
        } catch (err) {
            console.error(`[Monitoring] 모니터링 체크 오류: ${err.message}`);
        }
    }, MONITORING_CONFIG.checkInterval);
    
    // 프로세스 종료 시 인터벌 정리
    process.on('SIGTERM', () => {
        clearInterval(monitoringInterval);
    });
    
    process.on('SIGINT', () => {
        clearInterval(monitoringInterval);
    });
    
    // 즉시 한 번 체크
    checkMemoryUsage();
    checkWebSocketConnections(getWebSocketServer);
}

// 데이터베이스 오류 알림 전송 (Telegram 알림 비활성화 - 오류마다 보낼 필요 없음)
async function sendDatabaseErrorAlert(err, database, table, operation = 'unknown') {
    // 오류 메시지마다 Telegram 알림을 보내지 않음
    // 연결 풀 사용률이 70% 이상일 때만 알림 전송
    return;
}

// PostgreSQL 총 접속자 수 조회
async function checkPostgresConnectionCount() {
    try {
        // 연결 풀이 비어있으면 조회 불가
        if (connectionPool.size === 0) {
            console.log(`[PostgreSQL 연결 수] 연결 풀이 비어있어 조회할 수 없습니다.`);
            return null;
        }
        
        // 첫 번째 연결을 사용하여 전체 PostgreSQL 서버의 연결 수 조회
        const firstSequelize = Array.from(connectionPool.values())[0];
        
        // 전체 서버의 총 연결 수 조회 (pg_stat_activity의 모든 행)
        const [serverResults] = await firstSequelize.query(`
            SELECT count(*) as total_connections 
            FROM pg_stat_activity
        `);
        
        const serverTotal = parseInt(serverResults[0].total_connections, 10);
        
        // 모든 상태별 연결 수 조회 (디버깅용)
        const [stateResults] = await firstSequelize.query(`
            SELECT 
                COALESCE(state, '<NULL>') as state,
                count(*) as count
            FROM pg_stat_activity
            GROUP BY state
            ORDER BY count DESC
        `);
        
        // NULL 상태 연결의 상세 정보 조회 (백그라운드 프로세스 확인)
        const [nullStateDetails] = await firstSequelize.query(`
            SELECT 
                COALESCE(backend_type, '<NULL>') as backend_type,
                COALESCE(usename::text, '<NULL>') as usename,
                COALESCE(application_name::text, '<NULL>') as application_name,
                COALESCE(datname::text, '<NULL>') as datname,
                count(*) as count
            FROM pg_stat_activity
            WHERE state IS NULL
            GROUP BY backend_type, usename, application_name, datname
            ORDER BY count DESC
        `);
        
        // 데이터베이스별 연결 수 조회 (모든 상태 포함)
        // idle in transaction (aborted)도 포함하여 정확한 집계
        const [dbResults] = await firstSequelize.query(`
            SELECT 
                COALESCE(datname::text, '<NULL>') as database_name,
                count(*) FILTER (WHERE state = 'active') as active_count,
                count(*) FILTER (WHERE state = 'idle') as idle_count,
                count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction_count,
                count(*) FILTER (WHERE state = 'idle in transaction (aborted)') as idle_in_transaction_aborted_count,
                count(*) FILTER (WHERE state IS NOT NULL AND state NOT IN ('idle', 'idle in transaction', 'idle in transaction (aborted)', 'active')) as other_state_count,
                count(*) as total_count
            FROM pg_stat_activity 
            GROUP BY datname
            ORDER BY total_count DESC
        `);
        
        const connectionDetails = dbResults.map(r => {
            const active = parseInt(r.active_count, 10);
            const idle = parseInt(r.idle_count, 10);
            const idleInTransaction = parseInt(r.idle_in_transaction_count, 10);
            const idleInTransactionAborted = parseInt(r.idle_in_transaction_aborted_count, 10);
            const other = parseInt(r.other_state_count, 10);
            const total = parseInt(r.total_count, 10);
            
            return {
            database: r.database_name,
                active: active,
                idle: idle,
                idleInTransaction: idleInTransaction,
                idleInTransactionAborted: idleInTransactionAborted,
                other: other,
                total: total
            };
        });
        
        // 데이터베이스별 합계 검증
        const dbTotal = connectionDetails.reduce((sum, d) => sum + d.total, 0);
        const dbActive = connectionDetails.reduce((sum, d) => sum + d.active, 0);
        const dbIdle = connectionDetails.reduce((sum, d) => sum + d.idle, 0);
        const dbIdleInTransaction = connectionDetails.reduce((sum, d) => sum + d.idleInTransaction, 0);
        const dbIdleInTransactionAborted = connectionDetails.reduce((sum, d) => sum + d.idleInTransactionAborted, 0);
        const dbOther = connectionDetails.reduce((sum, d) => sum + d.other, 0);
        
        // 전체 active와 idle 수 계산 (모든 상태 포함)
        const [totalStats] = await firstSequelize.query(`
            SELECT 
                count(*) FILTER (WHERE state = 'active') as total_active,
                count(*) FILTER (WHERE state = 'idle') as total_idle,
                count(*) FILTER (WHERE state = 'idle in transaction') as total_idle_in_transaction,
                count(*) FILTER (WHERE state = 'idle in transaction (aborted)') as total_idle_in_transaction_aborted,
                count(*) FILTER (WHERE state IS NOT NULL AND state NOT IN ('idle', 'idle in transaction', 'idle in transaction (aborted)', 'active')) as total_other
            FROM pg_stat_activity
        `);
        
        const totalActive = parseInt(totalStats[0].total_active, 10);
        const totalIdle = parseInt(totalStats[0].total_idle, 10);
        const totalIdleInTransaction = parseInt(totalStats[0].total_idle_in_transaction, 10);
        const totalIdleInTransactionAborted = parseInt(totalStats[0].total_idle_in_transaction_aborted, 10);
        const totalOther = parseInt(totalStats[0].total_other, 10);
        
        // idle in transaction (aborted)는 문제가 있는 연결이므로 경고 표시
        const totalIdleCombined = totalIdle + totalIdleInTransaction;
        
        // 데이터베이스별 연결 수 간단히 출력 (한 줄에)
        if (connectionDetails.length > 0) {
            const dbConnections = connectionDetails
                .filter(detail => detail.total > 0)  // 0개인 데이터베이스는 제외
                .map(detail => `${detail.database}(${detail.total})`)
                .join(' ');
            
            if (dbConnections) {
                console.log(`[PostgreSQL 연결 수] 총 ${serverTotal}개 - ${dbConnections}`);
            } else {
                console.log(`[PostgreSQL 연결 수] 총 ${serverTotal}개`);
            }
        } else {
            console.log(`[PostgreSQL 연결 수] 총 ${serverTotal}개`);
        }
        
        // 검증: 데이터베이스별 합계가 전체와 일치하는지 확인 (로그 출력 제거)
        // const calculatedTotal = totalActive + totalIdle + totalIdleInTransaction + totalIdleInTransactionAborted + totalOther;
        // if (dbTotal !== serverTotal || calculatedTotal !== serverTotal) {
        //     console.warn(`\n[PostgreSQL 연결 수] ⚠️ 합계 불일치 감지:`);
        //     console.warn(`   전체: ${serverTotal}개`);
        //     console.warn(`   계산된 합계: ${calculatedTotal}개 (Active: ${totalActive}, Idle: ${totalIdle}, Idle in TX: ${totalIdleInTransaction}, Idle in TX (Aborted): ${totalIdleInTransactionAborted}, 기타: ${totalOther})`);
        //     console.warn(`   DB별 합계: ${dbTotal}개`);
        //     console.warn(`   차이: ${serverTotal - dbTotal}개`);
        // }
        
        // idle in transaction (aborted) 경고
        if (totalIdleInTransactionAborted > 0) {
            console.warn(`\n[PostgreSQL 연결 수] ⚠️ 경고: ${totalIdleInTransactionAborted}개의 연결이 "idle in transaction (aborted)" 상태입니다.`);
            console.warn(`   이는 트랜잭션이 시작되었지만 롤백되지 않은 상태를 의미합니다.`);
            console.warn(`   애플리케이션 코드에서 트랜잭션 커밋/롤백을 확인하세요.`);
            
            // Telegram 알림 전송
            const alertMessage = `⚠️ <b>PostgreSQL 트랜잭션 경고</b>\n\n` +
                               `🔗 <b>문제:</b> ${totalIdleInTransactionAborted}개의 연결이 "idle in transaction (aborted)" 상태입니다.\n` +
                               `\n📊 <b>상태 요약:</b>\n` +
                               `   - 총 연결: ${serverTotal}개\n` +
                               `   - Active: ${totalActive}개\n` +
                               `   - Idle: ${totalIdle}개\n` +
                               `   - Idle in Transaction: ${totalIdleInTransaction}개\n` +
                               `   - ⚠️ Idle in Transaction (Aborted): ${totalIdleInTransactionAborted}개\n` +
                               `\n💡 <b>원인:</b> 트랜잭션이 시작되었지만 롤백되지 않은 상태입니다.\n` +
                               `\n⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
            
            await sendTelegramMessage(alertMessage).catch(() => {
                // 알림 전송 실패는 무시
            });
        }
        
        // PostgreSQL 서버의 실제 max_connections 값 조회
        let pgMaxConnections = null;
        try {
            const [maxConnResult] = await firstSequelize.query(`SHOW max_connections`);
            if (maxConnResult && maxConnResult[0] && maxConnResult[0].max_connections) {
                pgMaxConnections = parseInt(maxConnResult[0].max_connections, 10);
            }
        } catch (err) {
            // 조회 실패 시 환경 변수 또는 기본값 사용
        }
        
        // max_connections를 찾지 못한 경우 환경 변수 또는 기본값 사용
        const maxConnections = pgMaxConnections || parseInt(process.env.MAX_CONNECTIONS) || 100;
        const connectionUsage = maxConnections > 0 ? (serverTotal / maxConnections) * 100 : 0;
        
        // 연결 한계 정보 조회 (max_conn, used, res_for_super, res_for_normal)
        let connectionLimitInfo = null;
        try {
            const [limitResult] = await firstSequelize.query(`
                SELECT max_conn, used, res_for_super, (max_conn - res_for_super - used) AS res_for_normal
                FROM (
                    SELECT count(*) as used FROM pg_stat_activity
                ) t1,
                (SELECT setting::int as res_for_super FROM pg_settings WHERE name='superuser_reserved_connections') t2,
                (SELECT setting::int as max_conn FROM pg_settings WHERE name='max_connections') t3
            `);
            
            if (limitResult && limitResult[0]) {
                connectionLimitInfo = {
                    max_conn: parseInt(limitResult[0].max_conn, 10),
                    used: parseInt(limitResult[0].used, 10),
                    res_for_super: parseInt(limitResult[0].res_for_super, 10),
                    res_for_normal: parseInt(limitResult[0].res_for_normal, 10)
                };
            }
        } catch (err) {
            console.error(`[Monitoring] 연결 한계 정보 조회 오류: ${err.message}`);
        }
        
        // 연결 수가 350개를 넘을 때만 경고
        const shouldAlert = serverTotal > 350;
        
        if (shouldAlert) {
            const now = Date.now();
            const alertKey = 'connection_usage';
            const lastAlertTime = alertState.lastAlertTime[alertKey] || 0;
            const lastIdleKillTime = alertState.lastIdleKillTime || 0;
            const lastConnectionCountBeforeKill = alertState.lastConnectionCountBeforeKill || 0;
            const cooldownPeriod = 5 * 60 * 1000; // 5분
            const idleKillRecheckPeriod = 60 * 1000; // 1분 (idle kill 후 재확인 대기 시간)
            
            // idle kill 후 재확인: 1분 이상 지났고, 연결 수가 여전히 과다한지 확인
            const timeSinceLastKill = now - lastIdleKillTime;
            const hasEnoughTimePassed = timeSinceLastKill >= idleKillRecheckPeriod;
            const stillHigh = lastIdleKillTime > 0 && serverTotal >= lastConnectionCountBeforeKill * 0.95; // 5% 이상 감소하지 않았으면
            
            // idle kill을 시도해야 하는지 확인
            // - 아직 idle kill을 시도하지 않았거나
            // - idle kill 후 1분이 지났고 상황이 개선되지 않았거나
            const shouldTryIdleKill = (lastIdleKillTime === 0) || (hasEnoughTimePassed && stillHigh);
            
            if (shouldTryIdleKill) {
                console.log(`[Monitoring] 🔪 연결 수 과다 감지 (${serverTotal}개). Idle 프로세스 종료 시도...`);
                
                // Idle 프로세스 종료 시도
                const killResult = await killIdleProcesses(10); // 10분 이상 idle인 프로세스 종료
                
                console.log(`[Monitoring] ✅ Idle 프로세스 종료 완료: ${killResult.killedCount}개 종료, ${killResult.failedCount}개 실패`);
                
                // 상태 업데이트
                alertState.lastIdleKillTime = now;
                alertState.lastConnectionCountBeforeKill = serverTotal;
                
                // idle kill 후 1분 후에 재확인하도록 설정 (다음 모니터링 주기에서 확인)
                console.log(`[Monitoring] ℹ️ Idle kill 완료. 1분 후 재확인 예정.`);
            } else if (hasEnoughTimePassed && stillHigh) {
                // idle kill 후 1분 이상 지났고, 연결 수가 여전히 과다하면 Telegram 알림 전송
                console.log(`[Monitoring] ⚠️ Idle kill 후에도 연결 수가 여전히 과다합니다 (${lastConnectionCountBeforeKill}개 → ${serverTotal}개). Telegram 알림 전송...`);
                
                // 경고 레벨 결정 (350개 초과 기준)
                let alertLevel = '⚠️';
                let alertTitle = 'PostgreSQL 연결 수 경고';
                
                if (serverTotal >= 400) {
                    alertLevel = '🚨';
                    alertTitle = 'PostgreSQL 연결 수 위험!';
                } else if (serverTotal >= 380) {
                    alertLevel = '🔴';
                    alertTitle = 'PostgreSQL 연결 수 경고';
                }
                
                const alertMessage = `${alertLevel} <b>${alertTitle}</b>\n\n` +
                                   `📊 <b>연결 수:</b> ${serverTotal}개 (임계값: 350개 초과)\n` +
                                   `   - 서버 최대값: ${maxConnections}개\n` +
                                   `   - 사용률: ${connectionUsage.toFixed(1)}%\n` +
                                   `   - Active: ${totalActive}개\n` +
                                   `   - Idle: ${totalIdle}개\n` +
                                   `   - Idle in Transaction: ${totalIdleInTransaction}개\n` +
                                   (totalIdleInTransactionAborted > 0 ? `   - ⚠️ Idle in TX (Aborted): ${totalIdleInTransactionAborted}개\n` : '') +
                                   (totalOther > 0 ? `   - 기타 상태: ${totalOther}개\n` : '') +
                                   `\n🔪 <b>자동 조치:</b> Idle 프로세스 종료 시도 완료\n` +
                                   `   - 상황 개선 없음 (연결 수: ${lastConnectionCountBeforeKill}개 → ${serverTotal}개)\n` +
                                   `\n💡 <b>권장 사항:</b>\n`;
                
                let recommendations = [];
                
                if (serverTotal >= 400) {
                    recommendations.push('🚨 연결 수가 매우 많습니다 (400개 이상)! 즉시 조치 필요');
                    recommendations.push('1. "idle in transaction" 상태의 연결 확인');
                    recommendations.push('2. 애플리케이션 코드에서 트랜잭션 커밋/롤백 확인');
                    recommendations.push('3. 수동으로 불필요한 연결 종료');
                    recommendations.push('4. PostgreSQL 서버의 max_connections 확인');
                } else if (serverTotal >= 380) {
                    recommendations.push('연결 수가 많습니다 (380개 이상)');
                    recommendations.push('1. 연결 풀 설정 확인 (전체 최대값)');
                    recommendations.push('2. 사용하지 않는 연결 정리');
                    recommendations.push('3. 여러 애플리케이션 인스턴스가 실행 중인지 확인');
                } else {
                    recommendations.push('연결 수가 350개를 초과했습니다');
                    recommendations.push('1. 연결이 제대로 해제되는지 확인');
                    recommendations.push('2. 연결 풀 모니터링 지속');
                }
                
                const finalMessage = alertMessage + recommendations.join('\n') +
                                   `\n\n⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
                
                // 쿨다운 체크 (5분)
                if (now - lastAlertTime >= cooldownPeriod) {
                    alertState.lastAlertTime[alertKey] = now;
                    await sendTelegramMessage(finalMessage).catch(() => {
                        // 알림 전송 실패는 무시
                    });
                }
            } else if (lastIdleKillTime > 0 && serverTotal < lastConnectionCountBeforeKill * 0.95) {
                // 상황이 개선된 경우 (5% 이상 감소)
                console.log(`[Monitoring] ✅ 연결 수가 개선되었습니다 (${lastConnectionCountBeforeKill}개 → ${serverTotal}개)`);
                // 상황이 개선되었으므로 상태 리셋
                alertState.lastIdleKillTime = 0;
                alertState.lastConnectionCountBeforeKill = 0;
            } else if (lastIdleKillTime > 0 && !hasEnoughTimePassed) {
                // 아직 재확인 대기 중
                const remainingSeconds = Math.ceil((idleKillRecheckPeriod - timeSinceLastKill) / 1000);
                console.log(`[Monitoring] ℹ️ Idle kill 후 재확인 대기 중... (${remainingSeconds}초 남음)`);
            }
        } else {
            // 연결 수가 정상 범위로 돌아오면 상태 리셋
            if (alertState.lastConnectionCountBeforeKill > 0) {
                console.log(`[Monitoring] ✅ 연결 수가 정상 범위로 돌아왔습니다 (${serverTotal}개)`);
                alertState.lastIdleKillTime = 0;
                alertState.lastConnectionCountBeforeKill = 0;
            }
        }
        
        // 연결 한계 정보 출력
        if (connectionLimitInfo) {
            console.log(`[PostgreSQL 연결 한계] 최대: ${connectionLimitInfo.max_conn}개, 사용 중: ${connectionLimitInfo.used}개, 슈퍼유저 예약: ${connectionLimitInfo.res_for_super}개, 일반 사용 가능: ${connectionLimitInfo.res_for_normal}개`);
        }
        
        console.log(`[PostgreSQL 연결 수] 조회 시간: ${getArgentinaTime()} (GMT-3)\n`);
        
        return {
            total: serverTotal,
            active: totalActive,
            idle: totalIdle,
            idleInTransaction: totalIdleInTransaction,
            idleInTransactionAborted: totalIdleInTransactionAborted,
            other: totalOther,
            stateBreakdown: stateResults.map(s => ({ state: s.state, count: parseInt(s.count, 10) })),
            details: connectionDetails,
            connectionLimitInfo: connectionLimitInfo
        };
    } catch (err) {
        console.error(`[Monitoring] PostgreSQL 연결 수 조회 오류: ${err.message}`);
        return null;
    }
}

// Sequelize 연결 풀 사용률 확인
async function checkConnectionPoolUsage() {
    try {
        if (connectionPool.size === 0) {
            return null;
        }
        
        // 전체 연결 풀 사용량 확인
        const { totalUsed, totalMax } = getTotalPoolUsage();
        const totalUsage = TOTAL_POOL_MAX > 0 ? (totalUsed / TOTAL_POOL_MAX) * 100 : 0;
        
        const poolStats = [];
        
        // 각 데이터베이스의 연결 풀 상태 확인
        for (const [key, sequelize] of connectionPool.entries()) {
            if (!sequelize || !sequelize.config) {
                continue;
            }
            
            const pool = sequelize.connectionManager.pool;
            if (!pool) {
                continue;
            }
            
            const poolMax = sequelize.config.pool?.max || 50;
            const poolUsed = pool.used || 0;
            const poolPending = pool.pending || 0;
            const poolSize = pool.size || 0;
            const poolUsage = poolMax > 0 ? (poolUsed / poolMax) * 100 : 0;
            
            const database = sequelize.config.database || 'unknown';
            const host = sequelize.config.host || 'unknown';
            
            poolStats.push({
                key,
                database,
                host,
                poolMax,
                poolUsed,
                poolPending,
                poolSize,
                poolUsage
            });
            
            // 70% 이상일 때 Telegram 알림 전송 (전체 또는 개별 데이터베이스)
            const shouldAlert = poolUsage >= 70 || totalUsage >= 70;
            
            if (shouldAlert) {
                const alertKey = `pool_usage_${database}`;
                const now = Date.now();
                const lastAlertTime = alertState.lastAlertTime[alertKey] || 0;
                const cooldownPeriod = 5 * 60 * 1000; // 5분 쿨다운
                
                // 쿨다운 기간이 지났거나 아직 알림을 보내지 않은 경우
                if (now - lastAlertTime >= cooldownPeriod || !alertState.poolUsageAlert[alertKey]) {
                    alertState.lastAlertTime[alertKey] = now;
                    alertState.poolUsageAlert[alertKey] = true;
                    
                    // 경고 레벨 결정 (전체 사용률 또는 개별 사용률 중 높은 값 기준)
                    const usageToCheck = Math.max(poolUsage, totalUsage);
                    let alertLevel = '⚠️';
                    let alertTitle = '연결 풀 사용률 경고';
                    
                    if (usageToCheck >= 100) {
                        alertLevel = '🚨';
                        alertTitle = '연결 풀 한계 초과!';
                    } else if (usageToCheck >= 90) {
                        alertLevel = '🔴';
                        alertTitle = '연결 풀 사용률 위험';
                    }
                    
                    const message = `${alertLevel} <b>${alertTitle}</b>\n\n` +
                                   `📊 <b>데이터베이스:</b> ${database}\n` +
                                   `🔗 <b>호스트:</b> ${host}\n` +
                                   `\n📈 <b>연결 풀 상태 (${database}):</b>\n` +
                                   `   - 사용 중: ${poolUsed}/${poolMax}개\n` +
                                   `   - 대기 중: ${poolPending}개\n` +
                                   `   - 풀 크기: ${poolSize}개\n` +
                                   `   - 사용률: ${poolUsage.toFixed(1)}%\n` +
                                   `\n🌐 <b>전체 연결 풀 상태:</b>\n` +
                                   `   - 사용 중: ${totalUsed}/${TOTAL_POOL_MAX}개\n` +
                                   `   - 전체 사용률: ${totalUsage.toFixed(1)}%\n` +
                                   `   - 데이터베이스 수: ${connectionPool.size}개\n` +
                                   `\n💡 <b>권장 사항:</b>\n`;
                    
                    let recommendations = [];
                    if (usageToCheck >= 100) {
                        recommendations.push('🚨 연결 풀 한계 초과! 즉시 조치 필요');
                        recommendations.push('1. 사용 중인 연결 확인');
                        recommendations.push('2. 트랜잭션이 제대로 종료되는지 확인');
                        recommendations.push(`3. 전체 연결 풀 최대값 증가 고려 (현재: ${TOTAL_POOL_MAX})`);
                    } else if (usageToCheck >= 90) {
                        recommendations.push('연결 풀 사용률이 90% 이상입니다');
                        recommendations.push('1. 연결 풀 설정 확인 (전체 최대값)');
                        recommendations.push('2. 사용하지 않는 연결 정리');
                        recommendations.push('3. PostgreSQL 서버 연결 상태 확인');
                    } else {
                        recommendations.push('연결 풀 사용률이 70% 이상입니다');
                        recommendations.push('1. 연결 풀 모니터링 지속');
                        recommendations.push('2. 사용하지 않는 연결 정리');
                    }
                    
                    const finalMessage = message + recommendations.join('\n') +
                                       `\n\n⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
                    
                    await sendTelegramMessage(finalMessage).catch(() => {
                        // 알림 전송 실패는 무시
                    });
                }
            } else {
                // 사용률이 70% 미만으로 떨어지면 알림 상태 리셋
                const alertKey = `pool_usage_${database}`;
                if (alertState.poolUsageAlert[alertKey]) {
                    alertState.poolUsageAlert[alertKey] = false;
                }
            }
        }
        
        return {
            totalUsage,
            totalUsed,
            totalMax: TOTAL_POOL_MAX,
            databaseCount: connectionPool.size,
            pools: poolStats
        };
    } catch (err) {
        console.error(`[Monitoring] 연결 풀 사용률 확인 오류: ${err.message}`);
        return null;
    }
}

// PostgreSQL 연결 수 모니터링 시작 (10분마다)
function startPostgresConnectionMonitoring() {
    // 10분 = 600,000 밀리초
    const interval = 10 * 60 * 1000;
    
    console.log(`[Monitoring] PostgreSQL 연결 수 모니터링 시작 (10분마다)`);
    console.log(`[Monitoring] 연결 풀 사용률 모니터링 시작 (70% 이상 시 알림)`);
    
    // 즉시 한 번 실행
    checkPostgresConnectionCount();
    checkConnectionPoolUsage();
    
    // 10분마다 실행
    const postgresMonitoringInterval = setInterval(async () => {
        try {
            await checkPostgresConnectionCount();
            // 연결 풀 사용률도 함께 확인
            await checkConnectionPoolUsage();
        } catch (err) {
            console.error(`[Monitoring] PostgreSQL 연결 수 모니터링 오류: ${err.message}`);
        }
    }, interval);
    
    // 프로세스 종료 시 인터벌 정리
    process.on('SIGTERM', () => {
        clearInterval(postgresMonitoringInterval);
    });
    
    process.on('SIGINT', () => {
        clearInterval(postgresMonitoringInterval);
    });
    
    return postgresMonitoringInterval;
}

// 모니터링 상태 조회
function getMonitoringStatus(getWebSocketServer) {
    const memInfo = checkMemoryUsage();
    const connectionCount = checkWebSocketConnections(getWebSocketServer);
    
    return {
        enabled: MONITORING_CONFIG.enabled,
        connectionCount,
        memory: {
            heapUsedMB: memInfo.heapUsedMB,
            heapTotalMB: memInfo.heapTotalMB,
            rssMB: memInfo.rssMB
        },
        thresholds: {
            connection: MONITORING_CONFIG.connectionThreshold,
            memoryWarning: MONITORING_CONFIG.memoryThresholdMB,
            memoryCritical: MONITORING_CONFIG.memoryCriticalMB
        },
        alerts: {
            connection: alertState.connectionAlert,
            memoryWarning: alertState.memoryWarningAlert,
            memoryCritical: alertState.memoryCriticalAlert
        },
        notifications: {
            telegram: MONITORING_CONFIG.telegram.enabled
        }
    };
}

module.exports = {
    startMonitoring,
    getMonitoringStatus,
    sendAlert,
    sendDatabaseErrorAlert,
    checkMemoryUsage,
    checkWebSocketConnections,
    startPostgresConnectionMonitoring,
    checkPostgresConnectionCount,
    checkConnectionPoolUsage
};

