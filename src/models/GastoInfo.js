const { DataTypes, Sequelize } = require('sequelize');

function defineGastoInfoModel(sequelize) {
    return sequelize.define('GastoInfo', {
        id_gasto: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal("nextval('cliente_seq'::regclass)"),
        },
        codigo: { type: DataTypes.STRING(20), allowNull: false, primaryKey: true },
        desc_gasto: { type: DataTypes.STRING(40), allowNull: true },
    }, {
        tableName: 'gasto_info',
        schema: 'public',
        timestamps: false,
    });
}

module.exports = { defineGastoInfoModel };

