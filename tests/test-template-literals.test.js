const { describe, test, expect } = require('bun:test');
const { UcodeLexer } = require("../src/lexer/ucodeLexer");
const { UcodeParser } = require("../src/parser/ucodeParser");
const { createLSPTestServer } = require("./lsp-test-helpers");
const path = require("path");
const fs = require("fs");

describe("Template Literal Support", () => {
  describe("Lexer - Template Literal Tokenization", () => {
    const { TokenType } = require("../src/lexer/tokenTypes");

    test("should tokenize simple template literal without placeholders", () => {
      const code = "`hello world`";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();

      expect(tokens).toHaveLength(2); // TK_TEMPLATE + TK_EOF
      expect(tokens[0].type).toBe(TokenType.TK_TEMPLATE);
      expect(tokens[0].value).toBe("hello world");
    });

    test("should tokenize template literal with single placeholder", () => {
      const code = "`hello \${name}`";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();

      // Expected: TK_TEMPLATE("hello ") + TK_PLACEH + TK_LABEL(name) + TK_RBRACE + TK_TEMPLATE("") + TK_EOF
      expect(tokens.length).toBeGreaterThanOrEqual(5);
      expect(tokens[0].type).toBe(TokenType.TK_TEMPLATE);
      expect(tokens[0].value).toBe("hello ");
      expect(tokens[1].type).toBe(TokenType.TK_PLACEH);
      expect(tokens[2].type).toBe(TokenType.TK_LABEL); // variable name
      expect(tokens[2].value).toBe("name");
    });

    test("should tokenize template literal with multiple placeholders", () => {
      const code = "`\${a} + \${b} = \${c}`";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();

      // Should have 3 TK_PLACEH tokens
      const placeholderTokens = tokens.filter(t => t.type === TokenType.TK_PLACEH);
      expect(placeholderTokens).toHaveLength(3);
    });

    test("should tokenize template literal with nested braces in placeholder", () => {
      const code = "`result: \${{ foo: 'bar' }}`";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();

      // Should properly handle the template start and placeholder
      expect(tokens[0].type).toBe(TokenType.TK_TEMPLATE);
      expect(tokens[0].value).toBe("result: ");
      expect(tokens[1].type).toBe(TokenType.TK_PLACEH);

      // Should have object literal braces
      // The exact token count depends on how nested braces are handled
      // At minimum, we should have the placeholder start and the object
      const lbraceTokens = tokens.filter(t => t.type === TokenType.TK_LBRACE);
      expect(lbraceTokens.length).toBeGreaterThanOrEqual(1);
    });

    test("should handle escape sequences in template literals", () => {
      const code = "`line1\\nline2\\ttab`";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const tokens = lexer.tokenize();

      expect(tokens[0].type).toBe(TokenType.TK_TEMPLATE);
      expect(tokens[0].value).toContain("\n");
      expect(tokens[0].value).toContain("\t");
    });
  });

  describe("Parser - Template Literal AST Construction", () => {
    test("should parse simple template literal", () => {
      const code = "let msg = `hello`;";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const parser = new UcodeParser(lexer.tokenize(), code);
      const result = parser.parse();

      expect(result.errors).toHaveLength(0);
      expect(result.ast).toBeDefined();

      const varDecl = result.ast.body[0];
      expect(varDecl.type).toBe("VariableDeclaration");

      const init = varDecl.declarations[0].init;
      expect(init.type).toBe("TemplateLiteral");
      expect(init.quasis).toHaveLength(1);
      expect(init.expressions).toHaveLength(0);
      expect(init.quasis[0].value.raw).toBe("hello");
    });

    test("should parse template literal with single placeholder", () => {
      const code = "let msg = `hello \${name}`;";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const parser = new UcodeParser(lexer.tokenize(), code);
      const result = parser.parse();

      expect(result.errors).toHaveLength(0);

      const init = result.ast.body[0].declarations[0].init;
      expect(init.type).toBe("TemplateLiteral");
      expect(init.quasis).toHaveLength(2);
      expect(init.expressions).toHaveLength(1);

      expect(init.quasis[0].value.raw).toBe("hello ");
      expect(init.quasis[0].tail).toBe(false);

      expect(init.expressions[0].type).toBe("Identifier");
      expect(init.expressions[0].name).toBe("name");

      expect(init.quasis[1].tail).toBe(true);
    });

    test("should parse template literal with multiple placeholders", () => {
      const code = "let msg = `\${a} + \${b} = \${c}`;";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const parser = new UcodeParser(lexer.tokenize(), code);
      const result = parser.parse();

      expect(result.errors).toHaveLength(0);

      const init = result.ast.body[0].declarations[0].init;
      expect(init.type).toBe("TemplateLiteral");
      expect(init.expressions).toHaveLength(3);
      expect(init.quasis).toHaveLength(4);

      expect(init.expressions[0].name).toBe("a");
      expect(init.expressions[1].name).toBe("b");
      expect(init.expressions[2].name).toBe("c");
    });

    test("should parse template literal with complex expressions", () => {
      const code = "let msg = `result: \${obj.foo + 10}`;";
      const lexer = new UcodeLexer(code, { rawMode: true });
      const parser = new UcodeParser(lexer.tokenize(), code);
      const result = parser.parse();

      expect(result.errors).toHaveLength(0);

      const init = result.ast.body[0].declarations[0].init;
      expect(init.type).toBe("TemplateLiteral");
      expect(init.expressions).toHaveLength(1);
      expect(init.expressions[0].type).toBe("BinaryExpression");
    });
  });

  describe("LSP Integration - Template Literal Analysis", () => {
    test("should mark variables used in template literals as used", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let name = "World";
let greeting = \`Hello \${name}!\`;
`;
        const testPath = path.join(__dirname, "temp-template-test.uc");
        fs.writeFileSync(testPath, content);

        try {
          const diagnostics = await server.getDiagnostics(content, testPath);

          // Should not have "unused variable" warning for 'name'
          const unusedWarnings = diagnostics.filter(d =>
            d.message.includes("unused") && d.message.includes("name")
          );
          expect(unusedWarnings).toHaveLength(0);
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });

    test("should provide hover information for variables in template literals", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let count = 42;
let msg = \`Count: \${count}\`;
`;
        const testPath = path.join(__dirname, "temp-template-hover.uc");
        fs.writeFileSync(testPath, content);

        try {
          // Calculate position of 'count' inside the template literal
          const lines = content.split('\n');
          const targetLine = lines.findIndex(line => line.includes('${count}'));
          const targetColumn = lines[targetLine].indexOf('count', lines[targetLine].indexOf('${'));

          const hover = await server.getHover(content, testPath, targetLine, targetColumn);

          expect(hover).toBeDefined();
          expect(hover.contents.value).toContain("integer");
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });

    test("should type template literals as string", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let template = \`value: \${42}\`;
// Use template with a string function - length() works on strings
let result = length(template);
`;
        const testPath = path.join(__dirname, "temp-template-type.uc");
        fs.writeFileSync(testPath, content);

        try {
          const diagnostics = await server.getDiagnostics(content, testPath);

          // Should not have type errors (warnings for unused vars are ok)
          const typeErrors = diagnostics.filter(d => d.severity === 1); // Error severity
          expect(typeErrors).toHaveLength(0);
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });

    test("should support any type in template placeholders", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let str = "text";
let num = 123;
let arr = [1, 2, 3];
let obj = { key: "value" };

let msg1 = \`String: \${str}\`;
let msg2 = \`Number: \${num}\`;
let msg3 = \`Array: \${arr}\`;
let msg4 = \`Object: \${obj}\`;
`;
        const testPath = path.join(__dirname, "temp-template-any-type.uc");
        fs.writeFileSync(testPath, content);

        try {
          const diagnostics = await server.getDiagnostics(content, testPath);

          // All variables should be marked as used
          const unusedWarnings = diagnostics.filter(d =>
            d.message.includes("unused")
          );
          expect(unusedWarnings).toHaveLength(0);
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });

    test("should support nested expressions in template placeholders", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let a = 5;
let b = 10;
let msg = \`Sum: \${a + b}, Product: \${a * b}\`;
`;
        const testPath = path.join(__dirname, "temp-template-nested.uc");
        fs.writeFileSync(testPath, content);

        try {
          const diagnostics = await server.getDiagnostics(content, testPath);

          // Both variables should be marked as used
          const unusedWarnings = diagnostics.filter(d =>
            d.message.includes("unused")
          );
          expect(unusedWarnings).toHaveLength(0);
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });

    test("should support object/array literals in template placeholders", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let id = 123;
let msg1 = \`Data: \${{ id: id, name: "test" }}\`;
let msg2 = \`List: \${[1, 2, 3]}\`;
`;
        const testPath = path.join(__dirname, "temp-template-objects.uc");
        fs.writeFileSync(testPath, content);

        try {
          const diagnostics = await server.getDiagnostics(content, testPath);

          // Should not have syntax errors
          const syntaxErrors = diagnostics.filter(d =>
            d.severity === 1 && d.message.includes("syntax")
          );
          expect(syntaxErrors).toHaveLength(0);

          // 'id' should be marked as used
          const unusedId = diagnostics.filter(d =>
            d.message.includes("unused") && d.message.includes("id")
          );
          expect(unusedId).toHaveLength(0);
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });

    test("should detect undefined variables in template placeholders", async () => {
      const server = createLSPTestServer();

      try {
        await server.initialize();

        const content = `let msg = \`Hello \${undefinedVar}!\`;
`;
        const testPath = path.join(__dirname, "temp-template-undefined.uc");
        fs.writeFileSync(testPath, content);

        try {
          const diagnostics = await server.getDiagnostics(content, testPath);

          // Should have "undefined variable" error
          const undefinedErrors = diagnostics.filter(d =>
            d.message.includes("undefined") && d.message.includes("undefinedVar")
          );
          expect(undefinedErrors.length).toBeGreaterThan(0);
        } finally {
          if (fs.existsSync(testPath)) {
            fs.unlinkSync(testPath);
          }
        }
      } finally {
        await server.shutdown();
      }
    });
  });
});
