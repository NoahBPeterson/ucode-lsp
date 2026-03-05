// Test suite for io module: type registry, constants, io.handle type inference, and hover
const { ioModuleTypeRegistry, ioFunctions, ioHandleFunctions, ioConstants, createIoHandleDataType } = require('../src/analysis/ioTypes.ts');
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer.ts');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { typeToString } = require('../src/analysis/symbolTable.ts');

console.log('Testing IO Module Functionality...\n');

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

// Helper to analyze code and return the symbol table
function analyzeCode(code) {
  const document = TextDocument.create('test://test.uc', 'ucode', 1, code);
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens);
  const ast = parser.parse();
  const analyzer = new SemanticAnalyzer(document);
  return analyzer.analyze(ast.ast);
}

// =========================================================================
// 1. Module-level function registry
// =========================================================================

const expectedFunctions = ['error', 'new', 'open', 'from', 'pipe'];

testCase('All expected module functions are present', () => {
  const names = ioModuleTypeRegistry.getFunctionNames();
  const missing = expectedFunctions.filter(f => !names.includes(f));
  if (missing.length > 0) {
    console.log(`    Missing: ${missing.join(', ')}`);
    return false;
  }
  return true;
});

testCase('isIoModuleFunction identifies functions correctly', () => {
  return expectedFunctions.every(f => ioModuleTypeRegistry.isIoModuleFunction(f))
    && !ioModuleTypeRegistry.isIoModuleFunction('nonexistent');
});

testCase('getFunction returns correct signatures', () => {
  const openFn = ioModuleTypeRegistry.getFunction('open');
  if (!openFn) return false;
  return openFn.returnType === 'io.handle | null'
    && openFn.parameters.length === 3
    && openFn.parameters[0].name === 'path';
});

testCase('getFunctionDocumentation formats correctly', () => {
  const doc = ioModuleTypeRegistry.getFunctionDocumentation('open');
  return doc.includes('io.open(') && doc.includes('io.handle | null') && doc.includes('POSIX');
});

testCase('from() function documentation', () => {
  const doc = ioModuleTypeRegistry.getFunctionDocumentation('from');
  return doc.includes('io.from(') && doc.includes('io.handle | null');
});

// =========================================================================
// 2. Handle method registry
// =========================================================================

const expectedHandleMethods = [
  'read', 'write', 'seek', 'tell', 'dup', 'dup2', 'fileno',
  'fcntl', 'ioctl', 'isatty', 'close', 'error',
  'ptsname', 'tcgetattr', 'tcsetattr', 'grantpt', 'unlockpt'
];

testCase('All expected handle methods are present', () => {
  const missing = expectedHandleMethods.filter(m => !ioModuleTypeRegistry.isIoHandleFunction(m));
  if (missing.length > 0) {
    console.log(`    Missing: ${missing.join(', ')}`);
    return false;
  }
  return true;
});

testCase('getHandleFunction returns correct signatures', () => {
  const readFn = ioModuleTypeRegistry.getHandleFunction('read');
  if (!readFn) return false;
  return readFn.returnType === 'string | null'
    && readFn.parameters.length === 1
    && readFn.parameters[0].name === 'length';
});

testCase('getHandleFunctionDocumentation formats correctly', () => {
  const doc = ioModuleTypeRegistry.getHandleFunctionDocumentation('write');
  return doc.includes('handle.write(') && doc.includes('number | null');
});

testCase('getIoHandleMethod returns method signatures', () => {
  const method = ioModuleTypeRegistry.getIoHandleMethod('seek');
  if (!method) return false;
  return method.name === 'seek' && method.parameters.length === 2;
});

testCase('getIoHandleMethod returns undefined for invalid methods', () => {
  return ioModuleTypeRegistry.getIoHandleMethod('nonexistent') === undefined;
});

// =========================================================================
// 3. Constant registry
// =========================================================================

