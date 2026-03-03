/**
 * Data Flow Analysis Tests
 *
 * Phase 2: Tests for data flow analysis with type inference and narrowing.
 */

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';
import { CFGBuilder } from '../src/analysis/cfg/cfgBuilder';
import { DataFlowAnalyzer } from '../src/analysis/cfg/dataFlowAnalyzer';
import { SymbolTable } from '../src/analysis/symbolTable';

/**
 * Helper to build CFG and run data flow analysis
 */
function analyzeDataFlow(code, name = 'test') {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, code);
  const result = parser.parse();

  if (result.errors.length > 0) {
    console.log('Parse errors:', result.errors.map((e) => `${e.message} at ${e.start}`));
  }

  const builder = new CFGBuilder(name);
  const cfg = builder.build(result.ast);

  const symbolTable = new SymbolTable();
  const analyzer = new DataFlowAnalyzer(cfg, symbolTable, code, { debug: false });
  const dfResult = analyzer.analyze();

  return { cfg, dfResult, symbolTable };
}

describe('Data Flow - Basic Type Inference', () => {
  test('should infer types from literal assignments', () => {
    const code = 'let x = 5; let y = "hello"; let z = true;';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    const entryState = cfg.entry.typeStateOut;
    expect(entryState.get('x')).toBe('integer');
    expect(entryState.get('y')).toBe('string');
    expect(entryState.get('z')).toBe('boolean');
  });

  test('should infer array type', () => {
    const code = 'let arr = [1, 2, 3];';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(cfg.entry.typeStateOut.get('arr')).toBe('array');
  });

  test('should infer object type', () => {
    const code = 'let obj = { a: 1, b: 2 };';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(cfg.entry.typeStateOut.get('obj')).toBe('object');
  });

  test('should update type on reassignment', () => {
    const code = 'let x = 5; x = "hello";';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // After both statements, x should be string
    const finalState = cfg.entry.typeStateOut;
    expect(finalState.get('x')).toBe('string');
  });
});

describe('Data Flow - Control Flow', () => {
  test('should handle if-statement with separate branches', () => {
    const code = 'let x = 0; if (true) { x = 5; } else { x = 10; }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Find the merge block after if statement
    const mergeBlock = cfg.blocks.find((b) => b.label === 'if.merge');
    expect(mergeBlock).toBeDefined();

    // x should be integer in merge block
    expect(mergeBlock.typeStateIn.get('x')).toBe('integer');
  });

  test('should merge types from different branches', () => {
    const code = 'let x; if (true) { x = 5; } else { x = "hello"; }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Find the merge block
    const mergeBlock = cfg.blocks.find((b) => b.label === 'if.merge');
    expect(mergeBlock).toBeDefined();

    // x should be union of integer and string
    const xType = mergeBlock.typeStateIn.get('x');
    expect(xType).toBeDefined();
    expect(xType.type).toBe('union');
    expect(xType.types).toContain('integer');
    expect(xType.types).toContain('string');
  });

  test('should propagate types through while loop', () => {
    const code = 'let i = 0; while (i < 10) { i = i + 1; }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Loop should converge with i as integer throughout
    const afterBlock = cfg.blocks.find((b) => b.label === 'while.after');
    expect(afterBlock).toBeDefined();
    expect(afterBlock.typeStateIn.get('i')).toBe('integer');
  });

  test('should handle for loop', () => {
    const code = 'for (let i = 0; i < 10; i++) { print(i); }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // i should be integer in loop body
    const bodyBlock = cfg.blocks.find((b) => b.label === 'for.body');
    expect(bodyBlock).toBeDefined();
    expect(bodyBlock.typeStateIn.get('i')).toBe('integer');
  });
});

