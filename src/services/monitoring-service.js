const https = require('https');
const http = require('http');
const { connectionPool } = require('../db/dynamic-sequelize');

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
    lastAlertTime: {}
};

// Telegram 메시지 전송
async function sendTelegramMessage(message) {
    // 텔레그램 메시지 전송 일시 중지
    return false;
    
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
                          `시간: ${new Date().toLocaleString('ko-KR')}`;
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
                          `시간: ${new Date().toLocaleString('ko-KR')}`;
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
                          `시간: ${new Date().toLocaleString('ko-KR')}`;
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

// 데이터베이스 오류 알림 전송
async function sendDatabaseErrorAlert(err, database, table, operation = 'unknown') {
    if (!MONITORING_CONFIG.enabled || !MONITORING_CONFIG.telegram.enabled) {
        return;
    }
    
    let errorMsg = err.original ? err.original.message : err.message;
    // 연결 한계 도달 오류 메시지 간소화
    if (errorMsg && errorMsg.includes('remaining connection slots are reserved for non-replication superuser connections')) {
        errorMsg = 'database 연결 한계도달';
    }
    const errorCode = err.original ? err.original.code : err.code;
    const errorType = err.constructor.name || 'UnknownError';
    
    // 오류 메시지 길이 제한 (Telegram 메시지 최대 길이: 4096자)
    const maxMessageLength = 3500; // 여유를 두고 3500자로 제한
    let truncatedErrorMsg = errorMsg;
    if (truncatedErrorMsg.length > maxMessageLength) {
        truncatedErrorMsg = truncatedErrorMsg.substring(0, maxMessageLength) + '... (truncated)';
    }
    
    const message = `🚨 <b>데이터베이스 오류 발생</b>\n\n` +
                   `📊 <b>데이터베이스:</b> ${database || '알 수 없음'}\n` +
                   `📋 <b>테이블:</b> ${table || '알 수 없음'}\n` +
                   `⚙️ <b>작업:</b> ${operation}\n` +
                   `❌ <b>오류 타입:</b> ${errorType}\n` +
                   (errorCode ? `🔢 <b>오류 코드:</b> ${errorCode}\n` : '') +
                   `\n💬 <b>오류 메시지:</b>\n<code>${truncatedErrorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>\n` +
                   `\n⏰ <b>시간:</b> ${new Date().toLocaleString('ko-KR')}`;
    
    // 데이터베이스 오류는 쿨다운 없이 전송 (중요한 오류이므로)
    console.log(`[Monitoring] 🚨 데이터베이스 오류 알림 전송`);
    console.log(`[Monitoring] 데이터베이스: ${database}, 테이블: ${table}, 작업: ${operation}`);
    console.log(`[Monitoring] 오류 메시지: ${errorMsg}`);
    
    const success = await sendTelegramMessage(message);
    if (!success) {
        console.warn(`[Monitoring] ⚠️ 데이터베이스 오류 알림 전송 실패`);
    }
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
        
        // 상태별 상세 정보 출력
        console.log(`\n[PostgreSQL 연결 수] 총 접속자: ${serverTotal}개`);
        console.log(`   - Active: ${totalActive}개`);
        console.log(`   - Idle: ${totalIdle}개`);
        console.log(`   - Idle in Transaction: ${totalIdleInTransaction}개`);
        if (totalIdleInTransactionAborted > 0) {
            console.warn(`   - ⚠️ Idle in Transaction (Aborted): ${totalIdleInTransactionAborted}개 (트랜잭션 미완료 문제!)`);
        }
        if (totalOther > 0) {
            console.log(`   - 기타 상태: ${totalOther}개`);
        }
        
        // 상태별 상세 정보 출력
        if (stateResults.length > 0) {
            console.log(`\n[상태별 상세 정보]`);
            stateResults.forEach(state => {
                console.log(`   - ${state.state}: ${state.count}개`);
            });
        }
        
        // 데이터베이스별 상세 정보 출력
        if (connectionDetails.length > 0) {
            console.log(`\n[데이터베이스별 연결 수]`);
            connectionDetails.forEach(detail => {
                if (detail.total > 0) {  // 0개인 데이터베이스는 출력하지 않음
                    const parts = [
                        `Active: ${detail.active}`,
                        `Idle: ${detail.idle}`,
                        `Idle in TX: ${detail.idleInTransaction}`
                    ];
                    if (detail.idleInTransactionAborted > 0) {
                        parts.push(`⚠️ Idle in TX (Aborted): ${detail.idleInTransactionAborted}`);
                    }
                    if (detail.other > 0) {
                        parts.push(`기타: ${detail.other}`);
                    }
                    console.log(`   - ${detail.database}: 총 ${detail.total}개 (${parts.join(', ')})`);
                }
            });
        }
        
        // 검증: 데이터베이스별 합계가 전체와 일치하는지 확인
        const calculatedTotal = totalActive + totalIdle + totalIdleInTransaction + totalIdleInTransactionAborted + totalOther;
        if (dbTotal !== serverTotal || calculatedTotal !== serverTotal) {
            console.warn(`\n[PostgreSQL 연결 수] ⚠️ 합계 불일치 감지:`);
            console.warn(`   전체: ${serverTotal}개`);
            console.warn(`   계산된 합계: ${calculatedTotal}개 (Active: ${totalActive}, Idle: ${totalIdle}, Idle in TX: ${totalIdleInTransaction}, Idle in TX (Aborted): ${totalIdleInTransactionAborted}, 기타: ${totalOther})`);
            console.warn(`   DB별 합계: ${dbTotal}개`);
            console.warn(`   차이: ${serverTotal - dbTotal}개`);
        }
        
        // idle in transaction (aborted) 경고
        if (totalIdleInTransactionAborted > 0) {
            console.warn(`\n[PostgreSQL 연결 수] ⚠️ 경고: ${totalIdleInTransactionAborted}개의 연결이 "idle in transaction (aborted)" 상태입니다.`);
            console.warn(`   이는 트랜잭션이 시작되었지만 롤백되지 않은 상태를 의미합니다.`);
            console.warn(`   애플리케이션 코드에서 트랜잭션 커밋/롤백을 확인하세요.`);
        }
        
        console.log(`[PostgreSQL 연결 수] 조회 시간: ${new Date().toLocaleString('ko-KR')}\n`);
        
        return {
            total: serverTotal,
            active: totalActive,
            idle: totalIdle,
            idleInTransaction: totalIdleInTransaction,
            idleInTransactionAborted: totalIdleInTransactionAborted,
            other: totalOther,
            stateBreakdown: stateResults.map(s => ({ state: s.state, count: parseInt(s.count, 10) })),
            details: connectionDetails
        };
    } catch (err) {
        console.error(`[Monitoring] PostgreSQL 연결 수 조회 오류: ${err.message}`);
        return null;
    }
}

// PostgreSQL 연결 수 모니터링 시작 (10분마다)
function startPostgresConnectionMonitoring() {
    // 10분 = 600,000 밀리초
    const interval = 10 * 60 * 1000;
    
    console.log(`[Monitoring] PostgreSQL 연결 수 모니터링 시작 (10분마다)`);
    
    // 즉시 한 번 실행
    checkPostgresConnectionCount();
    
    // 10분마다 실행
    const postgresMonitoringInterval = setInterval(async () => {
        try {
            await checkPostgresConnectionCount();
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
    checkPostgresConnectionCount
};

