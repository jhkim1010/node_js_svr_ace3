const { DataTypes, Sequelize } = require('sequelize');

function defineIngresosModel(sequelize) {
    return sequelize.define('Ingresos', {
    ingreso_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("nextval('ingreso_seq'::regclass)"),
    },
    codigo: { type: DataTypes.STRING(30), allowNull: false },
    desc3: { type: DataTypes.STRING(80), allowNull: true },
    cant3: { type: DataTypes.INTEGER, allowNull: false },
    pre1: { type: DataTypes.DOUBLE, allowNull: true },
    pre2: { type: DataTypes.DOUBLE, allowNull: true },
    pre3: { type: DataTypes.DOUBLE, allowNull: true },
    preorg: { type: DataTypes.DOUBLE, allowNull: true },
    fecha: { type: DataTypes.DATEONLY, allowNull: false, defaultValue: Sequelize.literal("'now'::text::date") },
    hora: { type: DataTypes.STRING(20), allowNull: true },
    sucursal: { 
        type: DataTypes.INTEGER, 
        allowNull: false, 
        defaultValue: 1,
        primaryKey: true,
    },
    codigoproducto: { type: DataTypes.STRING(15), allowNull: true },
    utime: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    borrado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    fotonombre: { type: DataTypes.STRING(50), allowNull: true },
    pre4: { type: DataTypes.DOUBLE, allowNull: true },
    refemp: { type: DataTypes.STRING(8), allowNull: true },
    refcolor: { type: DataTypes.STRING(8), allowNull: true },
    pre5: { type: DataTypes.DOUBLE, allowNull: true },
    totpre: { type: DataTypes.DOUBLE, allowNull: true },
    pubip: { type: DataTypes.STRING(30), allowNull: true },
    ip: { type: DataTypes.STRING(30), allowNull: true },
    mac: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'NONE' },
    ref1: { type: DataTypes.STRING(50), allowNull: true },
    ref_vcode: { type: DataTypes.STRING(70), allowNull: true, defaultValue: 'NONE' },
    bfallado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    bmovido: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ref_sucursal: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '-1' },
    auto_agregado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    b_autoagregado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    ref_id_codigo: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    num_corte: { type: DataTypes.STRING(50), allowNull: true },
    casoesp: { type: DataTypes.STRING(20), allowNull: true },
    ref_id_todocodigo: { type: DataTypes.INTEGER, allowNull: true },
    utime_modificado: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    id_ingreso_centralizado: { type: DataTypes.INTEGER, allowNull: true },
}, {
    tableName: 'ingresos',
    schema: 'public',
    timestamps: false,
    indexes: [
        // 복합 기본 키: (ingreso_id, sucursal)
        // Sequelize는 복합 기본 키를 인덱스로도 정의
        { unique: true, name: 'ingresos_ingreso_id_sucursal_bmovido_uniq', fields: ['ingreso_id', 'sucursal', 'bmovido'] },
        { name: 'item_id_codigo_ingresos', fields: ['ref_id_codigo'] },
        { name: 'item_ingresos', fields: ['codigo'] },
        { name: 'item_ingresos_borrado', fields: ['codigo', 'borrado'] },
        { name: 'item_ingresos_id_codigo_borrado', fields: ['ref_id_codigo', 'borrado'] },
        { name: 'item_ingresos_id_codigo_sucursal', fields: ['ref_id_codigo', 'sucursal'] },
        { name: 'item_ingresos_sucursal', fields: ['codigo', 'sucursal'] },
    ],
    });
}

module.exports = { defineIngresosModel };

