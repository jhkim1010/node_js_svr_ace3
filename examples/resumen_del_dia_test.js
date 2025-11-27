/**
 * GET /api/resumen_del_dia 테스트 스크립트
 * 사용법: node examples/resumen_del_dia_test.js
 */

const http = require('http');

// 설정 (실제 값으로 변경하세요)
const config = {
  host: 'localhost',
  port: 3030,
  path: '/api/resumen_del_dia',
  method: 'GET',
  headers: {
    'x-db-host': 'localhost',
    'x-db-port': '5432',
    'x-db-name': 'my_database',
    'x-db-user': 'postgres',
    'x-db-password': 'your_password',
    'x-db-ssl': 'false',
    'Content-Type': 'application/json'
  }
};

// 쿼리 파라미터 추가 (선택사항)
// 예: 날짜 지정
// config.path += '?fecha=2024-01-15';

// 요청 실행
const req = http.request(config, (res) => {
  let data = '';

  console.log(`\n=== 응답 상태: ${res.statusCode} ===`);
  console.log('응답 헤더:', res.headers);

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const jsonData = JSON.parse(data);
      console.log('\n=== 응답 데이터 ===');
      console.log(JSON.stringify(jsonData, null, 2));
    } catch (e) {
      console.log('\n=== 응답 데이터 (JSON 파싱 실패) ===');
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ 요청 오류:', error.message);
});

req.end();

