// 공통 로깅 유틸리티: 스택에서 파일/라인 정보를 추출해서 함께 출력

/**
 * 호출 스택에서 파일 경로와 라인/컬럼 정보를 추출합니다.
 * @param {number} stackOffset - stack 상에서 몇 번째 줄을 사용할지 (0: Error, 1: 현재 함수, 2: 호출자)
 * @returns {{file: string, line: number, column: number, raw: string}|null}
 */
function getCallerLocation(stackOffset = 2) {
    try {
        const err = new Error();
        if (!err.stack) return null;

        const lines = err.stack.split('\n');
        if (lines.length <= stackOffset) return null;

        const target = lines[stackOffset].trim();
        // 예: "at Object.<anonymous> (/path/to/file.js:123:45)"
        const match = target.match(/\(?([^()]+):(\d+):(\d+)\)?$/);
        if (!match) {
            return { file: 'unknown', line: 0, column: 0, raw: target };
        }

        const file = match[1];
        const line = parseInt(match[2], 10) || 0;
        const column = parseInt(match[3], 10) || 0;

        return { file, line, column, raw: target };
    } catch (e) {
        return null;
    }
}

/**
 * 에러 로그를 찍을 때, 호출 위치(파일:라인)를 함께 출력합니다.
 * @param  {...any} args - console.error 에 전달할 인자들
 */
function logErrorWithLocation(...args) {
    const loc = getCallerLocation(2); // 호출자 기준
    if (loc) {
        console.error(`[${loc.file}:${loc.line}]`, ...args);
    } else {
        console.error('[unknown:0]', ...args);
    }
}

module.exports = {
    getCallerLocation,
    logErrorWithLocation,
};
