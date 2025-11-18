const { DataTypes, Sequelize } = require('sequelize');

function defineTiposModel(sequelize) {
    return sequelize.define('Tipos', {
    tpcodigo: {
        type: DataTypes.STRING(5),
        allowNull: false,
        primaryKey: true,
    },
    tpdesc: { type: DataTypes.STRING(200), allowNull: true },
    tpinfo1: { type: DataTypes.STRING(10), allowNull: true },
    utime: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal('now()'),
    },
    borrado: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    id_tipo: {
        type: DataTypes.INTEGER,
        allowNull: true,
        unique: true,
        defaultValue: Sequelize.literal("nextval('tipo_seq'::regclass)"),
    },
}, {
    tableName: 'tipos',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineTiposModel };

