/**
 * Telegram Chat ID 확인 스크립트
 * 
 * 사용 방법:
 * 1. .env 파일에 TELEGRAM_BOT_TOKEN을 설정하세요
 * 2. node get-telegram-chat-id.js 실행
 * 3. 봇에게 메시지를 보내세요
 * 4. 스크립트가 Chat ID를 출력합니다
 */

require('dotenv').config();
const https = require('https');

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
    console.error('❌ TELEGRAM_BOT_TOKEN이 설정되지 않았습니다.');
    console.error('   .env 파일에 TELEGRAM_BOT_TOKEN=your_token_here 를 추가하세요.');
    process.exit(1);
}

console.log('📱 Telegram Chat ID 확인 스크립트');
console.log('=====================================\n');
console.log('1. Telegram에서 봇을 찾아주세요 (BotFather에서 만든 봇)');
console.log('2. 봇에게 아무 메시지나 보내주세요 (예: /start 또는 "안녕")');
console.log('3. 이 스크립트가 Chat ID를 확인합니다\n');
console.log('⏳ 봇에게 메시지를 보내고 기다려주세요...\n');

// 최신 메시지 가져오기
function getUpdates() {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
    
    https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (!response.ok) {
                    console.error('❌ 오류:', response.description);
                    console.error('   Bot Token이 올바른지 확인하세요.');
                    return;
                }
                
                const updates = response.result || [];
                
                if (updates.length === 0) {
                    console.log('📭 아직 메시지가 없습니다.');
                    console.log('   봇에게 메시지를 보내고 다시 실행하세요.');
                    return;
                }
                
                // 가장 최근 메시지 찾기
                const latestUpdate = updates[updates.length - 1];
                const message = latestUpdate.message;
                
                if (!message) {
                    console.log('📭 메시지를 찾을 수 없습니다.');
                    return;
                }
                
                const chatId = message.chat.id;
                const chatType = message.chat.type; // 'private', 'group', 'supergroup', 'channel'
                const firstName = message.chat.first_name || '';
                const lastName = message.chat.last_name || '';
                const username = message.chat.username || '';
                const chatTitle = message.chat.title || '';
                
                console.log('✅ Chat ID를 찾았습니다!\n');
                console.log('📋 정보:');
                console.log(`   Chat ID: ${chatId}`);
                console.log(`   타입: ${chatType}`);
                
                if (chatType === 'private') {
                    console.log(`   이름: ${firstName} ${lastName}`.trim());
                    if (username) {
                        console.log(`   사용자명: @${username}`);
                    }
                } else {
                    console.log(`   그룹/채널 이름: ${chatTitle}`);
                }
                
                console.log('\n💡 .env 파일에 다음을 추가하세요:');
                console.log(`TELEGRAM_CHAT_ID=${chatId}\n`);
                
                // 이전 메시지 삭제 (다음 실행을 위해)
                if (updates.length > 0) {
                    const lastUpdateId = updates[updates.length - 1].update_id;
                    const deleteUrl = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastUpdateId + 1}`;
                    https.get(deleteUrl, () => {}); // 응답은 무시
                }
                
            } catch (err) {
                console.error('❌ 응답 파싱 오류:', err.message);
            }
        });
    }).on('error', (err) => {
        console.error('❌ 요청 오류:', err.message);
        console.error('   인터넷 연결을 확인하세요.');
    });
}

// 5초마다 확인
getUpdates();
setInterval(getUpdates, 5000);

console.log('💡 팁: 봇에게 메시지를 보낸 후 이 스크립트를 실행하세요.');
console.log('   또는 Ctrl+C를 눌러 종료할 수 있습니다.\n');

