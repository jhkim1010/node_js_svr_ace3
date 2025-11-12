const { DataTypes } = require('sequelize');

function defineParametrosModel(sequelize) {
    return sequelize.define('Parametros', {
    progname: { type: DataTypes.STRING(20), allowNull: false, primaryKey: true },
    pname: { type: DataTypes.STRING(100), allowNull: false, primaryKey: true },
    valor1: { type: DataTypes.STRING(100), allowNull: true },
    valor2: { type: DataTypes.STRING(100), allowNull: true },
    valor3: { type: DataTypes.STRING(100), allowNull: true },
    opcion: { type: DataTypes.STRING(30), allowNull: false, defaultValue: '1', primaryKey: true },
}, {
    tableName: 'parametros',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineParametrosModel };


