# WebSocket 헤더 가이드

## "Invalid Upgrade header" 오류 해결

### 정상적인 WebSocket 요청 헤더 (클라이언트 → 서버)

WebSocket 연결을 위해 클라이언트가 보내야 하는 필수 헤더:

```
GET /api/ws HTTP/1.1
Host: sync.coolsistema.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Sec-WebSocket-Protocol: (선택사항)
Origin: https://sync.coolsistema.com (선택사항)
```

**필수 헤더:**
1. **`Upgrade: websocket`** 
   - 값은 정확히 `websocket`이어야 함 (대소문자 구분 없음)
   - `websocket, websocket`처럼 중복되면 안 됨

2. **`Connection: Upgrade`** 또는 **`Connection: upgrade`**
   - 값은 `Upgrade` 또는 `upgrade` (대소문자 구분 없음)
   - 여러 값이 있으면 `Upgrade`가 포함되어야 함 (예: `keep-alive, Upgrade`)

3. **`Sec-WebSocket-Key`**
   - 클라이언트가 생성한 Base64 인코딩된 랜덤 키
   - 16바이트 랜덤 데이터를 Base64로 인코딩

4. **`Sec-WebSocket-Version: 13`**
   - WebSocket 프로토콜 버전 (일반적으로 13)

### 정상적인 WebSocket 응답 헤더 (서버 → 클라이언트)

서버가 보내야 하는 응답 헤더:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**필수 응답 헤더:**
1. **상태 코드: `101 Switching Protocols`**
   - WebSocket 업그레이드 성공

2. **`Upgrade: websocket`**
   - 요청과 동일한 값

3. **`Connection: Upgrade`**
   - 요청과 동일한 값

4. **`Sec-WebSocket-Accept`**
   - 클라이언트의 `Sec-WebSocket-Key`를 기반으로 계산된 값
   - 공식: `base64(sha1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`

### 잘못된 헤더 예시

#### ❌ 잘못됨: Upgrade 헤더 중복
```
Upgrade: websocket, websocket
```
→ 중복된 값이 있으면 "Invalid Upgrade header" 오류 발생

#### ❌ 잘못됨: Upgrade 헤더 값 오류
```
Upgrade: WebSocket  (대문자 W, S)
Upgrade: WEBSOCKET  (모두 대문자)
Upgrade: websocket, http/1.1  (다른 값과 함께)
```

#### ❌ 잘못됨: Connection 헤더에 Upgrade 없음
```
Connection: keep-alive
Connection: close
```

#### ❌ 잘못됨: HTTP 200 응답
```
HTTP/1.1 200 OK
```
→ WebSocket은 101 Switching Protocols를 반환해야 함

### 현재 헤더 확인 방법

#### 1. 서버 측에서 확인

Node.js 서버에 다음 코드를 추가하여 요청 헤더를 확인:

```javascript
server.on('upgrade', (request, socket, head) => {
    console.log('=== Upgrade 요청 헤더 ===');
    console.log('Upgrade:', request.headers.upgrade);
    console.log('Connection:', request.headers.connection);
    console.log('Sec-WebSocket-Key:', request.headers['sec-websocket-key']);
    console.log('Sec-WebSocket-Version:', request.headers['sec-websocket-version']);
    console.log('모든 헤더:', JSON.stringify(request.headers, null, 2));
});
```

#### 2. Nginx 로그에서 확인

Nginx 액세스 로그에 헤더를 기록하도록 설정:

```nginx
log_format detailed '$remote_addr - $remote_user [$time_local] '
                   '"$request" $status $body_bytes_sent '
                   '"$http_referer" "$http_user_agent" '
                   'upgrade="$http_upgrade" connection="$http_connection"';

access_log /var/log/nginx/websocket_access.log detailed;
```

#### 3. curl로 테스트

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://localhost:3030/api/ws
```

### 문제 진단

#### 문제 1: "Invalid Upgrade header" 오류

**원인:**
- `Upgrade` 헤더가 없거나 잘못된 값
- `Upgrade` 헤더가 중복됨 (예: `websocket, websocket`)
- Nginx가 헤더를 잘못 전달함

**해결:**
1. Nginx 설정 확인:
   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   ```
   - `$http_upgrade` 변수 사용 (직접 값 아님)
   - `$connection_upgrade` 변수 사용 (map 지시어 필요)

2. 헤더 중복 확인:
   ```bash
   sudo grep -n "proxy_set_header Upgrade" /etc/nginx/sites-enabled/sync.coolsistema.com.conf
   ```
   - 한 번만 나타나야 함

#### 문제 2: HTTP 400 Bad Request

**원인:**
- `ws` 라이브러리가 헤더를 검증할 때 실패
- Express가 요청을 가로채서 잘못된 응답 전송

**해결:**
- Express가 WebSocket 요청을 처리하지 않도록 설정
- `ws` 라이브러리가 upgrade 이벤트를 처리할 수 있도록 보장

#### 문제 3: HTTP 502 Bad Gateway

**원인:**
- Nginx가 Node.js 서버에 연결하지 못함
- Node.js 서버가 응답하지 않음

**해결:**
- Node.js 서버가 실행 중인지 확인
- 포트가 올바른지 확인 (3030)
- 방화벽 설정 확인

### 디버깅 체크리스트

- [ ] Nginx 설정에서 `Upgrade` 헤더가 한 번만 설정되어 있는가?
- [ ] `Connection` 헤더가 `$connection_upgrade` 변수를 사용하는가?
- [ ] `/etc/nginx/nginx.conf`에 `map $http_upgrade $connection_upgrade` 지시어가 있는가?
- [ ] Node.js 서버가 upgrade 이벤트를 받고 있는가?
- [ ] Express가 WebSocket 요청을 가로채지 않는가?
- [ ] `ws` 라이브러리의 `verifyClient`가 호출되는가?

### 참고

- WebSocket 프로토콜: RFC 6455
- `ws` 라이브러리 문서: https://github.com/websockets/ws
- Nginx WebSocket 프록시: http://nginx.org/en/docs/http/websocket.html

