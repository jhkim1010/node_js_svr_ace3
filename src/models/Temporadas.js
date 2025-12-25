const { DataTypes, Sequelize } = require('sequelize');

function defineTemporadasModel(sequelize) {
    return sequelize.define('Temporadas', {
        id_temporada: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
            unique: true,
            // defaultValue 제거: 클라이언트가 값을 보내면 그 값을 사용하고,
            // 값을 보내지 않으면 데이터베이스 레벨의 기본값(시퀀스)이 자동으로 사용됨
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

