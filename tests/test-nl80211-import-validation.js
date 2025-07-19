// Test nl80211 module import validation
console.log('🔧 Testing NL80211 Import Validation...\n');

const { analyzeCode } = require('../src/analysis');

let totalTests = 0;
let passedTests = 0;

function testImportValidation(testName, code, shouldHaveError, expectedErrorMessage) {
    console.log(`\n🧪 Testing ${testName}:`);
    totalTests++;
    
    try {
        const result = analyzeCode(code);
        const hasError = result.diagnostics.some(d => d.message.includes('not exported by the nl80211 module'));
        
        if (shouldHaveError && hasError) {
            console.log(`  ✅ PASS - Error correctly detected`);
            console.log(`  Error: ${result.diagnostics.find(d => d.message.includes('not exported by the nl80211 module')).message}`);
            passedTests++;
        } else if (!shouldHaveError && !hasError) {
            console.log(`  ✅ PASS - No error as expected`);
            passedTests++;
        } else {
            console.log(`  ❌ FAIL - Expected error: ${shouldHaveError}, Got error: ${hasError}`);
            if (hasError) {
                console.log(`  Error message: ${result.diagnostics.find(d => d.message.includes('not exported by the nl80211 module')).message}`);
            }
        }
    } catch (error) {
        console.log(`  ❌ FAIL - Exception: ${error.message}`);
    }
}

// Test 1: Valid function imports
testImportValidation(
    'Valid function imports',
    `import { error, request, waitfor, listener } from 'nl80211';`,
    false
);

// Test 2: Valid constant imports
testImportValidation(
    'Valid constant imports',
    `import { NLM_F_ACK, NL80211_CMD_GET_WIPHY, NL80211_IFTYPE_STATION } from 'nl80211';`,
    false
);

// Test 3: Mixed valid imports
testImportValidation(
    'Mixed valid imports',
    `import { request, NL80211_CMD_TRIGGER_SCAN, error, NLM_F_DUMP } from 'nl80211';`,
    false
);

// Test 4: Invalid function import
testImportValidation(
    'Invalid function import',
    `import { invalidFunction } from 'nl80211';`,
    true
);

// Test 5: Invalid constant import
testImportValidation(
    'Invalid constant import',
    `import { INVALID_CONSTANT } from 'nl80211';`,
    true
);

// Test 6: Mix of valid and invalid imports
testImportValidation(
    'Mix of valid and invalid imports',
    `import { request, invalidFunction, NL80211_CMD_GET_WIPHY } from 'nl80211';`,
    true
);

// Test 7: Case sensitivity
testImportValidation(
    'Case sensitivity test',
    `import { ERROR, REQUEST } from 'nl80211';`,
    true
);

// Test 8: Namespace import (should always be valid)
testImportValidation(
    'Namespace import',
    `import * as nl80211 from 'nl80211';`,
    false
);

// Test 9: Valid complex import
testImportValidation(
    'Valid complex import',
    `import { request, waitfor, NL80211_CMD_CONNECT, NL80211_CMD_DISCONNECT, NLM_F_ACK } from 'nl80211';`,
    false
);

// Test 10: Empty import (edge case)
testImportValidation(
    'Empty import check',
    `import { } from 'nl80211';`,
    false
);

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All NL80211 import validation tests passed!');
} else {
    console.log('❌ Some tests failed. Please check the implementation.');
    process.exit(1);
}