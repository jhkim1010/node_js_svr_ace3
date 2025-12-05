const { DataTypes } = require('sequelize');

function defineManagersModel(sequelize) {
    return sequelize.define('Managers', {
        manager_name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            primaryKey: true,
        },
        password_hash: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        allowed_reports: {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: [], // 허용된 보고서 이름 배열 예: ['stocks', 'items', 'clientes']
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'managers',
        schema: 'public',
        timestamps: false,
        indexes: [
            { unique: true, fields: ['manager_name'] },
        ],
    });
}

module.exports = { defineManagersModel };

