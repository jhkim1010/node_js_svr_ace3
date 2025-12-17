/**
 * 트랜잭션 안전하게 커밋하는 헬퍼 함수
 * 트랜잭션이 아직 완료되지 않았는지 확인 후 커밋
 * @param {Object} transaction - Sequelize transaction 객체
 */
async function safeCommit(transaction) {
    if (transaction && !transaction.finished) {
        await transaction.commit();
    }
}

/**
 * 트랜잭션 안전하게 롤백하는 헬퍼 함수
 * 트랜잭션이 아직 완료되지 않았는지 확인 후 롤백
 * @param {Object} transaction - Sequelize transaction 객체
 */
async function safeRollback(transaction) {
    if (transaction && !transaction.finished) {
        await transaction.rollback();
    }
}

/**
 * 클라이언트 연결 종료 시 트랜잭션 롤백 및 연결 해제
 * @param {Object} req - Express request 객체
 * @param {Object} transaction - Sequelize transaction 객체
 * @returns {boolean} 클라이언트 연결이 끊어졌으면 true
 */
async function handleClientDisconnect(req, transaction) {
    const { isClientDisconnected } = require('../middleware/client-disconnect-handler');
    
    if (isClientDisconnected(req)) {
        // 클라이언트 연결이 끊어진 경우 트랜잭션 롤백
        if (transaction && !transaction.finished) {
            try {
                await safeRollback(transaction);
                console.log(`[Client Disconnect] 트랜잭션 롤백 완료 (연결 풀 해제)`);
            } catch (rollbackErr) {
                console.error(`[Client Disconnect] 트랜잭션 롤백 실패:`, rollbackErr.message);
            }
        }
        return true;
    }
    
    return false;
}

module.exports = {
    safeCommit,
    safeRollback,
    handleClientDisconnect
};

