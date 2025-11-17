const { DataTypes, Sequelize } = require('sequelize');

function defineOnlineVentasModel(sequelize) {
    return sequelize.define('OnlineVentas', {
    online_venta_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal("nextval('online_venta_seq'::regclass)"),
    },
    ref_id_vcode: { type: DataTypes.INTEGER, allowNull: true },
    ref_id_vcode_pagado: { type: DataTypes.INTEGER, allowNull: true },
    ref_id_encargado_envio: { type: DataTypes.INTEGER, allowNull: true },
    utime_registrado: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal('now()'),
    },
    utime_pagado: { type: DataTypes.DATE, allowNull: true },
    utime_enviado: { type: DataTypes.DATE, allowNull: true },
    num_pedido: { type: DataTypes.STRING(50), allowNull: true, unique: true },
    num_envio: { type: DataTypes.STRING(50), allowNull: true },
    b_por_cobranza: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    sucursal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
    },
    borrado: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    utime_modificado: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal('now()'),
    },
    cuenta_nombre: { type: DataTypes.STRING(40), allowNull: true },
    utime_completado: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: 'online_ventas',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineOnlineVentasModel };

