# 웹소켓 메시지 형식 가이드

## 개요

웹소켓 클라이언트는 데이터베이스 변경사항을 실시간으로 받을 수 있습니다. 이 문서는 클라이언트가 받는 메시지 형식을 설명합니다.

## 메시지 타입

### 1. 연결 확인 메시지

**타입**: `connected`

```json
{
  "type": "connected",
  "clientId": "client_1766513430055_2",
  "message": "WebSocket connection established"
}
```

### 2. 클라이언트 등록 확인 메시지

**타입**: `registered`

```json
{
  "type": "registered",
  "clientId": "client_1766513430055_2",
  "dbKey": "host.docker.internal:5432/ace17@ace",
  "sucursal": null
}
```

### 3. 데이터베이스 변경 알림 메시지

**타입**: `db-change`

#### API를 통한 변경 (Node.js API를 통해 변경된 경우)

```json
{
  "type": "db-change",
  "table": "codigos",
  "operation": "UPDATE",
  "data": [
    {
      "codigo": "ABC123",
      "id_codigo": 11341,
      "descripcion": "제품 설명",
      "pre1": 100.50,
      "pre2": 90.00,
      "pre3": 80.00,
      "pre4": null,
      "pre5": null,
      "preorg": 120.00,
      "utime": "2024-01-15T10:30:00.000Z",
      "borrado": false,
      "fotonombre": "product.jpg",
      "valor1": null,
      "valor2": null,
      "valor3": null,
      "pubip": null,
      "ip": null,
      "mac": null,
      "bmobile": false,
      "tipocodigo": "NORMAL",
      "ref_id_todocodigo": 123,
      "ref_id_color": 5,
      "str_talle": "M",
      "ref_id_temporada": 1,
      "ref_id_talle": 10,
      "utime_modificado": "2024-01-15T10:30:00.000Z",
      "id_codigo_centralizado": null,
      "id_woocommerce": null,
      "id_woocommerce_producto": null,
      "b_mostrar_vcontrol": true,
      "b_sincronizar_x_web": true,
      "codigoproducto": "PROD001",
      "d_oferta_mode": 0
    }
  ],
  "connectedClients": 1,
  "sucursal": null,
  "pagination": {
    "total": 1,
    "currentPage": 1,
    "pageSize": 20,
    "hasMore": false
  }
}
```

#### 트리거를 통한 변경 (데이터베이스에서 직접 변경된 경우)

```json
{
  "type": "db-change",
  "channel": "db_change_codigos_update",
  "table": "codigos",
  "operation": "UPDATE",
  "payload": "{\"codigo\":\"ABC123\",\"id_codigo\":11341,\"descripcion\":\"제품 설명\",\"pre1\":100.50,...}",
  "database": "ace17",
  "host": "host.docker.internal",
  "port": 5432,
  "pagination": {
    "total": 1,
    "currentPage": 1,
    "pageSize": 20,
    "hasMore": false
  }
}
```

**주의**: 트리거를 통한 변경의 경우 `payload`는 JSON 문자열입니다. 파싱이 필요합니다:

```javascript
const payload = JSON.parse(message.payload);
const codigo = payload.codigo;
const descripcion = payload.descripcion;
// ...
```

### 4. BATCH_SYNC 알림 메시지

**타입**: `db-change`

```json
{
  "type": "db-change",
  "table": "codigos",
  "operation": "BATCH_SYNC",
  "data": [
    {
      "codigo": "ABC123",
      "id_codigo": 11341,
      "descripcion": "제품 1",
      "pre1": 100.50
    },
    {
      "codigo": "DEF456",
      "id_codigo": 11342,
      "descripcion": "제품 2",
      "pre1": 200.00
    }
  ],
  "connectedClients": 1,
  "sucursal": null,
  "pagination": {
    "total": 2,
    "currentPage": 1,
    "pageSize": 20,
    "hasMore": false
  }
}
```

### 5. 페이지네이션 (20개 초과 시)

데이터가 20개를 초과하는 경우, 첫 번째 메시지에 `hasMore: true`가 포함됩니다:

```json
{
  "type": "db-change",
  "table": "codigos",
  "operation": "BATCH_SYNC",
  "data": [ /* 첫 20개 항목 */ ],
  "pagination": {
    "total": 50,
    "currentPage": 1,
    "pageSize": 20,
    "hasMore": true,
    "changeId": "codigos_BATCH_SYNC_1705312345678_abc123_client_123"
  }
}
```

추가 데이터를 받으려면 `fetch-more` 메시지를 보내야 합니다:

```json
{
  "type": "fetch-more",
  "action": "fetch-more",
  "changeId": "codigos_BATCH_SYNC_1705312345678_abc123_client_123",
  "page": 2
}
```

서버 응답:

```json
{
  "type": "fetch-more-response",
  "changeId": "codigos_BATCH_SYNC_1705312345678_abc123_client_123",
  "table": "codigos",
  "operation": "BATCH_SYNC",
  "data": [ /* 다음 20개 항목 */ ],
  "pagination": {
    "total": 50,
    "currentPage": 2,
    "pageSize": 20,
    "hasMore": true
  }
}
```

## 클라이언트 예제 코드

### Flutter/Dart 예제

