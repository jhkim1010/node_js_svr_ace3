const { Op } = require('sequelize');

// 같은 키(id, sucursal)를 가진 "다른" 레코드를 덮어쓰지 못하게 막는 가드
// 예: 클라이언트 로컬 시퀀스가 서버의 오래된 id 와 겹쳐 오늘 판매의 vdetalle 가
//     2019년 판매의 vdetalle 행을 UPDATE 로 덮어쓰는 문제 (shaple45, 2026-09-24)
// 모든 Model.update() 가 beforeBulkUpdate 를 거치므로 호출 지점마다 체크할 필요가 없음
function attachIdentityGuard(model, identityField) {
    model.addHook('beforeBulkUpdate', 'identityGuard', async (options) => {
        const incoming = options.attributes ? options.attributes[identityField] : undefined;
        if (incoming === undefined || incoming === null || !options.where) return;

        const conflict = await model.findOne({
            where: { [Op.and]: [options.where, { [identityField]: { [Op.ne]: incoming } }] },
            attributes: [identityField],
            transaction: options.transaction,
            raw: true
        });
        if (!conflict) return;

        const err = new Error(
            `${model.tableName} id conflict: row ${JSON.stringify(options.where)} belongs to ` +
            `${identityField}=${conflict[identityField]}, incoming ${identityField}=${incoming} - update blocked to avoid overwriting another record`
        );
        err.name = 'IdentityConflictError';
        err.code = 'ID_CONFLICT';
        throw err;
    });
}

module.exports = { attachIdentityGuard };
