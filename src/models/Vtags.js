const { DataTypes, Sequelize } = require('sequelize');

function defineVtagsModel(sequelize) {
    return sequelize.define('Vtags', {
    vtag_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal("nextval('vtag_seq'::regclass)"),
    },
    ref_id_vcode: { type: DataTypes.INTEGER, allowNull: true },
    ref_id_cuenta: { type: DataTypes.INTEGER, allowNull: true },
    num_autorizacion: { type: DataTypes.STRING(50), allowNull: true },
    fmonto: { type: DataTypes.DOUBLE, allowNull: true },
    b_por_cobranza: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    sucursal: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
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
    utime_modificado: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.literal('now()'),
    },
}, {
    tableName: 'vtags',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineVtagsModel };

