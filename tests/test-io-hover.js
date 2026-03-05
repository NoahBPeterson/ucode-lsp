// Integration test for io module hover: type inference + handle method lookup
// Tests that io.handle types are correctly inferred and method docs are available
const { ioModuleTypeRegistry, createIoHandleDataType } = require('../src/analysis/ioTypes.ts');
const { UcodeParser } = require('../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer.ts');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { typeToString } = require('../src/analysis/symbolTable.ts');

console.log('Testing IO Module Hover Integration...\n');

let totalTests = 0;
let passedTests = 0;

function testCase(name, testFunc) {
  console.log(`Testing ${name}:`);
  totalTests++;
  try {
    const result = testFunc();
    if (result) {
      console.log(`  Result: PASS`);
      passedTests++;
    } else {
      console.log(`  Result: FAIL`);
    }
  } catch (error) {
    console.log(`  Result: FAIL - ${error.message}`);
  }
}

// Helper: analyze code and return analysis result
function analyze(code) {
  const document = TextDocument.create('test://test.uc', 'ucode', 1, code);
  // Use dynamic import for the lexer to avoid enum issues
  const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens);
  const ast = parser.parse();
  const analyzer = new SemanticAnalyzer(document);
  return analyzer.analyze(ast.ast);
}

// Simulate the hover path for member expressions:
// Given a symbol from analysis, check if hovering on a method would produce docs
function simulateMethodHover(result, objectName, methodName) {
  const symbol = result.symbolTable.lookup(objectName);
  if (!symbol) return null;
  if (ioModuleTypeRegistry.isVariableOfIoType(symbol.dataType)) {
    return ioModuleTypeRegistry.getHandleFunctionDocumentation(methodName);
  }
  return null;
}

// =========================================================================
// 1. Type inference for all showcase patterns
// =========================================================================

