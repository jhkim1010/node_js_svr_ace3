const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

async function getClientesReport(req) {
    const Clientes = getModelForRequest(req, 'Clientes');
    const sequelize = Clientes.sequelize;

    // 쿼리 파라미터 파싱
    const dni = req.query.dni || null;
    const nombre = req.query.nombre || null;
    const localidad = req.query.localidad || null;
    const provincia = req.query.provincia || null;
    const borrado = req.query.borrado === 'true' ? true : (req.query.borrado === 'false' ? false : null);

    // 필터 조건 구성
    const whereConditions = {};
    if (dni) whereConditions.dni = { [Sequelize.Op.like]: `%${dni}%` };
    if (nombre) whereConditions.nombre = { [Sequelize.Op.like]: `%${nombre}%` };
    if (localidad) whereConditions.localidad = { [Sequelize.Op.like]: `%${localidad}%` };
    if (provincia) whereConditions.provincia = { [Sequelize.Op.like]: `%${provincia}%` };
    if (borrado !== null) whereConditions.borrado = borrado;

    // 고객 조회
    const clientes = await Clientes.findAll({
        where: whereConditions,
        order: [['nombre', 'ASC']],
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
        raw: true
    });

    // 집계 정보
    const totalClientes = await Clientes.count({ where: whereConditions });
    const activeClientes = await Clientes.count({ where: { ...whereConditions, borrado: false } });
    const deletedClientes = await Clientes.count({ where: { ...whereConditions, borrado: true } });

    // 총 부채 통계
    const deudaStats = await Clientes.findAll({
        attributes: [
            [sequelize.fn('SUM', sequelize.col('deuda')), 'total_deuda'],
            [sequelize.fn('AVG', sequelize.col('deuda')), 'avg_deuda'],
            [sequelize.fn('COUNT', sequelize.literal('CASE WHEN deuda > 0 THEN 1 END')), 'clientes_con_deuda']
        ],
        where: { ...whereConditions, borrado: false },
        raw: true
    });

    // 지역별 통계
    const localidadStats = await Clientes.findAll({
        attributes: [
            'localidad',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count']
        ],
        where: { ...whereConditions, borrado: false },
        group: ['localidad'],
        order: [[sequelize.fn('COUNT', sequelize.col('*')), 'DESC']],
        limit: 10,
        raw: true
    });

    // 지역별 통계
    const provinciaStats = await Clientes.findAll({
        attributes: [
            'provincia',
            [sequelize.fn('COUNT', sequelize.col('*')), 'count']
        ],
        where: { ...whereConditions, borrado: false },
        group: ['provincia'],
        order: [[sequelize.fn('COUNT', sequelize.col('*')), 'DESC']],
        limit: 10,
        raw: true
    });

    return {
        filters: {
            dni: dni || 'all',
            nombre: nombre || 'all',
            localidad: localidad || 'all',
            provincia: provincia || 'all',
            borrado: borrado !== null ? borrado : 'all'
        },
        summary: {
            total_clientes: totalClientes,
            active_clientes: activeClientes,
            deleted_clientes: deletedClientes,
            deuda_statistics: deudaStats[0] || {},
            top_localidades: localidadStats,
            top_provincias: provinciaStats
        },
        data: clientes
    };
}

module.exports = { getClientesReport };

