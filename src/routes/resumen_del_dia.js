const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');

const router = Router();

router.get('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const Gastos = getModelForRequest(req, 'Gastos');
        const sequelize = Vcode.sequelize;
        
        // 오늘 날짜의 vcodes 데이터 집계
        const vcodeResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'sum_tpago'],
                [sequelize.fn('SUM', sequelize.col('tefectivo')), 'sum_tefectivo'],
                [sequelize.fn('SUM', sequelize.col('tbanco')), 'sum_tbanco']
            ],
            where: Sequelize.where(
                Sequelize.fn('DATE', Sequelize.col('fecha')),
                Sequelize.fn('CURRENT_DATE')
            ),
            raw: true
        });
        
        // 오늘 날짜의 gastos 데이터 집계 (borrado = false)
        const gastosResult = await Gastos.findAll({
            attributes: [
                [sequelize.fn('SUM', sequelize.col('costo')), 'sum_gasto']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        Sequelize.fn('CURRENT_DATE')
                    ),
                    { borrado: false }
                ]
            },
            raw: true
        });
        
        const vcodeSummary = vcodeResult && vcodeResult.length > 0 ? vcodeResult[0] : null;
        const gastosSummary = gastosResult && gastosResult.length > 0 ? gastosResult[0] : null;
        
        res.json({
            fecha: new Date().toISOString().split('T')[0], // 오늘 날짜 (YYYY-MM-DD)
            count: parseInt(vcodeSummary?.count || 0, 10),
            sum_tpago: parseFloat(vcodeSummary?.sum_tpago || 0),
            sum_tefectivo: parseFloat(vcodeSummary?.sum_tefectivo || 0),
            sum_tbanco: parseFloat(vcodeSummary?.sum_tbanco || 0),
            sum_gasto: parseFloat(gastosSummary?.sum_gasto || 0)
        });
    } catch (err) {
        console.error('\nERROR: Resumen del dia fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        res.status(500).json({ 
            error: 'Failed to get resumen del dia', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
    }
});

module.exports = router;

