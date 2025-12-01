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

router.post('/', async (req, res) => {
    try {
        // 필수 DB 헤더 검증
        const missingHeaders = [];
        if (!req.dbConfig) {
            missingHeaders.push('DB 설정 정보가 없습니다. 헤더에 DB 연결 정보가 필요합니다.');
        } else {
            if (!req.dbConfig.host) missingHeaders.push('x-db-host 헤더가 필요합니다');
            if (!req.dbConfig.port) missingHeaders.push('x-db-port 헤더가 필요합니다');
            if (!req.dbConfig.database) missingHeaders.push('x-db-name 헤더가 필요합니다');
            if (!req.dbConfig.user) missingHeaders.push('x-db-user 헤더가 필요합니다');
            if (!req.dbConfig.password) missingHeaders.push('x-db-password 헤더가 필요합니다');
        }
        
        if (missingHeaders.length > 0) {
            return res.status(400).json({
                success: false,
                error: '필수 정보 부족',
                message: 'Required information is missing',
                missing: missingHeaders,
                required_headers: [
                    'x-db-host (또는 db-host): PostgreSQL 서버 주소',
                    'x-db-port (또는 db-port): PostgreSQL 포트 번호',
                    'x-db-name (또는 db-name): 데이터베이스 이름',
                    'x-db-user (또는 db-user): 데이터베이스 사용자 이름',
                    'x-db-password (또는 db-password): 데이터베이스 비밀번호'
                ],
                optional_headers: [
                    'x-db-ssl (또는 db-ssl): SSL 사용 여부 (true/false)'
                ]
            });
        }
        
        const Vcode = getModelForRequest(req, 'Vcode');
        const Gastos = getModelForRequest(req, 'Gastos');
        const Vdetalle = getModelForRequest(req, 'Vdetalle');
        const sequelize = Vcode.sequelize;
        
        // 요청 본문에서 date와 sucursal 받기
        let targetDate = req.body?.date || req.body?.fecha;
        const sucursal = req.body?.sucursal;
        
        // 날짜가 제공되지 않으면 현재 날짜 사용
        let vcodeDate, otherDate;
        
        if (targetDate) {
            // 날짜 유효성 검사
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(targetDate)) {
                return res.status(400).json({
                    error: '날짜 형식 오류',
                    message: 'Invalid date format',
                    received: targetDate,
                    expected: 'YYYY-MM-DD 형식 (예: 2024-01-15)'
                });
            }
            // 모든 쿼리에 동일한 날짜 사용
            vcodeDate = targetDate;
            otherDate = targetDate;
        } else {
            // 기본값: 현재 날짜 사용
            const today = new Date();
            const dateString = today.toISOString().split('T')[0]; // YYYY-MM-DD
            vcodeDate = dateString;
            otherDate = dateString;
        }
        
        // 쿼리 1: vcodes 데이터 집계 (b_mercadopago is false) - Sucursal별 그룹화
        // 조건: fecha = target_date AND b_cancelado is false AND borrado is false AND b_mercadopago is false
        const vcodeWhereConditions = [
            { fecha: vcodeDate },
            { b_cancelado: false },
            { borrado: false },
            { b_mercadopago: false }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            vcodeWhereConditions.push({ sucursal: sucursal });
        }
        
        const vcodeResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'operation_count'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_venta_day'],
                [sequelize.fn('SUM', sequelize.col('tefectivo')), 'total_efectivo_day'],
                [sequelize.fn('SUM', sequelize.col('tcredito')), 'total_credito_day'],
                [sequelize.fn('SUM', sequelize.col('tbanco')), 'total_banco_day'],
                [sequelize.fn('SUM', sequelize.col('tfavor')), 'total_favor_day'],
                [sequelize.fn('SUM', sequelize.col('cntropas')), 'total_count_ropas'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: vcodeWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 2: gastos 데이터 집계 - Sucursal별 그룹화
        // 조건: fecha = target_date AND borrado is false
        const gastosWhereConditions = [
            { fecha: otherDate },
            { borrado: false }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            gastosWhereConditions.push({ sucursal: sucursal });
        }
        
        const gastosResult = await Gastos.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'gasto_count'],
                [sequelize.fn('SUM', sequelize.col('costo')), 'total_gasto_day'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: gastosWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 3: vdetalle 데이터 집계 - Sucursal별 그룹화
        // 조건: fecha1 = target_date AND borrado is false
        const vdetalleWhereConditions = [
            { fecha1: otherDate },
            { borrado: false }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            vdetalleWhereConditions.push({ sucursal: sucursal });
        }
        
        const vdetalleResult = await Vdetalle.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_discount_event'],
                [sequelize.fn('SUM', sequelize.col('precio')), 'total_discount_day'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: vdetalleWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // 쿼리 4: vcodes 데이터 집계 (MercadoPago) - Sucursal별 그룹화
        // 조건: fecha = target_date AND b_cancelado is false AND borrado is false AND b_mercadopago is true
        const vcodeMpagoWhereConditions = [
            { fecha: otherDate },
            { b_cancelado: false },
            { borrado: false },
            { b_mercadopago: true }
        ];
        
        // sucursal 필터링 추가 (제공된 경우)
        if (sucursal) {
            vcodeMpagoWhereConditions.push({ sucursal: sucursal });
        }
        
        const vcodeMpagoResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_mpago_total'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_mpago_day'],
                'sucursal'
            ],
            where: {
                [Sequelize.Op.and]: vcodeMpagoWhereConditions
            },
            group: ['sucursal'],
            order: [['sucursal', 'ASC']],
            raw: true
        });
        
        // Sucursal별로 그룹화된 결과를 배열로 변환
        const vcodeSummary = (vcodeResult || []).map(item => ({
            sucursal: item.sucursal || null,
            operation_count: parseInt(item.operation_count || 0, 10),
            total_venta_day: parseFloat(item.total_venta_day || 0),
            total_efectivo_day: parseFloat(item.total_efectivo_day || 0),
            total_credito_day: parseFloat(item.total_credito_day || 0),
            total_banco_day: parseFloat(item.total_banco_day || 0),
            total_favor_day: parseFloat(item.total_favor_day || 0),
            total_count_ropas: parseFloat(item.total_count_ropas || 0)
        }));
        
        const gastosSummary = (gastosResult || []).map(item => ({
            sucursal: item.sucursal || null,
            gasto_count: parseInt(item.gasto_count || 0, 10),
            total_gasto_day: parseFloat(item.total_gasto_day || 0)
        }));
        
        const vdetalleSummary = (vdetalleResult || []).map(item => ({
            sucursal: item.sucursal || null,
            count_discount_event: parseInt(item.count_discount_event || 0, 10),
            total_discount_day: parseFloat(item.total_discount_day || 0)
        }));
        
        const vcodeMpagoSummary = (vcodeMpagoResult || []).map(item => ({
            sucursal: item.sucursal || null,
            count_mpago_total: parseInt(item.count_mpago_total || 0, 10),
            total_mpago_day: parseFloat(item.total_mpago_day || 0)
        }));
        
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
        
        const responseData = {
            fecha: targetDate || otherDate, // 요청된 날짜 또는 현재 날짜 (YYYY-MM-DD)
            fecha_vcodes: vcodeDate, // vcodes 쿼리에 사용된 날짜
            fecha_otros: otherDate, // 다른 쿼리에 사용된 날짜
            vcodes: vcodeSummary, // Sucursal별 배열
            gastos: gastosSummary, // Sucursal별 배열
            vdetalle: vdetalleSummary, // Sucursal별 배열
            vcodes_mpago: vcodeMpagoSummary, // Sucursal별 배열
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
        };
        
        res.json(responseData);
    } catch (err) {
        res.status(500).json({ 
            error: 'Failed to get resumen del dia', 
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? err.original.message : null
        });
    }
});

module.exports = router;

