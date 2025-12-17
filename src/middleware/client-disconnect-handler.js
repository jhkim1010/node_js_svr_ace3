/**
 * 클라이언트 연결 종료 감지 및 처리 미들웨어
 * 클라이언트가 요청 처리 중 연결을 끊으면 DB 연결을 즉시 해제하여 pool 낭비 방지
 */

/**
 * 클라이언트 연결 종료 감지 및 처리
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 * @param {Function} next - Express next 함수
 */
function clientDisconnectHandler(req, res, next) {
    // 클라이언트 연결 종료 감지
    const checkClientConnection = () => {
        // 요청이 중단되었는지 확인
        if (req.aborted || req.destroyed) {
            return true;
        }
        
        // 소켓이 종료되었는지 확인
        if (req.socket && (req.socket.destroyed || req.socket.ended)) {
            return true;
        }
        
        return false;
    };
    
    // 클라이언트 연결 종료 이벤트 리스너 등록
    const cleanup = () => {
        // 요청이 이미 완료되었으면 정리 불필요
        if (res.headersSent || res.finished) {
            return;
        }
        
        // 클라이언트 연결이 끊어진 경우
        if (checkClientConnection()) {
            // req에 플래그 설정 (라우터에서 확인 가능)
            req._clientDisconnected = true;
            
            // 응답 종료 (이미 종료되었을 수 있음)
            if (!res.headersSent && !res.finished) {
                res.destroy();
            }
        }
    };
    
    // 소켓 종료 이벤트 감지
    if (req.socket) {
        req.socket.on('close', cleanup);
        req.socket.on('error', cleanup);
    }
    
    // 요청 종료 이벤트 감지
    req.on('aborted', cleanup);
    req.on('close', cleanup);
    
    // 응답 완료 시 리스너 제거
    res.on('finish', () => {
        if (req.socket) {
            req.socket.removeListener('close', cleanup);
            req.socket.removeListener('error', cleanup);
        }
        req.removeListener('aborted', cleanup);
        req.removeListener('close', cleanup);
    });
    
    // req에 체크 함수 추가 (라우터에서 사용 가능)
    req.isClientDisconnected = checkClientConnection;
    
    next();
}

/**
 * 클라이언트 연결이 끊어졌는지 확인하는 헬퍼 함수
 * @param {Object} req - Express request 객체
 * @returns {boolean} 클라이언트 연결이 끊어졌으면 true
 */
function isClientDisconnected(req) {
    if (req._clientDisconnected) {
        return true;
    }
    
    if (req.aborted || req.destroyed) {
        return true;
    }
    
    if (req.socket && (req.socket.destroyed || req.socket.ended)) {
        return true;
    }
    
    return false;
}

module.exports = {
    clientDisconnectHandler,
    isClientDisconnected
};

