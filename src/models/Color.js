const { DataTypes, Sequelize } = require('sequelize');

function defineColorModel(sequelize) {
    return sequelize.define('Color', {
    idcolor: {
        type: DataTypes.TEXT,
        allowNull: false,
        primaryKey: true,
    },
    descripcioncolor: { type: DataTypes.STRING(50), allowNull: true },
    utime: { type: DataTypes.DATE, allowNull: true },
    borrado: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
    id_color: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: Sequelize.literal("nextval('color_seq'::regclass)"),
    },
}, {
    tableName: 'color',
    schema: 'public',
    timestamps: false,
    });
}

module.exports = { defineColorModel };

