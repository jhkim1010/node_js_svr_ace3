const { Sequelize } = require('sequelize');

// 헤더 기반 동적 연결 사용하므로 정적 sequelize는 더미 인스턴스로 생성
// 실제 연결은 하지 않으며, 모델 정의를 위한 기본값으로만 사용
const sequelize = new Sequelize('dummy', 'dummy', 'dummy', {
    host: 'localhost',
    port: 5432,
    dialect: 'postgres',
    logging: false,
    // 실제 연결을 시도하지 않도록 설정
    pool: { max: 0 },
});

// authenticate를 호출해도 실제로 연결하지 않도록 override (선택사항)
// 실제로는 모델 정의만 사용하므로 연결 시도 자체를 하지 않음

module.exports = { sequelize };


