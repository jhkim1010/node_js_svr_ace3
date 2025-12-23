# 데이터베이스 트리거 설정 가이드

## 문제 상황

Flutter 앱에서 직접 데이터베이스를 변경할 때, Node.js 서버를 거치지 않기 때문에 웹소켓 알림이 발생하지 않습니다. 이로 인해 다른 앱들이 실시간으로 변경사항을 감지하지 못합니다.

## 해결 방법

PostgreSQL 트리거를 사용하여 데이터베이스 레벨에서 변경사항을 감지하고, 자동으로 NOTIFY를 발생시켜 웹소켓을 통해 알림을 전송합니다.

## Codigos 테이블 트리거 설정

### 1. 스크립트 실행

PostgreSQL 데이터베이스에 연결하여 다음 스크립트를 실행하세요:

```bash
psql -U your_username -d your_database -f scripts/create-codigos-triggers.sql
```

또는 psql 콘솔에서:

```sql
\i scripts/create-codigos-triggers.sql
```

### 2. 트리거 확인

트리거가 제대로 생성되었는지 확인:

```sql
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'codigos'
ORDER BY trigger_name;
```

다음 3개의 트리거가 생성되어야 합니다:
- `codigos_insert_trigger` (INSERT 작업 감지)
- `codigos_update_trigger` (UPDATE 작업 감지)
- `codigos_delete_trigger` (DELETE 작업 감지)

### 3. 테스트

트리거가 제대로 작동하는지 테스트:

```sql
-- 테스트 INSERT
INSERT INTO codigos (codigo, descripcion, pre1) 
VALUES ('TEST001', 'Test Product', 100.0);

-- 테스트 UPDATE
UPDATE codigos SET pre1 = 150.0 WHERE codigo = 'TEST001';

-- 테스트 DELETE
DELETE FROM codigos WHERE codigo = 'TEST001';
```

웹소켓으로 연결된 클라이언트들이 이러한 변경사항을 실시간으로 받아야 합니다.

## 작동 원리

1. **트리거 함수**: `codigos` 테이블에 INSERT/UPDATE/DELETE 작업이 발생하면 트리거 함수가 자동 실행됩니다.

2. **NOTIFY 발생**: 트리거 함수는 `pg_notify()`를 사용하여 다음 채널로 알림을 전송합니다:
   - `db_change_codigos_insert`
   - `db_change_codigos_update`
   - `db_change_codigos_delete`

3. **웹소켓 전송**: Node.js 서버의 `websocket-service.js`가 이러한 채널을 LISTEN하고 있으며, 알림을 받으면 웹소켓을 통해 연결된 모든 클라이언트에게 브로드캐스트합니다.

## 주의사항

- 트리거는 데이터베이스 레벨에서 작동하므로, 어떤 클라이언트(Flutter 앱, 다른 Node.js 앱, 직접 SQL 실행 등)에서 변경하더라도 알림이 발생합니다.
- 트리거는 성능에 약간의 오버헤드를 추가할 수 있지만, 일반적으로 미미한 수준입니다.
- 트리거 함수는 변경된 행의 전체 데이터를 JSON으로 직렬화하여 전송합니다.

## 트리거 제거 (필요시)

트리거를 제거하려면:

```sql
DROP TRIGGER IF EXISTS codigos_insert_trigger ON codigos;
DROP TRIGGER IF EXISTS codigos_update_trigger ON codigos;
DROP TRIGGER IF EXISTS codigos_delete_trigger ON codigos;
```

## 다른 테이블에도 적용하기

다른 테이블(`todocodigos`, `gastos` 등)에도 동일한 트리거를 적용하려면, `create-codigos-triggers.sql` 파일을 참고하여 해당 테이블에 맞게 수정하여 사용하세요.

