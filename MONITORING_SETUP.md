# 모니터링 시스템 설정 가이드

## 개요

서버의 메모리 사용량과 WebSocket 연결 수를 모니터링하고, 임계값을 초과하면 자동으로 Telegram으로 알림을 전송합니다.

## 기능

- ✅ 메모리 사용량 모니터링 (경고/위험 임계값)
- ✅ WebSocket 연결 수 모니터링
- ✅ Telegram 알림 전송
- ✅ 중복 알림 방지 (5분 쿨다운)

## 환경 변수 설정

`.env` 파일에 다음 변수를 추가하세요:

### 기본 설정

```bash
# 모니터링 활성화
MONITORING_ENABLED=true

# 체크 간격 (밀리초, 기본값: 60000 = 60초)
MONITORING_CHECK_INTERVAL=60000

# 연결 수 임계값 (기본값: 1000)
MONITORING_CONNECTION_THRESHOLD=1000

# 메모리 경고 임계값 (MB, 기본값: 500)
MONITORING_MEMORY_THRESHOLD_MB=500

# 메모리 위험 임계값 (MB, 기본값: 1000)
MONITORING_MEMORY_CRITICAL_MB=1000
```

### Telegram 설정

1. **Telegram Bot 생성:**
   - Telegram에서 `@BotFather`에게 `/newbot` 명령 전송
   - Bot 이름과 사용자명 설정
   - 받은 Bot Token을 복사

2. **Chat ID 확인:**
   - Telegram에서 `@userinfobot`에게 메시지 전송
   - 받은 Chat ID를 복사

3. **환경 변수 설정:**
```bash
# Telegram 활성화
TELEGRAM_ENABLED=true

# Bot Token (BotFather에서 받은 토큰)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Chat ID (알림을 받을 사용자 또는 그룹의 Chat ID)
TELEGRAM_CHAT_ID=123456789
```


## 사용 예시

### .env 파일 예시

```bash
# 모니터링 설정
MONITORING_ENABLED=true
MONITORING_CHECK_INTERVAL=60000
MONITORING_CONNECTION_THRESHOLD=1000
MONITORING_MEMORY_THRESHOLD_MB=500
MONITORING_MEMORY_CRITICAL_MB=1000

# Telegram 설정
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

## 알림 메시지 예시

### 연결 수 경고
```
🚨 WebSocket 연결 수 경고!

현재 연결 수: 1050
임계값: 1000
시간: 2025-12-03 오후 2:30:00
```

### 메모리 경고
```
⚠️ 서버 메모리 경고

현재 메모리 사용량: 550MB
임계값: 500MB
RSS: 800MB
Heap Total: 600MB
시간: 2025-12-03 오후 2:30:00
```

### 메모리 위험
```
🚨 서버 메모리 위험!

현재 메모리 사용량: 1200MB
임계값: 1000MB
RSS: 1500MB
Heap Total: 1300MB
시간: 2025-12-03 오후 2:30:00
```

## 모니터링 상태 확인

### API 엔드포인트

```bash
GET /api/monitoring/status
```

**응답 예시:**
```json
{
  "ok": true,
  "enabled": true,
  "connectionCount": 1050,
  "memory": {
    "heapUsedMB": 550,
    "heapTotalMB": 600,
    "rssMB": 800
  },
  "thresholds": {
    "connection": 1000,
    "memoryWarning": 500,
    "memoryCritical": 1000
  },
  "alerts": {
    "connection": true,
    "memoryWarning": true,
    "memoryCritical": false
  },
  "notifications": {
    "telegram": true
  }
}
```

## 알림 동작 방식

1. **주기적 체크**: 설정된 간격(기본 60초)마다 메모리와 연결 수 확인
2. **임계값 초과 시**: 알림 전송
3. **쿨다운 기간**: 5분 동안 중복 알림 방지
4. **복구 시**: 임계값 이하로 돌아오면 알림 상태 리셋

## 문제 해결

### Telegram 알림이 전송되지 않는 경우

1. Bot Token이 올바른지 확인
2. Chat ID가 올바른지 확인
3. Bot이 차단되지 않았는지 확인
4. 서버 로그 확인: `[Monitoring] ❌ Telegram 알림 전송 실패`


### 알림이 너무 자주 오는 경우

- `MONITORING_CHECK_INTERVAL` 값을 증가 (예: 120000 = 2분)
- 쿨다운 기간은 5분으로 고정되어 있음

### 알림이 오지 않는 경우

- `MONITORING_ENABLED=true` 확인
- 환경 변수가 올바르게 설정되었는지 확인
- 서버 로그에서 `[Monitoring] ✅ 모니터링 시작` 메시지 확인

## 보안 고려사항

- ✅ 환경 변수에 민감한 정보 저장 (`.env` 파일)
- ✅ `.env` 파일을 `.gitignore`에 추가
- ✅ Bot Token과 Auth Token을 절대 코드에 하드코딩하지 않음

## 참고

- Telegram Bot API: https://core.telegram.org/bots/api
- Node.js 메모리 관리: https://nodejs.org/api/process.html#process_process_memoryusage

