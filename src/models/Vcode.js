const { DataTypes, Sequelize } = require('sequelize');

function defineVcodeModel(sequelize) {
    return sequelize.define('Vcode', {
    vcode_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("nextval('vcode_seq'::regclass)"),
    },
    vcode: { type: DataTypes.STRING(80), allowNull: false },
    itemcnt: { type: DataTypes.INTEGER, allowNull: true },
    clientenombre: { type: DataTypes.STRING(201), allowNull: true },
    dni: { type: DataTypes.STRING(15), allowNull: true },
    hora: { type: DataTypes.STRING(15), allowNull: true },
    tefectivo: { type: DataTypes.DOUBLE, allowNull: true },
    tcredito: { type: DataTypes.DOUBLE, allowNull: true },
    tbanco: { type: DataTypes.DOUBLE, allowNull: true },
    treservado: { type: DataTypes.DOUBLE, allowNull: true },
    tfavor: { type: DataTypes.DOUBLE, allowNull: true },
    tpago: { type: DataTypes.DOUBLE, allowNull: true },
    cntropas: { type: DataTypes.INTEGER, allowNull: true },
    direccion: { type: DataTypes.STRING(500), allowNull: true },
    vendedor: { type: DataTypes.STRING(15), allowNull: true },
    tipo: { type: DataTypes.INTEGER, allowNull: true },
    resiva: { type: DataTypes.INTEGER, allowNull: true },
    casoesp: { type: DataTypes.STRING(10), allowNull: true },
    nencargado: { type: DataTypes.STRING(50), allowNull: true },
    cretmp: { type: DataTypes.DOUBLE, allowNull: true, defaultValue: 0 },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },
    sucursal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
    utime: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
    borrado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    ntiqrepetir: { type: DataTypes.INTEGER, allowNull: true },
    b_mercadopago: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_movido: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_fallado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_x_cheque: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_deudapago: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_descontado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_reservado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_facturado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    b_endeudando: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    ref_id_cliente: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_vendedor: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_transporte: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_banco: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_media: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
    ref_id_provincia: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    ref_id_deposito: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
    d_num_caja: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
    d_num_terminal: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
    b_cancelado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
}, {
    tableName: 'vcodes',
    schema: 'public',
    timestamps: false,
    indexes: [
        { unique: true, name: 'vcodes_unique', fields: ['vcode_id', 'sucursal'] },
    ],
    });
}

// 정적 모델은 lazy하게 생성 (실제 사용 시에만)
let _staticVcode = null;
function getStaticVcode() {
    if (!_staticVcode) {
        const { sequelize } = require('../db/sequelize');
        _staticVcode = defineVcodeModel(sequelize);
    }
    return _staticVcode;
}

module.exports = { Vcode: { get: getStaticVcode }, defineVcodeModel };


