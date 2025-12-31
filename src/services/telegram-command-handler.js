const TelegramBot = require('node-telegram-bot-api');
const os = require('os');
const { checkPostgresConnectionCount } = require('./monitoring-service');
const { connectionPool } = require('../db/dynamic-sequelize');

// Telegram Bot 설정
const TELEGRAM_CONFIG = {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    pollingEnabled: process.env.TELEGRAM_POLLING_ENABLED === 'true'
};

let bot = null;

// 아르헨티나 시간대 (GMT-3) 시간 포맷
function getArgentinaTime() {
    const now = new Date();
    return now.toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 서버 상태 확인
async function handleStatusCommand(chatId) {
    // Node.js 프로세스 메모리
    const memUsage = process.memoryUsage();
    const processMemUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const processMemTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const processMemUsagePercent = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1);
    const processRssMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // 전체 시스템 메모리
    const totalMemGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMemGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMemGB = ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2);
    const systemMemUsagePercent = (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1);
    
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);
    
    const message = `📊 <b>서버 상태</b>\n\n` +
                   `💾 <b>시스템 메모리:</b>\n` +
                   `   - 사용 중: ${usedMemGB} GB / ${totalMemGB} GB (${systemMemUsagePercent}%)\n` +
                   `   - 여유: ${freeMemGB} GB\n\n` +
                   `🔧 <b>Node.js 프로세스 메모리:</b>\n` +
                   `   - 힙 사용: ${processMemUsedMB} MB / ${processMemTotalMB} MB (${processMemUsagePercent}%)\n` +
                   `   - RSS: ${processRssMB} MB\n\n` +
                   `⏱️ <b>업타임:</b>\n` +
                   `   - ${uptimeHours}시간 ${uptimeMinutes}분 ${uptimeSeconds}초\n\n` +
                   `⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// 데이터베이스 연결 수 확인
async function handleConnectionsCommand(chatId) {
    try {
        const stats = await checkPostgresConnectionCount();
        
        if (!stats) {
            await bot.sendMessage(chatId, '❌ 데이터베이스 연결 정보를 가져올 수 없습니다.');
            return;
        }
        
        const maxConnections = parseInt(process.env.MAX_CONNECTIONS) || 100;
        const usagePercent = maxConnections > 0 
            ? ((stats.total / maxConnections) * 100).toFixed(1)
            : 'N/A';
        
        let message = `🗄️ <b>데이터베이스 연결 상태</b>\n\n` +
                     `📊 <b>전체:</b>\n` +
                     `   - 총 연결: ${stats.total}개 / ${maxConnections}개 (${usagePercent}%)\n` +
                     `   - Active: ${stats.active}개\n` +
                     `   - Idle: ${stats.idle}개\n` +
                     `   - Idle in TX: ${stats.idleInTransaction}개\n`;
        
        if (stats.idleInTransactionAborted > 0) {
            message += `   - ⚠️ Idle in TX (Aborted): ${stats.idleInTransactionAborted}개\n`;
        }
        
        if (stats.other > 0) {
            message += `   - 기타 상태: ${stats.other}개\n`;
        }
        
        if (stats.details && stats.details.length > 0) {
            message += `\n📋 <b>데이터베이스별:</b>\n`;
            for (const detail of stats.details) {
                if (detail.total > 0) {
                    const parts = [];
                    if (detail.active > 0) parts.push(`Active: ${detail.active}`);
                    if (detail.idleInTransaction > 0) parts.push(`Idle in TX: ${detail.idleInTransaction} ⚠️`);
                    if (detail.idleInTransactionAborted > 0) parts.push(`Aborted: ${detail.idleInTransactionAborted} ⚠️`);
                    
                    message += `   - ${detail.database}: ${detail.total}개`;
                    if (parts.length > 0) {
                        message += ` (${parts.join(', ')})`;
                    }
                    message += `\n`;
                }
            }
        }
        
        message += `\n⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
        await bot.sendMessage(chatId, `❌ 연결 정보 조회 중 오류 발생:\n${err.message}`);
    }
}