const expectedConstantGroups = {
  'open flags': ['O_RDONLY', 'O_WRONLY', 'O_RDWR', 'O_CREAT', 'O_EXCL', 'O_TRUNC',
    'O_APPEND', 'O_NONBLOCK', 'O_NOCTTY', 'O_SYNC', 'O_CLOEXEC', 'O_DIRECTORY', 'O_NOFOLLOW'],
  'seek': ['SEEK_SET', 'SEEK_CUR', 'SEEK_END'],
  'fcntl': ['F_DUPFD', 'F_DUPFD_CLOEXEC', 'F_GETFD', 'F_SETFD', 'F_GETFL', 'F_SETFL',
    'F_GETLK', 'F_SETLK', 'F_SETLKW', 'F_GETOWN', 'F_SETOWN'],
  'fd flags': ['FD_CLOEXEC'],
  'terminal': ['TCSANOW', 'TCSADRAIN', 'TCSAFLUSH'],
  'ioctl': ['IOC_DIR_NONE', 'IOC_DIR_READ', 'IOC_DIR_WRITE', 'IOC_DIR_RW'],
};

testCase('All expected constants are present', () => {
  const allConstants = Object.values(expectedConstantGroups).flat();
  const missing = allConstants.filter(c => !ioConstants.has(c));
  if (missing.length > 0) {
    console.log(`    Missing: ${missing.join(', ')}`);
    return false;
  }
  return true;
});

testCase('isIoConstant identifies constants correctly', () => {
  return ioModuleTypeRegistry.isIoConstant('O_RDONLY')
    && ioModuleTypeRegistry.isIoConstant('SEEK_SET')
    && ioModuleTypeRegistry.isIoConstant('F_GETFD')
    && ioModuleTypeRegistry.isIoConstant('TCSANOW')
    && !ioModuleTypeRegistry.isIoConstant('NONEXISTENT');
});

testCase('getConstantDocumentation returns formatted docs', () => {
  const doc = ioModuleTypeRegistry.getConstantDocumentation('O_RDONLY');
  return doc.includes('(constant) O_RDONLY') && doc.includes('= 0') && doc.includes('Read-only');
});

testCase('SEEK_CUR constant documentation', () => {
  const doc = ioModuleTypeRegistry.getConstantDocumentation('SEEK_CUR');
  return doc.includes('(constant) SEEK_CUR') && doc.includes('= 1') && doc.includes('current position');
});

testCase('F_SETFL constant documentation', () => {
  const doc = ioModuleTypeRegistry.getConstantDocumentation('F_SETFL');
  return doc.includes('(constant) F_SETFL') && doc.includes('fcntl');
});

testCase('TCSAFLUSH constant documentation', () => {
  const doc = ioModuleTypeRegistry.getConstantDocumentation('TCSAFLUSH');
  return doc.includes('(constant) TCSAFLUSH') && doc.includes('discarding pending input');
});

testCase('IOC_DIR_RW constant documentation', () => {
  const doc = ioModuleTypeRegistry.getConstantDocumentation('IOC_DIR_RW');
  return doc.includes('(constant) IOC_DIR_RW') && doc.includes('Read-write');
});

testCase('getConstantDocumentation returns empty for unknown', () => {
  return ioModuleTypeRegistry.getConstantDocumentation('NONEXISTENT') === '';
});

// =========================================================================
// 4. IoObjectType and data type helpers
// =========================================================================

testCase('IoObjectType.IO_HANDLE equals io.handle', () => {
  // IoObjectType is an enum, imported as a value via require
  const { IoObjectType } = require('../src/analysis/ioTypes.ts');
  return IoObjectType && IoObjectType.IO_HANDLE === 'io.handle';
});

testCase('createIoHandleDataType creates correct type', () => {
  const dt = createIoHandleDataType();
  return dt && typeof dt === 'object' && 'moduleName' in dt && dt.moduleName === 'io.handle';
});

testCase('isVariableOfIoType detects io.handle', () => {
  const dt = createIoHandleDataType();
  return ioModuleTypeRegistry.isVariableOfIoType(dt);
});

testCase('isVariableOfIoType rejects non-io types', () => {
  return !ioModuleTypeRegistry.isVariableOfIoType('string')
    && !ioModuleTypeRegistry.isVariableOfIoType({ moduleName: 'fs.file' })
    && !ioModuleTypeRegistry.isVariableOfIoType('unknown');
});

testCase('typeToString returns io.handle for io handle data type', () => {
  const dt = createIoHandleDataType();
  return typeToString(dt) === 'io.handle';
});

// =========================================================================
// 5. io.handle type inference from semantic analysis
// =========================================================================

