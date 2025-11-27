const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { runScripts } = require('../utils/script-runner');
const path = require('path');
const fs = require('fs').promises;

const router = Router();

/**
 * scripts 폴더에서 실행할 스크립트 목록을 가져옵니다
 * @returns {Promise<Array<string>>}
 */
async function getScriptsToRun() {
    const scriptsDir = path.join(process.cwd(), 'scripts');
    
    try {
        // scripts 폴더 존재 확인
        await fs.access(scriptsDir);
        
        // 폴더 내 파일 목록 가져오기
        const files = await fs.readdir(scriptsDir);
        
        // 실행 가능한 스크립트 파일 필터링
        const scriptExtensions = ['.py', '.js', '.ts', '.sh', '.bash', '.ps1', '.bat', '.cmd'];
        const scripts = files
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return scriptExtensions.includes(ext);
            })
            .map(file => path.join(scriptsDir, file));
        
        return scripts;
    } catch (error) {
        // scripts 폴더가 없거나 접근할 수 없는 경우 빈 배열 반환
        return [];
    }
}

router.get('/', async (req, res) => {
    try {
        const Vcode = getModelForRequest(req, 'Vcode');
        const Gastos = getModelForRequest(req, 'Gastos');
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const sequelize = Vcode.sequelize;
        
        // 쿼리 1: vcodes 데이터 집계 (어제 날짜, b_mercadopago is false)
        // 조건: fecha = current_date - 1 AND b_cancelado is false AND borrado is false AND b_mercadopago is false
        const vcodeResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'operation_count'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_venta_day'],
                [sequelize.fn('SUM', sequelize.col('tefectivo')), 'total_efectivo_day'],
                [sequelize.fn('SUM', sequelize.col('tcredito')), 'total_credito_day'],
                [sequelize.fn('SUM', sequelize.col('tbanco')), 'total_banco_day'],
                [sequelize.fn('SUM', sequelize.col('tfavor')), 'total_favor_day'],
                [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_count_ropas']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        Sequelize.literal('CURRENT_DATE - INTERVAL \'1 day\'')
                    ),
                    { b_cancelado: false },
                    { borrado: false },
                    { b_mercadopago: false }
                ]
            },
            raw: true
        });
        
        // 쿼리 2: gastos 데이터 집계
        // 조건: fecha = current_date AND borrado is false
        const gastosResult = await Gastos.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'gasto_count'],
                [sequelize.fn('SUM', sequelize.col('costo')), 'total_gasto_day']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        Sequelize.fn('CURRENT_DATE')
                    ),
                    { borrado: false }
                ]
            },
            raw: true
        });
        
        // 쿼리 3: vdetalle 데이터 집계
        // 조건: fecha1 = current_date AND borrado is false
        const vdetalleResult = await Vdetalle.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_discount_event'],
                [sequelize.fn('SUM', sequelize.col('precio')), 'total_discount_day']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha1')),
                        Sequelize.fn('CURRENT_DATE')
                    ),
                    { borrado: false }
                ]
            },
            raw: true
        });
        
        // 쿼리 4: vcodes 데이터 집계 (MercadoPago)
        // 조건: fecha = current_date AND b_cancelado is false AND borrado is false AND b_mercadopago is true
        const vcodeMpagoResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_mpago_total'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_mpago_day']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        Sequelize.fn('CURRENT_DATE')
                    ),
                    { b_cancelado: false },
                    { borrado: false },
                    { b_mercadopago: true }
                ]
            },
            raw: true
        });
        
        const vcodeSummary = vcodeResult && vcodeResult.length > 0 ? vcodeResult[0] : null;
        const gastosSummary = gastosResult && gastosResult.length > 0 ? gastosResult[0] : null;
        const vdetalleSummary = vdetalleResult && vdetalleResult.length > 0 ? vdetalleResult[0] : null;
        const vcodeMpagoSummary = vcodeMpagoResult && vcodeMpagoResult.length > 0 ? vcodeMpagoResult[0] : null;
        
        // 스크립트 실행
        let scriptPaths = [];
        
        // 쿼리 파라미터로 스크립트 지정 가능
        if (req.query.scripts) {
            // 쉼표로 구분된 스크립트 이름 또는 경로
            const scriptNames = req.query.scripts.split(',').map(s => s.trim());
            const scriptsDir = path.join(process.cwd(), 'scripts');
            
            for (const scriptName of scriptNames) {
                // 절대 경로인지 확인
                if (path.isAbsolute(scriptName)) {
                    scriptPaths.push(scriptName);
                } else {
                    // 상대 경로인 경우 scripts 폴더 기준으로 찾기
                    scriptPaths.push(path.join(scriptsDir, scriptName));
                }
            }
        } else {
            // 쿼리 파라미터가 없으면 scripts 폴더의 모든 스크립트 실행
            scriptPaths = await getScriptsToRun();
        }
        
        let scriptResults = [];
        
        if (scriptPaths.length > 0) {
            try {
                scriptResults = await runScripts(scriptPaths, {
                    parseJson: true, // JSON 출력 자동 파싱
                    timeout: parseInt(req.query.scriptTimeout) || 60000 // 타임아웃 설정 가능 (기본 60초)
                });
            } catch (scriptError) {
                console.error('Script execution error:', scriptError);
                // 스크립트 실행 실패해도 계속 진행
            }
        }
        
        res.json({
            fecha: new Date().toISOString().split('T')[0], // 오늘 날짜 (YYYY-MM-DD)
            vcodes: {
                operation_count: parseInt(vcodeSummary?.operation_count || 0, 10),
                total_venta_day: parseFloat(vcodeSummary?.total_venta_day || 0),
                total_efectivo_day: parseFloat(vcodeSummary?.total_efectivo_day || 0),
                total_credito_day: parseFloat(vcodeSummary?.total_credito_day || 0),
                total_banco_day: parseFloat(vcodeSummary?.total_banco_day || 0),
                total_favor_day: parseFloat(vcodeSummary?.total_favor_day || 0),
                total_count_ropas: parseFloat(vcodeSummary?.total_count_ropas || 0)
            },
            gastos: {
                gasto_count: parseInt(gastosSummary?.gasto_count || 0, 10),
                total_gasto_day: parseFloat(gastosSummary?.total_gasto_day || 0)
            },
            vdetalle: {
                count_discount_event: parseInt(vdetalleSummary?.count_discount_event || 0, 10),
                total_discount_day: parseFloat(vdetalleSummary?.total_discount_day || 0)
            },
            vcodes_mpago: {
                count_mpago_total: parseInt(vcodeMpagoSummary?.count_mpago_total || 0, 10),
                total_mpago_day: parseFloat(vcodeMpagoSummary?.total_mpago_day || 0)
            },
            scripts: {
                executed: scriptPaths.length,
                results: scriptResults.map(result => ({
                    scriptName: result.scriptName,
                    success: result.success,
                    executionTime: result.executionTime,
                    output: result.parsedOutput || result.stdout,
                    error: result.error || result.stderr || null
                }))
            }
        });
    } catch (err) {
        console.error('\nERROR: Resumen del dia fetch error:');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        if (err.original) {
            console.error('   Original error:', err.original);
        }
        console.error('');
        res.status(500).json({ 
            error: 'Failed to get resumen del dia', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
    }
});

module.exports = router;

