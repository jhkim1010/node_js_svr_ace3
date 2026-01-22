# 리눅스 서버 배포 체크리스트 (Docker 환경)

이 문서는 연결 풀 최적화 및 WebSocket 안정성 개선 후 서버에서 확인해야 할 사항들을 정리합니다.

**⚠️ 중요: 현재 환경 구성**
- **PostgreSQL**: 도커 바깥에서 실행 (호스트 시스템)
- **Node.js 서버**: 도커 컨테이너 내부에서 실행 (`/home/node/app` 디렉토리)
- **연결 방식**: 도커 컨테이너에서 `host.docker.internal`을 통해 호스트의 PostgreSQL에 접근
- **환경 변수**: 호스트 시스템의 `.env` 파일이 `docker-compose.yaml`의 `env_file` 설정을 통해 컨테이너에 환경 변수로 전달됨
  - 호스트: `/path/to/node_js_svr_ace3/.env` (실제 파일)
  - 컨테이너: 환경 변수로만 전달 (파일은 복사되지 않음)

## ✅ 필수 확인 사항

### 1. 환경 변수 설정 (.env 파일)

**⚠️ 중요: `.env` 파일 위치**
- **호스트 시스템**: 프로젝트 루트 디렉토리 (예: `/home/user/node_js_svr_ace3/.env`)
- **도커 컨테이너**: `.env` 파일은 컨테이너 내부에 복사되지 않음
- **작동 방식**: `docker-compose.yaml`의 `env_file: ./.env` 설정을 통해 호스트의 `.env` 파일이 환경 변수로 컨테이너에 전달됨

**🔍 프로젝트 디렉토리 위치 확인 방법** (리눅스 서버에서):

프로젝트 디렉토리 경로를 모르는 경우, 다음 방법으로 확인할 수 있습니다:

```bash
# 방법 1: docker-compose.yaml 파일 찾기 (가장 확실한 방법)
find / -name "docker-compose.yaml" -type f 2>/dev/null | grep -i node_js_svr_ace3
# 또는
find /home -name "docker-compose.yaml" -type f 2>/dev/null
find /opt -name "docker-compose.yaml" -type f 2>/dev/null
find /var -name "docker-compose.yaml" -type f 2>/dev/null

# 방법 2: syncace 컨테이너의 작업 디렉토리 확인
docker inspect syncace | grep -i "workingdir\|workdir"
# 또는 더 자세히
docker inspect syncace --format '{{.Config.WorkingDir}}'

# 방법 3: docker-compose가 실행된 디렉토리 확인 (컨테이너 정보에서)
docker inspect syncace | grep -A 10 "Labels" | grep -i "com.docker.compose.project.working_dir"
# 또는
docker inspect syncace --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'

# 방법 4: .env 파일 찾기
find /home -name ".env" -path "*/node_js_svr_ace3/.env" 2>/dev/null
find /opt -name ".env" -path "*/node_js_svr_ace3/.env" 2>/dev/null

# 방법 5: syncace 컨테이너가 사용하는 이미지의 빌드 컨텍스트 확인
docker inspect syncace | grep -A 5 "Image"
# 이미지 이름이 sync-ace인 경우, 해당 이미지를 빌드한 디렉토리 확인

# 방법 6: 일반적인 위치 확인
ls -la /home/*/node_js_svr_ace3/.env 2>/dev/null
ls -la /opt/node_js_svr_ace3/.env 2>/dev/null
ls -la /var/www/node_js_svr_ace3/.env 2>/dev/null

# 방법 7: docker-compose ps로 확인 (프로젝트 디렉토리에서 실행해야 함)
# 여러 위치에서 시도
cd /home && docker-compose ps 2>/dev/null | grep syncace && echo "프로젝트 위치: $(pwd)"
cd /opt && docker-compose ps 2>/dev/null | grep syncace && echo "프로젝트 위치: $(pwd)"
```

