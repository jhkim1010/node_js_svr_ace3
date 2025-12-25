const { Router } = require('express');
const vcodesRouter = require('./vcodes');
const vdetalleRouter = require('./vdetalle');
const vdetallesRouter = require('./vdetalles');
const parametrosRouter = require('./parametros');
const ingresosRouter = require('./ingresos');
const codigosRouter = require('./codigos');
const todocodigosRouter = require('./todocodigos');
const gastoInfoRouter = require('./gasto_info');
const gastosRouter = require('./gastos');
const colorRouter = require('./color');
const creditoventasRouter = require('./creditoventas');
const clientesRouter = require('./clientes');
const tiposRouter = require('./tipos');
const vtagsRouter = require('./vtags');
const onlineVentasRouter = require('./online_ventas');
const logsRouter = require('./logs');
const vendedoresRouter = require('./vendedores');
const resumenDelDiaRouter = require('./resumen_del_dia');
const reporteRouter = require('./reporte');
const fventasRouter = require('./fventas');
const seniasVinculadosRouter = require('./senias_vinculados');
const temporadasRouter = require('./temporadas');

const router = Router();

// Health는 server.js에서 처리 (헤더 불필요)
router.use('/vcodes', vcodesRouter);
// vdetalles를 vdetalle보다 먼저 등록하여 경로 충돌 방지
router.use('/vdetalles', vdetallesRouter);
router.use('/vdetalle', vdetalleRouter);
router.use('/parametros', parametrosRouter);
router.use('/ingresos', ingresosRouter);
router.use('/codigos', codigosRouter);
router.use('/todocodigos', todocodigosRouter);
router.use('/gasto_info', gastoInfoRouter);
router.use('/gastos', gastosRouter);
router.use('/color', colorRouter);
router.use('/creditoventas', creditoventasRouter);
router.use('/clientes', clientesRouter);
router.use('/tipos', tiposRouter);
router.use('/vtags', vtagsRouter);
router.use('/online_ventas', onlineVentasRouter);
router.use('/logs', logsRouter);
router.use('/vendedores', vendedoresRouter);
router.use('/resumen_del_dia', resumenDelDiaRouter);
router.use('/reporte', reporteRouter);
router.use('/fventas', fventasRouter);
router.use('/senias_vinculados', seniasVinculadosRouter);
router.use('/temporadas', temporadasRouter);

module.exports = router;


