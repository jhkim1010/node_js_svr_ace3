# WebSocket 다중 데이터베이스 연결 분석

## 현재 구조 분석

### dbKey 생성 방식
```javascript
dbKey = `${host}:${port}/${database}@${user}`
// 예: "host.docker.internal:5432/mydb@postgres"
```

### 클라이언트 그룹 관리
- `dbClientGroups`: dbKey별로 클라이언트 그룹 관리
- 같은 dbKey를 가진 클라이언트들은 같은 그룹에 속함
- 브로드캐스트는 특정 dbKey의 그룹에만 전송

## 안전한 시나리오 ✅

### 1. 같은 database, 같은 user
- **dbKey**: `host:port/database@user` (동일)
- **결과**: 같은 그룹에 속함, 정상 동작 ✅
- **예시**: 
  - 클라이언트 A: database="mydb", user="postgres" → dbKey="host:5432/mydb@postgres"
  - 클라이언트 B: database="mydb", user="postgres" → dbKey="host:5432/mydb@postgres"
  - → 같은 그룹, 같은 변경사항 수신

### 2. 다른 database, 같은 user
- **dbKey**: `host:port/database@user` (다름)
- **결과**: 다른 그룹에 속함, 정상 동작 ✅
- **예시**:
  - 클라이언트 A: database="mydb1", user="postgres" → dbKey="host:5432/mydb1@postgres"
  - 클라이언트 B: database="mydb2", user="postgres" → dbKey="host:5432/mydb2@postgres"
  - → 다른 그룹, 각자의 변경사항만 수신

### 3. 같은 database, 다른 user
- **dbKey**: `host:port/database@user` (다름)
- **결과**: 다른 그룹에 속함, 의도된 동작 ✅
- **예시**:
  - 클라이언트 A: database="mydb", user="user1" → dbKey="host:5432/mydb@user1"
  - 클라이언트 B: database="mydb", user="user2" → dbKey="host:5432/mydb@user2"
  - → 다른 그룹, 각자의 변경사항만 수신 (user별 권한 분리)

## 잠재적 문제점 ⚠️

### 1. clientId 중복 가능성
**문제**: 여러 클라이언트가 같은 `clientId`를 사용할 경우
- `excludeClientId`로 제외할 때 다른 클라이언트도 제외될 수 있음
- **현재 보완**: `ws.id`는 고유하므로 실제로는 문제 없음
- **권장**: 클라이언트가 고유한 `clientId` 사용

### 2. host/port 기본값 강제 설정
**문제**: 모든 클라이언트가 같은 host/port를 사용
- 실제로는 다른 데이터베이스 서버에 연결하려는 클라이언트들이 같은 dbKey를 가질 수 있음
- **현재 상황**: 단일 데이터베이스 서버 환경에서는 문제 없음
- **다중 서버 환경**: host/port를 클라이언트가 지정할 수 있어야 함

### 3. dbKey 없이 등록 시도
**문제**: `database`나 `user`가 없으면 등록 실패
- **현재 처리**: 등록 실패, 오류 메시지 전송 ✅

### 4. 같은 클라이언트가 여러 database에 연결
**문제**: 하나의 WebSocket 연결로 여러 database를 등록할 수 없음
- **현재 구조**: 하나의 WebSocket 연결 = 하나의 database
- **해결책**: 여러 database에 연결하려면 여러 WebSocket 연결 필요

## 현재 구조의 안전성 평가

### ✅ 안전한 부분
1. **dbKey 기반 격리**: 다른 database의 클라이언트는 완전히 분리됨
2. **브로드캐스트 필터링**: dbKey별로 정확히 전송됨
3. **sucursal 필터링**: 테이블별로 추가 필터링 적용
4. **고유 ID**: `ws.id`는 서버에서 자동 생성되어 고유함

### ⚠️ 주의사항
1. **clientId 중복**: 클라이언트가 같은 `clientId`를 사용하지 않도록 주의
2. **단일 서버 가정**: 현재는 단일 데이터베이스 서버 환경에 최적화됨
3. **연결 해제**: 클라이언트 연결 해제 시 그룹에서 자동 제거됨

## 권장 사항

### 1. 클라이언트 ID 관리
```javascript
// 클라이언트가 고유한 ID 사용 권장
{
  "type": "register-client",
  "clientId": "unique_client_id_" + Date.now() + "_" + Math.random(),
  "database": "mydb",
  "user": "postgres"
}
```

### 2. 다중 데이터베이스 서버 지원 (향후)
현재는 단일 서버 환경에 최적화되어 있지만, 다중 서버를 지원하려면:
- 클라이언트가 host/port를 지정할 수 있도록 변경
- 또는 database 이름에 서버 정보 포함

### 3. 연결 상태 모니터링
서버 로그에서 각 클라이언트의 dbKey와 그룹 크기를 확인할 수 있음:
```
[WebSocket] ✅ 클라이언트 등록됨: id=xxx, clientId=yyy, dbKey=zzz, group size=N
```

## 결론

**현재 구조는 안전합니다!** ✅

- 다른 database의 클라이언트는 완전히 분리됨
- 같은 database의 클라이언트만 같은 변경사항을 받음
- 브로드캐스트는 정확히 해당 database의 클라이언트에게만 전송됨
- 혼돈을 일으킬 가능성은 매우 낮음

단, 클라이언트가 고유한 `clientId`를 사용하도록 권장합니다.