**가장 빠른 방법** (컨테이너가 실행 중인 경우):
```bash
# 컨테이너의 라벨에서 프로젝트 디렉토리 확인
docker inspect syncace --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'

# 결과가 나오면 그 경로로 이동
cd $(docker inspect syncace --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
```

**결과가 없는 경우** (수동으로 찾기):
```bash
# 1. 일반적인 프로젝트 위치 확인
ls -d /home/*/node_js_svr_ace3 2>/dev/null
ls -d /opt/node_js_svr_ace3 2>/dev/null
ls -d /var/www/node_js_svr_ace3 2>/dev/null

# 2. docker-compose.yaml 파일이 있는 디렉토리 찾기
find /home -name "docker-compose.yaml" -exec dirname {} \; 2>/dev/null | head -5

# 3. 찾은 디렉토리로 이동하여 확인
cd /찾은/경로
ls -la | grep -E "docker-compose|\.env"
```

**확인/추가할 변수** (호스트 시스템의 `.env` 파일에 설정):
```bash
# PostgreSQL 연결 풀 설정
DB_POOL_MAX=50          # 각 데이터베이스당 최대 연결 수 (기본값: 50)
DB_POOL_IDLE=5000       # 유휴 연결 유지 시간 밀리초 (기본값: 5000 = 5초)

# ⚠️ 중요: 도커 환경에서 호스트의 PostgreSQL 접근을 위한 설정
DB_HOST=host.docker.internal  # 도커 컨테이너에서 호스트 시스템 접근
```

**확인 방법** (호스트 시스템에서 실행):
```bash
# ⚠️ 먼저 프로젝트 디렉토리 위치 확인 (위의 "프로젝트 디렉토리 위치 확인 방법" 참조)
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3
# 또는 자동으로 찾기:
cd $(docker inspect syncace --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null) || \
cd $(find /home /opt /var -name "docker-compose.yaml" -path "*/node_js_svr_ace3/*" -exec dirname {} \; 2>/dev/null | head -1)

# .env 파일 확인
cat .env | grep DB_POOL

# 또는 전체 .env 파일 확인
cat .env

# docker-compose.yaml에서 env_file 설정 확인
cat docker-compose.yaml | grep env_file

# 현재 디렉토리 확인 (프로젝트 디렉토리인지 확인)
pwd
ls -la | grep -E "docker-compose|\.env|package.json"
```

**설정이 없으면 추가** (호스트 시스템에서 실행):
```bash
# ⚠️ 먼저 프로젝트 디렉토리 위치 확인
# 프로젝트 디렉토리로 이동 (위의 "프로젝트 디렉토리 위치 확인 방법" 참조)
cd /path/to/node_js_svr_ace3

# .env 파일 편집
nano .env

# 다음 내용 추가
DB_POOL_MAX=50
DB_POOL_IDLE=5000
DB_HOST=host.docker.internal  # 도커 환경 필수 설정
```

**도커 컨테이너에서 환경 변수 확인** (호스트 시스템에서 실행):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 실행 중인 컨테이너에서 환경 변수 확인
docker exec syncace env | grep DB_

# 또는 docker-compose 사용 시
docker-compose exec syncace env | grep DB_

# ⚠️ 참고: 컨테이너 내부에는 .env 파일이 없고, 환경 변수로만 전달됩니다
# 컨테이너 내부 작업 디렉토리는 /home/node/app 입니다
docker exec syncace ls -la /home/node/app | grep .env  # 파일이 없어야 정상
```

---

### 2. 도커 네트워크 설정 확인

**⚠️ 중요: 도커 컨테이너에서 호스트의 PostgreSQL 접근 가능 여부 확인**

**docker-compose.yaml 설정 확인**:
```yaml
services:
  syncace:
    extra_hosts:
      - "host.docker.internal:host-gateway"  # ⚠️ 이 설정이 있어야 함
