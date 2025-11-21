const { DataTypes, Sequelize } = require('sequelize');

function defineVendedoresModel(sequelize) {
    return sequelize.define('Vendedores', {
        vid: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true,
            defaultValue: Sequelize.literal("nextval('bancos_seq'::regclass)"),
        },
        vnombre: {
            type: DataTypes.STRING(30),
            primaryKey: true,
            allowNull: false,
            unique: true,
        },
        bpresente: { type: DataTypes.BOOLEAN, allowNull: true },
        utime: { type: DataTypes.DATE, allowNull: true },
        borrado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    }, {
        tableName: 'vendedores',
        schema: 'public',
        timestamps: false,
        indexes: [
            { unique: true, name: 'vendedor.pr', fields: ['vnombre'] },
            { unique: true, name: 'vendedor.unq', fields: ['vnombre'] },
            { unique: true, name: 'vendedor_id.uniq', fields: ['vid'] },
        ],
    });
}

module.exports = { defineVendedoresModel };