// 메모리 사용량 확인
async function handleMemoryCommand(chatId) {
    // Node.js 프로세스 메모리
    const memUsage = process.memoryUsage();
    const processMemUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const processMemTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const processMemUsagePercent = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1);
    const processRssMB = Math.round(memUsage.rss / 1024 / 1024);
    const processExternalMB = Math.round(memUsage.external / 1024 / 1024);
    const processArrayBuffersMB = Math.round(memUsage.arrayBuffers / 1024 / 1024);
    
    // 전체 시스템 메모리
    const totalMemGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMemGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMemGB = ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2);
    const systemMemUsagePercent = (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1);
    
    const message = `💾 <b>메모리 사용량</b>\n\n` +
                   `🌐 <b>시스템 메모리:</b>\n` +
                   `   - 총 메모리: ${totalMemGB} GB\n` +
                   `   - 사용 중: ${usedMemGB} GB (${systemMemUsagePercent}%)\n` +
                   `   - 여유: ${freeMemGB} GB\n\n` +
                   `🔧 <b>Node.js 프로세스:</b>\n` +
                   `   - 힙 사용: ${processMemUsedMB} MB / ${processMemTotalMB} MB (${processMemUsagePercent}%)\n` +
                   `   - RSS: ${processRssMB} MB\n` +
                   `   - External: ${processExternalMB} MB\n` +
                   `   - Array Buffers: ${processArrayBuffersMB} MB\n\n` +
                   `⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// 5분 이상 idle 상태인 연결 종료
async function handleKillIdleCommand(chatId) {
    try {
        // 연결 풀이 비어있으면 조회 불가
        if (connectionPool.size === 0) {
            await bot.sendMessage(chatId, '❌ 데이터베이스 연결이 없어 조회할 수 없습니다.');
            return;
        }
        
        // 첫 번째 연결을 사용하여 전체 PostgreSQL 서버의 idle 연결 조회
        const firstSequelize = Array.from(connectionPool.values())[0];
        
        // 5분 이상 idle 상태인 연결 찾기
        const [idleConnections] = await firstSequelize.query(`
            SELECT 
                pid,
                datname as database,
                usename as username,
                application_name,
                state,
                state_change,
                now() - state_change as idle_duration,
                query_start,
                query
            FROM pg_stat_activity
            WHERE state = 'idle'
                AND pid != pg_backend_pid()  -- 현재 세션 제외
                AND state_change < now() - interval '5 minutes'  -- 5분 이상 idle
            ORDER BY state_change ASC
        `);
        
        if (!idleConnections || idleConnections.length === 0) {
            await bot.sendMessage(chatId, '✅ 5분 이상 idle 상태인 연결이 없습니다.');
            return;
        }
        
        let killedCount = 0;
        let failedCount = 0;
        const killedDetails = [];
        const failedDetails = [];
        
        // 각 idle 연결 종료
        for (const conn of idleConnections) {
            try {
                const pid = conn.pid;
                const database = conn.database || 'unknown';
                const username = conn.username || 'unknown';
                const idleDuration = conn.idle_duration;
                
                // 연결 종료
                const [terminateResult] = await firstSequelize.query(
                    `SELECT pg_terminate_backend($1) as terminated`,
                    { replacements: [pid] }
                );
                
                if (terminateResult && terminateResult[0] && terminateResult[0].terminated) {
                    killedCount++;
                    killedDetails.push({
                        pid,
                        database,
                        username,
                        idleDuration: idleDuration.toString()
                    });
                } else {
                    failedCount++;
                    failedDetails.push({ pid, database, reason: '종료 실패' });
                }
            } catch (err) {
                failedCount++;
                failedDetails.push({ 
                    pid: conn.pid, 
                    database: conn.database || 'unknown',
                    reason: err.message 
                });
            }
        }
        
        // 결과 메시지 생성
        let message = `🔪 <b>Idle 연결 종료 결과</b>\n\n`;
        
        if (killedCount > 0) {
            message += `✅ <b>종료된 연결:</b> ${killedCount}개\n`;
            
            // 데이터베이스별로 그룹화하여 표시
            const dbGroups = {};
            killedDetails.forEach(detail => {
                if (!dbGroups[detail.database]) {
                    dbGroups[detail.database] = [];
                }
                dbGroups[detail.database].push(detail);
            });
            
            message += `\n📊 <b>데이터베이스별 종료:</b>\n`;
            for (const [db, details] of Object.entries(dbGroups)) {
                message += `   - ${db}: ${details.length}개\n`;
            }
            
            // 상세 정보 (최대 10개만 표시)
            if (killedDetails.length <= 10) {
                message += `\n📋 <b>종료된 연결 상세:</b>\n`;
                killedDetails.forEach((detail, index) => {
                    const duration = detail.idleDuration.replace(/^\s*/, '').replace(/\s*$/, '');
                    message += `   ${index + 1}. PID ${detail.pid} (${detail.database}, ${detail.username}) - ${duration} idle\n`;
                });
            } else {
                message += `\n📋 <b>종료된 연결:</b> ${killedDetails.length}개 (상세 정보는 로그 확인)\n`;
            }
        }
        
        if (failedCount > 0) {
            message += `\n❌ <b>종료 실패:</b> ${failedCount}개\n`;
            if (failedDetails.length <= 5) {
                failedDetails.forEach((detail, index) => {
                    message += `   ${index + 1}. PID ${detail.pid} (${detail.database}) - ${detail.reason}\n`;
                });
            }
        }
        
        if (killedCount === 0 && failedCount === 0) {
            message += `⚠️ 종료할 연결이 없습니다.`;
        }
        
        message += `\n⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
        
        // 로그 출력
        console.log(`[Telegram Command] 🔪 Idle 연결 종료: ${killedCount}개 종료, ${failedCount}개 실패`);
        if (killedDetails.length > 0) {
            console.log(`[Telegram Command] 종료된 연결 상세:`, killedDetails);
        }
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error(`[Telegram Command] ❌ /kill_idle 명령 처리 오류: ${err.message}`);
        await bot.sendMessage(chatId, `❌ Idle 연결 종료 중 오류 발생:\n${err.message}`);
    }
}

// 데이터베이스 연결 한계 정보 확인
async function handleDbaseCommand(chatId) {
    try {
        // 연결 풀이 비어있으면 조회 불가
        if (connectionPool.size === 0) {
            await bot.sendMessage(chatId, '❌ 데이터베이스 연결이 없어 조회할 수 없습니다.');
            return;
        }
        
        // 첫 번째 연결을 사용하여 전체 PostgreSQL 서버의 연결 한계 정보 조회
        const firstSequelize = Array.from(connectionPool.values())[0];
        
        const [limitResult] = await firstSequelize.query(`
            SELECT max_conn, used, res_for_super, (max_conn - res_for_super - used) AS res_for_normal
            FROM (
                SELECT count(*) as used FROM pg_stat_activity
            ) t1,
            (SELECT setting::int as res_for_super FROM pg_settings WHERE name='superuser_reserved_connections') t2,
            (SELECT setting::int as max_conn FROM pg_settings WHERE name='max_connections') t3
        `);
        
        if (!limitResult || !limitResult[0]) {
            await bot.sendMessage(chatId, '❌ 연결 한계 정보를 가져올 수 없습니다.');
            return;
        }
        
        const info = limitResult[0];
        const maxConn = parseInt(info.max_conn, 10);
        const used = parseInt(info.used, 10);
        const resForSuper = parseInt(info.res_for_super, 10);
        const resForNormal = parseInt(info.res_for_normal, 10);
        
        const usagePercent = maxConn > 0 ? ((used / maxConn) * 100).toFixed(1) : 'N/A';
        const normalUsagePercent = maxConn > 0 ? (((used) / (maxConn - resForSuper)) * 100).toFixed(1) : 'N/A';
        
        // 경고 레벨 결정
        let statusEmoji = '✅';
        let statusText = '정상';
        
        if (resForNormal <= 50) {
            statusEmoji = '🚨';
            statusText = '위험';
        } else if (resForNormal <= 100) {
            statusEmoji = '⚠️';
            statusText = '경고';
        }
        
        const message = `🗄️ <b>데이터베이스 연결 한계 정보</b>\n\n` +
                       `${statusEmoji} <b>상태:</b> ${statusText}\n\n` +
                       `📊 <b>연결 한계:</b>\n` +
                       `   - 최대 연결 수: ${maxConn.toLocaleString()}개\n` +
                       `   - 현재 사용 중: ${used.toLocaleString()}개 (${usagePercent}%)\n` +
                       `   - 슈퍼유저 예약: ${resForSuper.toLocaleString()}개\n` +
                       `   - 일반 사용 가능: ${resForNormal.toLocaleString()}개\n\n` +
                       `📈 <b>사용률 분석:</b>\n` +
                       `   - 전체 사용률: ${usagePercent}%\n` +
                       `   - 일반 사용률: ${normalUsagePercent}% (슈퍼유저 예약 제외)\n\n`;
        
        let recommendations = '';
        if (resForNormal <= 50) {
            recommendations = `🚨 <b>즉시 조치 필요:</b>\n` +
                            `   - 일반 사용 가능 연결이 ${resForNormal}개만 남았습니다\n` +
                            `   - 불필요한 연결을 종료하세요\n` +
                            `   - "idle in transaction" 상태 연결 확인\n`;
        } else if (resForNormal <= 100) {
            recommendations = `⚠️ <b>주의 필요:</b>\n` +
                            `   - 일반 사용 가능 연결이 ${resForNormal}개 남았습니다\n` +
                            `   - 연결 모니터링을 강화하세요\n`;
        } else {
            recommendations = `✅ <b>정상 상태:</b>\n` +
                            `   - 충분한 연결 여유가 있습니다\n`;
        }
        
        const finalMessage = message + recommendations +
                           `\n⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
        
        await bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });
    } catch (err) {
        console.error(`[Telegram Command] ❌ /dbase 명령 처리 오류: ${err.message}`);
        await bot.sendMessage(chatId, `❌ 데이터베이스 연결 한계 정보 조회 중 오류 발생:\n${err.message}`);
    }
}

// 도움말
async function handleHelpCommand(chatId) {
    const message = `🤖 <b>사용 가능한 명령어</b>\n\n` +
                   `📊 <b>상태 확인:</b>\n` +
                   `   /status - 서버 상태 확인\n` +
                   `   /connections - 데이터베이스 연결 수 확인\n` +
                   `   /memory - 메모리 사용량 확인\n` +
                   `   /dbase - 데이터베이스 연결 한계 정보 확인\n\n` +
                   `🔧 <b>관리:</b>\n` +
                   `   /kill_idle - 5분 이상 idle 상태인 연결 종료\n\n` +
                   `❓ <b>도움말:</b>\n` +
                   `   /help - 이 도움말 표시\n\n` +
                   `⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// 허용된 Chat ID 확인 함수
function isAuthorized(chatId) {
    return chatId.toString() === TELEGRAM_CONFIG.chatId.toString();
}

// Bot 초기화 및 시작
function startTelegramPolling() {
    if (!TELEGRAM_CONFIG.enabled || !TELEGRAM_CONFIG.pollingEnabled) {
        console.log(`[Telegram Command] ⚠️ Polling 비활성화됨`);
        return;
    }
    
    if (!TELEGRAM_CONFIG.botToken) {
        console.log(`[Telegram Command] ⚠️ Bot Token이 설정되지 않음`);
        return;
    }
    
    try {
        // Bot 인스턴스 생성 (Long polling 사용)
        bot = new TelegramBot(TELEGRAM_CONFIG.botToken, {
            polling: {
                interval: 300,  // 300ms 간격으로 확인 (기본값)
                autoStart: true,
                params: {
                    timeout: 10  // Long polling timeout (초)
                }
            }
        });
        
        console.log(`[Telegram Command] ✅ Bot 초기화 완료 (Long polling 활성화)`);
        
        // 에러 핸들링 (네트워크 타임아웃 오류는 로그 출력하지 않음)
        bot.on('polling_error', (error) => {
            // ETIMEDOUT, ECONNREFUSED 등 네트워크 오류는 로그 출력하지 않음
            if (error.message && (
                error.message.includes('ETIMEDOUT') ||
                error.message.includes('ECONNREFUSED') ||
                error.message.includes('ENOTFOUND') ||
                error.message.includes('connect timeout')
            )) {
                // 네트워크 오류는 조용히 무시 (너무 많은 로그 방지)
                return;
            }
            // 다른 종류의 오류만 로그 출력
            console.error(`[Telegram Command] ❌ Polling 오류: ${error.message}`);
        });
        
        bot.on('error', (error) => {
            // ETIMEDOUT, ECONNREFUSED 등 네트워크 오류는 로그 출력하지 않음
            if (error.message && (
                error.message.includes('ETIMEDOUT') ||
                error.message.includes('ECONNREFUSED') ||
                error.message.includes('ENOTFOUND') ||
                error.message.includes('connect timeout')
            )) {
                // 네트워크 오류는 조용히 무시 (너무 많은 로그 방지)
                return;
            }
            // 다른 종류의 오류만 로그 출력
            console.error(`[Telegram Command] ❌ Bot 오류: ${error.message}`);
        });
        
        // /status 명령어
        bot.onText(/^\/(status|상태)$/i, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                console.log(`[Telegram Command] ⚠️ 허용되지 않은 Chat ID에서 명령 시도: ${chatId}`);
                return;
            }
            console.log(`[Telegram Command] 📨 명령 수신: /status (Chat ID: ${chatId})`);
            try {
                await handleStatusCommand(chatId);
            } catch (err) {
                console.error(`[Telegram Command] ❌ 명령 처리 오류: ${err.message}`);
                await bot.sendMessage(chatId, `❌ 명령 처리 중 오류가 발생했습니다:\n${err.message}`);
            }
        });
        
        // /connections 명령어
        bot.onText(/^\/(connections|연결|conn)$/i, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                console.log(`[Telegram Command] ⚠️ 허용되지 않은 Chat ID에서 명령 시도: ${chatId}`);
                return;
            }
            console.log(`[Telegram Command] 📨 명령 수신: /connections (Chat ID: ${chatId})`);
            try {
                await handleConnectionsCommand(chatId);
            } catch (err) {
                console.error(`[Telegram Command] ❌ 명령 처리 오류: ${err.message}`);
                await bot.sendMessage(chatId, `❌ 명령 처리 중 오류가 발생했습니다:\n${err.message}`);
            }
        });
        
        // /memory 명령어
        bot.onText(/^\/(memory|메모리|mem)$/i, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                console.log(`[Telegram Command] ⚠️ 허용되지 않은 Chat ID에서 명령 시도: ${chatId}`);
                return;
            }
            console.log(`[Telegram Command] 📨 명령 수신: /memory (Chat ID: ${chatId})`);
            try {
                await handleMemoryCommand(chatId);
            } catch (err) {
                console.error(`[Telegram Command] ❌ 명령 처리 오류: ${err.message}`);
                await bot.sendMessage(chatId, `❌ 명령 처리 중 오류가 발생했습니다:\n${err.message}`);
            }
        });
        
        // /dbase 명령어
        bot.onText(/^\/(dbase|db|데이터베이스)$/i, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                console.log(`[Telegram Command] ⚠️ 허용되지 않은 Chat ID에서 명령 시도: ${chatId}`);
                return;
            }
            console.log(`[Telegram Command] 📨 명령 수신: /dbase (Chat ID: ${chatId})`);
            try {
                await handleDbaseCommand(chatId);
            } catch (err) {
                console.error(`[Telegram Command] ❌ 명령 처리 오류: ${err.message}`);
                await bot.sendMessage(chatId, `❌ 명령 처리 중 오류가 발생했습니다:\n${err.message}`);
            }
        });
        
        // /kill_idle 명령어
        bot.onText(/^\/(kill_idle|killidle|idle_kill)$/i, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                console.log(`[Telegram Command] ⚠️ 허용되지 않은 Chat ID에서 명령 시도: ${chatId}`);
                return;
            }
            console.log(`[Telegram Command] 📨 명령 수신: /kill_idle (Chat ID: ${chatId})`);
            try {
                await handleKillIdleCommand(chatId);
            } catch (err) {
                console.error(`[Telegram Command] ❌ 명령 처리 오류: ${err.message}`);
                await bot.sendMessage(chatId, `❌ 명령 처리 중 오류가 발생했습니다:\n${err.message}`);
            }
        });
        
        // /help 명령어
        bot.onText(/^\/(help|도움말|\?)$/i, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                console.log(`[Telegram Command] ⚠️ 허용되지 않은 Chat ID에서 명령 시도: ${chatId}`);
                return;
            }
            console.log(`[Telegram Command] 📨 명령 수신: /help (Chat ID: ${chatId})`);
            try {
                await handleHelpCommand(chatId);
            } catch (err) {
                console.error(`[Telegram Command] ❌ 명령 처리 오류: ${err.message}`);
                await bot.sendMessage(chatId, `❌ 명령 처리 중 오류가 발생했습니다:\n${err.message}`);
            }
        });
        
        // 알 수 없는 명령어 (등록된 명령어가 아닌 경우만 처리)
        // 주의: 이 핸들러는 다른 명령어 핸들러보다 나중에 등록되어야 하므로
        // 이미 처리된 명령어는 여기서 처리되지 않음
        // 하지만 명시적으로 등록하지 않고, 대신 'message' 이벤트로 처리
        bot.on('message', async (msg) => {
            // 텍스트 메시지이고 명령어인 경우만 처리
            if (!msg.text || !msg.text.startsWith('/')) {
                return;
            }
            
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                return;
            }
            
            const command = msg.text.split(' ')[0].toLowerCase();
            const knownCommands = ['/status', '/상태', '/connections', '/연결', '/conn', '/memory', '/메모리', '/mem', '/dbase', '/db', '/데이터베이스', '/kill_idle', '/killidle', '/idle_kill', '/help', '/도움말', '/?'];
            
            // 알려진 명령어가 아니면 처리
            if (!knownCommands.includes(command)) {
                console.log(`[Telegram Command] 📨 알 수 없는 명령어: ${command} (Chat ID: ${chatId})`);
                await bot.sendMessage(
                    chatId,
                    `❓ 알 수 없는 명령어입니다.\n\n사용 가능한 명령어: /help`,
                    { parse_mode: 'HTML' }
                );
            }
        });
        
        console.log(`[Telegram Command] ✅ 명령어 핸들러 등록 완료`);
        
    } catch (err) {
        console.error(`[Telegram Command] ❌ Bot 초기화 오류: ${err.message}`);
    }
}