```

**설정 확인 방법** (호스트 시스템에서 실행):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# docker-compose.yaml 파일 확인
cat docker-compose.yaml | grep -A 2 "extra_hosts"

# 실행 중인 컨테이너의 네트워크 설정 확인
docker inspect syncace | grep -A 5 "ExtraHosts"
```

**호스트 접근 테스트** (호스트 시스템에서 실행):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 도커 컨테이너 내부에서 호스트의 PostgreSQL 접근 테스트
docker exec syncace ping -c 3 host.docker.internal

# PostgreSQL 포트 접근 테스트 (호스트의 PostgreSQL 포트가 5432인 경우)
docker exec syncace nc -zv host.docker.internal 5432

# 또는 컨테이너 내부에서 직접 테스트
docker exec -it syncace sh
# 컨테이너 내부에서 (/home/node/app 디렉토리에 있음):
ping host.docker.internal
nc -zv host.docker.internal 5432
exit  # 컨테이너에서 나가기
```

**문제 발생 시 해결 방법**:
- Linux에서 `host.docker.internal`이 작동하지 않는 경우, `extra_hosts` 설정이 필요합니다
- `docker-compose.yaml`에 `extra_hosts: - "host.docker.internal:host-gateway"` 추가
- 또는 호스트의 실제 IP 주소를 사용 (예: `DB_HOST=172.17.0.1`)

---

### 3. PostgreSQL 서버 설정 확인 (호스트 시스템)

**⚠️ 중요: PostgreSQL은 도커 바깥(호스트 시스템)에서 실행 중입니다**

**PostgreSQL max_connections 확인** (호스트에서 실행):
```bash
# 호스트 시스템에서 PostgreSQL에 접속하여 확인
psql -U postgres -c "SHOW max_connections;"

# 또는
psql -U postgres -c "SELECT setting FROM pg_settings WHERE name='max_connections';"
```

**현재 연결 수 확인** (호스트에서 실행):
```bash
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

**도커 컨테이너에서의 연결 확인**:
```bash
# 도커 컨테이너에서 시작된 연결 확인
psql -U postgres -c "
SELECT 
    datname,
    application_name,
    client_addr,
    count(*) as connections
FROM pg_stat_activity
WHERE client_addr IS NOT NULL
GROUP BY datname, application_name, client_addr
ORDER BY connections DESC;
"
```

**권장 사항**:
- `max_connections`가 100 이상인지 확인
- 여러 데이터베이스를 사용하는 경우, 각 DB당 50개 연결을 고려하여 충분한 여유가 있는지 확인
- 예: 3개 DB × 50개 = 150개 필요 → `max_connections`는 최소 200 이상 권장
- 도커 컨테이너에서 접근하는 연결도 포함하여 계산

**max_connections 변경 방법** (필요시, 호스트에서 실행):
```bash
# postgresql.conf 파일 편집
sudo nano /etc/postgresql/[version]/main/postgresql.conf

# 또는
sudo nano /var/lib/pgsql/data/postgresql.conf

# 다음 값 수정
max_connections = 200  # 필요에 따라 조정

# PostgreSQL 재시작 (호스트에서)
sudo systemctl restart postgresql
# 또는
sudo service postgresql restart
```

**PostgreSQL 방화벽 설정 확인**:
```bash
# PostgreSQL이 도커 컨테이너에서 접근 가능하도록 설정 확인
# postgresql.conf에서 listen_addresses 확인
sudo grep "listen_addresses" /etc/postgresql/[version]/main/postgresql.conf

# pg_hba.conf에서 호스트 접근 허용 확인
sudo grep -E "^host" /etc/postgresql/[version]/main/pg_hba.conf

# 필요시 pg_hba.conf에 추가 (도커 컨테이너 IP 대역 허용)
# host    all    all    172.17.0.0/16    md5
```

**PostgreSQL max_connections 확인**:
```bash
# PostgreSQL에 접속하여 확인
psql -U postgres -c "SHOW max_connections;"

# 또는
psql -U postgres -c "SELECT setting FROM pg_settings WHERE name='max_connections';"
```

