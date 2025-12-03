# Nginx WebSocket 설정 가이드

## ⚠️ 중요 변경사항
**WebSocket 경로가 `/ws`에서 `/api/ws`로 변경되었습니다!**

클라이언트는 이제 `wss://sync.coolsistema.com/api/ws`로 연결해야 합니다.

## 문제
클라이언트가 `wss://sync.coolsistema.com/api/ws`로 연결할 때:
- **404 Not Found** 오류가 발생하거나
- **HTTP 200 OK** 응답을 받지만 WebSocket 연결이 실패합니다.

## 원인
Nginx 리버스 프록시가 WebSocket 업그레이드 요청을 처리하지 못하고 있습니다. Nginx가 일반 HTTP 요청으로 처리하여 Express가 응답하고 있습니다.

## 해결 방법

### 1. Nginx 설정 파일 수정

Nginx 설정 파일을 열어서 WebSocket 경로(`/ws`)에 대한 프록시 설정을 추가하세요.

일반적으로 설정 파일 위치:
- `/etc/nginx/sites-available/sync.coolsistema.com`
- `/etc/nginx/nginx.conf`
- `/etc/nginx/conf.d/default.conf`

### 2. 방법 1: 기존 /api location에 WebSocket 지원 추가 (권장)

**⚠️ 중요**: `map` 지시어를 `http` 블록에 먼저 추가해야 합니다!

**1단계: `http` 블록에 `map` 지시어 추가**

1. **메인 Nginx 설정 파일 열기**:
   ```bash
   sudo nano /etc/nginx/nginx.conf
   # 또는
   sudo vi /etc/nginx/nginx.conf
   ```

2. **`http { }` 블록 찾기**: 파일을 열면 다음과 같은 구조가 있습니다:
   ```nginx
   http {
       # 여기에 여러 설정들이 있음
       include /etc/nginx/conf.d/*.conf;
       include /etc/nginx/sites-enabled/*;
       
       # ... 기타 설정들 ...
   }
   ```

3. **`http { }` 블록 안에 `map` 지시어 추가**: 
   `http {` 바로 다음에 추가하거나, 다른 설정들 앞에 추가하세요:
   ```nginx
   http {
       # WebSocket 업그레이드를 위한 map 지시어 (http 블록 맨 위에 추가)
       map $http_upgrade $connection_upgrade {
           default upgrade;
           '' close;
       }
       
       # 기존 설정들...
       include /etc/nginx/conf.d/*.conf;
       include /etc/nginx/sites-enabled/*;
       
       # ... 나머지 설정 ...
   }
   ```

4. **파일 저장 및 문법 확인**:
   ```bash
   sudo nginx -t
   ```
   "syntax is ok" 메시지가 나오면 성공입니다.

**참고**: 만약 `/etc/nginx/nginx.conf`에 직접 추가하기 어렵다면, 별도 파일로 만들어서 include할 수도 있습니다:
```bash
# 새 파일 생성
sudo nano /etc/nginx/conf.d/websocket.conf

# 다음 내용 추가
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

# nginx.conf의 http 블록에 다음을 추가 (이미 있으면 생략)
include /etc/nginx/conf.d/websocket.conf;
```

**2단계: `/api` location 블록 확인 및 수정**

1. **설정 파일 찾기**: 
   ```bash
   # 사이트별 설정 파일 확인
   sudo ls -la /etc/nginx/sites-available/
   sudo ls -la /etc/nginx/sites-enabled/
   
   # 또는 conf.d 디렉토리 확인
   sudo ls -la /etc/nginx/conf.d/
   ```
   
   일반적으로 `sync.coolsistema.com` 관련 파일을 찾으세요:
   ```bash
   sudo nano /etc/nginx/sites-available/sync.coolsistema.com
   # 또는
   sudo nano /etc/nginx/sites-enabled/sync.coolsistema.com
   ```

2. **`server { }` 블록 안에서 `/api` location 찾기**:
   파일을 열면 다음과 같은 구조가 있습니다:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name sync.coolsistema.com;
       
       # SSL 인증서 설정...
       
       location /api {
           # 여기가 기존 /api location 블록입니다
           proxy_pass http://localhost:3030;
           # ... 기존 설정들 ...
       }
   }
   ```

3. **기존 `/api` location 블록을 다음과 같이 수정**:
   
   **기존 설정이 있다면**:
   ```nginx
   location /api {
       proxy_pass http://localhost:3030;
       proxy_http_version 1.1;
       
       # 이 두 줄을 추가하거나 수정하세요 (필수!)
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection $connection_upgrade;
       
       # 기존에 있던 헤더들 (그대로 유지)
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_cache_bypass $http_upgrade;
       
       # WebSocket 타임아웃 추가 (긴 연결 유지)
       proxy_read_timeout 86400s;
       proxy_send_timeout 86400s;
       proxy_buffering off;
   }
   ```
   
   **기존 설정이 없다면** `server { }` 블록 안에 새로 추가하세요:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name sync.coolsistema.com;
       
       # SSL 인증서 설정...
       
       # /api location 블록 추가
       location /api {
           proxy_pass http://localhost:3030;
           proxy_http_version 1.1;
           
           # WebSocket 업그레이드 지원 (필수!)
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
           
           # 기본 프록시 헤더
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
           
           # WebSocket 타임아웃 (긴 연결 유지)
           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;
           proxy_buffering off;
       }
   }
   ```

4. **중요 확인 사항**:
   - ✅ `proxy_set_header Upgrade $http_upgrade;` 가 있는가?
   - ✅ `proxy_set_header Connection $connection_upgrade;` 가 있는가? (단순히 `"upgrade"`가 아니라 `$connection_upgrade` 변수를 사용해야 함!)
   - ✅ `proxy_http_version 1.1;` 가 있는가?
   - ✅ `proxy_pass`의 포트가 Node.js 서버 포트(3030)와 일치하는가?

5. **파일 저장 및 문법 확인**:
   ```bash
   sudo nginx -t
   ```

### 2-1. 방법 2: 별도 WebSocket Location 블록 추가

기존 `server` 블록 안에 다음 설정을 추가하세요:

```nginx
# WebSocket 경로 프록시 설정
location /api/ws {
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
    location /api/ws {
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
ws.connect("wss://sync.coolsistema.com/api/ws")  # 경로 변경: /ws → /api/ws
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

