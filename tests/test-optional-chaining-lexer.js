// Test for optional chaining lexer support
console.log('🧪 Testing Optional Chaining Lexer Support...\n');

const { UcodeLexer } = require('../src/lexer/ucodeLexer');
const { TokenType } = require('../src/lexer/tokenTypes');

function testOptionalChainingLexer() {
    let passedTests = 0;
    let totalTests = 0;

    console.log('🔍 Testing optional chaining token recognition in lexer:');
    
    // Test 1: ?. operator
    totalTests++;
    const source1 = 'obj?.prop';
    const lexer1 = new UcodeLexer(source1, { rawMode: true });
    const tokens1 = lexer1.tokenize();
    
    const qdotToken = tokens1.find(token => token.type === TokenType.TK_QDOT);
    if (qdotToken) {
        console.log('  ✅ PASS: ?. operator recognized');
        console.log(`    Token: ${qdotToken.value} (type: ${TokenType[qdotToken.type]})`);
        passedTests++;
    } else {
        console.log('  ❌ FAIL: ?. operator not recognized');
        console.log(`    Tokens found: ${tokens1.map(t => `${t.value}(${TokenType[t.type]})`).join(', ')}`);
    }
    
    // Test 2: ?.( operator  
    totalTests++;
    const source2 = 'func?.(arg)';
    const lexer2 = new UcodeLexer(source2, { rawMode: true });
    const tokens2 = lexer2.tokenize();
    
    const qlparenToken = tokens2.find(token => token.type === TokenType.TK_QLPAREN);
    if (qlparenToken) {
        console.log('  ✅ PASS: ?.( operator recognized');
        console.log(`    Token: ${qlparenToken.value} (type: ${TokenType[qlparenToken.type]})`);
        passedTests++;
    } else {
        console.log('  ❌ FAIL: ?.( operator not recognized');
        console.log(`    Tokens found: ${tokens2.map(t => `${t.value}(${TokenType[t.type]})`).join(', ')}`);
    }
    
    // Test 3: ?.[ operator
    totalTests++;
    const source3 = 'arr?.[0]';
    const lexer3 = new UcodeLexer(source3, { rawMode: true });
    const tokens3 = lexer3.tokenize();
    
    const qlbrackToken = tokens3.find(token => token.type === TokenType.TK_QLBRACK);
    if (qlbrackToken) {
        console.log('  ✅ PASS: ?.[ operator recognized');
        console.log(`    Token: ${qlbrackToken.value} (type: ${TokenType[qlbrackToken.type]})`);
        passedTests++;
    } else {
        console.log('  ❌ FAIL: ?.[ operator not recognized');
        console.log(`    Tokens found: ${tokens3.map(t => `${t.value}(${TokenType[t.type]})`).join(', ')}`);
    }
    
    // Test 4: Complex example from the issue
    totalTests++;
    const source4 = 'return decode?.(buffer(payload), length(payload));';
    const lexer4 = new UcodeLexer(source4, { rawMode: true });
    const tokens4 = lexer4.tokenize();
    
    const complexQlparenToken = tokens4.find(token => token.type === TokenType.TK_QLPAREN);
    if (complexQlparenToken) {
        console.log('  ✅ PASS: Complex ?.( usage recognized');
        console.log(`    Token: ${complexQlparenToken.value} (type: ${TokenType[complexQlparenToken.type]})`);
        passedTests++;
    } else {
        console.log('  ❌ FAIL: Complex ?.( usage not recognized');
        console.log(`    Tokens found: ${tokens4.map(t => `${t.value}(${TokenType[t.type]})`).join(', ')}`);
    }

    console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
        console.log('🎉 All optional chaining lexer tests passed!');
        return true;
    } else {
        console.log('❌ Some optional chaining lexer tests failed!');
        return false;
    }
}

// Run the test
const success = testOptionalChainingLexer();
process.exit(success ? 0 : 1);