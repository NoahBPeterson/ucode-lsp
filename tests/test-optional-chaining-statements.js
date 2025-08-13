// Test for optional chaining with proper statement syntax
console.log('🧪 Testing Optional Chaining with Statements...\n');

const { UcodeLexer } = require('../src/lexer/ucodeLexer');
const { UcodeParser } = require('../src/parser/ucodeParser');

function testOptionalChainingStatements() {
    let passedTests = 0;
    let totalTests = 0;

    console.log('🔍 Testing optional chaining with proper statement syntax:');
    
    // Test 1: Property access in assignment
    totalTests++;
    try {
        const source1 = 'let x = obj?.prop;';
        const lexer1 = new UcodeLexer(source1, { rawMode: true });
        const tokens1 = lexer1.tokenize();
        const parser1 = new UcodeParser(tokens1, source1);
        const result1 = parser1.parse();
        
        if (result1.errors.length === 0) {
            console.log('  ✅ PASS: Property access assignment parsed correctly');
            passedTests++;
        } else {
            console.log('  ❌ FAIL: Property access assignment parsing failed');
            console.log(`    Errors: ${result1.errors.map(e => e.message).join(', ')}`);
        }
    } catch (error) {
        console.log('  ❌ FAIL: Property access assignment threw error:', error.message);
    }
    
    // Test 2: Array access in assignment
    totalTests++;
    try {
        const source2 = 'let y = arr?.[0];';
        const lexer2 = new UcodeLexer(source2, { rawMode: true });
        const tokens2 = lexer2.tokenize();
        const parser2 = new UcodeParser(tokens2, source2);
        const result2 = parser2.parse();
        
        if (result2.errors.length === 0) {
            console.log('  ✅ PASS: Array access assignment parsed correctly');
            passedTests++;
        } else {
            console.log('  ❌ FAIL: Array access assignment parsing failed');
            console.log(`    Errors: ${result2.errors.map(e => e.message).join(', ')}`);
        }
    } catch (error) {
        console.log('  ❌ FAIL: Array access assignment threw error:', error.message);
    }
    
    // Test 3: Function call in assignment
    totalTests++;
    try {
        const source3 = 'let z = func?.(arg);';
        const lexer3 = new UcodeLexer(source3, { rawMode: true });
        const tokens3 = lexer3.tokenize();
        const parser3 = new UcodeParser(tokens3, source3);
        const result3 = parser3.parse();
        
        if (result3.errors.length === 0) {
            console.log('  ✅ PASS: Function call assignment parsed correctly');
            passedTests++;
        } else {
            console.log('  ❌ FAIL: Function call assignment parsing failed');
            console.log(`    Errors: ${result3.errors.map(e => e.message).join(', ')}`);
        }
    } catch (error) {
        console.log('  ❌ FAIL: Function call assignment threw error:', error.message);
    }
    
    // Test 4: Return statement from original issue
    totalTests++;
    try {
        const source4 = `function test() {
            return decode?.(buffer(payload), length(payload));
        }`;
        const lexer4 = new UcodeLexer(source4, { rawMode: true });
        const tokens4 = lexer4.tokenize();
        const parser4 = new UcodeParser(tokens4, source4);
        const result4 = parser4.parse();
        
        if (result4.errors.length === 0) {
            console.log('  ✅ PASS: Return statement with optional call parsed correctly');
            passedTests++;
        } else {
            console.log('  ❌ FAIL: Return statement with optional call parsing failed');
            console.log(`    Errors: ${result4.errors.map(e => e.message).join(', ')}`);
        }
    } catch (error) {
        console.log('  ❌ FAIL: Return statement with optional call threw error:', error.message);
    }
    
    // Test 5: Complete function from the issue
    totalTests++;
    try {
        const source5 = `function decode_tlv(type, payload) {
            if (type !== defs.TLV_EXTENDED) {
                const decode = codec.decoder[type];
                return decode?.(buffer(payload), length(payload));
            }
            else {
                const buf = buffer(payload);
                const subtype = buf.get('!H');
                const decode = codec.extended_decoder[subtype];
                return decode?.(buf, length(payload));
            }
        }`;
        const lexer5 = new UcodeLexer(source5, { rawMode: true });
        const tokens5 = lexer5.tokenize();
        const parser5 = new UcodeParser(tokens5, source5);
        const result5 = parser5.parse();
        
        if (result5.errors.length === 0) {
            console.log('  ✅ PASS: Complete function from issue parsed correctly');
            passedTests++;
        } else {
            console.log('  ❌ FAIL: Complete function from issue parsing failed');
            console.log(`    Errors: ${result5.errors.map(e => e.message).join(', ')}`);
        }
    } catch (error) {
        console.log('  ❌ FAIL: Complete function from issue threw error:', error.message);
    }

    console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
        console.log('🎉 All optional chaining statement tests passed!');
        return true;
    } else {
        console.log('❌ Some optional chaining statement tests failed!');
        return false;
    }
}

// Run the test
const success = testOptionalChainingStatements();
process.exit(success ? 0 : 1);