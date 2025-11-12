const { DataTypes, Sequelize } = require('sequelize');

function defineTodocodigosModel(sequelize) {
    return sequelize.define('Todocodigos', {
    id_todocodigo: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("nextval('todocodigo_seq'::regclass)"),
    },
    tcodigo: { type: DataTypes.STRING(15), allowNull: false, unique: true },
    tdesc: { type: DataTypes.STRING(200), allowNull: true },
    tpre1: { type: DataTypes.DOUBLE, allowNull: true },
    tpre2: { type: DataTypes.DOUBLE, allowNull: true },
    tpre3: { type: DataTypes.DOUBLE, allowNull: true },
    torgpre: { type: DataTypes.DOUBLE, allowNull: true },
    ttelacodigo: { type: DataTypes.STRING(10), allowNull: true },
    ttelakg: { type: DataTypes.DOUBLE, allowNull: true },
    tinfo1: { type: DataTypes.STRING(10), allowNull: true },
    tinfo2: { type: DataTypes.STRING(10), allowNull: true },
    tinfo3: { type: DataTypes.STRING(10), allowNull: true },
    utime: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    borrado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    fotonombre: { type: DataTypes.STRING(50), allowNull: true },
    tpre4: { type: DataTypes.DOUBLE, allowNull: true },
    tpre5: { type: DataTypes.DOUBLE, allowNull: true },
    pubip: { type: DataTypes.STRING(30), allowNull: true },
    ip: { type: DataTypes.STRING(30), allowNull: true },
    mac: { type: DataTypes.STRING(30), allowNull: true },
    bmobile: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    ref_id_temporada: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_tipo: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_origen: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_empresa: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    memo: { type: DataTypes.STRING(1000), allowNull: true },
    estatus_precios: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'NO' },
    tprecio_dolar: { type: DataTypes.DOUBLE, allowNull: true, defaultValue: 0 },
    utime_modificado: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    id_todocodigo_centralizado: { type: DataTypes.INTEGER, allowNull: true },
    b_mostrar_vcontrol: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
    d_oferta_mode: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    id_serial: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    str_prefijo: { type: DataTypes.STRING(5), allowNull: true },
}, {
    tableName: 'todocodigos',
    schema: 'public',
    timestamps: false,
    indexes: [
        { unique: true, name: 'id_todocodigo.uniq', fields: ['id_todocodigo'] },
        { unique: true, name: 'todocodigo.uniq', fields: ['tcodigo'] },
        { unique: true, name: 'todocodigo_id.uniq', fields: ['id_todocodigo'] },
    ],
    });
}

module.exports = { defineTodocodigosModel };

