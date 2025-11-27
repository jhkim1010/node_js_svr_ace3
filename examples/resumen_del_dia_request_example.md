# GET /api/resumen_del_dia 샘플 요청

## cURL 예제

### 기본 요청 (오늘 날짜 사용)
```bash
curl -X GET "http://localhost:3030/api/resumen_del_dia" \
  -H "x-db-host: localhost" \
  -H "x-db-port: 5432" \
  -H "x-db-name: my_database" \
  -H "x-db-user: postgres" \
  -H "x-db-password: your_password" \
  -H "x-db-ssl: false"
```

### 특정 날짜 지정
```bash
curl -X GET "http://localhost:3030/api/resumen_del_dia?fecha=2024-01-15" \
  -H "x-db-host: localhost" \
  -H "x-db-port: 5432" \
  -H "x-db-name: my_database" \
  -H "x-db-user: postgres" \
  -H "x-db-password: your_password" \
  -H "x-db-ssl: false"
```

### 스크립트 실행 포함
```bash
curl -X GET "http://localhost:3030/api/resumen_del_dia?scripts=example_script.js&scriptTimeout=30000" \
  -H "x-db-host: localhost" \
  -H "x-db-port: 5432" \
  -H "x-db-name: my_database" \
  -H "x-db-user: postgres" \
  -H "x-db-password: your_password" \
  -H "x-db-ssl: false"
```

## JavaScript (fetch) 예제

```javascript
const response = await fetch('http://localhost:3030/api/resumen_del_dia?fecha=2024-01-15', {
  method: 'GET',
  headers: {
    'x-db-host': 'localhost',
    'x-db-port': '5432',
    'x-db-name': 'my_database',
    'x-db-user': 'postgres',
    'x-db-password': 'your_password',
    'x-db-ssl': 'false'
  }
});

const data = await response.json();
console.log(data);
```

## Python (requests) 예제

```python
import requests

url = "http://localhost:3030/api/resumen_del_dia"
headers = {
    "x-db-host": "localhost",
    "x-db-port": "5432",
    "x-db-name": "my_database",
    "x-db-user": "postgres",
    "x-db-password": "your_password",
    "x-db-ssl": "false"
}
params = {
    "fecha": "2024-01-15"  # 선택사항: YYYY-MM-DD 형식
}

response = requests.get(url, headers=headers, params=params)
print(response.json())
```

## 필수 헤더

| 헤더 이름 | 설명 | 예시 |
|---------|------|------|
| `x-db-host` | PostgreSQL 서버 주소 | `localhost` 또는 `192.168.1.1` |
| `x-db-port` | PostgreSQL 포트 번호 | `5432` |
| `x-db-name` | 데이터베이스 이름 | `my_database` |
| `x-db-user` | 데이터베이스 사용자 이름 | `postgres` |
| `x-db-password` | 데이터베이스 비밀번호 | `your_password` |

## 선택 헤더

| 헤더 이름 | 설명 | 기본값 |
|---------|------|--------|
| `x-db-ssl` | SSL 사용 여부 | `false` |

## 쿼리 파라미터 (모두 선택사항)

| 파라미터 | 설명 | 예시 |
|---------|------|------|
| `fecha` | 조회할 날짜 (YYYY-MM-DD) | `2024-01-15` |
| `date` | 조회할 날짜 (fecha와 동일) | `2024-01-15` |
| `target_date` | 조회할 날짜 (fecha와 동일) | `2024-01-15` |
| `scripts` | 실행할 스크립트 목록 (쉼표로 구분) | `script1.js,script2.py` |
| `scriptTimeout` | 스크립트 실행 타임아웃 (밀리초) | `60000` |

## 참고사항

- GET 요청이므로 **Body는 없습니다**
- 날짜를 지정하지 않으면 기본값 사용:
  - `vcodes` 쿼리: 어제 날짜
  - 나머지 쿼리: 오늘 날짜
- 헤더 이름은 `x-db-*` 또는 `db-*` 형식 모두 사용 가능
- SSL을 사용하는 경우 `x-db-ssl: true`로 설정

## 성공 응답 예시

```json
{
  "fecha": "2024-01-15",
  "fecha_vcodes": "2024-01-14",
  "fecha_otros": "2024-01-15",
  "vcodes": {
    "operation_count": 10,
    "total_venta_day": 150000.50,
    "total_efectivo_day": 50000.00,
    "total_credito_day": 80000.00,
    "total_banco_day": 20000.50,
    "total_favor_day": 0.00,
    "total_count_ropas": 25
  },
  "gastos": {
    "gasto_count": 5,
    "total_gasto_day": 10000.00
  },
  "vdetalle": {
    "count_discount_event": 3,
    "total_discount_day": 5000.00
  },
  "vcodes_mpago": {
    "count_mpago_total": 2,
    "total_mpago_day": 30000.00
  },
  "scripts": {
    "executed": 0,
    "results": []
  }
}
```

