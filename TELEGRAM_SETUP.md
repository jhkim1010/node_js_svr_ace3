# Telegram Bot 알림 설정 가이드

데이터베이스 POST 실패 및 모니터링 알림을 Telegram으로 받을 수 있습니다.

## 설정 방법

### 1. Telegram Bot 생성

1. Telegram에서 `@BotFather`에게 `/newbot` 명령 전송
2. 봇 이름과 사용자 이름 설정
3. 생성된 Bot Token을 복사 (예: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Chat ID 확인

**방법 1: 자동 스크립트 사용 (추천)**

1. `.env` 파일에 `TELEGRAM_BOT_TOKEN`을 먼저 설정하세요
2. 터미널에서 다음 명령 실행:
   ```bash
   node get-telegram-chat-id.js
   ```
3. 봇에게 아무 메시지나 보내세요 (예: `/start` 또는 "안녕")
4. 스크립트가 자동으로 Chat ID를 출력합니다

**방법 2: @userinfobot 사용**

1. Telegram에서 `@userinfobot`에게 메시지 전송
2. 반환된 `Id` 값을 복사 (예: `123456789`)

**방법 3: 봇에게 메시지 보낸 후 확인**

1. 봇에게 메시지를 보냅니다
2. 브라우저에서 다음 URL 접속:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
3. 응답에서 `"chat":{"id":123456789}` 부분의 숫자를 찾으세요

### 3. 환경 변수 설정

`.env` 파일에 다음 변수들을 추가하세요:

```bash
# Telegram 활성화
TELEGRAM_ENABLED=true

# Bot Token (BotFather에서 받은 토큰)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Chat ID (userinfobot에서 받은 ID)
TELEGRAM_CHAT_ID=123456789

# 최대 연결 수 (연결 사용률 경고 기준)
MAX_CONNECTIONS=100
```

### 4. 모니터링 활성화

```bash
# 모니터링 활성화
MONITORING_ENABLED=true
```

## 알림 종류

### 1. POST 실패 알림 (즉시 전송)

데이터베이스에 POST 요청이 실패하면 즉시 Telegram으로 알림이 전송됩니다.

**알림 내용:**
- 🚨 POST 실패 - 데이터베이스 오류
- 데이터베이스 이름
- 테이블 이름
- 작업 유형 (INSERT/CREATE 등)
- 오류 타입 및 코드
- 오류 원인 분석 (외래키, 중복키, 필수 필드 누락 등)
- 상세 오류 메시지
- 발생 시간

**예시:**
```
🚨 POST 실패 - 데이터베이스 오류

📊 데이터베이스: holika34
📋 테이블: ingresos
⚙️ 작업: INSERT/UPDATE Ingresos
❌ 오류 타입: UniqueConstraintError
🔢 오류 코드: 23505

🔑 중복 키 오류

💬 오류 메시지:
duplicate key value violates unique constraint "ingresos_ingreso_id_sucursal_uniq"

⏰ 시간: 2025-12-03 오후 8:56:41
```

### 2. 트랜잭션 경고 (즉시 전송)

"idle in transaction (aborted)" 상태의 연결이 감지되면 즉시 알림이 전송됩니다.

**알림 내용:**
- ⚠️ PostgreSQL 트랜잭션 경고
- 문제가 있는 연결 수
- 전체 연결 상태 요약
- 원인 설명

### 3. 연결 사용률 경고 (5분 쿨다운)

연결 사용률이 80% 이상일 때 5분마다 한 번씩 알림이 전송됩니다.

**알림 내용:**
- ⚠️ PostgreSQL 연결 사용률 경고
- 사용률 퍼센트
- 상세 연결 상태

## 테스트

설정 후 서버를 재시작하고, 테스트로 POST 요청을 실패시켜 알림이 정상적으로 전송되는지 확인하세요.

```bash
# 서버 재시작
npm start
```

## 문제 해결

### 알림이 전송되지 않는 경우

1. **환경 변수 확인**
   - `TELEGRAM_ENABLED=true`로 설정되어 있는지 확인
   - `TELEGRAM_BOT_TOKEN`과 `TELEGRAM_CHAT_ID`가 올바르게 설정되었는지 확인

2. **서버 로그 확인**
   - `[Monitoring] ✅ Telegram 알림 전송 성공` 메시지가 있는지 확인
   - `[Monitoring] ❌ Telegram 알림 전송 실패` 메시지가 있으면 원인 확인

3. **Bot Token 확인**
   - Bot Token이 올바른지 확인
   - Bot이 활성화되어 있는지 확인

4. **Chat ID 확인**
   - Chat ID가 올바른지 확인
   - Bot에게 메시지를 먼저 보냈는지 확인 (Bot이 사용자를 인식해야 함)

## 참고

- Telegram 메시지 최대 길이: 4096자 (초과 시 자동으로 잘림)
- POST 실패 알림은 쿨다운 없이 즉시 전송됩니다
- 연결 사용률 경고는 5분 쿨다운이 적용됩니다