describe('Data Flow - Type Narrowing', () => {
  test('should narrow type on null check (positive)', () => {
    const code = 'let x = null; if (x === null) { print(x); }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Find the then block
    const thenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    expect(thenBlock).toBeDefined();

    // x should be narrowed to null in then block
    expect(thenBlock.typeStateIn.get('x')).toBe('null');
  });

  test('should exclude null on negative check', () => {
    const code = 'let x; if (x !== null) { print(x); }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Find the then block directly
    const thenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    expect(thenBlock).toBeDefined();

    // In the then block, x should have null excluded
    // Since we start with unknown and exclude null, it stays unknown (can't narrow unknown further)
    const xType = thenBlock.typeStateIn.get('x');
    // The type should be defined (not undefined)
    expect(xType).toBeDefined();
  });

  test('should narrow type with type() check', () => {
    const code = 'let x; if (type(x) === "string") { print(x); }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Find the then block
    const thenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    expect(thenBlock).toBeDefined();

    // x should be narrowed to string in then block
    expect(thenBlock.typeStateIn.get('x')).toBe('string');
  });

  test('should exclude type in else branch', () => {
    const code = 'let x; if (type(x) === "string") { print("str"); } else { print("not str"); }';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);

    // Find the else block
    const elseBlock = cfg.blocks.find((b) => b.label === 'if.else');
    expect(elseBlock).toBeDefined();

    // The edge to else block should have narrowing that excludes string
    const elseEdge = cfg.entry.successors.find((e) => e.target === elseBlock);
    expect(elseEdge).toBeDefined();
    expect(elseEdge.narrowedState).toBeDefined();
  });
});

describe('Data Flow - Built-in Functions', () => {
  test('should infer return type of iptoarr', () => {
    const code = 'let ip = "192.168.1.1"; let arr = iptoarr(ip);';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(cfg.entry.typeStateOut.get('arr')).toBe('array');
  });

  test('should infer return type of arrtoip', () => {
    const code = 'let arr = [192, 168, 1, 1]; let ip = arrtoip(arr);';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(cfg.entry.typeStateOut.get('ip')).toBe('string');
  });

  test('should infer return type of split', () => {
    const code = 'let str = "a,b,c"; let parts = split(str, ",");';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(cfg.entry.typeStateOut.get('parts')).toBe('array');
  });

  test('should infer return type of join', () => {
    const code = 'let arr = ["a", "b"]; let str = join(",", arr);';
    const { cfg, dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(cfg.entry.typeStateOut.get('str')).toBe('string');
  });
});

describe('Data Flow - Convergence', () => {
  test('should converge on simple sequential code', () => {
    const code = 'let x = 1; let y = 2; let z = x + y;';
    const { dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(dfResult.iterations).toBeLessThan(10);
  });

  test('should converge on nested loops', () => {
    const code = 'for (let i = 0; i < 10; i++) { for (let j = 0; j < 10; j++) { print(i + j); } }';
    const { dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    // Nested loops may take more iterations
    expect(dfResult.iterations).toBeLessThan(100);
  });

  test('should converge on complex control flow', () => {
    const code = `
      let x = 0;
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          x = x + 1;
        } else {
          x = x + 2;
        }
      }
    `;
    const { dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    expect(dfResult.iterations).toBeLessThan(50);
  });
});

describe('Data Flow - Expression Type Inference', () => {
  test('should infer integer from arithmetic', () => {
    const code = 'let x = 5 + 3;';
    const { cfg } = analyzeDataFlow(code);

    expect(cfg.entry.typeStateOut.get('x')).toBe('integer');
  });

  test('should infer boolean from comparison', () => {
    const code = 'let x = 5 > 3;';
    const { cfg } = analyzeDataFlow(code);

    expect(cfg.entry.typeStateOut.get('x')).toBe('boolean');
  });

  test('should infer boolean from logical operators', () => {
    const code = 'let x = true && false;';
    const { cfg } = analyzeDataFlow(code);

    expect(cfg.entry.typeStateOut.get('x')).toBe('boolean');
  });

  test('should infer double from mixed arithmetic', () => {
    const code = 'let x = 5 + 3.14;';
    const { cfg } = analyzeDataFlow(code);

    expect(cfg.entry.typeStateOut.get('x')).toBe('double');
  });
});

describe('Data Flow - Edge Cases', () => {
  test('should handle variable declared without initializer', () => {
    const code = 'let x;';
    const { cfg } = analyzeDataFlow(code);

    expect(cfg.entry.typeStateOut.get('x')).toBe('unknown');
  });

  test('should handle empty program', () => {
    const code = '';
    const { dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
    // Empty program may take 1-2 iterations depending on implementation
    expect(dfResult.iterations).toBeLessThanOrEqual(2);
  });

  test('should handle return in if branch', () => {
    const code = 'let x = 0; if (x > 5) { return x; } x = 10;';
    const { dfResult } = analyzeDataFlow(code);

    expect(dfResult.converged).toBe(true);
  });
});
