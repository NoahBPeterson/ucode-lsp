/**
 * CFG Integration Tests
 *
 * Tests that CFG analysis is properly integrated into SemanticAnalyzer
 * and that LSP features can query CFG results.
 */

import { test, expect, describe } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

/**
 * Helper to run semantic analysis with CFG
 */
function analyzeWithCFG(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, code);
  const result = parser.parse();

  if (result.errors.length > 0) {
    console.log('Parse errors:', result.errors.map((e) => e.message));
  }

  const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
  const analyzer = new SemanticAnalyzer(textDocument, {
    enableControlFlowAnalysis: true,
  });

  const analysisResult = analyzer.analyze(result.ast);

  return {
    result: analysisResult,
    cfg: analysisResult.cfg,
    queryEngine: analysisResult.cfgQueryEngine,
  };
}

describe('CFG Integration - Basic', () => {
  test('should build CFG during semantic analysis', () => {
    const code = 'let x = 5;';
    const { cfg } = analyzeWithCFG(code);

    expect(cfg).toBeDefined();
    expect(cfg.entry).toBeDefined();
    expect(cfg.exit).toBeDefined();
    expect(cfg.blocks.length).toBeGreaterThan(0);
  });

  test('should create query engine', () => {
    const code = 'let x = 5;';
    const { queryEngine } = analyzeWithCFG(code);

    expect(queryEngine).toBeDefined();
  });

  test('should include CFG in analysis result', () => {
    const code = 'let x = 5;';
    const { result } = analyzeWithCFG(code);

    expect(result.cfg).toBeDefined();
    expect(result.cfgQueryEngine).toBeDefined();
  });

  test('should handle control flow structures', () => {
    const code = 'if (x > 5) { print(x); } else { print(0); }';
    const { cfg } = analyzeWithCFG(code);

    expect(cfg).toBeDefined();

    // Should have if.then, if.else, and if.merge blocks
    const thenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    const elseBlock = cfg.blocks.find((b) => b.label === 'if.else');
    const mergeBlock = cfg.blocks.find((b) => b.label === 'if.merge');

    expect(thenBlock).toBeDefined();
    expect(elseBlock).toBeDefined();
    expect(mergeBlock).toBeDefined();
  });

  test('should handle loops', () => {
    const code = 'for (let i = 0; i < 10; i++) { print(i); }';
    const { cfg } = analyzeWithCFG(code);

    expect(cfg).toBeDefined();

    // Should have for.init, for.condition, for.body, for.update blocks
    const initBlock = cfg.blocks.find((b) => b.label === 'for.init');
    const condBlock = cfg.blocks.find((b) => b.label === 'for.condition');
    const bodyBlock = cfg.blocks.find((b) => b.label === 'for.body');
    const updateBlock = cfg.blocks.find((b) => b.label === 'for.update');

    expect(initBlock).toBeDefined();
    expect(condBlock).toBeDefined();
    expect(bodyBlock).toBeDefined();
    expect(updateBlock).toBeDefined();
  });
});

describe('CFG Integration - Type States', () => {
  test('should populate type states in CFG blocks', () => {
    const code = 'let x = 5; let y = "hello";';
    const { cfg } = analyzeWithCFG(code);

    expect(cfg).toBeDefined();

    // Entry block should have type states populated
    const entryState = cfg.entry.typeStateOut;
    expect(entryState).toBeDefined();
    expect(entryState.size()).toBeGreaterThan(0);
  });

  test('should infer types in type states', () => {
    const code = 'let x = 5;';
    const { cfg } = analyzeWithCFG(code);

    const entryState = cfg.entry.typeStateOut;
    const xType = entryState.get('x');

    expect(xType).toBe('integer');
  });

  test('should handle type narrowing in branches', () => {
    const code = 'let x; if (type(x) === "string") { print(x); }';
    const { cfg } = analyzeWithCFG(code);

    const thenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    expect(thenBlock).toBeDefined();

    // In the then block, x should be narrowed to string
    const xType = thenBlock.typeStateIn.get('x');
    expect(xType).toBe('string');
  });

  test('should merge types from different branches', () => {
    const code = 'let x; if (true) { x = 5; } else { x = "hello"; }';
    const { cfg } = analyzeWithCFG(code);

    const mergeBlock = cfg.blocks.find((b) => b.label === 'if.merge');
    expect(mergeBlock).toBeDefined();

    // After if/else, x should be union of integer and string
    const xType = mergeBlock.typeStateIn.get('x');
    expect(xType).toBeDefined();
    expect(xType.type).toBe('union');
  });
});

describe('CFG Integration - Query Engine', () => {
  test('should query CFG info', () => {
    const code = 'let x = 5;';
    const { queryEngine } = analyzeWithCFG(code);

    const info = queryEngine.getCFGInfo();
    expect(info.blockCount).toBeGreaterThan(0);
    expect(info.entryBlockId).toBeDefined();
    expect(info.exitBlockId).toBeDefined();
  });

  test('should detect reachable blocks', () => {
    const code = 'let x = 5; if (true) { x = 10; }';
    const { cfg, queryEngine } = analyzeWithCFG(code);

    // All blocks should be reachable
    for (const block of cfg.blocks) {
      expect(queryEngine.isBlockReachable(block)).toBe(true);
    }
  });

  test('should get unreachable blocks', () => {
    const code = 'let x = 5; return x;';
    const { queryEngine } = analyzeWithCFG(code);

    const unreachableBlocks = queryEngine.getUnreachableBlocks();
    // May or may not have unreachable blocks depending on CFG construction
    expect(Array.isArray(unreachableBlocks)).toBe(true);
  });
});

describe('CFG Integration - Error Handling', () => {
  test('should handle empty program gracefully', () => {
    const code = '';
    const { cfg } = analyzeWithCFG(code);

    expect(cfg).toBeDefined();
    expect(cfg.entry).toBeDefined();
    expect(cfg.exit).toBeDefined();
  });

  test('should continue analysis if CFG fails', () => {
    // Even with potential CFG issues, semantic analysis should complete
    const code = 'let x = 5;';
    const { result } = analyzeWithCFG(code);

    expect(result).toBeDefined();
    expect(result.diagnostics).toBeDefined();
    expect(result.symbolTable).toBeDefined();
  });

  test('should handle complex nested structures', () => {
    const code = `
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          sum += i;
        } else {
          continue;
        }
      }
    `;
    const { cfg } = analyzeWithCFG(code);

    expect(cfg).toBeDefined();
    expect(cfg.blocks.length).toBeGreaterThan(5);
  });
});

describe('CFG Integration - Disabled CFG', () => {
  test('should skip CFG when disabled', () => {
    const code = 'let x = 5;';
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const result = parser.parse();

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
      enableControlFlowAnalysis: false, // Disabled
    });

    const analysisResult = analyzer.analyze(result.ast);

    // CFG should not be created
    expect(analysisResult.cfg).toBeUndefined();
    expect(analysisResult.cfgQueryEngine).toBeUndefined();

    // But analysis should still work
    expect(analysisResult.diagnostics).toBeDefined();
    expect(analysisResult.symbolTable).toBeDefined();
  });
});