**현재 연결 수 확인**:
```bash
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

**권장 사항**:
- `max_connections`가 100 이상인지 확인
- 여러 데이터베이스를 사용하는 경우, 각 DB당 50개 연결을 고려하여 충분한 여유가 있는지 확인
- 예: 3개 DB × 50개 = 150개 필요 → `max_connections`는 최소 200 이상 권장

**max_connections 변경 방법** (필요시):
```bash
# postgresql.conf 파일 편집
sudo nano /etc/postgresql/[version]/main/postgresql.conf

# 또는
sudo nano /var/lib/pgsql/data/postgresql.conf

# 다음 값 수정
max_connections = 200  # 필요에 따라 조정

# PostgreSQL 재시작
sudo systemctl restart postgresql
# 또는
sudo service postgresql restart
```

---

### 4. Nginx 설정 확인 (WebSocket 타임아웃)

**Nginx 설정 파일 위치 확인**:
```bash
# 일반적인 위치
/etc/nginx/sites-available/sync.coolsistema.com
# 또는
/etc/nginx/nginx.conf
```

**WebSocket 경로(/ws) 타임아웃 설정 확인**:
```nginx
location /ws {
    proxy_pass http://localhost:3030;
    proxy_http_version 1.1;
    
    # WebSocket 업그레이드 필수 헤더
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    
    # 기본 프록시 헤더
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # ⚠️ 중요: WebSocket 타임아웃 설정 (긴 연결 유지)
    proxy_read_timeout 86400s;  # 24시간
    proxy_send_timeout 86400s;  # 24시간
    
    # 버퍼링 비활성화 (실시간 통신)
    proxy_buffering off;
}
```

**설정 확인 방법**:
```bash
# Nginx 설정 파일 확인
sudo nginx -t

# 설정 파일에서 WebSocket 타임아웃 확인
sudo grep -A 10 "location /ws" /etc/nginx/sites-available/sync.coolsistema.com
```

**설정 변경 후 Nginx 재시작**:
```bash
# 설정 테스트
sudo nginx -t

# 재시작
sudo systemctl reload nginx
# 또는
sudo service nginx reload
```

---

### 5. 시스템 리소스 제한 확인

**도커 컨테이너 리소스 제한 확인**:
```bash
# 컨테이너의 리소스 사용량 확인
docker stats syncace --no-stream

# 컨테이너의 메모리 제한 확인
docker inspect syncace | grep -i memory

# 컨테이너의 CPU 제한 확인
docker inspect syncace | grep -i cpu
```

**파일 디스크립터 제한 확인**:
```bash
# 현재 프로세스의 제한 확인
ulimit -n

# 시스템 전체 제한 확인
cat /proc/sys/fs/file-max

# 사용자별 제한 확인
ulimit -a
```

**연결 수 제한 확인**:
```bash
# 현재 열린 연결 수 확인
ss -s

# WebSocket 연결 수 확인 (포트 3030)
ss -tn | grep :3030 | wc -l
```

**필요시 제한 증가** (시스템 관리자 권한 필요):
```bash
# /etc/security/limits.conf 파일 편집
sudo nano /etc/security/limits.conf

# 다음 내용 추가 (nodejs 사용자 또는 root)
* soft nofile 65535
* hard nofile 65535

# 재부팅 후 적용되거나, 현재 세션에서:
ulimit -n 65535
```

---

### 6. 애플리케이션 재시작 (도커 컨테이너)

**⚠️ 중요: 코드 변경사항 적용을 위한 도커 컨테이너 재시작 필요**

**docker-compose 사용 시** (권장):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 컨테이너 재시작 (코드 변경사항 적용)
docker-compose restart syncace

# 또는 컨테이너 재빌드 후 재시작 (코드 변경이 많은 경우)
docker-compose up -d --build syncace

# 컨테이너 상태 확인
docker-compose ps

# 로그 확인 (실시간)
docker-compose logs -f syncace

# 로그 확인 (최근 100줄)
docker-compose logs --tail=100 syncace
```

