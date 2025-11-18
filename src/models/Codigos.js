const { DataTypes, Sequelize } = require('sequelize');

function defineCodigosModel(sequelize) {
    return sequelize.define('Codigos', {
    codigo: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
    },
    descripcion: { type: DataTypes.STRING(90), allowNull: true },
    pre1: { type: DataTypes.DOUBLE, allowNull: true },
    pre2: { type: DataTypes.DOUBLE, allowNull: true },
    pre3: { type: DataTypes.DOUBLE, allowNull: true },
    preorg: { type: DataTypes.DOUBLE, allowNull: true },
    codigoproducto: { type: DataTypes.STRING(20), allowNull: true },
    utime: { type: DataTypes.DATE, allowNull: true },
    borrado: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    fotonombre: { type: DataTypes.STRING(50), allowNull: true },
    pre4: { type: DataTypes.DOUBLE, allowNull: true },
    pre5: { type: DataTypes.DOUBLE, allowNull: true },
    valor1: { type: DataTypes.STRING(30), allowNull: true },
    valor2: { type: DataTypes.STRING(30), allowNull: true },
    valor3: { type: DataTypes.STRING(30), allowNull: true },
    pubip: { type: DataTypes.STRING(30), allowNull: true },
    ip: { type: DataTypes.STRING(30), allowNull: true },
    mac: { type: DataTypes.STRING(40), allowNull: true },
    bmobile: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    tipocodigo: { type: DataTypes.STRING(120), allowNull: true },
    id_codigo: {
        type: DataTypes.INTEGER,
        allowNull: true,
        unique: true,
        defaultValue: Sequelize.literal("nextval('codigo_seq'::regclass)"),
    },
    ref_id_todocodigo: { type: DataTypes.INTEGER, allowNull: true },
    ref_id_color: { type: DataTypes.INTEGER, allowNull: true },
    str_talle: { type: DataTypes.STRING(10), allowNull: true },
    ref_id_temporada: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    ref_id_talle: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    utime_modificado: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal('now()'),
    },
    id_codigo_centralizado: { type: DataTypes.INTEGER, allowNull: true },
    id_woocommerce: { type: DataTypes.INTEGER, allowNull: true },
    id_woocommerce_producto: { type: DataTypes.INTEGER, allowNull: true },
    b_mostrar_vcontrol: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: true,
    },
    b_sincronizar_x_web: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: true,
    },
    d_oferta_mode: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
}, {
    tableName: 'codigos',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineCodigosModel };

