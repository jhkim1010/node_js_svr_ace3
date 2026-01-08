const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');

const router = Router();

// venta 세부 정보 조회 (vcode_id와 sucursal 파라미터)
router.get('/', async (req, res) => {
    try {
        console.log(`[Vdetalles] GET /api/vdetalles 요청 받음 - query:`, req.query, `body:`, req.body);
        const vcodeId = parseInt(req.query.vcode_id || req.body.vcode_id, 10);
        const sucursal = parseInt(req.query.sucursal || req.body.sucursal, 10);
        
        console.log(`[Vdetalles] 파라미터 파싱 - vcodeId: ${vcodeId}, sucursal: ${sucursal}`);
        
        if (Number.isNaN(vcodeId)) {
            return res.status(400).json({ error: 'Invalid vcode_id parameter' });
        }
        
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const sequelize = Vdetalle.sequelize;
        
        // vcodes 정보 조회 (sucursal도 함께 사용)
        let vcodesWhereClause = 'WHERE vcode_id = :vcodeId';
        const vcodesReplacements = { vcodeId };
        
        if (!Number.isNaN(sucursal)) {
            vcodesWhereClause += ' AND sucursal = :sucursal';
            vcodesReplacements.sucursal = sucursal;
        }
        
        const vcodesQuery = `
            SELECT tpago, tefectivo, tcredito, tbanco, treservado, tfavor, d_num_caja, d_num_terminal, vendedor
            FROM vcodes 
            ${vcodesWhereClause}
            LIMIT 1
        `;
        const vcodesResult = await sequelize.query(vcodesQuery, {
            replacements: vcodesReplacements,
            type: sequelize.QueryTypes.SELECT
        });
        
        // cliente 정보 조회 (sucursal도 함께 사용하여 정확한 레코드 찾기)
        let clienteSubquery = 'SELECT ref_id_cliente FROM vcodes WHERE vcode_id = :vcodeId';
        if (!Number.isNaN(sucursal)) {
            clienteSubquery += ' AND sucursal = :sucursal';
        }
        clienteSubquery += ' LIMIT 1';
        
        const clienteQuery = `
            SELECT dni, nombre, direccion, localidad, provincia, vendedor 
            FROM clientes 
            WHERE id = (${clienteSubquery})
        `;
        const clienteResult = await sequelize.query(clienteQuery, {
            replacements: vcodesReplacements,
            type: sequelize.QueryTypes.SELECT
        });
        
        // detalles 정보 조회
        const detallesQuery = `
            SELECT codigo1, v.desc1, v.cant1, v.preuni, v.precio 
            FROM vdetalle v 
            WHERE v.ref_id_vcode = :vcodeId
        `;
        const detallesResult = await sequelize.query(detallesQuery, {
            replacements: { vcodeId },
            type: sequelize.QueryTypes.SELECT
        });
        
        // vtags 정보 조회 (cuentas 조인)
        const vtagsQuery = `
            SELECT c.cuenta_nombre, v.num_autorizacion, v.fmonto, v.sucursal 
            FROM vtags v 
            INNER JOIN cuentas c ON v.ref_id_cuenta = c.id_cuenta 
            WHERE v.ref_id_vcode = :vcodeId
        `;
        const vtagsResult = await sequelize.query(vtagsQuery, {
            replacements: { vcodeId },
            type: sequelize.QueryTypes.SELECT
        });
        
        // cheque 정보 조회 (sucursal도 함께 사용하여 정확한 레코드 찾기)
        let chequeSubquery = 'SELECT vcode FROM vcodes WHERE vcode_id = :vcodeId';
        if (!Number.isNaN(sucursal)) {
            chequeSubquery += ' AND sucursal = :sucursal';
        }
        chequeSubquery += ' LIMIT 1';
        
        const chequeQuery = `
            SELECT * FROM cheques c 
            WHERE c.vcode = (${chequeSubquery})
        `;
        const chequeResult = await sequelize.query(chequeQuery, {
            replacements: vcodesReplacements,
            type: sequelize.QueryTypes.SELECT
        });
        
        // online_ventas 정보 조회
        const onlineVentasQuery = `
            SELECT num_pedido, ov.utime_registrado, ov.utime_pagado 
            FROM online_ventas ov 
            WHERE ov.ref_id_vcode = :vcodeId
        `;
        const onlineVentasResult = await sequelize.query(onlineVentasQuery, {
            replacements: { vcodeId },
            type: sequelize.QueryTypes.SELECT
        });
        
        // 결과 반환
        res.json({
            vcodes: vcodesResult.length > 0 ? vcodesResult[0] : null,
            cliente: clienteResult.length > 0 ? clienteResult[0] : null,
            detalles: detallesResult,
            vtags: vtagsResult,
            cheque: chequeResult.length > 0 ? chequeResult : null,
            online_ventas: onlineVentasResult.length > 0 ? onlineVentasResult : null
        });
    } catch (err) {
        console.error('Error fetching venta details:', err);
        res.status(500).json({ 
            error: 'Failed to fetch venta details', 
            details: err.message 
        });
    }
});

module.exports = router;

