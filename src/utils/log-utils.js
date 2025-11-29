// 공통 로깅 유틸리티: 스택에서 파일/라인 정보를 추출해서 함께 출력

/**
 * 호출 스택에서 "실제 호출자"의 파일 경로와 라인/컬럼 정보를 추출합니다.
 * - log-utils.js 내부 프레임은 건너뛰고, 처음으로 log-utils.js가 아닌 프레임을 선택합니다.
 * @returns {{file: string, line: number, column: number, raw: string}|null}
 */
function getCallerLocation() {
    try {
        const err = new Error();
        if (!err.stack) return null;

        const lines = err.stack.split('\n');
        // 0: Error, 1 이후가 실제 스택 프레임
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            // log-utils.js 자체는 건너뛰기
            if (line.includes('log-utils.js')) {
                continue;
            }
            // 예: "at Object.<anonymous> (/path/to/file.js:123:45)"
            const match = line.match(/\(?([^()]+):(\d+):(\d+)\)?$/);
            if (!match) {
                continue;
            }

            const file = match[1];
            const lineNum = parseInt(match[2], 10) || 0;
            const column = parseInt(match[3], 10) || 0;

            return { file, line: lineNum, column, raw: line };
        }

        // 적당한 프레임을 찾지 못했으면 null
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 에러 로그를 찍을 때, 호출 위치(파일:라인)를 함께 출력합니다.
 * @param  {...any} args - console.error 에 전달할 인자들
 */
function logErrorWithLocation(...args) {
    const loc = getCallerLocation();
    if (loc) {
        console.error(`[${loc.file}:${loc.line}]`, ...args);
    } else {
        console.error('[unknown:0]', ...args);
    }
}

/**
 * 정보 로그를 찍을 때, 호출 위치(파일:라인)를 함께 출력합니다.
 * @param  {...any} args - console.log 에 전달할 인자들
 */
function logInfoWithLocation(...args) {
    const loc = getCallerLocation();
    if (loc) {
        console.log(`[${loc.file}:${loc.line}]`, ...args);
    } else {
        console.log('[unknown:0]', ...args);
    }
}

module.exports = {
    getCallerLocation,
    logErrorWithLocation,
    logInfoWithLocation,
};
