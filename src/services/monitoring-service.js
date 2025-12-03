const https = require('https');
const http = require('http');

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
    
    const errorMsg = err.original ? err.original.message : err.message;
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
    
    const success = await sendTelegramMessage(message);
    if (!success) {
        console.warn(`[Monitoring] ⚠️ 데이터베이스 오류 알림 전송 실패`);
    }
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
    checkWebSocketConnections
};