**docker 명령어 직접 사용 시**:
```bash
# 컨테이너 재시작
docker restart syncace

# 컨테이너 상태 확인
docker ps | grep syncace

# 로그 확인 (실시간)
docker logs -f syncace

# 로그 확인 (최근 100줄)
docker logs --tail=100 syncace
```

**코드 변경 후 완전 재빌드가 필요한 경우**:
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 컨테이너 중지 및 제거
docker-compose down

# 이미지 재빌드
docker-compose build --no-cache syncace

# 컨테이너 시작
docker-compose up -d syncace

# 로그 확인
docker-compose logs -f syncace
```

**환경 변수 변경 후 재시작** (호스트 시스템에서 실행):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 호스트 시스템의 .env 파일 수정
nano .env

# 컨테이너 재시작 (환경 변수 재로드)
docker-compose restart syncace

# 또는 완전 재시작 (환경 변수 확실히 적용)
docker-compose down
docker-compose up -d
```

---

### 7. 변경사항 적용 확인

**도커 컨테이너 로그에서 확인할 메시지**:

1. **연결 풀 설정 확인**:
```
[Connection Pool] ✅ 새로운 연결 생성: [database_name] (현재: X/50)
```

2. **WebSocket 서버 초기화 확인**:
```
[WebSocket] ✅ WebSocket 서버 생성 완료: 경로=/ws, /api/ws 지원
[WebSocket] ✅ WebSocket 서버 초기화 완료
```

3. **PostgreSQL max_connections 확인** (첫 연결 시):
```
[Connection Pool] 📊 PostgreSQL 서버 max_connections: 100개
```

**연결 풀 사용량 모니터링**:
```bash
# 도커 컨테이너 로그에서 연결 풀 관련 메시지 확인
docker logs -f syncace | grep "Connection Pool"

# 또는 docker-compose 사용 시
docker-compose logs -f syncace | grep "Connection Pool"

# 최근 로그에서 연결 풀 관련 메시지 검색
docker logs syncace 2>&1 | grep "Connection Pool" | tail -20
```

**WebSocket 연결 테스트**:
```bash
# WebSocket 연결 테스트 (wscat 설치 필요: npm install -g wscat)
wscat -c wss://sync.coolsistema.com/ws

# 연결 후 메시지 전송 테스트
{"type": "register-client", "database": "your_db", "user": "your_user"}
```

---

### 8. 성능 모니터링

**PostgreSQL 연결 수 모니터링** (호스트에서 실행):
```bash
# 실시간 연결 수 확인
watch -n 5 "psql -U postgres -c 'SELECT count(*) FROM pg_stat_activity;'"

# 연결 상세 정보
psql -U postgres -c "
SELECT 
    datname,
    count(*) as connections,
    count(*) FILTER (WHERE state = 'active') as active,
    count(*) FILTER (WHERE state = 'idle') as idle,
    count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction
FROM pg_stat_activity
GROUP BY datname;
"

# 도커 컨테이너에서 시작된 연결 확인
psql -U postgres -c "
SELECT 
    datname,
    client_addr,
    application_name,
    count(*) as connections,
    count(*) FILTER (WHERE state = 'active') as active,
    count(*) FILTER (WHERE state = 'idle') as idle
FROM pg_stat_activity
WHERE client_addr IS NOT NULL
GROUP BY datname, client_addr, application_name
ORDER BY connections DESC;
"
```

**도커 컨테이너 리소스 모니터링**:
```bash
# 컨테이너 리소스 사용량 실시간 모니터링
docker stats syncace

# 컨테이너 프로세스 확인
docker top syncace

# 컨테이너 네트워크 연결 확인
docker exec syncace netstat -an | grep 5432
```

