# Nginx 헤더 중복 확인 가이드

## 문제
클라이언트가 "Invalid Upgrade header" 오류를 받고 있고, 서버 로그에서 `Upgrade 헤더: websocket, websocket`처럼 중복된 헤더 값이 보입니다.

## 헤더 중복 확인 방법

### 1단계: Nginx 설정 파일 열기

```bash
sudo nano /etc/nginx/sites-enabled/sync.coolsistema.com.conf
```

또는

```bash
sudo vi /etc/nginx/sites-enabled/sync.coolsistema.com.conf
```

### 2단계: `location /api` 블록 찾기

파일을 열면 다음과 같은 구조가 있습니다:

```nginx
server {
    listen 443 ssl;
    server_name sync.coolsistema.com;
    
    # ... 기타 설정 ...
    
    location /api {
        # 여기가 확인할 부분입니다
    }
}
```

### 3단계: 헤더 중복 확인

`location /api` 블록 안에서 다음 헤더들이 **여러 번** 설정되어 있는지 확인하세요:

#### 확인할 헤더들:

1. **`proxy_set_header Upgrade`** - 이 헤더가 여러 번 있는지 확인
2. **`proxy_set_header Connection`** - 이 헤더가 여러 번 있는지 확인

#### 올바른 설정 (중복 없음):

```nginx
location /api {
    proxy_pass http://localhost:3030;
    proxy_http_version 1.1;
    
    # 각 헤더는 한 번만 설정되어야 함
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_buffering off;
}
```

#### 잘못된 설정 (중복 있음) - 예시:

```nginx
location /api {
    proxy_pass http://localhost:3030;
    proxy_http_version 1.1;
    
    # ❌ 잘못됨: Upgrade 헤더가 두 번 설정됨
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Upgrade websocket;  # 중복!
    
    # ❌ 잘못됨: Connection 헤더가 두 번 설정됨
    proxy_set_header Connection upgrade;
    proxy_set_header Connection $connection_upgrade;  # 중복!
    
    # ... 나머지 설정 ...
}
```

### 4단계: grep으로 중복 확인

터미널에서 다음 명령어로 중복을 확인할 수 있습니다:

```bash
# Upgrade 헤더가 몇 번 설정되어 있는지 확인
sudo grep -n "proxy_set_header Upgrade" /etc/nginx/sites-enabled/sync.coolsistema.com.conf

# Connection 헤더가 몇 번 설정되어 있는지 확인
sudo grep -n "proxy_set_header Connection" /etc/nginx/sites-enabled/sync.coolsistema.com.conf
```

**결과 해석:**
- 각 헤더가 **한 번만** 나타나야 합니다
- 두 번 이상 나타나면 중복입니다

### 5단계: 전체 location 블록 확인

`location /api` 블록 전체를 확인하려면:

```bash
# location /api 블록 전체 보기
sudo sed -n '/location \/api {/,/^[[:space:]]*}/p' /etc/nginx/sites-enabled/sync.coolsistema.com.conf
```

또는 파일을 열어서 `location /api {` 부터 다음 `}` 까지 확인하세요.

### 6단계: include된 파일 확인

만약 `include` 지시어로 다른 파일을 포함하고 있다면, 그 파일도 확인해야 합니다:

```bash
# include된 파일 찾기
sudo grep -r "include" /etc/nginx/sites-enabled/sync.coolsistema.com.conf

# 예를 들어, 다음과 같은 경우:
# include /etc/nginx/conf.d/websocket.conf;
# 이 파일도 확인해야 합니다
```

### 7단계: 수정 방법

중복을 발견했다면:

1. **중복된 헤더 제거**: 같은 헤더가 여러 번 설정되어 있으면 하나만 남기고 나머지 제거
2. **올바른 값 사용**: 
   - `Upgrade`: `$http_upgrade` 사용 (변수)
   - `Connection`: `$connection_upgrade` 사용 (변수, `map` 지시어 필요)

### 8단계: 수정 후 확인

```bash
# 문법 확인
sudo nginx -t

# 성공하면 다음과 같은 메시지가 나옵니다:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 9단계: Nginx 재시작

```bash
sudo systemctl restart nginx
```

또는

```bash
sudo service nginx restart
```

### 10단계: 로그 확인

재시작 후 에러 로그 확인:

```bash
sudo tail -f /var/log/nginx/error.log
```

## 현재 설정 확인 명령어 (한 번에 실행)

다음 명령어를 실행하면 현재 설정을 한 번에 확인할 수 있습니다:

```bash
echo "=== Upgrade 헤더 확인 ==="
sudo grep -n "proxy_set_header Upgrade" /etc/nginx/sites-enabled/sync.coolsistema.com.conf

echo ""
echo "=== Connection 헤더 확인 ==="
sudo grep -n "proxy_set_header Connection" /etc/nginx/sites-enabled/sync.coolsistema.com.conf

echo ""
echo "=== location /api 블록 전체 ==="
sudo sed -n '/location \/api {/,/^[[:space:]]*}/p' /etc/nginx/sites-enabled/sync.coolsistema.com.conf
```

## 예상되는 문제와 해결

### 문제 1: 헤더가 두 번 설정됨
**증상**: `Upgrade 헤더: websocket, websocket`
**해결**: 중복된 `proxy_set_header Upgrade` 줄 중 하나 제거

### 문제 2: 잘못된 값 사용
**증상**: `proxy_set_header Upgrade websocket` (변수 없이 직접 값)
**해결**: `proxy_set_header Upgrade $http_upgrade`로 변경

### 문제 3: map 지시어 없음
**증상**: `Connection` 헤더가 제대로 작동하지 않음
**해결**: `/etc/nginx/nginx.conf`의 `http` 블록에 `map` 지시어 추가

## 참고

- Nginx는 같은 헤더를 여러 번 설정하면 값을 합쳐서 전달합니다
- WebSocket은 정확한 헤더 형식이 필요하므로 중복이 문제가 될 수 있습니다
- `$connection_upgrade` 변수는 `map` 지시어로 정의되어 있어야 합니다

