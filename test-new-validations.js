const { validateWithLexer } = require('./out/server.js');
const { TextDocument } = require('vscode-languageserver-textdocument');

function createTestDocument(content, uri = 'file:///test.uc') {
    return TextDocument.create(uri, 'ucode', 1, content);
}

function testValidations(testName, code, expectedErrors) {
    console.log(`\n🧪 Testing ${testName}:`);
    console.log(`Code: ${code}`);
    
    const document = createTestDocument(code);
    const diagnostics = validateWithLexer(document, { console: { log: () => {} } });
    
    console.log(`Found ${diagnostics.length} diagnostic(s):`);
    diagnostics.forEach((diag, i) => {
        console.log(`  ${i + 1}. ${diag.message}`);
    });
    
    if (expectedErrors > 0) {
        if (diagnostics.length === 0) {
            console.log(`❌ FAIL: Expected ${expectedErrors} error(s) but got none`);
        } else {
            console.log(`✅ PASS: Found expected error(s)`);
        }
    } else {
        if (diagnostics.length > 0) {
            console.log(`❌ FAIL: Expected no errors but got ${diagnostics.length}`);
        } else {
            console.log(`✅ PASS: No errors as expected`);
        }
    }
}

console.log('🧪 Testing new validation implementations...\n');

// Test string analysis functions
testValidations('String Analysis - length with number', 'length(123);', 1);
testValidations('String Analysis - index with number', 'index(456, "needle");', 1);
testValidations('String Analysis - rindex with number', 'rindex(789, "needle");', 1);
testValidations('String Analysis - match with number as first param', 'match(123, /pattern/);', 1);
testValidations('String Analysis - match with number as second param', 'match("text", 456);', 1);

// Test valid string analysis
testValidations('String Analysis - valid length', 'length("hello");', 0);
testValidations('String Analysis - valid index', 'index("hello", "l");', 0);
testValidations('String Analysis - valid rindex', 'rindex("hello", "l");', 0);
testValidations('String Analysis - valid match', 'match("hello", /el/);', 0);

// Test filter/map functions
testValidations('Array Functions - filter with string', 'filter("string", func);', 1);
testValidations('Array Functions - filter with number as second param', 'filter(arr, 123);', 1);
testValidations('Array Functions - map with string', 'map("string", func);', 1);
testValidations('Array Functions - map with number as second param', 'map(arr, 456);', 1);

// Test valid filter/map
testValidations('Array Functions - valid filter', 'filter(myArray, myFunc);', 0);
testValidations('Array Functions - valid map', 'map(myArray, myFunc);', 0);

// Test object functions
testValidations('Object Functions - keys with string', 'keys("string");', 1);
testValidations('Object Functions - values with number', 'values(123);', 1);
testValidations('Object Functions - exists with string as first param', 'exists("string", "key");', 1);
testValidations('Object Functions - exists with number as second param', 'exists(obj, 456);', 1);

// Test valid object functions
testValidations('Object Functions - valid keys', 'keys(myObj);', 0);
testValidations('Object Functions - valid values', 'values(myObj);', 0);
testValidations('Object Functions - valid exists', 'exists(myObj, "key");', 0);

// Test number conversion functions
testValidations('Number Conversions - hex with string', 'hex("string");', 1);
testValidations('Number Conversions - hexdec with number', 'hexdec(123);', 1);
testValidations('Number Conversions - hexenc with number', 'hexenc(456);', 1);

// Test valid number conversions
testValidations('Number Conversions - valid hex', 'hex(255);', 0);
testValidations('Number Conversions - valid hexdec', 'hexdec("FF");', 0);
testValidations('Number Conversions - valid hexenc', 'hexenc("hello");', 0);

console.log('\n🏁 Testing completed!');