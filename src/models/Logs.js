const { DataTypes, Sequelize } = require('sequelize');

function defineLogsModel(sequelize) {
    return sequelize.define('Logs', {
    fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal("'now'::text::date"),
    },
    hora: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
    },
    evento: {
        type: DataTypes.STRING(800),
        allowNull: false,
        primaryKey: true,
    },
    progname: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true,
    },
    ref1: { type: DataTypes.STRING(100), allowNull: true },
    alerta: { type: DataTypes.BOOLEAN, allowNull: true },
    sucursal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
    },
    utime: { type: DataTypes.DATE, allowNull: true },
    id_log: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: Sequelize.literal("nextval('log_seq'::regclass)"),
    },
}, {
    tableName: 'logs',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineLogsModel };

