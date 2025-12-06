const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getModelForRequest } = require('../models/model-factory');
const { JWT_SECRET } = require('../middleware/auth');

const router = Router();

/**
 * POST /api/auth/login
 * 관리자 로그인 엔드포인트
 * 
 * 요청 본문:
 * {
 *   manager_name: string,
 *   password: string
 * }
 * 
 * 응답:
 * {
 *   success: true,
 *   token: string (JWT 토큰),
 *   manager_name: string,
 *   allowed_reports: string[]
 * }
 */
router.post('/login', async (req, res) => {
    try {
        const { manager_name, password } = req.body;

        // 입력 검증
        if (!manager_name || !password) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'manager_name and password are required',
                received: {
                    manager_name: manager_name || null,
                    password: password ? '***' : null
                }
            });
        }

        // DB 헤더 검증
        if (!req.dbConfig) {
            return res.status(400).json({
                error: 'Database configuration required',
                message: 'DB headers are required for authentication'
            });
        }

        // Managers 모델 가져오기
        const Managers = getModelForRequest(req, 'Managers');

        // 관리자 조회
        const manager = await Managers.findOne({
            where: {
                manager_name: manager_name,
                is_active: true
            },
            raw: true
        });

        if (!manager) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid manager name or password'
            });
        }

        // 비밀번호 검증
        const passwordMatch = await bcrypt.compare(password, manager.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid manager name or password'
            });
        }

        // JWT 토큰 생성
        const token = jwt.sign(
            {
                manager_name: manager.manager_name,
                allowed_reports: manager.allowed_reports || []
            },
            JWT_SECRET,
            {
                expiresIn: '24h' // 24시간 유효
            }
        );

        // 사용 가능한 보고서 목록
        const allowedReports = manager.allowed_reports || [];
        const allReports = ['stocks', 'items', 'clientes', 'gastos', 'ventas', 'alertas', 'codigos', 'todocodigos'];
        
        // 빈 배열이면 모든 보고서 접근 가능
        const availableReports = allowedReports.length === 0 
            ? allReports 
            : allowedReports;

        // 성공 응답
        res.json({
            success: true,
            token: token,
            manager_name: manager.manager_name,
            allowed_reports: allowedReports, // 원본 권한 목록
            available_reports: availableReports, // 실제 사용 가능한 보고서 목록
            is_super_admin: allowedReports.length === 0 // 슈퍼 관리자 여부
        });

    } catch (err) {
        console.error('\n[로그인 오류]');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        console.error('');

        res.status(500).json({
            error: 'Login failed',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

/**
 * POST /api/auth/create-manager
 * 관리자 생성 엔드포인트
 * 
 * 요청 본문:
 * {
 *   manager_name: string (최소 3자),
 *   password: string (최소 6자),
 *   allowed_reports: string[] (선택사항)
 *     - 가능한 값: ["stocks", "items", "clientes", "gastos", "ventas", "alertas", "codigos", "todocodigos"]
 *     - 빈 배열 []: 모든 리소스 접근 가능 (슈퍼 관리자)
 * }
 * 
 * 응답:
 * {
 *   success: true,
 *   message: "Manager created successfully",
 *   manager_name: string,
 *   allowed_reports: string[]
 * }
 */
router.post('/create-manager', async (req, res) => {
    try {
        let { manager_name, password, allowed_reports } = req.body;

        // 입력 검증
        if (!manager_name || !password) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'manager_name and password are required'
            });
        }

        // 관리자 이름 길이 검증 (최소 3자)
        if (manager_name.length < 3) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'manager_name must be at least 3 characters long'
            });
        }

        // 비밀번호 길이 검증 (최소 6자)
        if (password.length < 6) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'password must be at least 6 characters long'
            });
        }

        // allowed_reports 유효성 검증 (선택사항)
        const validReports = ['stocks', 'items', 'clientes', 'gastos', 'ventas', 'alertas', 'codigos', 'todocodigos'];
        if (allowed_reports && Array.isArray(allowed_reports)) {
            const invalidReports = allowed_reports.filter(report => !validReports.includes(report.toLowerCase()));
            if (invalidReports.length > 0) {
                return res.status(400).json({
                    error: 'Bad Request',
                    message: 'Invalid report names in allowed_reports',
                    invalid_reports: invalidReports,
                    valid_reports: validReports
                });
            }
            // 소문자로 정규화
            allowed_reports = allowed_reports.map(r => r.toLowerCase());
        }

        // DB 헤더 검증
        if (!req.dbConfig) {
            return res.status(400).json({
                error: 'Database configuration required',
                message: 'DB headers are required'
            });
        }

        const Managers = getModelForRequest(req, 'Managers');

        // 중복 확인
        const existingManager = await Managers.findOne({
            where: { manager_name: manager_name },
            raw: true
        });

        if (existingManager) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Manager already exists'
            });
        }

        // 비밀번호 해시화
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // 관리자 생성
        const newManager = await Managers.create({
            manager_name: manager_name,
            password_hash: password_hash,
            allowed_reports: allowed_reports || [],
            is_active: true,
            created_at: new Date()
        });

        res.status(201).json({
            success: true,
            message: 'Manager created successfully',
            manager_name: newManager.manager_name,
            allowed_reports: newManager.allowed_reports || []
        });

    } catch (err) {
        console.error('\n[관리자 생성 오류]');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        console.error('');

        res.status(500).json({
            error: 'Failed to create manager',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

/**
 * GET /api/auth/available-reports
 * 현재 토큰으로 사용 가능한 보고서 목록 조회
 * 
 * 헤더:
 * - Authorization: Bearer <token>
 * - x-app-name: be_cool (선택사항)
 */
router.get('/available-reports', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || req.headers.Authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authorization token required'
            });
        }

        const token = authHeader.substring(7);

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired token'
            });
        }

        // DB에서 최신 관리자 정보 확인
        if (!req.dbConfig) {
            return res.status(400).json({
                error: 'Database configuration required',
                message: 'DB headers are required'
            });
        }

        const Managers = getModelForRequest(req, 'Managers');
        const manager = await Managers.findOne({
            where: {
                manager_name: decoded.manager_name,
                is_active: true
            },
            raw: true
        });

        if (!manager) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Manager not found or inactive'
            });
        }

        const allowedReports = manager.allowed_reports || [];
        const allReports = ['stocks', 'items', 'clientes', 'gastos', 'ventas', 'alertas', 'codigos', 'todocodigos'];
        
        const availableReports = allowedReports.length === 0 
            ? allReports 
            : allowedReports;

        res.json({
            success: true,
            manager_name: manager.manager_name,
            allowed_reports: allowedReports,
            available_reports: availableReports,
            is_super_admin: allowedReports.length === 0,
            all_reports: allReports // 모든 가능한 보고서 목록
        });

    } catch (err) {
        console.error('\n[사용 가능한 보고서 조회 오류]');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('');

        res.status(500).json({
            error: 'Failed to get available reports',
            details: err.message,
            errorType: err.constructor.name
        });
    }
});

module.exports = router;

