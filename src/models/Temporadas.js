const { DataTypes, Sequelize } = require('sequelize');

function defineTemporadasModel(sequelize) {
    return sequelize.define('Temporadas', {
        id_temporada: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
            unique: true,
            defaultValue: Sequelize.literal("nextval('temporada_seq'::regclass)"),
        },
        temporada_nombre: { type: DataTypes.STRING(100), allowNull: true },
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
    }, {
        tableName: 'temporadas',
        schema: 'public',
        timestamps: false,
    });
}

module.exports = { defineTemporadasModel };

