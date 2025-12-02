const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getItemsReport(req) {
    const Codigos = getModelForRequest(req, 'Codigos');
    const sequelize = Codigos.sequelize;

    // 쿼리 파라미터 파싱
    const codigo = req.query.codigo || null;
    const descripcion = req.query.descripcion || null;
    const tipocodigo = req.query.tipocodigo || null;
    const borrado = req.query.borrado === 'true' ? true : (req.query.borrado === 'false' ? false : null);

    // 필터 조건 구성
    const whereConditions = {};
    if (codigo) whereConditions.codigo = { [Sequelize.Op.like]: `%${codigo}%` };
    if (descripcion) whereConditions.descripcion = { [Sequelize.Op.like]: `%${descripcion}%` };
    if (tipocodigo) whereConditions.tipocodigo = { [Sequelize.Op.like]: `%${tipocodigo}%` };
    if (borrado !== null) whereConditions.borrado = borrado;

    // 아이템 조회
    const items = await Codigos.findAll({
        where: whereConditions,
        order: [['codigo', 'ASC']],
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
        raw: true
    });

    // 집계 정보
    const totalItems = await Codigos.count({ where: whereConditions });
    const activeItems = await Codigos.count({ where: { ...whereConditions, borrado: false } });
    const deletedItems = await Codigos.count({ where: { ...whereConditions, borrado: true } });

    // 가격 통계
    const priceStats = await Codigos.findAll({
        attributes: [
            [sequelize.fn('AVG', sequelize.col('pre1')), 'avg_pre1'],
            [sequelize.fn('AVG', sequelize.col('pre2')), 'avg_pre2'],
            [sequelize.fn('AVG', sequelize.col('pre3')), 'avg_pre3'],
            [sequelize.fn('MIN', sequelize.col('pre1')), 'min_pre1'],
            [sequelize.fn('MAX', sequelize.col('pre1')), 'max_pre1']
        ],
        where: { ...whereConditions, borrado: false },
        raw: true
    });

    return {
        filters: {
            codigo: codigo || 'all',
            descripcion: descripcion || 'all',
            tipocodigo: tipocodigo || 'all',
            borrado: borrado !== null ? borrado : 'all'
        },
        summary: {
            total_items: totalItems,
            active_items: activeItems,
            deleted_items: deletedItems,
            price_statistics: priceStats[0] || {}
        },
        data: items
    };
}

module.exports = { getItemsReport };