**애플리케이션 모니터링 엔드포인트**:
```bash
# 헬스 체크
curl https://sync.coolsistema.com/api/health

# 모니터링 상태 확인
curl https://sync.coolsistema.com/api/monitoring/status
```

---

## ⚠️ 문제 발생 시 확인 사항

### 연결 풀 관련 문제

**증상**: "remaining connection slots are reserved" 오류

**확인 사항**:
1. PostgreSQL `max_connections` 값 확인
2. 현재 사용 중인 연결 수 확인
3. `DB_POOL_MAX` 환경 변수 값 확인 (각 DB당 50개 이하 권장)
4. 다른 애플리케이션이 많은 연결을 사용하고 있는지 확인

**해결 방법**:
```bash
# 현재 연결 수 확인 (호스트에서 실행)
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# 각 데이터베이스별 연결 수 확인
psql -U postgres -c "
SELECT datname, count(*) 
FROM pg_stat_activity 
GROUP BY datname;
"

# 도커 컨테이너에서 시작된 연결 확인
psql -U postgres -c "
SELECT datname, client_addr, count(*) 
FROM pg_stat_activity 
WHERE client_addr IS NOT NULL
GROUP BY datname, client_addr;
"

# 필요시 DB_POOL_MAX 값 감소 (호스트 시스템에서 실행)
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 호스트 시스템의 .env 파일 수정
nano .env
# DB_POOL_MAX=30  # 50에서 30으로 감소

# 도커 컨테이너 재시작하여 환경 변수 적용
docker-compose restart syncace
```

---

### WebSocket 연결 끊김 문제

**증상**: WebSocket 연결이 자주 끊어짐

**확인 사항**:
1. Nginx `proxy_read_timeout`, `proxy_send_timeout` 설정 확인 (86400s 이상 권장)
2. 애플리케이션 로그에서 ping/pong 관련 오류 확인
3. 네트워크 방화벽 설정 확인

**해결 방법**:
```bash
# Nginx 설정 확인
sudo nginx -t
sudo grep -A 5 "location /ws" /etc/nginx/sites-available/sync.coolsistema.com

# Nginx 재시작
sudo systemctl reload nginx

# 도커 컨테이너 로그에서 WebSocket 관련 메시지 확인
docker logs syncace 2>&1 | grep "WebSocket"
# 또는
docker-compose logs syncace | grep "WebSocket"

# 도커 컨테이너 재시작
docker-compose restart syncace
```

---

## 📋 빠른 체크리스트 (도커 환경)

배포 전 다음 항목들을 빠르게 확인:

- [ ] `.env` 파일에 `DB_POOL_MAX=50`, `DB_POOL_IDLE=5000`, `DB_HOST=host.docker.internal` 설정되어 있는가?
- [ ] `docker-compose.yaml`에 `extra_hosts: - "host.docker.internal:host-gateway"` 설정되어 있는가?
- [ ] 도커 컨테이너에서 `host.docker.internal` 접근 가능한가? (`docker exec syncace ping -c 3 host.docker.internal`)
- [ ] 도커 컨테이너에서 호스트의 PostgreSQL 포트 접근 가능한가? (`docker exec syncace nc -zv host.docker.internal 5432`)
- [ ] PostgreSQL `max_connections`가 충분한가? (최소 100 이상, 여러 DB 사용 시 더 필요)
- [ ] PostgreSQL `pg_hba.conf`에서 도커 컨테이너 IP 대역 접근 허용되어 있는가?
- [ ] Nginx `/ws` 경로에 `proxy_read_timeout 86400s`, `proxy_send_timeout 86400s` 설정되어 있는가?
- [ ] Nginx 설정 테스트 통과했는가? (`sudo nginx -t`)
- [ ] 도커 컨테이너가 재시작되었는가? (`docker-compose restart syncace`)
- [ ] 도커 컨테이너 로그에서 연결 풀 및 WebSocket 초기화 메시지가 정상인가?
- [ ] WebSocket 연결 테스트가 성공하는가?

