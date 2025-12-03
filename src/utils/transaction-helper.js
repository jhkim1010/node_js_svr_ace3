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

module.exports = {
    safeCommit,
    safeRollback
};

