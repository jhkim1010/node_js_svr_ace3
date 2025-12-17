# 서버 진단 및 복구 가이드

## 502 Bad Gateway 에러 해결

### 문제 상황
- `sync.coolsistema.com`에서 502 Bad Gateway 에러 발생
- nginx는 실행 중이지만 백엔드 Node.js 서버에 연결하지 못함

### 원격 서버 진단 단계

#### 1. SSH로 원격 서버 접속
```bash
ssh user@sync.coolsistema.com
# 또는
ssh user@서버IP주소
```

#### 2. Docker 컨테이너 상태 확인
```bash
# 컨테이너 목록 확인
docker ps -a

# syncace 컨테이너가 있는지 확인
docker ps -a | grep syncace
```

#### 3. 컨테이너가 중지된 경우 시작
```bash
# 컨테이너 시작
docker start syncace

# 또는 docker-compose 사용
cd /path/to/node_js_svr_ace3
docker-compose up -d
```

#### 4. 컨테이너가 없는 경우 재시작
```bash
cd /path/to/node_js_svr_ace3
docker-compose down
docker-compose up -d --build
```

#### 5. 포트 3030 확인
```bash
# 포트 3030이 열려있는지 확인
sudo lsof -i :3030
# 또는
sudo netstat -tlnp | grep 3030

# 로컬에서 테스트
curl http://localhost:3030/api/health
```

#### 6. 컨테이너 로그 확인
```bash
# 실시간 로그 확인
docker logs -f syncace

# 최근 로그 확인
docker logs --tail 100 syncace
```

#### 7. nginx 설정 확인
```bash
# nginx 설정 파일 확인
sudo cat /etc/nginx/sites-enabled/sync.coolsistema.com.conf

# nginx 설정 테스트
sudo nginx -t

# nginx 재시작 (필요시)
sudo systemctl restart nginx
```

### 일반적인 해결 방법

#### 방법 1: Docker 컨테이너 재시작
```bash
docker restart syncace
```

#### 방법 2: Docker Compose로 재시작
```bash
cd /path/to/node_js_svr_ace3
docker-compose restart
```

#### 방법 3: 완전 재시작 (컨테이너 재빌드)
```bash
cd /path/to/node_js_svr_ace3
docker-compose down
docker-compose up -d --build
```

#### 방법 4: 직접 Node.js 실행 (Docker 없이)
```bash
cd /path/to/node_js_svr_ace3
npm install
npm start
# 또는
node src/server.js
```

### 문제별 해결책

#### 문제 1: 컨테이너가 계속 종료됨
```bash
# 로그 확인
docker logs syncace

# 환경 변수 확인
docker exec syncace env

# .env 파일 확인
cat .env
```

#### 문제 2: 포트 충돌
```bash
# 다른 프로세스가 포트 3030을 사용하는지 확인
sudo lsof -i :3030

# 프로세스 종료 (필요시)
sudo kill -9 <PID>
```

#### 문제 3: nginx 설정 오류
```bash
# nginx 에러 로그 확인
sudo tail -f /var/log/nginx/error.log

# nginx 설정 파일 확인
sudo nano /etc/nginx/sites-enabled/sync.coolsistema.com.conf
```

### 빠른 복구 스크립트

원격 서버에서 실행:
```bash
#!/bin/bash
cd /path/to/node_js_svr_ace3

# 컨테이너 중지
docker-compose down

# 컨테이너 재시작
docker-compose up -d

# 상태 확인
sleep 5
docker ps | grep syncace
curl http://localhost:3030/api/health
```

### 모니터링

#### 실시간 모니터링
```bash
# 컨테이너 로그 실시간 확인
docker logs -f syncace

# 시스템 리소스 확인
docker stats syncace
```

#### 헬스체크
```bash
# 로컬에서 확인
curl http://localhost:3030/api/health

# 외부에서 확인
curl https://sync.coolsistema.com/api/health
```

