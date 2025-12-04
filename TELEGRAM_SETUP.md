# Telegram Bot 알림 및 명령어 설정 가이드

데이터베이스 POST 실패 및 모니터링 알림을 Telegram으로 받을 수 있고, Telegram에서 서버에 명령을 보내서 실행할 수 있습니다.

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

### 4. Telegram 명령어 활성화 (선택사항)

Telegram에서 서버에 명령을 보내서 실행하려면 다음 환경 변수를 추가하세요:

```bash
# Telegram Polling 활성화 (명령어 수신)
TELEGRAM_POLLING_ENABLED=true
```

**주의:** Polling을 활성화하면 서버가 Long polling 방식으로 Telegram API를 호출하여 새 메시지를 확인합니다 (메시지가 있을 때만 응답하므로 효율적입니다).

### 5. 모니터링 활성화

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

## Telegram 명령어 사용법

`TELEGRAM_POLLING_ENABLED=true`로 설정하면 Telegram에서 서버에 명령을 보내서 실행할 수 있습니다.

### 사용 가능한 명령어

#### 1. `/status` 또는 `/상태`
서버 상태를 확인합니다.

**응답 내용:**
- 메모리 사용량 (힙 메모리, RSS)
- 서버 업타임
- 현재 시간

**예시:**
```
📊 서버 상태

💾 메모리:
   - 사용 중: 245 MB / 512 MB (47.9%)
   - RSS: 180 MB

⏱️ 업타임:
   - 2시간 15분 30초

⏰ 시간: 03/12/2025, 20:13:13 (GMT-3)
```

#### 2. `/connections` 또는 `/연결` 또는 `/conn`
데이터베이스 연결 수를 확인합니다.

**응답 내용:**
- 전체 연결 수 및 사용률
- Active, Idle, Idle in Transaction 상태별 연결 수
- 데이터베이스별 상세 연결 정보

**예시:**
```
🗄️ 데이터베이스 연결 상태

📊 전체:
   - 총 연결: 84개 / 100개 (84.0%)
   - Active: 1개
   - Idle: 5개
   - Idle in TX: 1개

📋 데이터베이스별:
   - holika34: 10개 (Active: 1, Idle in TX: 1 ⚠️)
   - charo84: 5개
   - anelen23: 3개

⏰ 시간: 03/12/2025, 20:13:13 (GMT-3)
```

#### 3. `/memory` 또는 `/메모리` 또는 `/mem`
메모리 사용량을 확인합니다.

**응답 내용:**
- 힙 메모리 사용량 및 사용률
- RSS, External, Array Buffers 메모리 정보

**예시:**
```
💾 메모리 사용량

📊 힙 메모리:
   - 사용 중: 245 MB / 512 MB
   - 사용률: 47.9%

📈 전체 메모리:
   - RSS: 180 MB
   - External: 5 MB
   - Array Buffers: 2 MB

⏰ 시간: 03/12/2025, 20:13:13 (GMT-3)
```

#### 4. `/help` 또는 `/도움말` 또는 `/?`
사용 가능한 명령어 목록을 표시합니다.

### 명령어 사용 방법

1. Telegram에서 봇을 찾습니다
2. 봇에게 명령어를 보냅니다 (예: `/status`)
3. 서버가 명령을 처리하고 결과를 Telegram으로 전송합니다

### 보안

- **허용된 Chat ID만 명령 실행**: 환경 변수 `TELEGRAM_CHAT_ID`에 설정된 Chat ID에서 보낸 명령만 실행됩니다
- 다른 Chat ID에서 보낸 명령은 무시되고 로그에 기록됩니다

### 명령어 처리 방식

- **Polling 방식**: 서버가 5초마다 Telegram API를 호출하여 새 메시지를 확인합니다
- **명령어만 처리**: `/`로 시작하는 명령어만 처리되며, 일반 메시지는 무시됩니다
- **비동기 처리**: 명령어 처리는 비동기로 실행되며, 결과는 즉시 Telegram으로 전송됩니다

## 참고

- Telegram 메시지 최대 길이: 4096자 (초과 시 자동으로 잘림)
- POST 실패 알림은 쿨다운 없이 즉시 전송됩니다
- 연결 사용률 경고는 5분 쿨다운이 적용됩니다
- 명령어 Polling은 5초마다 실행되며, 서버 리소스를 소모합니다
- 명령어 기능을 사용하지 않으면 `TELEGRAM_POLLING_ENABLED`를 설정하지 않거나 `false`로 설정하세요

