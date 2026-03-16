# WebSocket 클라이언트 가이드

클라이언트에서 이 서버의 WebSocket을 사용해 **실시간 DB 변경 알림**을 받기 위해 알아야 할 내용을 정리한 문서입니다.

---

## 1. 개요

- **프로토콜**: 표준 **WebSocket** (Socket.IO 아님)
- **역할**: 같은 데이터베이스에 연결된 클라이언트끼리, API 또는 DB 트리거로 인한 테이블 변경을 실시간으로 공유
- **전송 범위**: 동일 `dbKey`(DB 연결 식별자)로 등록된 클라이언트에게만 전송. 변경을 일으킨 클라이언트는 선택적으로 제외 가능

---

## 2. 연결

### 2.1 URL

다음 두 경로 모두 사용 가능합니다.

- `ws://<호스트>/ws`
- `ws://<호스트>/api/ws`

HTTPS 환경에서는 `wss://` 로 연결하세요.

예:

- 로컬: `ws://localhost:3000/ws` 또는 `ws://localhost:3000/api/ws`
- 운영: `wss://sync.example.com/api/ws`

### 2.2 연결 직후

연결이 성립되면 서버가 **한 번** 다음 메시지를 보냅니다.

```json
{
  "type": "connected",
  "clientId": "client_1766513430055_2",
  "message": "WebSocket connection established"
}
```

- `clientId`: 서버가 부여한 소켓 식별자. 등록 전에는 이 값이 임시 ID로 쓰일 수 있음.
- **DB 변경 알림을 받으려면 반드시 아래 “클라이언트 등록”을 해야 합니다.** 등록 전에는 어떤 테이블 알림도 오지 않습니다.

### 2.3 접속 순서 (클라이언트가 할 일)

아래 순서대로 하면 서버 로그에 성공 메시지가 찍힙니다.

| 순서 | 클라이언트 동작 | 서버 로그 (성공 시) |
|------|-----------------|---------------------|
| 1 | `wss://sync.coolsistema.com/api/ws` 로 **연결** (쿼리 없이/있어도 됨) | `[WebSocket] upgrade 요청 수신: url=/api/ws, Upgrade=websocket, Connection=upgrade` |
| 2 | (연결 수립) | `[WebSocket] ✅ 클라이언트 연결됨: id=client_..., url=/api/ws` |
| 3 | (서버가 먼저 보냄) **첫 메시지** 수신 → `type` 이 `connected` 인지 확인 | `[WebSocket] 메시지 전송됨: type=connected, clientId=...` |
| 4 | **즉시** `register-client` 전송 (database, user 필수) | - |
| 5 | (서버 응답) `type: registered` 수신 | `[WebSocket] ✅ 클라이언트 등록됨: id=..., dbKey=..., tables=[...], group size=...` |

**접속 URL**: `wss://sync.coolsistema.com/api/ws`

**등록 메시지 예시** (`connected` 를 받은 뒤 한 번만 보내기):

```json
{"type": "register-client", "database": "kimah14", "user": "kimah"}
```

필요 시 `clientId`, `sucursal`, `subscribedTables` 추가.

### 2.4 연결이 안 될 때

- **`upgrade 요청 수신` 로그가 없음** → 요청이 Node까지 안 옴. Nginx/방화벽 확인. [NGINX_WEBSOCKET_SETUP.md](../NGINX_WEBSOCKET_SETUP.md) 참고.
- **`upgrade 요청 수신` 은 있는데 `클라이언트 연결됨` 없음** → `verifyClient` 거절. 로그에 `지원하지 않는 경로` / `유효하지 않은 Upgrade 헤더` 확인.
- **`클라이언트 연결됨` 까지 있는데 `클라이언트 등록됨` 없음** → 클라이언트가 `connected` 수신 후 `register-client` 를 안 보냄. 또는 `database`/`user` 오류. 서버는 `type: error` 로 응답.

---

## 3. 클라이언트 등록 (필수)

DB 변경 알림을 받으려면 연결 후 **등록 메시지**를 보내야 합니다.

### 3.1 보낼 메시지

