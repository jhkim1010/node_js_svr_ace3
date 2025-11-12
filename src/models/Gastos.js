const { DataTypes, Sequelize } = require('sequelize');

function defineGastosModel(sequelize) {
    return sequelize.define('Gastos', {
        id_ga: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal("nextval('gasto_seq'::regclass)"),
        },
        hora: { type: DataTypes.STRING(20), allowNull: false },
        tema: { type: DataTypes.STRING(150), allowNull: true },
        costo: { type: DataTypes.DOUBLE, allowNull: false },
        nencargado: { type: DataTypes.STRING(10), allowNull: true },
        fecha: { type: DataTypes.DATEONLY, allowNull: true },
        sucursal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
        utime: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
        borrado: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
        tipo: { type: DataTypes.STRING(20), allowNull: true },
        bdesdecaja: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
        codigo: { type: DataTypes.STRING(30), allowNull: true },
        utime_modificado: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
        d_num_caja: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
    }, {
        tableName: 'gastos',
        schema: 'public',
        timestamps: false,
    });
}

module.exports = { defineGastosModel };

