#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 색상 출력을 위한 유틸리티
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Git 명령어 실행 헬퍼
function execGitCommand(command, options = {}) {
    try {
        const result = execSync(command, {
            encoding: 'utf-8',
            stdio: 'pipe',
            ...options
        });
        return result.trim();
    } catch (error) {
        if (error.status === 0) {
            return error.stdout?.toString().trim() || '';
        }
        throw error;
    }
}

// 변경된 파일 목록 가져오기
function getChangedFiles() {
    try {
        // staged와 unstaged 파일 모두 가져오기
        const staged = execGitCommand('git diff --cached --name-only');
        const unstaged = execGitCommand('git diff --name-only');
        const untracked = execGitCommand('git ls-files --others --exclude-standard');
        
        const allFiles = [
            ...(staged ? staged.split('\n').filter(Boolean) : []),
            ...(unstaged ? unstaged.split('\n').filter(Boolean) : []),
            ...(untracked ? untracked.split('\n').filter(Boolean) : [])
        ];
        
        return [...new Set(allFiles)]; // 중복 제거
    } catch (error) {
        log(`❌ 변경된 파일 확인 실패: ${error.message}`, 'red');
        return [];
    }
}

// 파일 타입별로 분류
function categorizeFiles(files) {
    const categories = {
        routes: [],
        models: [],
        services: [],
        utils: [],
        config: [],
        middleware: [],
        db: [],
        scripts: [],
        docs: [],
        configFiles: [],
        other: []
    };
    
    files.forEach(file => {
        if (file.includes('src/routes/')) {
            categories.routes.push(file);
        } else if (file.includes('src/models/')) {
            categories.models.push(file);
        } else if (file.includes('src/services/')) {
            categories.services.push(file);
        } else if (file.includes('src/utils/')) {
            categories.utils.push(file);
        } else if (file.includes('src/config/')) {
            categories.config.push(file);
        } else if (file.includes('src/middleware/')) {
            categories.middleware.push(file);
        } else if (file.includes('src/db/')) {
            categories.db.push(file);
        } else if (file.includes('scripts/')) {
            categories.scripts.push(file);
        } else if (file.match(/\.(md|txt)$/i)) {
            categories.docs.push(file);
        } else if (file.match(/\.(json|yaml|yml|env|conf)$/i) || file.includes('package.json') || file.includes('Dockerfile')) {
            categories.configFiles.push(file);
        } else {
            categories.other.push(file);
        }
    });
    
    return categories;
}

// 커밋 메시지 자동 생성
function generateCommitMessage(files) {
    if (files.length === 0) {
        return null;
    }
    
    const categories = categorizeFiles(files);
    const messages = [];
    
    // 주요 변경사항 요약
    if (categories.routes.length > 0) {
        const routeNames = categories.routes.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`라우터 수정: ${routeNames}`);
    }
    
    if (categories.models.length > 0) {
        const modelNames = categories.models.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`모델 수정: ${modelNames}`);
    }
    
    if (categories.services.length > 0) {
        const serviceNames = categories.services.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`서비스 수정: ${serviceNames}`);
    }
    
    if (categories.utils.length > 0) {
        const utilNames = categories.utils.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`유틸리티 수정: ${utilNames}`);
    }
    
    if (categories.db.length > 0) {
        const dbNames = categories.db.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`데이터베이스 설정 수정: ${dbNames}`);
    }
    
    if (categories.middleware.length > 0) {
        const middlewareNames = categories.middleware.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`미들웨어 수정: ${middlewareNames}`);
    }
    
    if (categories.config.length > 0) {
        const configNames = categories.config.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`설정 수정: ${configNames}`);
    }
    
    if (categories.scripts.length > 0) {
        const scriptNames = categories.scripts.map(f => path.basename(f, '.js')).join(', ');
        messages.push(`스크립트 추가/수정: ${scriptNames}`);
    }
    
    if (categories.docs.length > 0) {
        const docNames = categories.docs.map(f => path.basename(f)).join(', ');
        messages.push(`문서 업데이트: ${docNames}`);
    }
    
    if (categories.configFiles.length > 0) {
        const configFileNames = categories.configFiles.map(f => path.basename(f)).join(', ');
        messages.push(`설정 파일 수정: ${configFileNames}`);
    }
    
    if (categories.other.length > 0) {
        const otherNames = categories.other.map(f => path.basename(f)).join(', ');
        messages.push(`기타 파일 수정: ${otherNames}`);
    }
    
    // 변경된 파일이 많으면 요약
    if (files.length > 5) {
        return `${messages.slice(0, 3).join(', ')} 외 ${files.length - categories.routes.length - categories.models.length - categories.services.length}개 파일 수정`;
    }
    
    return messages.join(', ');
}

// 메인 함수
function main() {
    log('\n🚀 자동 Git 커밋 및 푸시 시작...\n', 'cyan');
    
    try {
        // Git 저장소인지 확인
        try {
            execGitCommand('git rev-parse --git-dir');
        } catch (error) {
            log('❌ 현재 디렉토리가 Git 저장소가 아닙니다.', 'red');
            process.exit(1);
        }
        
        // 현재 브랜치 확인
        const currentBranch = execGitCommand('git rev-parse --abbrev-ref HEAD');
        log(`📍 현재 브랜치: ${currentBranch}`, 'blue');
        
        // 변경된 파일 확인
        const changedFiles = getChangedFiles();
        
        if (changedFiles.length === 0) {
            log('✅ 커밋할 변경사항이 없습니다.', 'green');
            return;
        }
        
        log(`\n📝 변경된 파일 (${changedFiles.length}개):`, 'yellow');
        changedFiles.forEach(file => {
            log(`   - ${file}`, 'reset');
        });
        
        // 커밋 메시지 생성
        const commitMessage = generateCommitMessage(changedFiles);
        
        if (!commitMessage) {
            log('❌ 커밋 메시지를 생성할 수 없습니다.', 'red');
            return;
        }
        
        log(`\n💬 생성된 커밋 메시지:`, 'cyan');
        log(`   ${commitMessage}`, 'yellow');
        
        // 모든 변경사항 스테이징
        log('\n📦 변경사항 스테이징 중...', 'blue');
        execGitCommand('git add .');
        log('✅ 스테이징 완료', 'green');
        
        // 커밋
        log('\n💾 커밋 중...', 'blue');
        execGitCommand(`git commit -m "${commitMessage}"`);
        log('✅ 커밋 완료', 'green');
        
        // 푸시
        log('\n🚀 원격 저장소로 푸시 중...', 'blue');
        execGitCommand(`git push origin ${currentBranch}`);
        log('✅ 푸시 완료', 'green');
        
        log('\n🎉 모든 작업이 완료되었습니다!', 'green');
        
    } catch (error) {
        log(`\n❌ 오류 발생: ${error.message}`, 'red');
        if (error.stdout) {
            log(`출력: ${error.stdout}`, 'yellow');
        }
        if (error.stderr) {
            log(`에러: ${error.stderr}`, 'red');
        }
        process.exit(1);
    }
}

// 스크립트 실행
if (require.main === module) {
    main();
}

module.exports = { main, generateCommitMessage, getChangedFiles };

