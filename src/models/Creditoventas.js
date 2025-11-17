const { DataTypes, Sequelize } = require('sequelize');

function defineCreditoventasModel(sequelize) {
    return sequelize.define('Creditoventas', {
    creditoventa_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal("nextval('creditoventa_seq'::regclass)"),
    },
    vcode: { type: DataTypes.STRING(40), allowNull: false },
    hora: { type: DataTypes.STRING(15), allowNull: true },
    dni: { type: DataTypes.STRING(15), allowNull: false },
    nombre: { type: DataTypes.STRING(30), allowNull: true },
    tpago: { type: DataTypes.DOUBLE, allowNull: true },
    tefectivo: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0,
    },
    tcredito: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0,
    },
    tbanco: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0,
    },
    treservado: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0,
    },
    tfavor: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0,
    },
    cntropas: { type: DataTypes.INTEGER, allowNull: true },
    caso: { type: DataTypes.STRING(10), allowNull: true },
    cretmp: {
        type: DataTypes.DOUBLE,
        allowNull: true,
        defaultValue: 0,
    },
    fecha: { type: DataTypes.DATEONLY, allowNull: true },
    utime: { type: DataTypes.DATE, allowNull: true },
    borrado: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    memo: { type: DataTypes.STRING(800), allowNull: true },
    sucursal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
    },
    ref_id_cliente: { type: DataTypes.INTEGER, allowNull: true },
    ref_id_vcode: { type: DataTypes.INTEGER, allowNull: true },
    b_utilizado_x_descuento: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    utime_modificado: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal('now()'),
    },
}, {
    tableName: 'creditoventas',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineCreditoventasModel };

