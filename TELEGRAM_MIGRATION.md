# node-telegram-bot-api로 마이그레이션 가이드

현재 수동 Polling 방식을 `node-telegram-bot-api` 라이브러리로 마이그레이션하는 방법입니다.

## 1. 패키지 설치

```bash
npm install node-telegram-bot-api
```

## 2. 코드 마이그레이션

### 현재 코드 구조
```
src/services/telegram-command-handler.js
  - 수동 getUpdates 호출
  - 5초마다 폴링
  - update_id 수동 관리
```

### 새로운 코드 구조
```javascript
const TelegramBot = require('node-telegram-bot-api');

// Bot 인스턴스 생성
const bot = new TelegramBot(token, { polling: true });

// 명령어 처리
bot.onText(/\/status/, (msg) => {
  // 명령어 처리
});

bot.on('message', (msg) => {
  // 일반 메시지 처리
});
```

## 3. 완전한 마이그레이션 예시

### src/services/telegram-command-handler-v2.js

```javascript
const TelegramBot = require('node-telegram-bot-api');
const { checkPostgresConnectionCount } = require('./monitoring-service');

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
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const memUsagePercent = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1);
    
    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);
    const uptimeSeconds = Math.floor(uptime % 60);
    
    const message = `📊 <b>서버 상태</b>\n\n` +
                   `💾 <b>메모리:</b>\n` +
                   `   - 사용 중: ${memUsedMB} MB / ${memTotalMB} MB (${memUsagePercent}%)\n` +
                   `   - RSS: ${Math.round(memUsage.rss / 1024 / 1024)} MB\n\n` +
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
    const memUsage = process.memoryUsage();
    const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const memUsagePercent = ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(1);
    
    const message = `💾 <b>메모리 사용량</b>\n\n` +
                   `📊 <b>힙 메모리:</b>\n` +
                   `   - 사용 중: ${memUsedMB} MB / ${memTotalMB} MB\n` +
                   `   - 사용률: ${memUsagePercent}%\n\n` +
                   `📈 <b>전체 메모리:</b>\n` +
                   `   - RSS: ${Math.round(memUsage.rss / 1024 / 1024)} MB\n` +
                   `   - External: ${Math.round(memUsage.external / 1024 / 1024)} MB\n` +
                   `   - Array Buffers: ${Math.round(memUsage.arrayBuffers / 1024 / 1024)} MB\n\n` +
                   `⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
}

// 도움말
async function handleHelpCommand(chatId) {
    const message = `🤖 <b>사용 가능한 명령어</b>\n\n` +
                   `📊 <b>상태 확인:</b>\n` +
                   `   /status - 서버 상태 확인\n` +
                   `   /connections - 데이터베이스 연결 수 확인\n` +
                   `   /memory - 메모리 사용량 확인\n\n` +
                   `❓ <b>도움말:</b>\n` +
                   `   /help - 이 도움말 표시\n\n` +
                   `⏰ <b>시간:</b> ${getArgentinaTime()} (GMT-3)`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
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
        
        // 에러 핸들링
        bot.on('polling_error', (error) => {
            console.error(`[Telegram Command] ❌ Polling 오류: ${error.message}`);
        });
        
        bot.on('error', (error) => {
            console.error(`[Telegram Command] ❌ Bot 오류: ${error.message}`);
        });
        
        // 허용된 Chat ID 확인 함수
        function isAuthorized(chatId) {
            return chatId.toString() === TELEGRAM_CONFIG.chatId.toString();
        }
        
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
        
        // 알 수 없는 명령어
        bot.onText(/^\//, async (msg) => {
            const chatId = msg.chat.id;
            if (!isAuthorized(chatId)) {
                return;
            }
            const command = msg.text.split(' ')[0];
            console.log(`[Telegram Command] 📨 알 수 없는 명령어: ${command} (Chat ID: ${chatId})`);
            await bot.sendMessage(
                chatId,
                `❓ 알 수 없는 명령어입니다.\n\n사용 가능한 명령어: /help`,
                { parse_mode: 'HTML' }
            );
        });
        
        console.log(`[Telegram Command] ✅ 명령어 핸들러 등록 완료`);
        
    } catch (err) {
        console.error(`[Telegram Command] ❌ Bot 초기화 오류: ${err.message}`);
    }
}

// 메시지 전송 함수 (기존 monitoring-service.js와 호환)
async function sendTelegramMessage(message, chatId = null) {
    if (!bot) {
        return false;
    }
    
    const targetChatId = chatId || TELEGRAM_CONFIG.chatId;
    if (!targetChatId) {
        return false;
    }
    
    try {
        await bot.sendMessage(targetChatId, message, { parse_mode: 'HTML' });
        return true;
    } catch (err) {
        console.error(`[Telegram Command] ❌ 메시지 전송 실패: ${err.message}`);
        return false;
    }
}

module.exports = {
    startTelegramPolling,
    sendTelegramMessage
};
```

## 4. monitoring-service.js 업데이트

`monitoring-service.js`에서 `sendTelegramMessage`를 `telegram-command-handler`에서 import하도록 변경:

```javascript
// 기존
const https = require('https');
async function sendTelegramMessage(message) {
    // https 직접 사용
}

// 변경 후
const { sendTelegramMessage } = require('./telegram-command-handler');
// 또는 별도로 유지 (양쪽 모두 지원)
```

## 5. 장점 요약

### 성능 개선
- **Long polling**: 메시지가 있을 때만 응답 (즉각적)
- **API 호출 감소**: 5초마다 호출 → 필요할 때만 호출
- **Rate limit 위험 감소**: 불필요한 호출 제거

### 코드 품질
- **간결함**: 이벤트 리스너로 명확한 구조
- **에러 처리**: 자동 재연결 및 에러 복구
- **유지보수**: 라이브러리가 API 변경 대응

### 확장성
- **인라인 키보드**: 향후 버튼 추가 용이
- **파일 처리**: 파일 업로드/다운로드 간편
- **Webhook**: 필요시 쉽게 전환 가능

## 6. 마이그레이션 체크리스트

- [ ] `npm install node-telegram-bot-api` 실행
- [ ] `telegram-command-handler.js`를 새 버전으로 교체
- [ ] `monitoring-service.js`의 `sendTelegramMessage` 확인
- [ ] 서버 재시작 및 테스트
- [ ] 기존 명령어 동작 확인
- [ ] 에러 핸들링 확인

## 7. 롤백 방법

문제가 발생하면 기존 `telegram-command-handler.js`로 되돌리면 됩니다.

```bash
# 패키지 제거 (선택사항)
npm uninstall node-telegram-bot-api

# 기존 파일로 복원
git checkout src/services/telegram-command-handler.js
```

