#!/usr/bin/env python3
"""
GET /api/resumen_del_dia 테스트 스크립트
사용법: python3 examples/resumen_del_dia_test.py
"""

import requests
import json
from datetime import datetime, timedelta

# 설정 (실제 값으로 변경하세요)
DB_CONFIG = {
    'host': 'localhost',
    'port': '5432',
    'database': 'my_database',
    'user': 'postgres',
    'password': 'your_password',
    'ssl': 'false'
}

# 서버 URL
BASE_URL = 'http://localhost:3030'
ENDPOINT = f'{BASE_URL}/api/resumen_del_dia'

# 헤더 설정
headers = {
    'x-db-host': DB_CONFIG['host'],
    'x-db-port': DB_CONFIG['port'],
    'x-db-name': DB_CONFIG['database'],
    'x-db-user': DB_CONFIG['user'],
    'x-db-password': DB_CONFIG['password'],
    'x-db-ssl': DB_CONFIG['ssl'],
    'Content-Type': 'application/json'
}

def test_basic_request():
    """기본 요청 (오늘 날짜 사용)"""
    print("\n=== 기본 요청 (오늘 날짜) ===")
    try:
        response = requests.get(ENDPOINT, headers=headers)
        print(f"상태 코드: {response.status_code}")
        print(f"응답 데이터:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"❌ 오류 발생: {e}")

def test_with_date(date_str):
    """특정 날짜 지정 요청"""
    print(f"\n=== 특정 날짜 지정 요청 ({date_str}) ===")
    try:
        params = {'fecha': date_str}
        response = requests.get(ENDPOINT, headers=headers, params=params)
        print(f"상태 코드: {response.status_code}")
        print(f"응답 데이터:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"❌ 오류 발생: {e}")

def test_with_scripts():
    """스크립트 실행 포함 요청"""
    print("\n=== 스크립트 실행 포함 요청 ===")
    try:
        params = {
            'scripts': 'example_script.js',
            'scriptTimeout': '30000'
        }
        response = requests.get(ENDPOINT, headers=headers, params=params)
        print(f"상태 코드: {response.status_code}")
        print(f"응답 데이터:")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"❌ 오류 발생: {e}")

if __name__ == '__main__':
    # 기본 요청
    test_basic_request()
    
    # 특정 날짜 지정 (예: 어제)
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    test_with_date(yesterday)
    
    # 스크립트 실행 포함
    # test_with_scripts()

