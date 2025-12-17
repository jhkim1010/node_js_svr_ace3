// Vcodes 배치 처리 결과를 화면에 표시하는 예제 코드
// 서버 응답을 받아서 각 항목의 처리 결과(insert/update/skip)와 이유를 표시합니다

/**
 * Vcodes 배치 처리 결과를 화면에 표시하는 함수
 * @param {Object} response - 서버 응답 객체
 */
function displayVcodesResults(response) {
    console.log('\n========================================');
    console.log('Vcodes 배치 처리 결과');
    console.log('========================================\n');
    
    // Overall summary
    console.log(`📊 Overall Summary:`);
    console.log(`   Total: ${response.total} items`);
    console.log(`   Success: ${response.processed} items`);
    console.log(`   Created: ${response.created} items`);
    console.log(`   Updated: ${response.updated} items`);
    if (response.skipped) {
        console.log(`   Skipped: ${response.skipped} items`);
    }
    console.log(`   Failed: ${response.failed} items`);
    console.log('');
    
    // Detailed results for each item
    if (response.results && response.results.length > 0) {
        console.log('✅ Successful Items:');
        console.log('────────────────────────────────────────');
        
        response.results.forEach((result, idx) => {
            const identifier = result.identifier || {};
            const vcodeId = identifier.vcode_id || result.data?.vcode_id || 'N/A';
            const sucursal = identifier.sucursal || result.data?.sucursal || 'N/A';
            const vcode = identifier.vcode || result.data?.vcode || 'N/A';
            
            // 액션에 따른 이모지와 색상
            let actionEmoji = '';
            let actionText = '';
            
            switch (result.action) {
                case 'created':
                    actionEmoji = '🆕';
                    actionText = 'Created';
                    break;
                case 'updated':
                    actionEmoji = '🔄';
                    actionText = 'Updated';
                    break;
                case 'skipped':
                    actionEmoji = '⏭️';
                    actionText = 'Skipped';
                    break;
                default:
                    actionEmoji = '❓';
                    actionText = result.action || 'Unknown';
            }
            
            console.log(`\n${idx + 1}. ${actionEmoji} [${actionText}]`);
            console.log(`   Identifier: vcode_id=${vcodeId}, sucursal=${sucursal}, vcode=${vcode}`);
            console.log(`   Reason: ${result.reason_en || result.reason || 'N/A'}`);
            
            if (result.utime_comparison) {
                console.log(`   utime comparison: ${result.utime_comparison}`);
            }
            
            if (result.clientUtime || result.serverUtime) {
                console.log(`   Client utime: ${result.clientUtime || 'N/A'}`);
                console.log(`   Server utime: ${result.serverUtime || 'N/A'}`);
            }
        });
        
        console.log('\n');
    }
    
    // 실패한 항목들
    if (response.errors && response.errors.length > 0) {
        console.log('❌ 실패한 항목들:');
        console.log('────────────────────────────────────────');
        
        response.errors.forEach((error, idx) => {
            const identifier = error.identifier || {};
            const vcodeId = identifier.vcode_id || error.data?.vcode_id || 'N/A';
            const sucursal = identifier.sucursal || error.data?.sucursal || 'N/A';
            const vcode = identifier.vcode || error.data?.vcode || 'N/A';
            
            console.log(`\n${idx + 1}. ❌ [Failed]`);
            console.log(`   Identifier: vcode_id=${vcodeId}, sucursal=${sucursal}, vcode=${vcode}`);
            console.log(`   Reason: ${error.reason_en || error.reason || 'N/A'}`);
            console.log(`   Error message: ${error.error || 'N/A'}`);
            console.log(`   Error type: ${error.errorType || 'N/A'}`);
            
            if (error.errorClassification) {
                console.log(`   Error classification:`);
                console.log(`     - Source: ${error.errorClassification.source || 'N/A'}`);
                console.log(`     - Description: ${error.errorClassification.description || 'N/A'}`);
                console.log(`     - Reason: ${error.errorClassification.reason || 'N/A'}`);
            }
        });
        
        console.log('\n');
    }
    
    console.log('========================================\n');
}

