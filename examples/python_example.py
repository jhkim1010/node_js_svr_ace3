"""
Python에서 Node.js ACE API로 요청 보내기 예시
필요한 패키지: pip install requests
"""

import requests
import json

# API 기본 URL
BASE_URL = "http://localhost:3030"

# 데이터베이스 연결 정보 (헤더에 포함)
DB_HEADERS = {
    'x-db-host': 'localhost',        # PostgreSQL 서버 주소
    'x-db-port': '5432',              # PostgreSQL 포트
    'x-db-name': 'your_database',     # 데이터베이스 이름
    'x-db-user': 'postgres',          # 데이터베이스 사용자
    'x-db-password': 'your_password', # 데이터베이스 비밀번호
    'x-db-ssl': 'false',              # SSL 사용 여부 (선택사항)
    'Content-Type': 'application/json'  # JSON 요청 헤더
}

# ============================================
# 1. Health 체크 (헤더 불필요)
# ============================================
def health_check():
    """서버 상태 확인"""
    url = f"{BASE_URL}/api/health"
    response = requests.get(url)
    print(f"Health Check: {response.status_code}")
    print(f"Response: {response.json()}")
    return response.json()

# ============================================
# 2. Vcodes - GET (목록 조회)
# ============================================
def get_vcodes():
    """Vcodes 목록 조회"""
    url = f"{BASE_URL}/api/vcodes"
    response = requests.get(url, headers=DB_HEADERS)
    print(f"\nGET /api/vcodes")
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Records: {len(data)}")
        if data:
            print(f"First record: {json.dumps(data[0], indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 200 else None

# ============================================
# 3. Vcodes - GET (단건 조회)
# ============================================
def get_vcode_by_id(vcode_id):
    """특정 Vcode 조회"""
    url = f"{BASE_URL}/api/vcodes/{vcode_id}"
    response = requests.get(url, headers=DB_HEADERS)
    print(f"\nGET /api/vcodes/{vcode_id}")
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print(f"Data: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 200 else None

# ============================================
# 4. Vcodes - POST (생성)
# ============================================
def create_vcode():
    """새 Vcode 생성"""
    url = f"{BASE_URL}/api/vcodes"
    data = {
        "vcode": "VC001",
        "fecha": "2024-01-15",
        "clientenombre": "테스트 고객",
        "dni": "12345678",
        "sucursal": 1,
        "itemcnt": 5,
        "tpago": 100000
    }
    response = requests.post(url, headers=DB_HEADERS, json=data)
    print(f"\nPOST /api/vcodes")
    print(f"Status: {response.status_code}")
    if response.status_code == 201:
        print(f"Created: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 201 else None

# ============================================
# 5. Vcodes - PUT (수정)
# ============================================
def update_vcode(vcode_id):
    """Vcode 수정"""
    url = f"{BASE_URL}/api/vcodes/{vcode_id}"
    data = {
        "clientenombre": "수정된 고객명",
        "tpago": 150000
    }
    response = requests.put(url, headers=DB_HEADERS, json=data)
    print(f"\nPUT /api/vcodes/{vcode_id}")
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print(f"Updated: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 200 else None

# ============================================
# 6. Vcodes - DELETE (삭제)
# ============================================
def delete_vcode(vcode_id):
    """Vcode 삭제"""
    url = f"{BASE_URL}/api/vcodes/{vcode_id}"
    response = requests.delete(url, headers=DB_HEADERS)
    print(f"\nDELETE /api/vcodes/{vcode_id}")
    print(f"Status: {response.status_code}")
    if response.status_code == 204:
        print("Deleted successfully")
    else:
        print(f"Error: {response.text}")
    return response.status_code == 204

# ============================================
# 7. Vdetalle - POST (생성 예시)
# ============================================
def create_vdetalle():
    """새 Vdetalle 생성"""
    url = f"{BASE_URL}/api/vdetalle"
    data = {
        "vcode1": "VC001",
        "codigo1": "PROD001",
        "cant1": 10,
        "precio": 50000,
        "fecha1": "2024-01-15",
        "desc1": "상품 설명",
        "ref_id_vcode": 1
    }
    response = requests.post(url, headers=DB_HEADERS, json=data)
    print(f"\nPOST /api/vdetalle")
    print(f"Status: {response.status_code}")
    if response.status_code == 201:
        print(f"Created: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 201 else None

# ============================================
# 8. Ingresos - POST (생성 예시)
# ============================================
def create_ingreso():
    """새 Ingreso 생성"""
    url = f"{BASE_URL}/api/ingresos"
    data = {
        "codigo": "ING001",
        "cant3": 20,
        "desc3": "입고 상품",
        "pre1": 30000,
        "sucursal": 1
    }
    response = requests.post(url, headers=DB_HEADERS, json=data)
    print(f"\nPOST /api/ingresos")
    print(f"Status: {response.status_code}")
    if response.status_code == 201:
        print(f"Created: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 201 else None

# ============================================
# 9. Parametros - GET (복합 키 사용)
# ============================================
def get_parametro(progname, pname, opcion='1'):
    """Parametro 조회 (복합 키)"""
    url = f"{BASE_URL}/api/parametros/{progname}/{pname}/{opcion}"
    response = requests.get(url, headers=DB_HEADERS)
    print(f"\nGET /api/parametros/{progname}/{pname}/{opcion}")
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print(f"Data: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    else:
        print(f"Error: {response.text}")
    return response.json() if response.status_code == 200 else None

# ============================================
# 10. 클래스로 래핑한 버전 (재사용 가능)
# ============================================
class NodeJsAceClient:
    """Node.js ACE API 클라이언트 클래스"""
    
    def __init__(self, base_url, db_host, db_port, db_name, db_user, db_password, db_ssl=False):
        self.base_url = base_url
        self.headers = {
            'x-db-host': db_host,
            'x-db-port': str(db_port),
            'x-db-name': db_name,
            'x-db-user': db_user,
            'x-db-password': db_password,
            'x-db-ssl': 'true' if db_ssl else 'false',
            'Content-Type': 'application/json'
        }
    
    def get(self, endpoint, params=None):
        """GET 요청"""
        url = f"{self.base_url}{endpoint}"
        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()
    
    def post(self, endpoint, data):
        """POST 요청"""
        url = f"{self.base_url}{endpoint}"
        response = requests.post(url, headers=self.headers, json=data)
        response.raise_for_status()
        return response.json()
    
    def put(self, endpoint, data):
        """PUT 요청"""
        url = f"{self.base_url}{endpoint}"
        response = requests.put(url, headers=self.headers, json=data)
        response.raise_for_status()
        return response.json()
    
    def delete(self, endpoint):
        """DELETE 요청"""
        url = f"{self.base_url}{endpoint}"
        response = requests.delete(url, headers=self.headers)
        response.raise_for_status()
        return response.status_code == 204
    
    # 편의 메서드들
    def get_vcodes(self):
        """Vcodes 목록 조회"""
        return self.get('/api/vcodes')
    
    def get_vcode(self, vcode_id):
        """Vcode 단건 조회"""
        return self.get(f'/api/vcodes/{vcode_id}')
    
    def create_vcode(self, data):
        """Vcode 생성"""
        return self.post('/api/vcodes', data)
    
    def update_vcode(self, vcode_id, data):
        """Vcode 수정"""
        return self.put(f'/api/vcodes/{vcode_id}', data)
    
    def delete_vcode(self, vcode_id):
        """Vcode 삭제"""
        return self.delete(f'/api/vcodes/{vcode_id}')

# ============================================
# 사용 예시
# ============================================
if __name__ == "__main__":
    # 헤더 정보 수정 필요!
    DB_HEADERS['x-db-name'] = 'your_database'
    DB_HEADERS['x-db-user'] = 'postgres'
    DB_HEADERS['x-db-password'] = 'your_password'
    
    print("=" * 60)
    print("Node.js ACE API Python 예시")
    print("=" * 60)
    
    # 1. Health 체크
    try:
        health_check()
    except Exception as e:
        print(f"Health check failed: {e}")
    
    # 2. Vcodes 목록 조회
    try:
        vcodes = get_vcodes()
    except Exception as e:
        print(f"Get vcodes failed: {e}")
    
    # 3. 클래스 사용 예시
    print("\n" + "=" * 60)
    print("클래스 사용 예시")
    print("=" * 60)
    
    client = NodeJsAceClient(
        base_url="http://localhost:3030",
        db_host="localhost",
        db_port=5432,
        db_name="your_database",
        db_user="postgres",
        db_password="your_password",
        db_ssl=False
    )
    
    try:
        # Vcodes 목록 조회
        vcodes_list = client.get_vcodes()
        print(f"Vcodes count: {len(vcodes_list)}")
        
        # Vcode 생성 (예시)
        # new_vcode = client.create_vcode({
        #     "vcode": "VC002",
        #     "fecha": "2024-01-15",
        #     "clientenombre": "클래스로 생성",
        #     "sucursal": 1
        # })
        # print(f"Created: {new_vcode}")
        
    except Exception as e:
        print(f"Error: {e}")