testCase('open() from io: handle type is io.handle', () => {
  const result = analyze(`import { open } from 'io';\nlet handle = open('/tmp/test', 0);`);
  const sym = result.symbolTable.lookup('handle');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('from() from io: handle type is io.handle', () => {
  const result = analyze(`import { from } from 'io';\nlet h = from(null);`);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('io.open() namespace: handle type is io.handle', () => {
  const result = analyze(`import * as io from 'io';\nlet h = io.open('/tmp/test', 0);`);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('io.new() namespace: handle type is io.handle', () => {
  const result = analyze(`import * as io from 'io';\nlet h = io.new(1, false);`);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('io.from() namespace: handle type is io.handle', () => {
  const result = analyze(`import * as io from 'io';\nlet h = io.from(null);`);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('Second open() call: ptmx type is io.handle', () => {
  const code = `import { open, O_RDWR } from 'io';
let handle = open('/tmp/a', 0);
let ptmx = open('/dev/ptmx', O_RDWR);`;
  const result = analyze(code);
  const sym = result.symbolTable.lookup('ptmx');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('Third open() call: tty type is io.handle', () => {
  const code = `import { open, O_RDWR } from 'io';
let handle = open('/tmp/a', 0);
let ptmx = open('/dev/ptmx', O_RDWR);
let tty = open('/dev/tty', O_RDWR);`;
  const result = analyze(code);
  const sym = result.symbolTable.lookup('tty');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('open() without io import: type is fs.file (not io.handle)', () => {
  const result = analyze(`let f = open('/tmp/test', 'r');`);
  const sym = result.symbolTable.lookup('f');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'fs.file';
});

testCase('open() from fs import: type is fs.file (not io.handle)', () => {
  const result = analyze(`import { open } from 'fs';\nlet f = open('/tmp/test', 'r');`);
  const sym = result.symbolTable.lookup('f');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'fs.file';
});

testCase('Assignment inference: h = open() from io', () => {
  const result = analyze(`import { open } from 'io';\nlet h;\nh = open('/tmp/test', 0);`);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

// =========================================================================
// 2. Method hover simulation — all 17 handle methods
// =========================================================================

const handleCode = `import { open } from 'io';
let h = open('/tmp/test', 0);
h.read(1024);`;

const allMethods = [
  ['read', 'handle.read', 'string | null'],
  ['write', 'handle.write', 'number | null'],
  ['seek', 'handle.seek', 'number | null'],
  ['tell', 'handle.tell', 'number | null'],
  ['close', 'handle.close', 'boolean | null'],
  ['fileno', 'handle.fileno', 'number | null'],
  ['isatty', 'handle.isatty', 'boolean'],
  ['dup', 'handle.dup', 'io.handle | null'],
  ['dup2', 'handle.dup2', 'io.handle | null'],
  ['fcntl', 'handle.fcntl', 'any'],
  ['ioctl', 'handle.ioctl', 'any'],
  ['error', 'handle.error', 'string | null'],
  ['tcgetattr', 'handle.tcgetattr', 'object | null'],
  ['tcsetattr', 'handle.tcsetattr', 'boolean | null'],
  ['grantpt', 'handle.grantpt', 'boolean | null'],
  ['unlockpt', 'handle.unlockpt', 'boolean | null'],
  ['ptsname', 'handle.ptsname', 'string | null'],
];

// Analyze once for all method tests
const methodResult = analyze(handleCode);

for (const [method, expectedPrefix, expectedReturn] of allMethods) {
  testCase(`Method hover: h.${method}() shows correct docs`, () => {
    const doc = simulateMethodHover(methodResult, 'h', method);
    if (!doc) { console.log('    No docs returned'); return false; }
    console.log(`    Doc: ${doc.substring(0, 70)}`);
    return doc.includes(expectedPrefix) && doc.includes(expectedReturn);
  });
}

// =========================================================================
// 3. Multi-variable method hover
// =========================================================================

const multiCode = `import { open, O_RDWR } from 'io';
let ptmx = open('/dev/ptmx', O_RDWR);
let tty = open('/dev/tty', O_RDWR);`;
const multiResult = analyze(multiCode);

testCase('ptmx.tcsetattr() lookup returns docs', () => {
  const doc = simulateMethodHover(multiResult, 'ptmx', 'tcsetattr');
  if (!doc) { console.log('    No docs returned'); return false; }
  console.log(`    Doc: ${doc.substring(0, 70)}`);
  return doc.includes('handle.tcsetattr');
});

testCase('tty.ioctl() lookup returns docs', () => {
  const doc = simulateMethodHover(multiResult, 'tty', 'ioctl');
  if (!doc) { console.log('    No docs returned'); return false; }
  console.log(`    Doc: ${doc.substring(0, 70)}`);
  return doc.includes('handle.ioctl');
});

testCase('ptmx.grantpt() lookup returns docs', () => {
  const doc = simulateMethodHover(multiResult, 'ptmx', 'grantpt');
  if (!doc) { console.log('    No docs returned'); return false; }
  return doc.includes('handle.grantpt');
});

testCase('Invalid method on io.handle returns null', () => {
  const doc = simulateMethodHover(multiResult, 'ptmx', 'nonexistent');
  return doc === null || doc === '';
});

// =========================================================================
// 4. Constant hover — imported constants get specific docs
// =========================================================================

testCase('O_RDONLY imported from io gets constant-specific hover', () => {
  const result = analyze(`import { O_RDONLY } from 'io';\nlet x = O_RDONLY;`);
  const sym = result.symbolTable.lookup('O_RDONLY');
  if (!sym) { console.log('    Symbol not found'); return false; }
  const name = sym.importSpecifier || sym.name;
  const doc = ioModuleTypeRegistry.getConstantDocumentation(name);
  console.log(`    Doc: ${doc.substring(0, 60)}`);
  return doc.includes('O_RDONLY') && doc.includes('Read-only');
});

testCase('SEEK_END gets constant-specific hover', () => {
  const result = analyze(`import { SEEK_END } from 'io';\nlet x = SEEK_END;`);
  const sym = result.symbolTable.lookup('SEEK_END');
  if (!sym) { console.log('    Symbol not found'); return false; }
  const doc = ioModuleTypeRegistry.getConstantDocumentation(sym.importSpecifier || sym.name);
  console.log(`    Doc: ${doc.substring(0, 60)}`);
  return doc.includes('SEEK_END') && doc.includes('end of file');
});

testCase('F_SETFL gets constant-specific hover', () => {
  const result = analyze(`import { F_SETFL } from 'io';\nlet x = F_SETFL;`);
  const sym = result.symbolTable.lookup('F_SETFL');
  if (!sym) { console.log('    Symbol not found'); return false; }
  const doc = ioModuleTypeRegistry.getConstantDocumentation(sym.importSpecifier || sym.name);
  return doc.includes('F_SETFL') && doc.includes('fcntl');
});

testCase('TCSAFLUSH gets constant-specific hover', () => {
  const result = analyze(`import { TCSAFLUSH } from 'io';\nlet x = TCSAFLUSH;`);
  const sym = result.symbolTable.lookup('TCSAFLUSH');
  if (!sym) { console.log('    Symbol not found'); return false; }
  const doc = ioModuleTypeRegistry.getConstantDocumentation(sym.importSpecifier || sym.name);
  return doc.includes('TCSAFLUSH') && doc.includes('discarding');
});

testCase('IOC_DIR_RW gets constant-specific hover', () => {
  const result = analyze(`import { IOC_DIR_RW } from 'io';\nlet x = IOC_DIR_RW;`);
  const sym = result.symbolTable.lookup('IOC_DIR_RW');
  if (!sym) { console.log('    Symbol not found'); return false; }
  const doc = ioModuleTypeRegistry.getConstantDocumentation(sym.importSpecifier || sym.name);
  return doc.includes('IOC_DIR_RW') && doc.includes('Read-write');
});

// =========================================================================
// 5. No false error diagnostics for io.handle method usage
// =========================================================================

testCase('No io.handle errors for showcase method calls', () => {
  const code = `import { open, O_RDWR, O_CREAT, O_TRUNC, SEEK_SET, F_GETFD, FD_CLOEXEC } from 'io';
let handle = open('/tmp/test', O_CREAT | O_RDWR | O_TRUNC, 0o644);
handle.write('Line 1\\n');
handle.tell();
handle.seek(0, SEEK_SET);
handle.read(4096);
handle.fileno();
handle.dup();
handle.isatty();
handle.fcntl(F_GETFD);
handle.error();
handle.close();
let ptmx = open('/dev/ptmx', O_RDWR);
ptmx.grantpt();
ptmx.unlockpt();
ptmx.ptsname();
ptmx.tcgetattr();
ptmx.tcsetattr({}, 0);
ptmx.ioctl(0, 0, 0);
ptmx.close();`;
  const result = analyze(code);
  const ioErrors = result.diagnostics.filter(d =>
    d.severity === 1 && d.message && d.message.includes('io.handle')
  );
  if (ioErrors.length > 0) {
    console.log(`    Unexpected errors: ${ioErrors.map(e => e.message).join('; ')}`);
    return false;
  }
  return true;
});

testCase('Error for nonexistent method on io.handle', () => {
  const code = `import { open } from 'io';\nlet h = open('/tmp/test', 0);\nh.bogus();`;
  const result = analyze(code);
  const errs = result.diagnostics.filter(d => d.message && d.message.includes('does not exist on io.handle'));
  console.log(`    Found ${errs.length} error(s)`);
  return errs.length > 0;
});

// =========================================================================
// 6. Type persistence — handle retains io.handle after many statements
// =========================================================================

testCase('handle retains io.handle type after many intervening statements', () => {
  const code = `import { open, O_CREAT, O_RDWR, O_TRUNC, SEEK_SET } from 'io';
let handle = open('/tmp/test', O_CREAT | O_RDWR | O_TRUNC, 0o644);
handle.write('Line 1\\n');
handle.write('Line 2\\n');
handle.write('Line 3\\n');
let pos = handle.tell();
let new_pos = handle.seek(0, SEEK_SET);
let contents = handle.read(4096);
handle.seek(-10, SEEK_SET);
let tail = handle.read(10);
let fd = handle.fileno();
let dup_handle = handle.dup();
let is_terminal = handle.isatty();
let closed = handle.close();`;
  const result = analyze(code);
  const sym = result.symbolTable.lookup('handle');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

testCase('ptmx retains io.handle type after many method calls', () => {
  const code = `import { open, O_RDWR, O_NOCTTY, TCSANOW } from 'io';
let ptmx = open('/dev/ptmx', O_RDWR | O_NOCTTY);
ptmx.grantpt();
ptmx.unlockpt();
ptmx.ptsname();
let attrs = ptmx.tcgetattr();
ptmx.tcsetattr({}, TCSANOW);
ptmx.ioctl(0, 0, 0);
ptmx.close();`;
  const result = analyze(code);
  const sym = result.symbolTable.lookup('ptmx');
  if (!sym) { console.log('    Symbol not found'); return false; }
  console.log(`    type: ${typeToString(sym.dataType)}`);
  return typeToString(sym.dataType) === 'io.handle';
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\nTest Results: ${passedTests}/${totalTests} tests passed`);
if (passedTests === totalTests) {
  console.log('All io hover tests passed!');
} else {
  console.log(`${totalTests - passedTests} tests failed.`);
  process.exit(1);
}
