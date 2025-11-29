const { DataTypes, Sequelize } = require('sequelize');

function defineVdetalleModel(sequelize) {
    return sequelize.define('Vdetalle', {
    id_vdetalle: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("nextval('vdetalle_seq'::regclass)"),
    },
    vcode1: { type: DataTypes.STRING(50), allowNull: false },
    codigo1: { type: DataTypes.STRING(30), allowNull: false },
    desc1: { type: DataTypes.STRING(300), allowNull: true },
    cant1: { type: DataTypes.INTEGER, allowNull: false },
    dnicomprador: { type: DataTypes.STRING(20), allowNull: true },
    codigoproducto: { type: DataTypes.STRING(15), allowNull: true },
    info1: { type: DataTypes.STRING(10), allowNull: true },
    info2: { type: DataTypes.STRING(10), allowNull: true },
    precio: { type: DataTypes.DOUBLE, allowNull: false },
    ganancia: { type: DataTypes.DOUBLE, allowNull: true },
    fecha1: { type: DataTypes.DATEONLY, allowNull: false },
    sucursal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
    utime: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    borrado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    refemp: { type: DataTypes.STRING(8), allowNull: true },
    refcolor: { type: DataTypes.STRING(8), allowNull: true },
    preuni: { type: DataTypes.DOUBLE, allowNull: true },
    caso: { type: DataTypes.STRING(30), allowNull: true },
    bfallado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    bmovido: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    ref_vendedor: { type: DataTypes.STRING(40), allowNull: true },
    ref_id_vcode: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_provincia: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_cliente: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_vendedor: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_codigo: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_todocodigo: { type: DataTypes.INTEGER, allowNull: true },
    breservado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    utime_modificado: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    is_oferta: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    d_oferta_mode: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
}, {
    tableName: 'vdetalle',
    schema: 'public',
    timestamps: false,
    indexes: [
        { unique: true, name: 'vdetalle_id.uniq', fields: ['id_vdetalle', 'sucursal', 'ref_id_vcode'] },
        { name: 'item_id_codigo_ventas', fields: ['ref_id_codigo'] },
        { name: 'item_ventas', fields: ['codigo1'] },
        { name: 'item_ventas_borrado', fields: ['codigo1', 'borrado'] },
        { name: 'item_ventas_comprador', fields: ['codigo1', 'dnicomprador'] },
        { name: 'item_ventas_id_codigo_borrado', fields: ['ref_id_codigo', 'borrado'] },
        { name: 'item_ventas_id_codigo_comprador', fields: ['ref_id_codigo', 'dnicomprador'] },
        { name: 'item_ventas_id_codigo_preuni', fields: ['ref_id_codigo', 'preuni'] },
        { name: 'item_ventas_id_codigo_sucursal_preuni', fields: ['ref_id_codigo', 'sucursal', 'preuni'] },
        { name: 'item_ventas_preuni', fields: ['codigo1', 'preuni'] },
        { name: 'item_ventas_sucursal_preuni', fields: ['codigo1', 'sucursal', 'preuni'] },
    ],
    });
}

module.exports = { defineVdetalleModel };


