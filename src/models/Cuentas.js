const { DataTypes, Sequelize } = require('sequelize');

function defineCuentasModel(sequelize) {
    return sequelize.define('Cuentas', {
        id_cuenta: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
        },
        cuenta_nombre: { 
            type: DataTypes.STRING(100), 
            allowNull: true,
            unique: true,
        },
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
        b_sincronizado_node_svr: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
            defaultValue: false,
        },
    }, {
        tableName: 'cuentas',
        schema: 'public',
        timestamps: false,
    });
}

module.exports = { defineCuentasModel };

