const fs = require('fs');
const path = require('path');

const BUILD_INFO_FILE = path.join(__dirname, '../../.build-info.json');

/**
 * 빌드 날짜를 저장합니다
 */
function saveBuildDate() {
    const buildDate = new Date().toISOString();
    const buildInfo = {
        buildDate: buildDate,
        buildDateFormatted: formatBuildDate(buildDate)
    };
    
    try {
        fs.writeFileSync(BUILD_INFO_FILE, JSON.stringify(buildInfo, null, 2), 'utf8');
        return buildInfo;
    } catch (err) {
        console.error('Failed to save build date:', err);
        return null;
    }
}

/**
 * 저장된 빌드 날짜를 읽습니다
 */
function getBuildDate() {
    try {
        if (fs.existsSync(BUILD_INFO_FILE)) {
            const content = fs.readFileSync(BUILD_INFO_FILE, 'utf8');
            const buildInfo = JSON.parse(content);
            return buildInfo;
        }
    } catch (err) {
        console.error('Failed to read build date:', err);
    }
    
    // 빌드 정보 파일이 없으면 현재 파일의 수정 시간 사용
    try {
        const serverFile = path.join(__dirname, '../server.js');
        const stats = fs.statSync(serverFile);
        const buildDate = stats.mtime.toISOString();
        return {
            buildDate: buildDate,
            buildDateFormatted: formatBuildDate(buildDate)
        };
    } catch (err) {
        // 최후의 수단: 현재 시간 사용
        const buildDate = new Date().toISOString();
        return {
            buildDate: buildDate,
            buildDateFormatted: formatBuildDate(buildDate)
        };
    }
}

/**
 * 날짜를 읽기 쉬운 형식으로 포맷합니다
 */
function formatBuildDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 빌드 정보를 콘솔에 표시합니다
 */
function displayBuildInfo() {
    const buildInfo = getBuildDate();
    const separator = '='.repeat(60);
    
    console.log('\n' + separator);
    console.log(`  Build date: ${buildInfo.buildDateFormatted}`);
    console.log(separator + '\n');
}

module.exports = {
    saveBuildDate,
    getBuildDate,
    displayBuildInfo,
    formatBuildDate
};