/**
 * Display results as HTML table (for web browsers)
 * @param {Object} response - Server response object
 * @returns {string} HTML string
 */
function displayVcodesResultsAsHTML(response) {
    let html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Vcodes Batch Processing Results</h2>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
            <h3>📊 Overall Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 5px;"><strong>Total:</strong></td>
                    <td style="padding: 5px;">${response.total} items</td>
                </tr>
                <tr>
                    <td style="padding: 5px;"><strong>Success:</strong></td>
                    <td style="padding: 5px; color: green;">${response.processed} items</td>
                </tr>
                <tr>
                    <td style="padding: 5px;"><strong>Created:</strong></td>
                    <td style="padding: 5px; color: blue;">${response.created} items</td>
                </tr>
                <tr>
                    <td style="padding: 5px;"><strong>Updated:</strong></td>
                    <td style="padding: 5px; color: orange;">${response.updated} items</td>
                </tr>
    `;
    
    if (response.skipped) {
        html += `
                <tr>
                    <td style="padding: 5px;"><strong>Skipped:</strong></td>
                    <td style="padding: 5px; color: gray;">${response.skipped} items</td>
                </tr>
        `;
    }
    
    html += `
                <tr>
                    <td style="padding: 5px;"><strong>Failed:</strong></td>
                    <td style="padding: 5px; color: red;">${response.failed} items</td>
                </tr>
            </table>
        </div>
    `;
    
    // Successful items table
    if (response.results && response.results.length > 0) {
        html += `
        <h3>✅ Successful Items</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd; margin-bottom: 20px;">
            <thead>
                <tr style="background: #4CAF50; color: white;">
                    <th style="padding: 10px; text-align: left;">#</th>
                    <th style="padding: 10px; text-align: left;">Status</th>
                    <th style="padding: 10px; text-align: left;">Identifier</th>
                    <th style="padding: 10px; text-align: left;">Reason</th>
                    <th style="padding: 10px; text-align: left;">utime Comparison</th>
                </tr>
            </thead>
            <tbody>
        `;
        
        response.results.forEach((result, idx) => {
            const identifier = result.identifier || {};
            const vcodeId = identifier.vcode_id || result.data?.vcode_id || 'N/A';
            const sucursal = identifier.sucursal || result.data?.sucursal || 'N/A';
            const vcode = identifier.vcode || result.data?.vcode || 'N/A';
            
            let actionEmoji = '';
            let actionText = '';
            let rowColor = '';
            
            switch (result.action) {
                case 'created':
                    actionEmoji = '🆕';
                    actionText = 'Created';
                    rowColor = '#e3f2fd';
                    break;
                case 'updated':
                    actionEmoji = '🔄';
                    actionText = 'Updated';
                    rowColor = '#fff3e0';
                    break;
                case 'skipped':
                    actionEmoji = '⏭️';
                    actionText = 'Skipped';
                    rowColor = '#f5f5f5';
                    break;
                default:
                    actionEmoji = '❓';
                    actionText = result.action || 'Unknown';
            }
            
            html += `
                <tr style="background: ${rowColor};">
                    <td style="padding: 8px; border: 1px solid #ddd;">${idx + 1}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${actionEmoji} ${actionText}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">
                        vcode_id: ${vcodeId}<br>
                        sucursal: ${sucursal}<br>
                        vcode: ${vcode}
                    </td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${result.reason_en || result.reason || 'N/A'}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">
                        ${result.utime_comparison || 'N/A'}<br>
                        ${result.clientUtime ? `Client: ${result.clientUtime}` : ''}<br>
                        ${result.serverUtime ? `Server: ${result.serverUtime}` : ''}
                    </td>
                </tr>
            `;
        });
        
        html += `
            </tbody>
        </table>
        `;
    }
    
    // Failed items table
    if (response.errors && response.errors.length > 0) {
        html += `
        <h3>❌ Failed Items</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
            <thead>
                <tr style="background: #f44336; color: white;">
                    <th style="padding: 10px; text-align: left;">#</th>
                    <th style="padding: 10px; text-align: left;">Identifier</th>
                    <th style="padding: 10px; text-align: left;">Reason</th>
                    <th style="padding: 10px; text-align: left;">Error Message</th>
                </tr>
            </thead>
            <tbody>
        `;
        
        response.errors.forEach((error, idx) => {
            const identifier = error.identifier || {};
            const vcodeId = identifier.vcode_id || error.data?.vcode_id || 'N/A';
            const sucursal = identifier.sucursal || error.data?.sucursal || 'N/A';
            const vcode = identifier.vcode || error.data?.vcode || 'N/A';
            
            html += `
                <tr style="background: #ffebee;">
                    <td style="padding: 8px; border: 1px solid #ddd;">${idx + 1}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">
                        vcode_id: ${vcodeId}<br>
                        sucursal: ${sucursal}<br>
                        vcode: ${vcode}
                    </td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${error.reason_en || error.reason || 'N/A'}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">
                        <strong>${error.error || 'N/A'}</strong><br>
                        Type: ${error.errorType || 'N/A'}<br>
                        ${error.errorClassification ? `
                            Source: ${error.errorClassification.source || 'N/A'}<br>
                            Description: ${error.errorClassification.description || 'N/A'}<br>
                            Reason: ${error.errorClassification.reason || 'N/A'}
                        ` : ''}
                    </td>
                </tr>
            `;
        });
        
        html += `
            </tbody>
        </table>
        `;
    }
    
    html += `
    </div>
    `;
    
    return html;
}

// 사용 예제
if (require.main === module) {
    // 예제 응답 데이터
    const exampleResponse = {
        success: true,
        message: "Vcodes processing complete: 3 succeeded (1 created, 1 updated, 1 skipped), 0 failed",
        processed: 3,
        failed: 0,
        total: 3,
        created: 1,
        updated: 1,
        skipped: 1,
        results: [
            {
                index: 0,
                action: 'created',
                reason: 'new_record',
                reason_en: 'Created new record because no existing record was found',
                identifier: {
                    vcode_id: 1001,
                    sucursal: 1,
                    vcode: 'VC001'
                },
                data: { vcode_id: 1001, sucursal: 1, vcode: 'VC001' }
            },
            {
                index: 1,
                action: 'updated',
                reason: 'client_utime_newer',
                reason_en: 'Updated because client utime is newer',
                utime_comparison: 'Client utime(2024-01-15 10:30:00.000) > Server utime(2024-01-15 09:00:00.000)',
                identifier: {
                    vcode_id: 1002,
                    sucursal: 1,
                    vcode: 'VC002'
                },
                clientUtime: '2024-01-15 10:30:00.000',
                serverUtime: '2024-01-15 09:00:00.000',
                data: { vcode_id: 1002, sucursal: 1, vcode: 'VC002' }
            },
            {
                index: 2,
                action: 'skipped',
                reason: 'server_utime_newer',
                reason_en: 'Skipped because server utime(2024-01-15 11:00:00.000) is newer than or equal to client utime(2024-01-15 10:00:00.000)',
                utime_comparison: 'Client utime(2024-01-15 10:00:00.000) <= Server utime(2024-01-15 11:00:00.000)',
                identifier: {
                    vcode_id: 1003,
                    sucursal: 1,
                    vcode: 'VC003'
                },
                clientUtime: '2024-01-15 10:00:00.000',
                serverUtime: '2024-01-15 11:00:00.000',
                data: { vcode_id: 1003, sucursal: 1, vcode: 'VC003' }
            }
        ],
        errors: []
    };
    
    // Display results in console
    displayVcodesResults(exampleResponse);
    
    // Display results as HTML (for web browsers)
    // const html = displayVcodesResultsAsHTML(exampleResponse);
    // console.log(html);
}

module.exports = {
    displayVcodesResults,
    displayVcodesResultsAsHTML
};

