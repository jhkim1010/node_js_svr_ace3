#!/usr/bin/env python3
"""
예제 Python 스크립트
resumen_del_dia 라우터에서 실행되는 스크립트 예시
"""

import json
import sys
from datetime import datetime

def main():
    # 예제 데이터 생성
    result = {
        "timestamp": datetime.now().isoformat(),
        "message": "Hello from Python script!",
        "data": {
            "value1": 100,
            "value2": 200,
            "sum": 300
        }
    }
    
    # JSON으로 출력 (stdout에 출력하면 자동으로 파싱됨)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 에러는 stderr에 출력
    # sys.stderr.write("This is a warning message\n")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())

