const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;

const execAsync = promisify(exec);

/**
 * 스크립트 실행 결과
 * @typedef {Object} ScriptResult
 * @property {string} scriptName - 스크립트 이름
 * @property {boolean} success - 실행 성공 여부
 * @property {string} stdout - 표준 출력
 * @property {string} stderr - 표준 에러 출력
 * @property {number} exitCode - 종료 코드
 * @property {number} executionTime - 실행 시간 (ms)
 * @property {any} parsedOutput - 파싱된 출력 (JSON인 경우)
 * @property {string} error - 에러 메시지 (실패한 경우)
 */

/**
 * 스크립트를 실행합니다
 * @param {string} scriptPath - 스크립트 파일 경로
 * @param {Object} options - 실행 옵션
 * @param {string} options.workingDir - 작업 디렉토리
 * @param {Object} options.env - 환경 변수
 * @param {number} options.timeout - 타임아웃 (ms)
 * @param {boolean} options.parseJson - JSON 출력 파싱 여부
 * @returns {Promise<ScriptResult>}
 */
async function runScript(scriptPath, options = {}) {
    const {
        workingDir = process.cwd(),
        env = {},
        timeout = 30000, // 30초 기본 타임아웃
        parseJson = false
    } = options;

    const scriptName = path.basename(scriptPath);
    const startTime = Date.now();

    try {
        // 스크립트 파일 존재 확인
        await fs.access(scriptPath);

        // 스크립트 확장자에 따라 실행 명령어 결정
        const ext = path.extname(scriptPath).toLowerCase();
        let command;

        switch (ext) {
            case '.py':
                command = `python "${scriptPath}"`;
                break;
            case '.js':
                command = `node "${scriptPath}"`;
                break;
            case '.ts':
                command = `ts-node "${scriptPath}"`;
                break;
            case '.sh':
            case '.bash':
                // Windows에서는 Git Bash나 WSL 사용
                if (process.platform === 'win32') {
                    command = `bash "${scriptPath}"`;
                } else {
                    command = `bash "${scriptPath}"`;
                }
                break;
            case '.ps1':
                command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
                break;
            case '.bat':
            case '.cmd':
                command = `"${scriptPath}"`;
                break;
            default:
                // 확장자가 없거나 알 수 없는 경우, 실행 권한이 있으면 직접 실행
                command = `"${scriptPath}"`;
        }

        // 환경 변수 병합
        const envVars = { ...process.env, ...env };

        // 스크립트 실행
        const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            env: envVars,
            timeout,
            maxBuffer: 10 * 1024 * 1024 // 10MB
        });

        const executionTime = Date.now() - startTime;

        // JSON 파싱 시도
        let parsedOutput = null;
        if (parseJson && stdout.trim()) {
            try {
                parsedOutput = JSON.parse(stdout.trim());
            } catch (e) {
                // JSON 파싱 실패는 무시
            }
        }

        return {
            scriptName,
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: 0,
            executionTime,
            parsedOutput,
            error: null
        };
    } catch (error) {
        const executionTime = Date.now() - startTime;

        return {
            scriptName,
            success: false,
            stdout: error.stdout ? error.stdout.trim() : '',
            stderr: error.stderr ? error.stderr.trim() : error.message,
            exitCode: error.code || 1,
            executionTime,
            parsedOutput: null,
            error: error.message
        };
    }
}

/**
 * 여러 스크립트를 병렬로 실행합니다
 * @param {Array<string>} scriptPaths - 스크립트 파일 경로 배열
 * @param {Object} options - 실행 옵션
 * @returns {Promise<Array<ScriptResult>>}
 */
async function runScripts(scriptPaths, options = {}) {
    const promises = scriptPaths.map(scriptPath => runScript(scriptPath, options));
    return Promise.all(promises);
}

/**
 * 여러 스크립트를 순차적으로 실행합니다
 * @param {Array<string>} scriptPaths - 스크립트 파일 경로 배열
 * @param {Object} options - 실행 옵션
 * @returns {Promise<Array<ScriptResult>>}
 */
async function runScriptsSequentially(scriptPaths, options = {}) {
    const results = [];
    for (const scriptPath of scriptPaths) {
        const result = await runScript(scriptPath, options);
        results.push(result);
        // 실패 시 중단 옵션 (기본값: false)
        if (!result.success && options.stopOnError) {
            break;
        }
    }
    return results;
}

module.exports = {
    runScript,
    runScripts,
    runScriptsSequentially
};

