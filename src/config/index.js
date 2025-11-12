require('dotenv').config();

const config = {
    port: parseInt(process.env.PORT || '3030', 10),
    // DB 연결 정보는 헤더에서 받으므로 설정 불필요
};

module.exports = config;


