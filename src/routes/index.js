const { Router } = require('express');
const vcodesRouter = require('./vcodes');
const vdetalleRouter = require('./vdetalle');
const parametrosRouter = require('./parametros');
const ingresosRouter = require('./ingresos');
const codigosRouter = require('./codigos');
const todocodigosRouter = require('./todocodigos');
const gastoInfoRouter = require('./gasto_info');
const gastosRouter = require('./gastos');

const router = Router();

// Health는 server.js에서 처리 (헤더 불필요)
router.use('/vcodes', vcodesRouter);
router.use('/vdetalle', vdetalleRouter);
router.use('/parametros', parametrosRouter);
router.use('/ingresos', ingresosRouter);
router.use('/codigos', codigosRouter);
router.use('/todocodigos', todocodigosRouter);
router.use('/gasto_info', gastoInfoRouter);
router.use('/gastos', gastosRouter);

module.exports = router;


