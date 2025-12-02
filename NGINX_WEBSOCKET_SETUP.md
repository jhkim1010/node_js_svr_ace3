# Nginx WebSocket 설정 가이드

## 문제
클라이언트가 `wss://sync.coolsistema.com/ws`로 연결할 때 **404 Not Found** 오류가 발생합니다.

## 원인
Nginx 리버스 프록시가 WebSocket 업그레이드 요청을 처리하지 못하고 있습니다.

## 해결 방법

### 1. Nginx 설정 파일 수정

Nginx 설정 파일을 열어서 WebSocket 경로(`/ws`)에 대한 프록시 설정을 추가하세요.

일반적으로 설정 파일 위치:
- `/etc/nginx/sites-available/sync.coolsistema.com`
- `/etc/nginx/nginx.conf`
- `/etc/nginx/conf.d/default.conf`

### 2. WebSocket Location 블록 추가

기존 `server` 블록 안에 다음 설정을 추가하세요:

```nginx
# WebSocket 경로 프록시 설정
location /ws {
    proxy_pass http://localhost:3030;  # Node.js 서버 포트 (실제 포트로 변경)
    proxy_http_version 1.1;
    
    # WebSocket 업그레이드 필수 헤더
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # 기본 프록시 헤더
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket 타임아웃 설정 (긴 연결 유지)
    proxy_read_timeout 86400s;  # 24시간
    proxy_send_timeout 86400s;  # 24시간
    
    # 버퍼링 비활성화 (실시간 통신)
    proxy_buffering off;
}
```

### 3. 전체 설정 예시

```nginx
server {
    listen 443 ssl http2;
    server_name sync.coolsistema.com;

    # SSL 인증서 설정
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/certificate.key;

    # 일반 API 요청
    location /api {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket 경로 (중요!)
    location /ws {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffering off;
    }
}
```

### 4. 설정 적용

1. Nginx 설정 파일 문법 확인:
```bash
sudo nginx -t
```

2. Nginx 재시작:
```bash
sudo systemctl restart nginx
# 또는
sudo service nginx restart
```

3. 로그 확인:
```bash
sudo tail -f /var/log/nginx/error.log
```

## 중요 사항

1. **포트 확인**: `proxy_pass`의 포트가 Node.js 서버가 실행 중인 포트와 일치하는지 확인하세요.

2. **Upgrade 헤더**: `proxy_set_header Upgrade $http_upgrade;`와 `proxy_set_header Connection "upgrade";`는 필수입니다.

3. **타임아웃**: WebSocket은 긴 연결을 유지하므로 타임아웃을 충분히 길게 설정하세요.

4. **버퍼링**: 실시간 통신을 위해 `proxy_buffering off;`를 설정하는 것이 좋습니다.

## 테스트

설정 적용 후 클라이언트에서 다시 연결을 시도하세요:

```python
import websocket
ws = websocket.WebSocket()
ws.connect("wss://sync.coolsistema.com/ws")
```

연결이 성공하면 서버 로그에 다음 메시지가 표시됩니다:
```
[WebSocket] ✅ 클라이언트 연결됨: id=client_xxx, remoteAddress=xxx
```

## 문제 해결

여전히 404 오류가 발생하면:

1. Nginx 설정 파일이 올바른 위치에 있는지 확인
2. `nginx -t`로 문법 오류 확인
3. Nginx 에러 로그 확인: `sudo tail -f /var/log/nginx/error.log`
4. Node.js 서버가 실행 중인지 확인: `netstat -tulpn | grep 3030`
5. 방화벽에서 포트가 열려있는지 확인

