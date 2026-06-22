// Tests for this.prop = val property type tracking.
// Properties assigned via `this` inside methods should be visible
// to sibling methods in the same object literal.

import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { typeToString } from '../../src/analysis/symbolTable.ts';

function analyze(code) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();
    const doc = {
        getText: () => code,
        positionAt: (o) => { let l=0,c=0; for(let i=0;i<o&&i<code.length;i++){if(code[i]==='\n'){l++;c=0;}else{c++;}} return {line:l,character:c}; },
        offsetAt: (p) => { const lines=code.split('\n'); let o=0; for(let i=0;i<p.line&&i<lines.length;i++){o+=lines[i].length+1;} return o+p.character; },
        uri: 'file:///test.uc', languageId: 'ucode', version: 1
    };
    const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
    return analyzer.analyze(parseResult.ast);
}

function typeAt(result, code, varName) {
    const off = code.indexOf(`let ${varName}`) + 4;
    const sym = result.symbolTable.lookupAtPosition(varName, off);
    return sym ? typeToString(sym.dataType) : 'NOT FOUND';
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// ============================================================================
// 1. Properties from literal are visible to methods
// ============================================================================
{
    const code = `let obj = {
    name: "test",
    count: 0,
    getName: function() {
        let n = this.name;
    },
    getCount: function() {
        let c = this.count;
    }
};`;
    const r = analyze(code);
    check('literal this.name -> string', typeAt(r, code, 'n'), 'string');
    check('literal this.count -> integer', typeAt(r, code, 'c'), 'integer');
}

// ============================================================================
// 2. Properties assigned via this are visible to the SAME method
// ============================================================================
{
    const code = `let obj = {
    init: function() {
        this.status = "ready";
        this.port = 8080;
        let s = this.status;
        let p = this.port;
    }
};`;
    const r = analyze(code);
    check('this.status in same method -> string', typeAt(r, code, 's'), 'string');
    check('this.port in same method -> integer', typeAt(r, code, 'p'), 'integer');
}

// ============================================================================
// 3. Properties assigned via this in one method visible to SIBLING methods
// ============================================================================
{
    const code = `let obj = {
    start: function() {
        this.host = "0.0.0.0";
        this.port = 8080;
    },
    getAddr: function() {
        let h = this.host;
        let p = this.port;
    }
};`;
    const r = analyze(code);
    check('cross-method this.host -> string', typeAt(r, code, 'h'), 'string');
    check('cross-method this.port -> integer', typeAt(r, code, 'p'), 'integer');
}

// ============================================================================
// 4. this assignments don't clobber literal properties
// ============================================================================
{
    const code = `let obj = {
    name: "original",
    init: function() {
        this.name = "updated";
    },
    getName: function() {
        let n = this.name;
    }
};`;
    const r = analyze(code);
    // After reassignment, type should still be string (same type)
    check('reassigned this.name still string', typeAt(r, code, 'n'), 'string');
}

// ============================================================================
// 5. Mixed literal + this-assigned properties
// ============================================================================
{
    const code = `let obj = {
    config: {},
    load: function(path) {
        this.loaded = true;
        this.filename = path;
    },
    info: function() {
        let c = this.config;
        let l = this.loaded;
        let f = this.filename;
    }
};`;
    const r = analyze(code);
    check('literal this.config -> object', typeAt(r, code, 'c'), 'object');
    check('this-assigned this.loaded -> boolean', typeAt(r, code, 'l'), 'boolean');
    // filename type depends on parameter type (unknown)
    check('this-assigned this.filename -> unknown', typeAt(r, code, 'f'), 'unknown');
}

// ============================================================================
// 6. Array property assigned via this
// ============================================================================
{
    const code = `let obj = {
    init: function() {
        this.items = [1, 2, 3];
        this.names = ["a", "b"];
    },
    getItems: function() {
        let i = this.items;
        let n = this.names;
    }
};`;
    const r = analyze(code);
    // Array element types not yet preserved through this.prop assignment
    // (inferAssignmentDataType returns basic type without _fullType)
    const itemsType = typeAt(r, code, 'i');
    check('this.items is array', itemsType.startsWith('array'), true);
    const namesType = typeAt(r, code, 'n');
    check('this.names is array', namesType.startsWith('array'), true);
}

// ============================================================================
// 7. Real-world pattern: uci mock cursor
// ============================================================================
{
    const code = `let cursor = {
    _configs: {},
    load: function(file) {
        this._configs[file] = {};
    },
    get: function(config, section, option) {
        let cfg = this._configs;
    }
};`;
    const r = analyze(code);
    // _configs is from literal — should be object
    check('this._configs -> object', typeAt(r, code, 'cfg'), 'object');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