```dart
import 'package:web_socket_channel/web_socket_channel.dart';

class DatabaseWebSocketClient {
  WebSocketChannel? _channel;
  
  void connect() {
    _channel = WebSocketChannel.connect(
      Uri.parse('wss://sync.coolsistema.com/api/ws'),
    );
    
    // 등록 메시지 전송
    _channel!.sink.add(jsonEncode({
      'type': 'register',
      'dbHost': 'localhost',
      'dbPort': '5432',
      'dbName': 'ace17',
      'dbUser': 'ace',
      'dbPassword': '1234',
      'clientId': 'my_client_id'
    }));
    
    // 메시지 수신
    _channel!.stream.listen((message) {
      final data = jsonDecode(message);
      
      if (data['type'] == 'db-change') {
        handleDatabaseChange(data);
      } else if (data['type'] == 'registered') {
        print('등록 완료: ${data['clientId']}');
      }
    });
  }
  
  void handleDatabaseChange(Map<String, dynamic> message) {
    final table = message['table'];
    final operation = message['operation'];
    
    if (table == 'codigos') {
      // API를 통한 변경
      if (message['data'] != null) {
        final items = message['data'] as List;
        for (var item in items) {
          print('Codigo 변경: ${item['codigo']}');
          print('설명: ${item['descripcion']}');
          print('가격1: ${item['pre1']}');
          print('작업: $operation');
        }
      }
      // 트리거를 통한 변경
      else if (message['payload'] != null) {
        final payload = jsonDecode(message['payload']);
        print('Codigo 변경 (트리거): ${payload['codigo']}');
        print('설명: ${payload['descripcion']}');
        print('가격1: ${payload['pre1']}');
        print('작업: $operation');
      }
    }
  }
}
```

### JavaScript/TypeScript 예제

```javascript
const ws = new WebSocket('wss://sync.coolsistema.com/api/ws');

ws.onopen = () => {
  // 등록 메시지 전송
  ws.send(JSON.stringify({
    type: 'register',
    dbHost: 'localhost',
    dbPort: '5432',
    dbName: 'ace17',
    dbUser: 'ace',
    dbPassword: '1234',
    clientId: 'my_client_id'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'db-change') {
    handleDatabaseChange(message);
  } else if (message.type === 'registered') {
    console.log('등록 완료:', message.clientId);
  }
};

function handleDatabaseChange(message) {
  const { table, operation, data, payload } = message;
  
  if (table === 'codigos') {
    // API를 통한 변경
    if (data && Array.isArray(data)) {
      data.forEach(item => {
        console.log('Codigo 변경:', item.codigo);
        console.log('설명:', item.descripcion);
        console.log('가격1:', item.pre1);
        console.log('작업:', operation);
        
        // UI 업데이트 또는 다른 처리
        updateUI(item, operation);
      });
    }
    // 트리거를 통한 변경
    else if (payload) {
      const item = typeof payload === 'string' ? JSON.parse(payload) : payload;
      console.log('Codigo 변경 (트리거):', item.codigo);
      console.log('설명:', item.descripcion);
      console.log('가격1:', item.pre1);
      console.log('작업:', operation);
      
      updateUI(item, operation);
    }
  }
}

function updateUI(item, operation) {
  // UI 업데이트 로직
  if (operation === 'UPDATE') {
    // 제품 정보 업데이트
  } else if (operation === 'CREATE') {
    // 새 제품 추가
  } else if (operation === 'DELETE') {
    // 제품 삭제
  }
}
```

## 메시지 필드 설명

### db-change 메시지 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | string | 항상 `"db-change"` |
| `table` | string | 변경된 테이블명 (예: `"codigos"`, `"todocodigos"`) |
| `operation` | string | 작업 유형 (`"CREATE"`, `"UPDATE"`, `"DELETE"`, `"BATCH_SYNC"`) |
| `data` | array | 변경된 데이터 배열 (API를 통한 변경 시) |
| `payload` | string | JSON 문자열 (트리거를 통한 변경 시) |
| `channel` | string | 트리거 채널명 (트리거를 통한 변경 시) |
| `connectedClients` | number | 연결된 클라이언트 수 |
| `sucursal` | number/null | 지점 번호 (필터링용) |
| `pagination` | object | 페이지네이션 정보 (20개 초과 시) |

### codigos 테이블 데이터 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `codigo` | string | 제품 코드 (Primary Key) |
| `id_codigo` | number | 제품 ID |
| `descripcion` | string | 제품 설명 |
| `pre1` | number | 가격 1 |
| `pre2` | number | 가격 2 |
| `pre3` | number | 가격 3 |
| `pre4` | number | 가격 4 |
| `pre5` | number | 가격 5 |
| `preorg` | number | 원가 |
| `utime` | string | 업데이트 시간 (ISO 8601) |
| `borrado` | boolean | 삭제 여부 |
| `fotonombre` | string | 사진 파일명 |
| `b_mostrar_vcontrol` | boolean | VControl 표시 여부 |
| `b_sincronizar_x_web` | boolean | 웹 동기화 여부 |
| 기타 필드 | - | 참고: `src/models/Codigos.js` |

## 주의사항

1. **트리거를 통한 변경**: `payload`는 JSON 문자열이므로 파싱이 필요합니다.
2. **페이지네이션**: 데이터가 20개를 초과하면 `fetch-more` 메시지를 보내 추가 데이터를 받아야 합니다.
3. **sucursal 필터링**: `codigos`와 `todocodigos` 테이블은 sucursal 필터링이 적용되지 않습니다 (모든 클라이언트에게 전송).
4. **연결 유지**: 서버가 60초마다 ping을 보내므로, 클라이언트는 pong으로 응답해야 합니다.