**타입** (둘 중 하나):

- `type: "register-client"`
- 또는 `type: "register"` (동일하게 처리)

**필드**:

| 필드 | 필수 | 설명 |
|------|------|------|
| `database` / `dbName` / `db_name` | ○ (dbKey 없을 때) | DB 이름 |
| `user` / `dbUser` / `db_user` | ○ (dbKey 없을 때) | DB 사용자 |
| `dbKey` | 선택 | 이미 알고 있다면 `host:port/database@user` 형식으로 보내면 됨. 있으면 `database`/`user` 무시 |
| `clientId` | 선택 | 클라이언트가 쓰고 싶은 ID. 없으면 서버가 부여한 `clientId`(연결 시 받은 값) 사용. API 요청 시 `X-Client-ID`로 이 값을 보내면, 해당 요청으로 인한 알림을 본인에게는 안 보내도록 할 수 있음 |
| `sucursal` | 선택 | 지점 번호(숫자). 알림 필터링에 사용됨. 없으면 `null`로 “전체”로 취급 |
| `subscribedTables` | 선택 | 수신할 테이블 이름 배열 (예: `["codigos","todocodigos"]`). 생략 시 모든 테이블 구독. [§5.1](#51-연결별-테이블-구독-activar--desactivar) 참고 |

**참고**: `dbHost`, `dbPort` 등은 서버에서 **사용하지 않습니다.** 서버가 자신의 기본 호스트/포트로 `dbKey`를 만들기 때문에, 클라이언트는 `database` + `user` (또는 `dbKey`)만 맞추면 됩니다.

### 3.2 등록 요청 예시

```json
{
  "type": "register-client",
  "database": "ace17",
  "user": "ace",
  "clientId": "my_app_001",
  "sucursal": 1
}
```

또는 `dbKey`를 이미 알고 있는 경우:

```json
{
  "type": "register-client",
  "dbKey": "127.0.0.1:5432/ace17@ace",
  "clientId": "my_app_001",
  "sucursal": 1
}
```

### 3.3 등록 응답

성공 시:

```json
{
  "type": "registered",
  "clientId": "my_app_001",
  "dbKey": "127.0.0.1:5432/ace17@ace",
  "sucursal": 1
}
```

실패 시 (예: dbKey를 만들 수 없는 경우):

```json
{
  "type": "error",
  "message": "Failed to register client: dbKey generation failed"
}
```

등록이 성공한 뒤부터 해당 `dbKey`에 대한 DB 변경 알림을 받을 수 있습니다.

---

## 4. 수신 메시지 정리

클라이언트가 받을 수 있는 메시지 타입은 다음과 같습니다.

| type | 설명 |
|------|------|
| `connected` | 연결 직후 1회 |
| `registered` | 등록 성공 시 1회 |
| `error` | 오류 (등록 실패, 잘못된 메시지 등) |
| `db-change` | 테이블 변경 알림 (CREATE/UPDATE/DELETE/BATCH_SYNC) |
| `fetch-more-response` | `fetch-more` 요청에 대한 추가 데이터 페이지 |
| `subscription-updated` | `update-subscription` 적용 후 서버가 보내는 구독 확정 |

자세한 JSON 예시와 필드 설명은 ** [WEBSOCKET_MESSAGE_FORMAT.md](./WEBSOCKET_MESSAGE_FORMAT.md)** 를 참고하세요.

### 4.1 db-change 공통 구조

- `table`: 테이블명 (예: `codigos`, `todocodigos`, `ingresos` …)
- `operation`: `"CREATE"` | `"UPDATE"` | `"DELETE"` | `"BATCH_SYNC"`
- `data`: 변경된 레코드 배열 (API 경로 알림일 때)
- `payload`: 트리거 알림일 때 JSON **문자열** 한 개 (파싱 필요)
- `connectedClients`: 해당 DB에 연결된 클라이언트 수
- `sucursal`: 알림 데이터의 지점 번호 (없으면 null)
- `pagination`: 항목이 20개 초과일 때 페이지 정보 및 `changeId` (아래 “페이지네이션” 참고)

트리거 알림은 `channel`, `database`, `host`, `port` 등이 붙을 수 있습니다. 클라이언트는 `table` + `operation` + `data` 또는 `payload`만 있어도 처리 가능합니다.

---

## 5. 알림이 오는 테이블 (서버 지원 목록)

아래 테이블에 대해 API 또는 DB 트리거로 변경이 발생하면, 같은 `dbKey`로 등록된 클라이언트에게 알림이 갑니다.

- vcodes, vdetalle, ingresos, codigos, todocodigos  
- parametros, gasto_info, gastos, color, creditoventas  
- clientes, tipos, vtags, online_ventas, logs  
- temporadas, cuentas  
- vendedores, fventas, senias_vinculados  

클라이언트 config에서 **enabled** 로 리스닝할 테이블을 정할 때, 위 목록에 있는 테이블만 WebSocket 구독이 의미 있습니다. [§5.2](#52-클라이언트-configjson-연동) 참고.

---

## 5.1 연결별 테이블 구독 (activar / desactivar)

각 연결마다 **어떤 테이블의 알림을 받을지** 켜거나 끌 수 있습니다.  
등록 시 또는 등록 후에 **구독 테이블 목록**을 지정하면, 그 테이블에 대한 `db-change`만 해당 연결로 전송됩니다.

### 방식 요약

| 방식 | 용도 |
|------|------|
| **등록 시 `subscribedTables`** | 처음부터 받을 테이블만 지정 |
| **`update-subscription`** | 연결된 뒤 구독 목록을 통째로 갱신 (activar/desactivar = 목록에서 추가/제거 후 전송) |

- **`subscribedTables`를 보내지 않거나 빈 배열이 아닌 “없음”**이면 → **모든 테이블** 구독 (기존 동작 유지).
- **`subscribedTables`를 배열로 보내면** → **그 테이블들만** 알림 수신.  
  - activar: 구독 목록에 테이블명 추가 후 `update-subscription` 전송.  
  - desactivar: 구독 목록에서 테이블명 제거 후 `update-subscription` 전송.

### 구독 가능한 테이블명

아래 이름만 유효합니다. 오타나 목록에 없는 이름은 서버에서 무시됩니다.

`vcodes`, `vdetalle`, `ingresos`, `codigos`, `todocodigos`, `parametros`, `gasto_info`, `gastos`, `color`, `creditoventas`, `clientes`, `tipos`, `vtags`, `online_ventas`, `logs`, `temporadas`, `cuentas`, `vendedores`, `fventas`, `senias_vinculados`

### 등록 시 구독 지정

등록 메시지에 **선택 필드** `subscribedTables`를 넣습니다.

```json
{
  "type": "register-client",
  "database": "ace17",
  "user": "ace",
  "clientId": "my_app_001",
  "sucursal": 1,
  "subscribedTables": ["codigos", "todocodigos", "ingresos"]
}
```

- `subscribedTables` **없음** → 모든 테이블 구독 (기존과 동일).
- `subscribedTables: []` → 서버 구현에 따라 “전부” 또는 “없음”으로 해석 가능하므로, “전부 받기”는 필드 생략 권장.
- `subscribedTables: ["codigos", "todocodigos"]` → 이 두 테이블 알림만 수신.

### 등록 후 구독 변경 (update-subscription)

이미 등록된 연결에서 **구독 목록만 바꿀 때** 사용합니다.  
activar/desactivar는 모두 “원하는 최종 목록”을 보내는 방식입니다.

**요청 (클라이언트 → 서버)**

```json
{
  "type": "update-subscription",
  "subscribedTables": ["codigos", "todocodigos", "ingresos", "clientes"]
}
```

- `subscribedTables`: **현재 구독할 테이블 이름 배열.** 이 목록으로 기존 구독을 **완전히 교체**합니다.
- 특정 테이블 **activar**: 기존 목록에 테이블을 추가한 새 배열을 보냅니다.
- 특정 테이블 **desactivar**: 기존 목록에서 해당 테이블을 뺀 새 배열을 보냅니다.
- **전부 받기**: 이 메시지 대신 `subscribedTables`를 비우거나 보내지 않는 방식은 서버 구현에 따름. 권장: “전부”를 원하면 등록 시처럼 `update-subscription`에서 서버가 정의한 “전체 목록” 또는 특별 값(예: `null`)을 문서에 명시해 사용.

**응답 (서버 → 클라이언트)**

```json
{
  "type": "subscription-updated",
  "subscribedTables": ["codigos", "todocodigos", "ingresos", "clientes"]
}
```

에러 시(예: 등록 전에 보낸 경우) `type: "error"`, `message: "..."` 로 응답합니다.

### 클라이언트 구현 팁

- 앱에서 “이 연결이 구독 중인 테이블 목록”을 상태로 갖고,
  - **activar**: 목록에 추가 → `update-subscription`에 새 목록 전송.
  - **desactivar**: 목록에서 제거 → `update-subscription`에 새 목록 전송.
- 재연결 시에는 **등록 메시지에 `subscribedTables`를 다시 넣어** 동일한 구독을 유지하는 것이 안전합니다.

---

## 5.2 클라이언트 config.json 연동

클라이언트가 `config.json`으로 테이블별 **enabled** / **sucursal_numero** 를 두고 WebSocket 리스닝 여부를 정하는 경우, 아래처럼 서버와 맞추면 됩니다.

### config 예시

```json
{
  "temporadas": { "enabled": true },
  "tipos": { "enabled": true },
  "color": { "enabled": true },
  "todocodigos": { "enabled": true },
  "codigos": { "enabled": true },
  "clientes": { "enabled": false, "sucursal_numero": 1 },
  "vendedores": { "enabled": true, "sucursal_numero": 1 },
  "cuentas": { "enabled": true, "sucursal_numero": 1 },
  "vcodes": { "enabled": false, "sucursal_numero": 1 },
  "ingresos": { "enabled": false, "sucursal_numero": 2 },
  "logs": { "enabled": false, "sucursal_numero": 1 }
}
```

### 서버 지원 여부 (테이블 매핑)

| config 테이블 | 서버 WebSocket 지원 | 비고 |
|---------------|---------------------|------|
| temporadas, tipos, color, todocodigos, codigos | ✅ | 구독·알림 지원 |
| clientes, cuentas, vendedores, vcodes, vdetalle | ✅ | 구독·알림 지원 |
| ingresos, logs, gasto_info, gastos, creditoventas | ✅ | 구독·알림 지원 |
| online_ventas, vtags, parametros | ✅ | 구독·알림 지원 |
| fventas, senias_vinculados | ✅ | 구독·알림 지원 |
| **movidos** | ❌ (WebSocket 없음) | REST 전용 fetch API. config에 넣어도 WS 구독 대상 아님 |
| **empresas** | ❌ | 현재 서버에 WS 알림 없음 |
| **cobranzacab**, **cobdetalles** | ❌ | 현재 서버에 WS 알림 없음 |

- **enabled: true** 인 테이블만 `subscribedTables`에 넣고, 그 중 **서버 지원 목록(§5)** 에 있는 것만 전송하는 것을 권장합니다.
- **movidos** 는 WebSocket이 없으므로 config에서 enabled 해도 REST로만 사용하면 됩니다.

### subscribedTables 만들기

config에서 **enabled: true** 이고, **서버가 지원하는 테이블**만 골라서 등록/구독에 사용하면 됩니다.

```javascript
// 예: config에서 enabled인 테이블 중 서버 지원 테이블만
const SERVER_WS_TABLES = ['vcodes','vdetalle','ingresos','codigos','todocodigos','parametros','gasto_info','gastos','color','creditoventas','clientes','tipos','vtags','online_ventas','logs','temporadas','cuentas','vendedores','fventas','senias_vinculados'];

function getSubscribedTablesFromConfig(configTables) {
  return Object.entries(configTables || {})
    .filter(([_, v]) => v && v.enabled === true)
    .map(([table]) => table.toLowerCase())
    .filter(t => SERVER_WS_TABLES.includes(t));
}

// 등록 시
const subscribedTables = getSubscribedTablesFromConfig(config.tables);
ws.send(JSON.stringify({
  type: 'register-client',
  database: 'ace17',
  user: 'ace',
  clientId: 'my_app',
  sucursal: 1,  // 아래 참고
  subscribedTables: subscribedTables.length ? subscribedTables : undefined  // 비면 전체 구독
}));
```

### sucursal (config의 sucursal_numero)

- 서버는 **연결당 하나의 sucursal** 만 가집니다. (`register-client` / `update-subscription` 에서는 연결 단위 `sucursal` 만 지원.)
- config는 테이블별 **sucursal_numero** 를 가질 수 있으므로:
  - **방법 A**: 연결 하나만 쓰고, 그 연결의 `sucursal` 에는 “주로 쓰는” 지점 하나(예: 첫 번째 sucursal_numero)를 넣고, 나머지 테이블/지점은 클라이언트에서 **수신한 db-change 의 sucursal 과 config의 sucursal_numero 를 비교해 필터링**.
  - **방법 B**: 지점마다 WebSocket 연결을 따로 두고, 각 연결에 해당 지점의 `sucursal` 을 넣어 등록. (지점별로 다른 알림만 받고 싶을 때 유리.)

---

## 6. sucursal(지점) 필터링

알림을 “어떤 클라이언트에게 보낼지”는 테이블별로 다릅니다.

- **codigos, todocodigos, tipos, color**  
  - sucursal 무관. 같은 `dbKey`면 **모든** 등록 클라이언트에게 전송.

- **ingresos**  
  - 클라이언트가 **특정 sucursal로 등록**된 경우: 알림 데이터의 `sucursal`과 **일치할 때만** 수신.  
  - 클라이언트가 sucursal 없이 등록된 경우: ingresos 알림은 **받지 않음**.

- **그 외 테이블**  
  - 클라이언트가 **sucursal로 등록**된 경우: 알림의 `sucursal`과 일치할 때만 수신.  
  - 클라이언트가 sucursal 없이 등록된 경우: **모든** sucursal 알림 수신.  
  - 알림에 sucursal이 없으면: 모든 클라이언트에게 전송.

정리하면, “특정 지점만 보고 싶다”면 등록 시 `sucursal`을 넣고, “전부 보고 싶다”면 `sucursal`을 생략하거나 null로 두면 됩니다.

---

## 7. 페이지네이션 (20개 초과 시)

한 번에 보내는 변경 데이터는 최대 **20건**입니다. 20건을 넘으면:

- 첫 번째 `db-change`에 `pagination.hasMore: true`와 `pagination.changeId`가 포함됩니다.
- 나머지 데이터를 받으려면 클라이언트가 **fetch-more**를 보내야 합니다.

### 7.1 fetch-more 요청 (클라이언트 → 서버)

```json
{
  "type": "fetch-more",
  "changeId": "codigos_BATCH_SYNC_1705312345678_abc123_client_123",
  "page": 2
}
```

- `changeId`: 첫 번째 `db-change`의 `pagination.changeId`와 동일해야 함.
- `page`: 2부터 시작. 다음 페이지 요청 시 3, 4, … 로 증가.

`action: "fetch-more"` 형태도 지원됩니다.

### 7.2 fetch-more 응답 (서버 → 클라이언트)

```json
{
  "type": "fetch-more-response",
  "changeId": "codigos_BATCH_SYNC_1705312345678_abc123_client_123",
  "table": "codigos",
  "operation": "BATCH_SYNC",
  "data": [ /* 해당 페이지의 레코드들 */ ],
  "pagination": {
    "total": 50,
    "currentPage": 2,
    "pageSize": 20,
    "hasMore": true
  }
}
```

`hasMore: false`가 나올 때까지 같은 `changeId`로 `page`를 올려가며 요청하면 됩니다.

---

## 8. 연결 유지 (Ping / Pong)

- 서버가 약 **30초마다** ping을 보냅니다.
- 브라우저의 표준 WebSocket은 ping에 자동으로 pong으로 응답하므로, 별도 구현이 필요 없습니다.
- 비브라우저 클라이언트는 가능하면 ping 수신 시 pong 응답을 해 주는 것이 좋습니다. 그렇지 않으면 일정 시간 후 서버가 연결을 끊을 수 있습니다.

---

## 9. 클라이언트 구현 시 체크리스트

1. **연결**: `ws://.../ws` 또는 `.../api/ws` 로 표준 WebSocket 연결.
2. **등록**: `connected` 수신 후 `register-client`(또는 `register`) 로 `database`+`user` 또는 `dbKey` 전달. 필요 시 `clientId`, `sucursal`, `subscribedTables` 포함.
3. **테이블 구독**: 특정 테이블만 받으려면 등록 시 `subscribedTables` 지정. 연결 후 변경 시 `update-subscription` 으로 목록 갱신 (§5.1).
4. **알림 처리**: `type === 'db-change'` 인 메시지에서 `table`, `operation`, `data`(또는 `payload` 파싱) 로 UI/캐시 갱신.
5. **페이지네이션**: `db-change`의 `pagination.hasMore === true` 이면 `changeId`를 저장해 두고, `fetch-more`로 `page` 2, 3, … 요청 후 `fetch-more-response`로 이어받기.
6. **에러**: `type === 'error'` 처리 및 필요 시 재연결·재등록.
7. **재연결**: 끊긴 뒤 다시 연결하면 **반드시 다시 등록**해야 알림을 받을 수 있음.

---

## 10. Python 클라이언트 예제

클라이언트가 Python인 경우 `websocket-client` 또는 `websockets` 라이브러리를 사용할 수 있습니다.

**의존성**: `pip install websocket-client`

```python
import json
import websocket

WS_URL = "wss://sync.coolsistema.com/api/ws"

def on_message(ws, message):
    data = json.loads(message)
    msg_type = data.get("type")
    if msg_type == "connected":
        # 연결 직후: 등록 메시지 전송
        ws.send(json.dumps({
            "type": "register-client",
            "database": "ace17",
            "user": "ace",
            "clientId": "my_python_client",
            "sucursal": 1,
            "subscribedTables": ["codigos", "todocodigos", "ingresos"]
        }))
    elif msg_type == "registered":
        print("등록 완료:", data.get("clientId"), "tables:", data.get("subscribedTables"))
    elif msg_type == "db-change":
        table = data.get("table")
        operation = data.get("operation")
        items = data.get("data") or ([] if not data.get("payload") else [json.loads(data["payload"])])
        for item in (items if isinstance(items, list) else [items]):
            print(f"[{table}] {operation}:", item.get("codigo") or item.get("tcodigo") or item)
    elif msg_type == "error":
        print("에러:", data.get("message"))

def on_error(ws, error):
    print("WebSocket 오류:", error)

def on_close(ws, close_status_code, close_msg):
    print("연결 종료:", close_status_code, close_msg)

def on_open(ws):
    print("연결됨. connected 메시지 대기 중...")

if __name__ == "__main__":
    ws = websocket.WebSocketApp(
        WS_URL,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close
    )
    ws.run_forever()
```

- 서버가 **30초마다 ping**을 보내므로, `websocket-client`는 기본적으로 pong을 응답합니다.
- **재연결** 시에는 다시 `connected` → `register-client` 순서로 보내면 됩니다.
- **config에서 enabled인 테이블만** `subscribedTables`에 넣어서 보내면 됩니다 (§5.2).

---

## 11. 참고 문서

- **[WEBSOCKET_MESSAGE_FORMAT.md](./WEBSOCKET_MESSAGE_FORMAT.md)**  
  수신/발신 메시지의 상세 필드, codigos 예시, Flutter/JavaScript 예제 코드 등.

- API에서 “이 요청을 한 클라이언트에게는 알림을 보내지 않으려면” 해당 API 요청에 **헤더 `X-Client-ID`** 를 넣고, 그 값을 WebSocket 등록 시 보낸 `clientId`와 동일하게 맞추면 됩니다. (서버는 해당 clientId를 가진 소켓에는 그 변경 알림을 보내지 않습니다.) **Python** 클라이언트 예제는 §10 참고.
