const { Router } = require('express');
const { getModelForRequest } = require('../models/model-factory');
const { Sequelize } = require('sequelize');
const { runScripts } = require('../utils/script-runner');
const path = require('path');
const fs = require('fs').promises;

const router = Router();

// 모든 요청에 대해 헤더와 바디 정보를 먼저 출력하는 미들웨어
router.use((req, res, next) => {
    console.log('\n=== resumen_del_dia 라우터 진입 ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Method:', req.method);
    console.log('Original URL:', req.originalUrl);
    console.log('Path:', req.path);
    console.log('URL:', req.url);
    console.log('Query Parameters:', JSON.stringify(req.query, null, 2));
    
    // 모든 헤더 출력
    console.log('\n--- 모든 헤더 ---');
    const allHeaders = {};
    Object.keys(req.headers).forEach(key => {
        if (key.toLowerCase().includes('password')) {
            allHeaders[key] = '***';
        } else {
            allHeaders[key] = req.headers[key];
        }
    });
    console.log(JSON.stringify(allHeaders, null, 2));
    
    // 관련 DB 헤더만 별도로 출력
    console.log('\n--- DB 관련 헤더 ---');
    const dbHeaders = {
        'x-db-host': req.headers['x-db-host'] || req.headers['db-host'] || '없음',
        'x-db-port': req.headers['x-db-port'] || req.headers['db-port'] || '없음',
        'x-db-name': req.headers['x-db-name'] || req.headers['db-name'] || '없음',
        'x-db-user': req.headers['x-db-user'] || req.headers['db-user'] || '없음',
        'x-db-password': req.headers['x-db-password'] || req.headers['db-password'] ? '***' : '없음',
        'x-db-ssl': req.headers['x-db-ssl'] || req.headers['db-ssl'] || '없음'
    };
    console.log(JSON.stringify(dbHeaders, null, 2));
    
    // Body 정보 출력
    console.log('\n--- Body 정보 ---');
    if (req.body && Object.keys(req.body).length > 0) {
        const bodyCopy = JSON.parse(JSON.stringify(req.body));
        // 비밀번호 필드 마스킹
        if (bodyCopy.password) bodyCopy.password = '***';
        if (bodyCopy.db_password) bodyCopy.db_password = '***';
        if (bodyCopy['x-db-password']) bodyCopy['x-db-password'] = '***';
        console.log(JSON.stringify(bodyCopy, null, 2));
    } else {
        console.log('없음 (GET 요청이거나 Body가 비어있음)');
    }
    
    // DB Config 정보 출력
    console.log('\n--- DB Config (req.dbConfig) ---');
    if (req.dbConfig) {
        console.log(JSON.stringify({
            host: req.dbConfig.host,
            port: req.dbConfig.port,
            database: req.dbConfig.database,
            user: req.dbConfig.user,
            password: '***',
            ssl: req.dbConfig.ssl
        }, null, 2));
    } else {
        console.log('없음 (아직 parseDbHeader 미들웨어를 통과하지 않았거나 설정되지 않음)');
    }
    
    console.log('===================================\n');
    next();
});

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
    console.log('→ resumen_del_dia 핸들러 실행 시작');
    
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
            console.error('\n❌ 실패: 필수 정보 부족');
            console.error('부족한 정보:');
            missingHeaders.forEach((msg, idx) => {
                console.error(`   ${idx + 1}. ${msg}`);
            });
            console.error('');
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
        
        // 날짜 파라미터 처리
        // 쿼리 파라미터에서 날짜 받기: fecha, date, target_date 등
        let targetDate = req.query.fecha || req.query.date || req.query.target_date;
        
        // 날짜가 제공되지 않으면 기본값 사용
        // vcodes는 어제 날짜, 나머지는 오늘 날짜
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
            // 기본값: vcodes는 어제, 나머지는 오늘
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            vcodeDate = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
            otherDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
        }
        
        // 쿼리 1: vcodes 데이터 집계 (b_mercadopago is false)
        // 조건: fecha = target_date AND b_cancelado is false AND borrado is false AND b_mercadopago is false
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
                        vcodeDate
                    ),
                    { b_cancelado: false },
                    { borrado: false },
                    { b_mercadopago: false }
                ]
            },
            raw: true
        });
        
        // 쿼리 2: gastos 데이터 집계
        // 조건: fecha = target_date AND borrado is false
        const gastosResult = await Gastos.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'gasto_count'],
                [sequelize.fn('SUM', sequelize.col('costo')), 'total_gasto_day']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        otherDate
                    ),
                    { borrado: false }
                ]
            },
            raw: true
        });
        
        // 쿼리 3: vdetalle 데이터 집계
        // 조건: fecha1 = target_date AND borrado is false
        const vdetalleResult = await Vdetalle.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_discount_event'],
                [sequelize.fn('SUM', sequelize.col('precio')), 'total_discount_day']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha1')),
                        otherDate
                    ),
                    { borrado: false }
                ]
            },
            raw: true
        });
        
        // 쿼리 4: vcodes 데이터 집계 (MercadoPago)
        // 조건: fecha = target_date AND b_cancelado is false AND borrado is false AND b_mercadopago is true
        const vcodeMpagoResult = await Vcode.findAll({
            attributes: [
                [sequelize.fn('COUNT', sequelize.col('*')), 'count_mpago_total'],
                [sequelize.fn('SUM', sequelize.col('tpago')), 'total_mpago_day']
            ],
            where: {
                [Sequelize.Op.and]: [
                    Sequelize.where(
                        Sequelize.fn('DATE', Sequelize.col('fecha')),
                        otherDate
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
        
        const responseData = {
            fecha: targetDate || otherDate, // 요청된 날짜 또는 오늘 날짜 (YYYY-MM-DD)
            fecha_vcodes: vcodeDate, // vcodes 쿼리에 사용된 날짜
            fecha_otros: otherDate, // 다른 쿼리에 사용된 날짜
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
        };
        
        // 성공 시 반환 내용 출력
        console.log('\n✅ 성공: resumen_del_dia 응답 데이터');
        console.log('==========================================');
        console.log(JSON.stringify(responseData, null, 2));
        console.log('==========================================\n');
        
        res.json(responseData);
    } catch (err) {
        console.error('\n❌ 실패: resumen_del_dia 처리 중 오류 발생');
        console.error('==========================================');
        console.error('Error Type:', err.constructor.name);
        console.error('Error Message:', err.message);
        console.error('Error Stack:', err.stack);
        if (err.original) {
            console.error('Original Error:', err.original);
            console.error('Original Error Code:', err.original.code);
            console.error('Original Error Detail:', err.original.detail);
        }
        
        // 부족한 정보 분석
        const missingInfo = [];
        if (!req.dbConfig) {
            missingInfo.push('DB 설정 정보가 없습니다');
        } else {
            if (!req.dbConfig.host) missingInfo.push('DB 호스트 정보가 없습니다');
            if (!req.dbConfig.port) missingInfo.push('DB 포트 정보가 없습니다');
            if (!req.dbConfig.database) missingInfo.push('DB 이름 정보가 없습니다');
            if (!req.dbConfig.user) missingInfo.push('DB 사용자 정보가 없습니다');
            if (!req.dbConfig.password) missingInfo.push('DB 비밀번호 정보가 없습니다');
        }
        
        // 데이터베이스 연결 오류인지 확인
        if (err.name === 'SequelizeConnectionError' || err.original?.code === 'ECONNREFUSED') {
            missingInfo.push('데이터베이스 연결 실패 - 호스트, 포트, 인증 정보를 확인하세요');
        }
        
        if (err.name === 'SequelizeAccessDeniedError' || err.original?.code === '28P01') {
            missingInfo.push('데이터베이스 인증 실패 - 사용자 이름과 비밀번호를 확인하세요');
        }
        
        if (err.name === 'SequelizeDatabaseError' || err.original?.code === '3D000') {
            missingInfo.push('데이터베이스가 존재하지 않습니다 - 데이터베이스 이름을 확인하세요');
        }
        
        if (missingInfo.length > 0) {
            console.error('\n부족한 정보:');
            missingInfo.forEach((info, idx) => {
                console.error(`   ${idx + 1}. ${info}`);
            });
        }
        
        console.error('==========================================\n');
        
        res.status(500).json({ 
            success: false,
            error: 'Failed to get resumen del dia', 
            message: 'resumen_del_dia 조회 중 오류가 발생했습니다',
            details: err.message,
            errorType: err.constructor.name,
            originalError: err.original ? {
                message: err.original.message,
                code: err.original.code,
                detail: err.original.detail
            } : null,
            missingInfo: missingInfo.length > 0 ? missingInfo : undefined
        });
    }
});

module.exports = router;