testCase('io.handle inferred from open() imported from io (let declaration)', () => {
  const code = `import { open } from 'io';\nlet h = open('/tmp/test', 0);`;
  const result = analyzeCode(code);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol h not found'); return false; }
  const ts = typeToString(sym.dataType);
  console.log(`    h type: ${ts}`);
  return ts === 'io.handle';
});

testCase('io.handle inferred from from() imported from io', () => {
  // 'from' is a keyword but still importable from io
  const code = `import { from } from 'io';\nlet h = from(null);`;
  const result = analyzeCode(code);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol h not found'); return false; }
  const ts = typeToString(sym.dataType);
  console.log(`    h type: ${ts}`);
  return ts === 'io.handle';
});

testCase('io.handle NOT inferred from open() without io import', () => {
  // Without io import, open() should resolve to fs.file (builtin)
  const code = `let h = open('/tmp/test', 'r');`;
  const result = analyzeCode(code);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol h not found'); return false; }
  const ts = typeToString(sym.dataType);
  console.log(`    h type: ${ts}`);
  return ts === 'fs.file';
});

testCase('io.handle inferred via namespace import io.open()', () => {
  const code = `import * as io from 'io';\nlet h = io.open('/tmp/test', 0);`;
  const result = analyzeCode(code);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol h not found'); return false; }
  const ts = typeToString(sym.dataType);
  console.log(`    h type: ${ts}`);
  return ts === 'io.handle';
});

testCase('io.handle inferred from assignment (not just declaration)', () => {
  const code = `import { open } from 'io';\nlet h;\nh = open('/tmp/test', 0);`;
  const result = analyzeCode(code);
  const sym = result.symbolTable.lookup('h');
  if (!sym) { console.log('    Symbol h not found'); return false; }
  const ts = typeToString(sym.dataType);
  console.log(`    h type: ${ts}`);
  return ts === 'io.handle';
});

testCase('pipe() does NOT return io.handle type (returns array)', () => {
  const code = `import { pipe } from 'io';\nlet p = pipe();`;
  const result = analyzeCode(code);
  const sym = result.symbolTable.lookup('p');
  if (!sym) { console.log('    Symbol p not found'); return false; }
  const ts = typeToString(sym.dataType);
  console.log(`    p type: ${ts}`);
  // pipe returns array, not io.handle
  return ts !== 'io.handle';
});

// =========================================================================
// 6. No false positive diagnostics on io.handle methods
// =========================================================================

testCase('No error diagnostics on valid handle method calls', () => {
  const code = `import { open } from 'io';
let h = open('/tmp/test', 0);
h.read(1024);
h.write('hello');
h.seek(0, 0);
h.tell();
h.fileno();
h.close();
h.isatty();
h.dup();
h.dup2(10);
h.fcntl(1);
h.error();
`;
  const result = analyzeCode(code);
  // Filter for errors (not warnings) related to io.handle methods
  const ioErrors = result.diagnostics.filter(d =>
    d.severity === 1 && d.message && d.message.includes('io.handle')
  );
  if (ioErrors.length > 0) {
    console.log(`    Unexpected errors: ${ioErrors.map(e => e.message).join(', ')}`);
    return false;
  }
  return true;
});

testCase('Error diagnostic for invalid method on io.handle', () => {
  const code = `import { open } from 'io';
let h = open('/tmp/test', 0);
h.nonexistentMethod();
`;
  const result = analyzeCode(code);
  const methodErrors = result.diagnostics.filter(d =>
    d.message && d.message.includes("does not exist on io.handle")
  );
  console.log(`    Found ${methodErrors.length} method error(s)`);
  return methodErrors.length > 0;
});

// =========================================================================
// 7. Constant hover shows per-constant docs (not generic module docs)
// =========================================================================

testCase('Each constant group has documentation for every member', () => {
  const allConstants = Object.values(expectedConstantGroups).flat();
  const missing = allConstants.filter(c => {
    const doc = ioModuleTypeRegistry.getConstantDocumentation(c);
    return !doc || doc.length === 0;
  });
  if (missing.length > 0) {
    console.log(`    Constants without docs: ${missing.join(', ')}`);
    return false;
  }
  return true;
});

// =========================================================================
// Summary
// =========================================================================

console.log(`\nTest Results: ${passedTests}/${totalTests} tests passed`);
if (passedTests === totalTests) {
  console.log('All io module tests passed!');
} else {
  console.log(`${totalTests - passedTests} tests failed.`);
  process.exit(1);
}
