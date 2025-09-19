/**
 * Tests for function return type handling using shared LSP server
 * Ensures functions have type 'function' while calls return actual return types
 */

// Function that runs tests with shared LSP server
async function runFunctionReturnTypeTests(lspServer) {
    const { getHover } = lspServer;
    
    let totalTests = 0;
    let passedTests = 0;
    
    function assertEqual(actual, expected, testName) {
        totalTests++;
        if (actual === expected) {
            passedTests++;
            return true;
        } else {
            console.log(`❌ ${testName}: expected ${expected}, got ${actual}`);
            return false;
        }
    }
    
    function assertContains(text, expected, testName) {
        totalTests++;
        if (text && text.includes(expected)) {
            passedTests++;
            return true;
        } else {
            console.log(`❌ ${testName}: expected "${expected}" in "${text}"`);
            return false;
        }
    }
    
    // Test 1: Function identifiers should show function type
    {
        const testContent = `function getString() {
    return "hello";
}

let funcRef = getString;`;
        
        const testFile = `/tmp/test-function-types-${Date.now()}.uc`;
        
        try {
            // Find exact positions
            const lines = testContent.split('\n');
            const getStringLine = lines.findIndex(line => line.includes('function getString'));
            const funcRefLine = lines.findIndex(line => line.includes('let funcRef'));
            
            const getStringChar = lines[getStringLine].indexOf('getString');
            const funcRefChar = lines[funcRefLine].indexOf('getString');
            
            // Test hover on function name declaration
            const functionHover = await getHover(testContent, testFile, getStringLine, getStringChar);
            
            if (functionHover && functionHover.contents) {
                const functionHoverText = typeof functionHover.contents === 'string' 
                    ? functionHover.contents 
                    : functionHover.contents.value || functionHover.contents[0];
                
                assertContains(functionHoverText, 'function', 'Function declaration shows function type');
            } else {
                console.log(`❌ Function declaration shows function type: no hover response at line ${getStringLine}, char ${getStringChar}`);
                totalTests++;
            }
            
            // Test hover on function reference
            const refHover = await getHover(testContent, testFile, funcRefLine, funcRefChar);
            
            if (refHover && refHover.contents) {
                const refHoverText = typeof refHover.contents === 'string' 
                    ? refHover.contents 
                    : refHover.contents.value || refHover.contents[0];
                
                assertContains(refHoverText, 'function', 'Function reference shows function type');
            } else {
                console.log(`❌ Function reference shows function type: no hover response at line ${funcRefLine}, char ${funcRefChar}`);
                totalTests++;
            }
        } catch (error) {
            console.log(`❌ Function type test failed: ${error.message}`);
            totalTests += 2;
        }
    }
    
    // Test 2: Function calls should show return types
    {
        const testContent = `function getString() {
    return "hello";
}

function getNumber() {
    return 42;
}

let result1 = getString();
let result2 = getNumber();`;
        
        const testFile = `/tmp/test-function-calls-${Date.now()}.uc`;
        
        try {
            // Find exact positions using indexOf
            const lines = testContent.split('\n');
            const result1Line = lines.findIndex(line => line.includes('let result1'));
            const result2Line = lines.findIndex(line => line.includes('let result2'));
            
            const result1Char = lines[result1Line].indexOf('result1');
            const result2Char = lines[result2Line].indexOf('result2');
            
            // Test hover on 'result1' variable name
            const stringCallHover = await getHover(testContent, testFile, result1Line, result1Char);
            
            if (stringCallHover && stringCallHover.contents) {
                const stringCallHoverText = typeof stringCallHover.contents === 'string' 
                    ? stringCallHover.contents 
                    : stringCallHover.contents.value || stringCallHover.contents[0];
                
                // Should contain string but not function
                const hasString = stringCallHoverText.includes('string');
                
                if (hasString) {
                    passedTests++;
                } else {
                    console.log(`❌ String function call result should show string type: got "${stringCallHoverText}"`);
                }
                totalTests++;
            } else {
                console.log(`❌ String function call result: no hover response at line ${result1Line}, char ${result1Char}`);
                totalTests++;
            }
            
            // Test hover on 'result2' variable name
            const numberCallHover = await getHover(testContent, testFile, result2Line, result2Char);
            
            if (numberCallHover && numberCallHover.contents) {
                const numberCallHoverText = typeof numberCallHover.contents === 'string' 
                    ? numberCallHover.contents 
                    : numberCallHover.contents.value || numberCallHover.contents[0];
                
                // Accept any non-function type
                const hasFunction = numberCallHoverText.toLowerCase().includes('function');
                
                if (!hasFunction) {
                    passedTests++;
                } else {
                    console.log(`❌ Number function call result should not show function type: got "${numberCallHoverText}"`);
                }
                totalTests++;
            } else {
                console.log(`❌ Number function call result: no hover response at line ${result2Line}, char ${result2Char}`);
                totalTests++;
            }
        } catch (error) {
            console.log(`❌ Function call test failed: ${error.message}`);
            totalTests += 2;
        }
    }
    
    // Test 3: Union return types
    {
        const testContent = `function getStringOrNull() {
    if (true) {
        return "hello";
    } else {
        return null;
    }
}

let result = getStringOrNull();`;
        
        const testFile = `/tmp/test-union-return-${Date.now()}.uc`;
        
        try {
            // Test hover on union function declaration (line 0, character 9)
            const functionHover = await getHover(testContent, testFile, 0, 9);
            
            if (functionHover && functionHover.contents) {
                const functionHoverText = typeof functionHover.contents === 'string' 
                    ? functionHover.contents 
                    : functionHover.contents.value || functionHover.contents[0];
                
                assertContains(functionHoverText, 'function', 'Union function shows function type');
            } else {
                console.log('❌ Union function shows function type: no hover response');
                totalTests++;
            }
            
            // Test hover on union function call result (line 8, character 4)
            const resultHover = await getHover(testContent, testFile, 8, 4);
            
            if (resultHover && resultHover.contents) {
                const resultHoverText = typeof resultHover.contents === 'string' 
                    ? resultHover.contents 
                    : resultHover.contents.value || resultHover.contents[0];
                
                // Should not show 'function' type for call result
                const hasFunction = resultHoverText.toLowerCase().includes('function');
                
                if (!hasFunction) {
                    console.log('✅ Union function call result does not show function type');
                    passedTests++;
                } else {
                    console.log(`❌ Union function call result should not show function type: got "${resultHoverText}"`);
                }
                totalTests++;
            } else {
                console.log('❌ Union function call result type: no hover response');
                totalTests++;
            }
        } catch (error) {
            console.log(`❌ Union type test failed: ${error.message}`);
            totalTests += 2;
        }
    }
    
    console.log(`\n📊 Function Return Type Tests: ${passedTests}/${totalTests} passed`);
    return passedTests === totalTests;
}

// Export for use with shared LSP server
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runFunctionReturnTypeTests };
}

// For standalone execution (fallback)
if (require.main === module) {
    console.log('⚠️  This test requires a shared LSP server. Run via test-all-validations.test.js');
    process.exit(1);
}