/**
 * Tests for rest parameter support in arrow functions
 * Ensures parsing and semantic analysis work correctly
 */

const { UcodeLexer } = require('../src/lexer');
const { UcodeParser } = require('../src/parser/ucodeParser');
const assert = require('assert');

describe('Rest Parameters in Arrow Functions', () => {

  describe('Parser Tests', () => {
    
    it('should parse simple arrow function with rest parameter', () => {
      const code = 'let func = (a, ...rest) => a + rest[0];';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors');
      assert.ok(result.ast && result.ast.body.length > 0, 'Should have parsed AST');
      
      const varDecl = result.ast.body[0];
      assert.strictEqual(varDecl.type, 'VariableDeclaration');
      
      const arrowFunc = varDecl.declarations[0].init;
      assert.strictEqual(arrowFunc.type, 'ArrowFunctionExpression');
      assert.strictEqual(arrowFunc.params.length, 1, 'Should have 1 regular parameter');
      assert.ok(arrowFunc.restParam, 'Should have rest parameter');
      assert.strictEqual(arrowFunc.restParam.name, 'rest', 'Rest parameter should be named "rest"');
    });
    
    it('should parse arrow function with only rest parameter', () => {
      const code = 'let func = (...args) => args.length;';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors');
      
      const arrowFunc = result.ast.body[0].declarations[0].init;
      assert.strictEqual(arrowFunc.type, 'ArrowFunctionExpression');
      assert.strictEqual(arrowFunc.params.length, 0, 'Should have 0 regular parameters');
      assert.ok(arrowFunc.restParam, 'Should have rest parameter');
      assert.strictEqual(arrowFunc.restParam.name, 'args', 'Rest parameter should be named "args"');
    });
    
    it('should parse object literal with arrow function and rest parameter', () => {
      const code = 'export default { debug: (fmt, ...args) => warn(sprintf(fmt, ...args)) };';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors');
      
      const exportDecl = result.ast.body[0];
      assert.strictEqual(exportDecl.type, 'ExportDefaultDeclaration');
      
      const obj = exportDecl.declaration;
      assert.strictEqual(obj.type, 'ObjectExpression');
      
      const debugProp = obj.properties[0];
      assert.strictEqual(debugProp.type, 'Property');
      
      const arrowFunc = debugProp.value;
      assert.strictEqual(arrowFunc.type, 'ArrowFunctionExpression');
      assert.strictEqual(arrowFunc.params.length, 1, 'Should have 1 regular parameter');
      assert.ok(arrowFunc.restParam, 'Should have rest parameter');
      assert.strictEqual(arrowFunc.restParam.name, 'args');
    });
    
    it('should parse complex object literal with multiple arrow functions', () => {
      const code = `export default {
        debug: (fmt, ...args) => warn(sprintf(\`[D] \${fmt}\\n\`, ...args)),
        warn:  (fmt, ...args) => warn(sprintf(\`[W] \${fmt}\\n\`, ...args)),
        error: (fmt, ...args) => warn(sprintf(\`[E] \${fmt}\\n\`, ...args))
      };`;
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors');
      
      const obj = result.ast.body[0].declaration;
      assert.strictEqual(obj.properties.length, 3, 'Should have 3 properties');
      
      // Check each property has an arrow function with rest parameter
      for (let i = 0; i < 3; i++) {
        const prop = obj.properties[i];
        const arrowFunc = prop.value;
        assert.strictEqual(arrowFunc.type, 'ArrowFunctionExpression');
        assert.strictEqual(arrowFunc.params.length, 1);
        assert.ok(arrowFunc.restParam);
        assert.strictEqual(arrowFunc.restParam.name, 'args');
      }
    });
    
    it('should handle spread operator in call expressions within arrow functions', () => {
      const code = 'let func = (fmt, ...args) => sprintf(fmt, ...args);';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors');
      
      const arrowFunc = result.ast.body[0].declarations[0].init;
      assert.strictEqual(arrowFunc.type, 'ArrowFunctionExpression');
      assert.ok(arrowFunc.restParam);
      
      // Check that the function body contains a call with spread element
      const callExpr = arrowFunc.body;
      assert.strictEqual(callExpr.type, 'CallExpression');
      
      // The second argument should be a spread element
      const spreadArg = callExpr.arguments[1];
      assert.strictEqual(spreadArg.type, 'SpreadElement');
      assert.strictEqual(spreadArg.argument.type, 'Identifier');
      assert.strictEqual(spreadArg.argument.name, 'args');
    });
  });
  
  describe('Regular Function Tests', () => {
    it('should parse regular function with rest parameter', () => {
      const code = 'function test(a, ...rest) { return rest; }';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors');
      
      const funcDecl = result.ast.body[0];
      assert.strictEqual(funcDecl.type, 'FunctionDeclaration');
      assert.strictEqual(funcDecl.params.length, 1, 'Should have 1 regular parameter');
      assert.ok(funcDecl.restParam, 'Should have rest parameter');
      assert.strictEqual(funcDecl.restParam.name, 'rest');
    });
  });
  
  describe('Error Cases', () => {
    it('should allow multiple spread operators in function calls', () => {
      const code = 'let func = () => { let a = [1,2]; let b = [3,4]; print(...a, ...b); };';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      // Multiple spread operators in calls should be valid
      assert.strictEqual(result.errors.length, 0, 'Should have no parse errors for multiple spread in calls');
      assert.ok(result.ast, 'Should parse successfully');
    });
    
    it('should not allow parameters after rest parameter', () => {
      const code = 'let func = (...args, extra) => args;';
      
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();
      const parser = new UcodeParser(tokens, code);
      const result = parser.parse();
      
      // The parser should generate errors when parameters appear after rest parameter
      assert.ok(result.errors.length > 0, 'Should have parse errors for parameters after rest parameter');
      
      // The parsing should fail to create a proper arrow function
      const init = result.ast.body[0].declarations[0].init;
      assert.notStrictEqual(init.type, 'ArrowFunctionExpression', 'Should not successfully parse as arrow function');
    });
  });
});