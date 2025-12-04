# PostgreSQL 연결 풀 분석 및 개선 방안

## 현재 상황

### PostgreSQL 서버 설정
- **최대 연결 수**: 100개
- **현재 사용 중**: 92개 (92%)
- **Active**: 1개
- **Idle**: 3개
- **Idle in Transaction**: 0개

### Sequelize 연결 풀 설정
```javascript
pool: {
    max: 400,        // ⚠️ 문제: 서버 최대값(100)보다 훨씬 큼
    min: 0,
    idle: 10000,     // 10초 - 유휴 연결 유지 시간
    acquire: 60000,  // 60초 - 연결 획득 대기 시간
    evict: 1000,     // 1초 - 유휴 연결 체크 주기
    handleDisconnects: true
}
```

## 문제점 분석

### 1. Pool Max 값이 서버 한계보다 큼
- **현재**: Sequelize `pool.max = 400`
- **서버 한계**: PostgreSQL `max_connections = 100`
- **문제**: 여러 데이터베이스가 있으면 각각 최대 400개까지 시도할 수 있어 서버 한계를 쉽게 초과

### 2. 여러 데이터베이스 사용 시
- 각 데이터베이스마다 별도의 연결 풀 생성
- 각 풀이 최대 400개까지 시도 가능
- 예: 3개 데이터베이스 × 400개 = 최대 1200개 시도 (서버 한계 100개 초과)

### 3. 유휴 연결 관리
- `idle: 10000` (10초) - 유휴 연결이 10초간 유지됨
- 실제 사용은 Active 1개, Idle 3개뿐인데 총 92개 연결이 있음
- 대부분의 연결이 다른 애플리케이션이나 세션에서 사용 중일 가능성

## 개선 방안

### 1. Sequelize Pool Max 값 조정 (권장)

**방안 A: 환경 변수로 설정 가능하게**
```javascript
// 데이터베이스 개수를 고려한 동적 계산
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX) || 50;
// 또는 PostgreSQL 서버의 max_connections를 동적으로 가져와서 계산
```

**방안 B: 고정값으로 조정**
```javascript
pool: {
    max: 50,  // 데이터베이스당 최대 50개 (여러 DB 고려)
    min: 0,
    idle: 5000,  // 5초로 단축 (유휴 연결 빠른 정리)
    acquire: 60000,
    evict: 1000,
    handleDisconnects: true
}
```

### 2. 유휴 연결 관리 개선
- `idle` 시간을 10초 → 5초로 단축
- 불필요한 연결을 더 빠르게 정리

### 3. 모니터링 강화
- 각 데이터베이스별 연결 풀 사용량 모니터링
- 연결 풀 상태를 Telegram 알림에 포함

## 권장 설정

### 환경 변수 추가
```bash
# .env 파일에 추가
DB_POOL_MAX=50          # 데이터베이스당 최대 연결 수
DB_POOL_IDLE=5000       # 유휴 연결 유지 시간 (밀리초)
```

### 코드 수정
```javascript
pool: {
    max: parseInt(process.env.DB_POOL_MAX) || 50,
    min: 0,
    idle: parseInt(process.env.DB_POOL_IDLE) || 5000,
    acquire: 60000,
    evict: 1000,
    handleDisconnects: true
}
```

## 현재 상태 평가

### ✅ 잘 작동하는 부분
1. **연결 풀 재사용**: 동일한 DB 연결 정보는 재사용됨
2. **자동 재연결**: `handleDisconnects: true`로 연결 끊김 자동 처리
3. **에러 재시도**: 연결 실패 시 최대 3번 재시도
4. **모니터링**: Telegram 알림으로 연결 상태 추적

### ⚠️ 개선이 필요한 부분
1. **Pool Max 값**: 400 → 50 정도로 조정 필요
2. **Idle 시간**: 10초 → 5초로 단축 권장
3. **동적 조정**: PostgreSQL 서버의 max_connections에 맞게 자동 조정

## 결론

**현재 pool 조절은 부분적으로 잘 되고 있지만, 개선이 필요합니다.**

주요 문제:
- `pool.max = 400`이 PostgreSQL 서버 한계(100)보다 너무 큼
- 여러 데이터베이스 사용 시 각 풀이 독립적으로 작동하여 서버 한계 초과 가능

권장 조치:
1. `pool.max`를 50 정도로 조정
2. `idle` 시간을 5초로 단축
3. 환경 변수로 설정 가능하게 변경