---

## 📞 추가 도움말 (도커 환경)

문제가 발생하면 다음 정보를 수집하여 확인하세요 (호스트 시스템에서 실행):

```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 환경 변수 확인 (호스트 시스템의 .env 파일)
cat .env | grep DB_

# 도커 컨테이너 내부 환경 변수 확인 (호스트의 .env가 환경 변수로 전달됨)
docker exec syncace env | grep DB_

# docker-compose.yaml 설정 확인
cat docker-compose.yaml

# PostgreSQL 연결 상태 (호스트에서 실행)
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
psql -U postgres -c "SHOW max_connections;"

# 도커 컨테이너에서 시작된 연결 확인
psql -U postgres -c "
SELECT datname, client_addr, application_name, count(*) 
FROM pg_stat_activity 
WHERE client_addr IS NOT NULL
GROUP BY datname, client_addr, application_name;
"

# 도커 컨테이너 네트워크 설정 확인
docker inspect syncace | grep -A 10 "NetworkSettings"

# 도커 컨테이너에서 호스트 접근 테스트
docker exec syncace ping -c 3 host.docker.internal
docker exec syncace nc -zv host.docker.internal 5432

# Nginx 설정 확인
sudo nginx -t
sudo grep -A 10 "location /ws" /etc/nginx/sites-available/sync.coolsistema.com

# 도커 컨테이너 로그 (최근 100줄)
docker logs --tail=100 syncace
# 또는 docker-compose 사용 시
docker-compose logs --tail=100 syncace

# 도커 컨테이너 상태 확인
docker ps | grep syncace
docker-compose ps

# 도커 컨테이너 리소스 사용량 확인
docker stats syncace --no-stream
```

## 🔧 도커 환경 특화 문제 해결

### 도커 컨테이너에서 PostgreSQL 접근 불가

**증상**: 연결 오류, "connection refused" 또는 "host not found"

**확인 사항**:
1. `docker-compose.yaml`에 `extra_hosts` 설정 확인
2. 호스트의 PostgreSQL이 실행 중인지 확인
3. PostgreSQL 포트가 열려있는지 확인

**해결 방법** (호스트 시스템에서 실행):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 1. docker-compose.yaml 확인 및 수정
cat docker-compose.yaml
# extra_hosts 설정이 있는지 확인

# 2. 호스트의 PostgreSQL 상태 확인
sudo systemctl status postgresql

# 3. PostgreSQL 포트 확인
sudo netstat -tlnp | grep 5432
# 또는
sudo ss -tlnp | grep 5432

# 4. 도커 컨테이너에서 접근 테스트
docker exec syncace ping -c 3 host.docker.internal
docker exec syncace nc -zv host.docker.internal 5432

# 5. 문제가 지속되면 호스트 IP 직접 사용 (임시)
# 호스트 시스템의 .env 파일 수정
nano .env
# DB_HOST=172.17.0.1  # 호스트의 도커 브리지 IP (docker0)
# 또는
# DB_HOST=[호스트의 실제 IP 주소]
# 
# 컨테이너 재시작
docker-compose restart syncace
```

### 도커 컨테이너 재시작 후 환경 변수 미적용

**증상**: 환경 변수 변경 후에도 이전 값이 사용됨

**해결 방법** (호스트 시스템에서 실행):
```bash
# 프로젝트 디렉토리로 이동
cd /path/to/node_js_svr_ace3

# 완전 재시작 (권장)
docker-compose down
docker-compose up -d

# 또는 컨테이너 재생성
docker-compose up -d --force-recreate syncace

# 환경 변수 확인 (컨테이너 내부의 환경 변수)
docker exec syncace env | grep DB_

# ⚠️ 참고: 컨테이너 내부에는 .env 파일이 없습니다
# 환경 변수는 호스트의 .env 파일에서 docker-compose.yaml을 통해 전달됩니다
```
