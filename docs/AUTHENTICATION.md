# 인증 및 권한 관리 시스템

## 개요

이 시스템은 관리자 인증과 보고서 접근 권한 관리를 제공합니다.

## 주요 기능

1. **관리자 인증**: manager_name과 password로 로그인
2. **JWT 토큰 기반 인증**: 로그인 후 JWT 토큰 발급
3. **보고서 권한 관리**: 각 관리자마다 접근 가능한 보고서 제한

## 데이터베이스 설정

### 1. Managers 테이블 생성

```bash
psql -U your_user -d your_database -f scripts/create-managers-table.sql
```

또는 직접 SQL 실행:

```sql
CREATE TABLE IF NOT EXISTS public.managers (
    manager_name VARCHAR(100) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    allowed_reports JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS managers_manager_name_idx ON public.managers(manager_name);
```

## API 엔드포인트

### 1. 관리자 생성 (POST /api/auth/create-manager)

새 관리자를 생성합니다.

**요청:**
```bash
curl -X POST http://localhost:3030/api/auth/create-manager \
  -H "Content-Type: application/json" \
  -H "x-db-host: localhost" \
  -H "x-db-port: 5432" \
  -H "x-db-name: your_database" \
  -H "x-db-user: your_user" \
  -H "x-db-password: your_password" \
  -d '{
    "manager_name": "admin1",
    "password": "secure_password123",
    "allowed_reports": ["stocks", "items", "clientes"]
  }'
```

**응답:**
```json
{
  "success": true,
  "message": "Manager created successfully",
  "manager_name": "admin1",
  "allowed_reports": ["stocks", "items", "clientes"]
}
```

**allowed_reports 설명:**
- 빈 배열 `[]`: 모든 보고서 접근 가능 (슈퍼 관리자)
- 특정 보고서 배열: 해당 보고서만 접근 가능
  - 가능한 값: `["stocks", "items", "clientes", "gastos", "ventas", "alertas"]`

### 2. 로그인 (POST /api/auth/login)

관리자 로그인하여 JWT 토큰을 받습니다.

**요청:**
```bash
curl -X POST http://localhost:3030/api/auth/login \
  -H "Content-Type: application/json" \
  -H "x-db-host: localhost" \
  -H "x-db-port: 5432" \
  -H "x-db-name: your_database" \
  -H "x-db-user: your_user" \
  -H "x-db-password: your_password" \
  -d '{
    "manager_name": "admin1",
    "password": "secure_password123"
  }'
```

**응답:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "manager_name": "admin1",
  "allowed_reports": ["stocks", "items", "clientes"]
}
```

### 3. 보고서 접근 (GET /api/reporte/{report_name})

JWT 토큰을 사용하여 보고서에 접근합니다.

**요청:**
```bash
curl -X GET http://localhost:3030/api/reporte/stocks \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "x-db-host: localhost" \
  -H "x-db-port: 5432" \
  -H "x-db-name: your_database" \
  -H "x-db-user: your_user" \
  -H "x-db-password: your_password"
```

**권한이 없는 경우 응답:**
```json
{
  "error": "Forbidden",
  "message": "Access denied to report: ventas",
  "allowed_reports": ["stocks", "items", "clientes"]
}
```

## 사용 예시

### JavaScript/TypeScript

```javascript
// 1. 로그인
const loginResponse = await fetch('http://localhost:3030/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-db-host': 'localhost',
    'x-db-port': '5432',
    'x-db-name': 'your_database',
    'x-db-user': 'your_user',
    'x-db-password': 'your_password'
  },
  body: JSON.stringify({
    manager_name: 'admin1',
    password: 'secure_password123'
  })
});

const { token } = await loginResponse.json();

// 2. 보고서 요청
const reportResponse = await fetch('http://localhost:3030/api/reporte/stocks', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'x-db-host': 'localhost',
    'x-db-port': '5432',
    'x-db-name': 'your_database',
    'x-db-user': 'your_user',
    'x-db-password': 'your_password'
  }
});

const reportData = await reportResponse.json();
```

### Python

```python
import requests

# 1. 로그인
login_url = 'http://localhost:3030/api/auth/login'
login_headers = {
    'Content-Type': 'application/json',
    'x-db-host': 'localhost',
    'x-db-port': '5432',
    'x-db-name': 'your_database',
    'x-db-user': 'your_user',
    'x-db-password': 'your_password'
}
login_data = {
    'manager_name': 'admin1',
    'password': 'secure_password123'
}

response = requests.post(login_url, headers=login_headers, json=login_data)
token = response.json()['token']

# 2. 보고서 요청
report_url = 'http://localhost:3030/api/reporte/stocks'
report_headers = {
    'Authorization': f'Bearer {token}',
    **login_headers
}

report_response = requests.get(report_url, headers=report_headers)
report_data = report_response.json()
```

## 환경 변수 설정

`.env` 파일에 JWT 시크릿 키를 설정하세요:

```env
JWT_SECRET=your-super-secret-key-change-in-production
```

프로덕션 환경에서는 반드시 강력한 시크릿 키를 사용하세요.

## 보안 고려사항

1. **비밀번호 해싱**: bcrypt를 사용하여 비밀번호를 해시화합니다 (salt rounds: 10)
2. **JWT 토큰 만료**: 토큰은 24시간 후 만료됩니다
3. **HTTPS 사용**: 프로덕션 환경에서는 반드시 HTTPS를 사용하세요
4. **시크릿 키 보호**: JWT_SECRET은 환경 변수로 관리하고 절대 코드에 하드코딩하지 마세요

## 보고서 및 리소스 이름 목록

프론트엔드에서 선택 가능한 항목:

- `stocks`: 재고 보고서 (`/api/reporte/stocks`)
- `items`: 아이템 보고서 (`/api/reporte/items`)
- `clientes`: 고객 보고서 (`/api/reporte/clientes`)
- `gastos`: 지출 보고서 (`/api/reporte/gastos`)
- `ventas`: 판매 보고서 (`/api/reporte/ventas`)
- `alertas`: 알림 보고서 (`/api/reporte/alertas`)
- `codigos`: 코드 관리 (`/api/codigos`) - 현재 권한 체크 없음
- `todocodigos`: 전체 코드 관리 (`/api/todocodigos`) - 현재 권한 체크 없음

**참고**: `codigos`와 `todocodigos`는 보고서가 아닌 일반 리소스이지만, 프론트엔드에서 권한 관리에 포함시킬 수 있습니다. 백엔드는 `allowed_reports`에 이 값들을 저장하지만, 현재는 실제 권한 체크가 적용되지 않습니다.

## 관리자 권한 수정

데이터베이스에서 직접 수정:

```sql
-- 특정 관리자의 권한 수정
UPDATE public.managers 
SET allowed_reports = '["stocks", "items"]'::jsonb
WHERE manager_name = 'admin1';

-- 모든 보고서 접근 권한 부여 (빈 배열)
UPDATE public.managers 
SET allowed_reports = '[]'::jsonb
WHERE manager_name = 'admin1';

-- 계정 비활성화
UPDATE public.managers 
SET is_active = false
WHERE manager_name = 'admin1';
```