// 메시지 전송 함수 (monitoring-service.js와 호환)
async function sendTelegramMessage(message, chatId = null) {
    if (!TELEGRAM_CONFIG.enabled || !TELEGRAM_CONFIG.botToken) {
        return false;
    }
    
    const targetChatId = chatId || TELEGRAM_CONFIG.chatId;
    if (!targetChatId) {
        return false;
    }
    
    // Bot이 초기화되어 있으면 bot 인스턴스 사용
    if (bot) {
        try {
            await bot.sendMessage(targetChatId, message, { parse_mode: 'HTML' });
            return true;
        } catch (err) {
            console.error(`[Telegram Command] ❌ Bot 메시지 전송 실패: ${err.message}`);
            // Fallback to direct API call
        }
    }
    
    // Bot이 없거나 오류 발생 시 직접 API 호출 (fallback)
    try {
        const https = require('https');
        const url = `https://api.telegram.org/bot${TELEGRAM_CONFIG.botToken}/sendMessage`;
        const data = JSON.stringify({
            chat_id: targetChatId,
            text: message,
            parse_mode: 'HTML'
        });
        
        return new Promise((resolve) => {
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
                        resolve(true);
                    } else {
                        console.error(`[Telegram Command] ❌ API 메시지 전송 실패: ${res.statusCode} - ${responseData}`);
                        resolve(false);
                    }
                });
            });
            
            req.on('error', (err) => {
                console.error(`[Telegram Command] ❌ API 요청 오류: ${err.message}`);
                resolve(false);
            });
            
            req.write(data);
            req.end();
        });
    } catch (err) {
        console.error(`[Telegram Command] ❌ 메시지 전송 오류: ${err.message}`);
        return false;
    }
}

module.exports = {
    startTelegramPolling,
    sendTelegramMessage
};
