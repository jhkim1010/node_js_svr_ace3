const jwt = require('jsonwebtoken');
const { getModelForRequest } = require('../models/model-factory');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * JWT 토큰 검증 미들웨어
 * req.headers.authorization에서 Bearer 토큰을 추출하여 검증
 * 검증 성공 시 req.manager에 관리자 정보 저장
 */
async function authenticateManager(req, res, next) {
    try {
        // Authorization 헤더에서 토큰 추출
        const authHeader = req.headers.authorization || req.headers.Authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authorization token required. Format: Bearer <token>'
            });
        }

        const token = authHeader.substring(7); // 'Bearer ' 제거

        // 토큰 검증
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired token',
                details: err.message
            });
        }

        // DB에서 관리자 정보 확인 (토큰이 유효하더라도 DB에서 활성 상태 확인)
        if (!req.dbConfig) {
            return res.status(500).json({
                error: 'Database configuration not found',
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

        // req 객체에 관리자 정보 저장
        req.manager = {
            manager_name: manager.manager_name,
            allowed_reports: manager.allowed_reports || []
        };

        next();
    } catch (err) {
        console.error('\n[인증 미들웨어 오류]');
        console.error('   Error type:', err.constructor.name);
        console.error('   Error message:', err.message);
        console.error('   Full error:', err);
        console.error('');

        return res.status(500).json({
            error: 'Authentication error',
            details: err.message,
            errorType: err.constructor.name
        });
    }
}

/**
 * 보고서 접근 권한 체크 미들웨어
 * req.manager.allowed_reports에 요청한 보고서가 있는지 확인
 */
function checkReportPermission(reportName) {
    return (req, res, next) => {
        if (!req.manager) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Manager authentication required'
            });
        }

        const allowedReports = req.manager.allowed_reports || [];

        // 빈 배열이면 모든 보고서 접근 허용 (관리자)
        if (allowedReports.length === 0) {
            return next();
        }

        // 특정 보고서만 허용된 경우
        if (!allowedReports.includes(reportName)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Access denied to report: ${reportName}`,
                allowed_reports: allowedReports
            });
        }

        next();
    };
}

module.exports = {
    authenticateManager,
    checkReportPermission,
    JWT_SECRET
};

