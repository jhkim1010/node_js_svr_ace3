const { DataTypes, Sequelize } = require('sequelize');

function defineFventasModel(sequelize) {
    return sequelize.define('Fventas', {
        id_fventa: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: Sequelize.literal("nextval('fventa_seq'::regclass)"),
        },
        numfactura: { 
            type: DataTypes.STRING(20), 
            allowNull: false,
            primaryKey: true,
        },
        tipofactura: { 
            type: DataTypes.STRING(3), 
            allowNull: false,
            primaryKey: true,
        },
        hora: { type: DataTypes.STRING(20), allowNull: true },
        dni: { type: DataTypes.STRING(20), allowNull: true },
        clientenombre: { type: DataTypes.STRING(210), allowNull: true },
        monto: { type: DataTypes.DOUBLE, allowNull: true },
        xefectivo: { type: DataTypes.DOUBLE, allowNull: true },
        xbanco: { type: DataTypes.DOUBLE, allowNull: true },
        xcheque: { type: DataTypes.DOUBLE, allowNull: true },
        numcheque: { type: DataTypes.STRING(20), allowNull: true },
        sucursal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
        utime: { type: DataTypes.DATE, allowNull: true },
        fecha: { type: DataTypes.DATEONLY, allowNull: true },
        borrado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ref_num: { type: DataTypes.STRING(50), allowNull: true },
        cae: { type: DataTypes.STRING(50), allowNull: true },
        vencimiento_cae: { type: DataTypes.DATEONLY, allowNull: true },
        punto_venta: { type: DataTypes.INTEGER, allowNull: true },
        afip_number: { type: DataTypes.INTEGER, allowNull: true },
        tipo_pago: { type: DataTypes.STRING(200), allowNull: true },
        b_impreso_x_comandera: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
        terminal: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1 },
        ref_id_vcode: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 0 },
        b_sincronizado_node_svr: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    }, {
        tableName: 'fventas',
        schema: 'public',
        timestamps: false,
        // 복합 기본 키: (numfactura, tipofactura, sucursal, borrado)
        // Sequelize는 복합 기본 키를 인덱스로만 정의할 수 있음
        indexes: [
            { 
                unique: true, 
                name: 'fventa2.pr', 
                fields: ['numfactura', 'tipofactura', 'sucursal', 'borrado'] 
            }
        ],
    });
}

module.exports = { defineFventasModel };

