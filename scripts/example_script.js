#!/usr/bin/env node
/**
 * 예제 Node.js 스크립트
 * resumen_del_dia 라우터에서 실행되는 스크립트 예시
 */

const data = {
    timestamp: new Date().toISOString(),
    message: "Hello from Node.js script!",
    data: {
        value1: 150,
        value2: 250,
        sum: 400
    }
};

// JSON으로 출력 (stdout에 출력하면 자동으로 파싱됨)
console.log(JSON.stringify(data, null, 2));

// 에러는 stderr에 출력
// console.error("This is a warning message");

process.exit(0);

