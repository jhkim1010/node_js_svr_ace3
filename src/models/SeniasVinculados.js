const { DataTypes, Sequelize } = require('sequelize');

function defineSeniasVinculadosModel(sequelize) {
    return sequelize.define('SeniasVinculados', {
        id_senia_vinculado: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal("nextval('senia_vinculado_seq'::regclass)"),
        },
        ref_id_reservado: { type: DataTypes.INTEGER, allowNull: true },
        ref_id_senia: { type: DataTypes.INTEGER, allowNull: true },
        b_usado_x_descuento: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
        utime: { type: DataTypes.DATE, allowNull: true, defaultValue: Sequelize.literal('now()') },
        ref_id_vcode: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
        ref_id_cliente: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
        ref_uuid_vcode: { type: DataTypes.UUID, allowNull: true },
        ref_uuid_cliente: { type: DataTypes.UUID, allowNull: true },
        borrado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        sucursal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
        uuid_senias_vinculado: { type: DataTypes.UUID, allowNull: true },
    }, {
        tableName: 'senias_vinculados',
        schema: 'public',
        timestamps: false,
        indexes: [
            { 
                unique: true, 
                name: 'senia_vinculado.pr', 
                fields: ['id_senia_vinculado'] 
            }
        ],
    });
}

module.exports = { defineSeniasVinculadosModel };

