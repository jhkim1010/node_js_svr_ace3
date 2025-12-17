# 클라이언트 연결 종료 시 Connection Pool 관리

## 문제점

클라이언트가 요청 처리 중 연결을 끊으면 다음과 같은 문제가 발생할 수 있습니다:

1. **Connection Pool 낭비**: DB 연결이 이미 획득된 상태에서 클라이언트가 사라지면, 연결이 `idle in transaction` 상태가 될 수 있습니다.
2. **자동 정리 한계**: Sequelize의 `handleDisconnects: true`는 트랜잭션 중에는 제대로 작동하지 않을 수 있습니다.
3. **리소스 누수**: 트랜잭션이 완료되지 않으면 연결이 pool로 반환되지 않습니다.

## 해결 방안

### 1. 클라이언트 연결 종료 감지 미들웨어

모든 요청에 대해 클라이언트 연결 종료를 감지하는 미들웨어가 자동으로 적용됩니다:

```javascript
// src/middleware/client-disconnect-handler.js
// 자동으로 req에 클라이언트 연결 상태를 추적
```

### 2. 트랜잭션 사용 시 처리 방법

트랜잭션을 사용하는 라우터에서는 다음과 같이 처리합니다:

```javascript
const { handleClientDisconnect } = require('../utils/transaction-helper');

router.post('/', async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
        // 작업 수행...
        
        // 클라이언트 연결 종료 체크 (주요 작업 전후)
        if (await handleClientDisconnect(req, transaction)) {
            return; // 클라이언트 연결이 끊어졌으면 조기 종료
        }
        
        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        await safeRollback(transaction);
        throw err;
    }
});
```

### 3. 일반 쿼리 사용 시 처리 방법

트랜잭션을 사용하지 않는 경우 (예: `resumen_del_dia`):

```javascript
const { isClientDisconnected } = require('../middleware/client-disconnect-handler');

router.post('/', async (req, res) => {
    try {
        // 클라이언트 연결 종료 체크
        if (isClientDisconnected(req)) {
            return; // 클라이언트 연결이 끊어졌으면 조기 종료
        }
        
        const result = await Model.findAll();
        res.json(result);
    } catch (err) {
        // 에러 처리...
    }
});
```

## 작동 원리

1. **미들웨어 레벨**: `clientDisconnectHandler`가 모든 요청에 대해 클라이언트 연결 상태를 모니터링합니다.
2. **이벤트 감지**: `req.aborted`, `req.socket.destroyed`, `req.socket.close` 등의 이벤트를 감지합니다.
3. **플래그 설정**: 클라이언트 연결이 끊어지면 `req._clientDisconnected = true`로 설정됩니다.
4. **조기 종료**: 라우터에서 `isClientDisconnected(req)` 또는 `handleClientDisconnect(req, transaction)`를 호출하여 조기 종료합니다.

## Sequelize Pool 설정

현재 설정:

```javascript
pool: {
    max: poolMax,
    min: 0,                    // 사용하지 않을 때 연결을 닫음
    idle: 5000,                // 유휴 연결 유지 시간 (5초)
    acquire: 60000,            // 연결 획득 대기 시간 (60초)
    evict: 1000,               // 유휴 연결 체크 주기 (1초)
    handleDisconnects: true    // 연결 끊김 자동 처리
}
```

## 모니터링

클라이언트 연결 종료가 감지되면 로그가 출력됩니다:

```
[Client Disconnect] 트랜잭션 롤백 완료 (연결 풀 해제)
```

## 주의사항

1. **트랜잭션 사용 시**: 반드시 `handleClientDisconnect`를 호출하여 트랜잭션을 롤백해야 합니다.
2. **긴 작업**: 여러 쿼리를 실행하는 경우, 각 쿼리 실행 전에 클라이언트 연결 상태를 체크하는 것이 좋습니다.
3. **에러 처리**: 클라이언트 연결 종료는 에러가 아니므로, 에러 핸들러에서 처리하지 않습니다.

## 개선 효과

- ✅ Connection Pool 낭비 방지
- ✅ `idle in transaction` 상태 방지
- ✅ 리소스 누수 방지
- ✅ 자동 정리 보장

