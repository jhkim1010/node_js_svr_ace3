const { DataTypes, Sequelize } = require('sequelize');

function defineClientesModel(sequelize) {
    return sequelize.define('Clientes', {
    dni: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
    },
    nombre: { type: DataTypes.STRING(200), allowNull: true },
    direccion: { type: DataTypes.STRING(60), allowNull: true },
    vendedor: { type: DataTypes.STRING(20), allowNull: true },
    transporte: { type: DataTypes.STRING(40), allowNull: true },
    telefono: { type: DataTypes.STRING(30), allowNull: true },
    tipo: { type: DataTypes.INTEGER, allowNull: true },
    resiva: { type: DataTypes.INTEGER, allowNull: true },
    deuda: { type: DataTypes.DOUBLE, allowNull: true },
    info2: { type: DataTypes.STRING(30), allowNull: true },
    resropas: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    localidad: { type: DataTypes.STRING(40), allowNull: true },
    provincia: { type: DataTypes.STRING(30), allowNull: true },
    utime: { type: DataTypes.DATE, allowNull: true },
    id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        unique: true,
        defaultValue: Sequelize.literal("nextval('cliente_seq'::regclass)"),
    },
    memo: { type: DataTypes.STRING(800), allowNull: true },
    borrado: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    email: { type: DataTypes.STRING(300), allowNull: true },
    ref_id_provincia: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    id_cliente_centralizado: { type: DataTypes.INTEGER, allowNull: true },
    ref_id_vendedor: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    direccion_transp: { type: DataTypes.STRING(500), allowNull: true },
    localidad_transp: { type: DataTypes.STRING(100), allowNull: true },
    prov_transp: { type: DataTypes.STRING(50), allowNull: true },
    codigo_postal: { type: DataTypes.STRING(10), allowNull: true },
}, {
    tableName: 'clientes',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineClientesModel };

