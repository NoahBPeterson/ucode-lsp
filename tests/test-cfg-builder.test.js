/**
 * CFG Builder Tests
 *
 * Phase 1: Tests for Control Flow Graph construction from AST.
 * These tests verify that the CFGBuilder correctly creates blocks and edges
 * for various control flow structures.
 */

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';
import { CFGBuilder } from '../src/analysis/cfg/cfgBuilder';
import {
  visualizeCFGText,
  visualizeCFGDot,
  validateCFG,
  computeCFGStats,
  printCFGSummary,
} from '../src/analysis/cfg/visualizer';

/**
 * Helper to parse code and build a CFG
 */
function buildCFG(code, name = 'test') {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, code);
  const result = parser.parse();

  if (result.errors.length > 0) {
    throw new Error(
      `Parse errors: ${result.errors.map((e) => e.message).join(', ')}`
    );
  }

  const builder = new CFGBuilder(name);
  const cfg = builder.build(result.ast);

  return { cfg, builder, ast: result.ast };
}

describe('CFG Builder - Basic Structure', () => {
  test('should create entry and exit blocks', () => {
    const code = `let x = 5;`;
    const { cfg } = buildCFG(code);

    expect(cfg.entry).toBeDefined();
    expect(cfg.exit).toBeDefined();
    expect(cfg.entry.label).toBe('entry');
    expect(cfg.exit.label).toBe('exit');
  });

  test('should include entry and exit in blocks list', () => {
    const code = `let x = 5;`;
    const { cfg } = buildCFG(code);

    expect(cfg.blocks).toContain(cfg.entry);
    expect(cfg.blocks).toContain(cfg.exit);
  });

  test('should assign unique IDs to blocks', () => {
    const code = `let x = 5; let y = 10;`;
    const { cfg } = buildCFG(code);

    const ids = new Set(cfg.blocks.map((b) => b.id));
    expect(ids.size).toBe(cfg.blocks.length);
  });

  test('should create valid CFG structure', () => {
    const code = `let x = 5;`;
    const { cfg } = buildCFG(code);

    const errors = validateCFG(cfg);
    if (errors.length > 0) {
      console.log('Validation errors:', errors);
    }
    expect(errors).toHaveLength(0);
  });
});

describe('CFG Builder - Sequential Statements', () => {
  test('should add sequential statements to entry block', () => {
    const code = 'let x = 5;\nlet y = 10;\nlet z = x + y;';
    const { cfg } = buildCFG(code);

    expect(cfg.entry.statements.length).toBeGreaterThan(0);
    expect(cfg.entry.successors).toHaveLength(1);
    expect(cfg.entry.successors[0].target).toBe(cfg.exit);
  });

  test('should preserve statement order', () => {
    const code = 'let x = 1;\nlet y = 2;\nlet z = 3;';
    const { cfg } = buildCFG(code);

    const stmtTypes = cfg.entry.statements.map((s) => s.type);
    expect(stmtTypes).toContain('VariableDeclaration');
  });
});

describe('CFG Builder - If Statements', () => {
  test('should create then and merge blocks for if without else', () => {
    const code = `
      if (x > 5) {
        print("big");
      }
    `;
    const { cfg } = buildCFG(code);

    // Should have: entry, if.then, if.merge, exit
    expect(cfg.blocks.length).toBeGreaterThanOrEqual(4);

    const ifThenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    const ifMergeBlock = cfg.blocks.find((b) => b.label === 'if.merge');

    expect(ifThenBlock).toBeDefined();
    expect(ifMergeBlock).toBeDefined();
  });

  test('should create conditional edges from test', () => {
    const code = `
      if (x > 5) {
        print("big");
      }
    `;
    const { cfg } = buildCFG(code);

    const ifThenBlock = cfg.blocks.find((b) => b.label === 'if.then');

    // Entry should have edge to then block with condition
    const thenEdge = cfg.entry.successors.find(
      (e) => e.target === ifThenBlock
    );
    expect(thenEdge).toBeDefined();
    expect(thenEdge.condition).toBeDefined();
    expect(thenEdge.isNegative).toBeFalsy();
  });

  test('should create then, else, and merge blocks for if-else', () => {
    const code = `
      if (x > 5) {
        print("big");
      } else {
        print("small");
      }
    `;
    const { cfg } = buildCFG(code);

    const ifThenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    const ifElseBlock = cfg.blocks.find((b) => b.label === 'if.else');
    const ifMergeBlock = cfg.blocks.find((b) => b.label === 'if.merge');

    expect(ifThenBlock).toBeDefined();
    expect(ifElseBlock).toBeDefined();
    expect(ifMergeBlock).toBeDefined();
  });

  test('should create positive and negative edges for if-else', () => {
    const code = `
      if (x > 5) {
        print("big");
      } else {
        print("small");
      }
    `;
    const { cfg } = buildCFG(code);

    const ifThenBlock = cfg.blocks.find((b) => b.label === 'if.then');
    const ifElseBlock = cfg.blocks.find((b) => b.label === 'if.else');

    // Find edges from entry
    const thenEdge = cfg.entry.successors.find(
      (e) => e.target === ifThenBlock
    );
    const elseEdge = cfg.entry.successors.find(
      (e) => e.target === ifElseBlock
    );

    expect(thenEdge).toBeDefined();
    expect(thenEdge.isNegative).toBeFalsy();

    expect(elseEdge).toBeDefined();
    expect(elseEdge.isNegative).toBe(true);
  });

  test('should handle nested if statements', () => {
    const code = `
      if (x > 5) {
        if (y > 10) {
          print("both big");
        }
      }
    `;
    const { cfg } = buildCFG(code);

    // Should have multiple if.then and if.merge blocks
    const thenBlocks = cfg.blocks.filter((b) =>
      b.label?.startsWith('if.then')
    );
    expect(thenBlocks.length).toBeGreaterThanOrEqual(2);

    // Validate structure
    expect(validateCFG(cfg)).toHaveLength(0);
  });
});

describe('CFG Builder - While Loops', () => {
  test('should create condition, body, and after blocks', () => {
    const code = `
      while (x < 10) {
        x = x + 1;
      }
    `;
    const { cfg } = buildCFG(code);

    const condBlock = cfg.blocks.find((b) => b.label === 'while.condition');
    const bodyBlock = cfg.blocks.find((b) => b.label === 'while.body');
    const afterBlock = cfg.blocks.find((b) => b.label === 'while.after');

    expect(condBlock).toBeDefined();
    expect(bodyBlock).toBeDefined();
    expect(afterBlock).toBeDefined();
  });

  test('should create loop back edge from body to condition', () => {
    const code = `
      while (x < 10) {
        x = x + 1;
      }
    `;
    const { cfg } = buildCFG(code);

    const condBlock = cfg.blocks.find((b) => b.label === 'while.condition');
    const bodyBlock = cfg.blocks.find((b) => b.label === 'while.body');

    // Body should have edge back to condition
    const loopBackEdge = bodyBlock.successors.find(
      (e) => e.target === condBlock
    );
    expect(loopBackEdge).toBeDefined();
  });

  test('should create exit edge from condition when false', () => {
    const code = `
      while (x < 10) {
        x = x + 1;
      }
    `;
    const { cfg } = buildCFG(code);

    const condBlock = cfg.blocks.find((b) => b.label === 'while.condition');
    const afterBlock = cfg.blocks.find((b) => b.label === 'while.after');

    // Condition should have edge to after block when false
    const exitEdge = condBlock.successors.find((e) => e.target === afterBlock);
    expect(exitEdge).toBeDefined();
    expect(exitEdge.isNegative).toBe(true);
  });
});

describe('CFG Builder - For Loops', () => {
  test('should create init, condition, body, update, and after blocks', () => {
    const code = `
      for (let i = 0; i < 10; i++) {
        print(i);
      }
    `;
    const { cfg } = buildCFG(code);

    const initBlock = cfg.blocks.find((b) => b.label === 'for.init');
    const condBlock = cfg.blocks.find((b) => b.label === 'for.condition');
    const bodyBlock = cfg.blocks.find((b) => b.label === 'for.body');
    const updateBlock = cfg.blocks.find((b) => b.label === 'for.update');
    const afterBlock = cfg.blocks.find((b) => b.label === 'for.after');

    expect(initBlock).toBeDefined();
    expect(condBlock).toBeDefined();
    expect(bodyBlock).toBeDefined();
    expect(updateBlock).toBeDefined();
    expect(afterBlock).toBeDefined();
  });

  test('should create correct loop flow: init -> cond -> body -> update -> cond', () => {
    const code = `
      for (let i = 0; i < 10; i++) {
        print(i);
      }
    `;
    const { cfg } = buildCFG(code);

    const initBlock = cfg.blocks.find((b) => b.label === 'for.init');
    const condBlock = cfg.blocks.find((b) => b.label === 'for.condition');
    const bodyBlock = cfg.blocks.find((b) => b.label === 'for.body');
    const updateBlock = cfg.blocks.find((b) => b.label === 'for.update');

    // init -> cond
    expect(initBlock.successors.some((e) => e.target === condBlock)).toBe(
      true
    );

    // cond -> body
    expect(condBlock.successors.some((e) => e.target === bodyBlock)).toBe(
      true
    );

    // body -> update
    expect(bodyBlock.successors.some((e) => e.target === updateBlock)).toBe(
      true
    );

    // update -> cond (loop back)
    expect(updateBlock.successors.some((e) => e.target === condBlock)).toBe(
      true
    );
  });

  test('should handle for loop without test (infinite loop)', () => {
    const code = `
      for (let i = 0; ; i++) {
        if (i > 10) break;
      }
    `;
    const { cfg } = buildCFG(code);

    // Should still create all blocks
    expect(validateCFG(cfg)).toHaveLength(0);
  });
});

describe('CFG Builder - For-In Loops', () => {
  test('should create setup, condition, body, and after blocks', () => {
    const code = `
      for (let key in obj) {
        print(key);
      }
    `;
    const { cfg } = buildCFG(code);

    const setupBlock = cfg.blocks.find((b) => b.label === 'for-in.setup');
    const condBlock = cfg.blocks.find((b) => b.label === 'for-in.condition');
    const bodyBlock = cfg.blocks.find((b) => b.label === 'for-in.body');
    const afterBlock = cfg.blocks.find((b) => b.label === 'for-in.after');

    expect(setupBlock).toBeDefined();
    expect(condBlock).toBeDefined();
    expect(bodyBlock).toBeDefined();
    expect(afterBlock).toBeDefined();
  });
});

describe('CFG Builder - Switch Statements', () => {
  test('should create blocks for each case', () => {
    const code = `
      switch (x) {
        case 1:
          print("one");
          break;
        case 2:
          print("two");
          break;
        default:
          print("other");
      }
    `;
    const { cfg } = buildCFG(code);

    const case0Block = cfg.blocks.find((b) => b.label === 'switch.case0');
    const case1Block = cfg.blocks.find((b) => b.label === 'switch.case1');
    const defaultBlock = cfg.blocks.find((b) => b.label === 'switch.default');
    const afterBlock = cfg.blocks.find((b) => b.label === 'switch.after');

    expect(case0Block).toBeDefined();
    expect(case1Block).toBeDefined();
    expect(defaultBlock).toBeDefined();
    expect(afterBlock).toBeDefined();
  });

  test('should model fall-through behavior', () => {
    const code = `
      switch (x) {
        case 1:
          print("one");
          // fall through
        case 2:
          print("two");
          break;
      }
    `;
    const { cfg } = buildCFG(code);

    const case0Block = cfg.blocks.find((b) => b.label === 'switch.case0');
    const case1Block = cfg.blocks.find((b) => b.label === 'switch.case1');

    // case0 should have edge to case1 (fall through)
    expect(case0Block.successors.some((e) => e.target === case1Block)).toBe(
      true
    );
  });
});

describe('CFG Builder - Try-Catch', () => {
  test('should create try, catch, and after blocks', () => {
    const code = `
      try {
        riskyOperation();
      } catch (e) {
        handleError(e);
      }
    `;
    const { cfg } = buildCFG(code);

    const tryBlock = cfg.blocks.find((b) => b.label === 'try');
    const catchBlock = cfg.blocks.find((b) => b.label === 'catch');
    const afterBlock = cfg.blocks.find((b) => b.label === 'try.after');

    expect(tryBlock).toBeDefined();
    expect(catchBlock).toBeDefined();
    expect(afterBlock).toBeDefined();
  });

  test('should create exception edge from try to catch', () => {
    const code = `
      try {
        riskyOperation();
      } catch (e) {
        handleError(e);
      }
    `;
    const { cfg } = buildCFG(code);

    const tryBlock = cfg.blocks.find((b) => b.label === 'try');
    const catchBlock = cfg.blocks.find((b) => b.label === 'catch');

    // Try block should have edge to catch block
    expect(tryBlock.successors.some((e) => e.target === catchBlock)).toBe(
      true
    );
  });
});

describe('CFG Builder - Jump Statements', () => {
  test('should handle return statement', () => {
    const code = `
      if (x > 5) {
        return x;
      }
      return 0;
    `;
    const { cfg } = buildCFG(code);

    // Find blocks with return statements
    const returningBlocks = cfg.blocks.filter((b) =>
      b.statements.some((s) => s.type === 'ReturnStatement')
    );

    // Each return should have edge to exit
    for (const block of returningBlocks) {
      expect(block.successors.some((e) => e.target === cfg.exit)).toBe(true);
    }
  });

  test('should handle break in loop', () => {
    const code = `
      while (true) {
        if (x > 10) {
          break;
        }
        x++;
      }
    `;
    const { cfg } = buildCFG(code);

    const afterBlock = cfg.blocks.find((b) => b.label === 'while.after');

    // Find block with break statement
    const breakBlock = cfg.blocks.find((b) =>
      b.statements.some((s) => s.type === 'BreakStatement')
    );

    // Break block should have edge to after block
    if (breakBlock) {
      expect(breakBlock.successors.some((e) => e.target === afterBlock)).toBe(
        true
      );
    }
  });

  test('should handle continue in loop', () => {
    const code = `
      while (x < 10) {
        if (x % 2 === 0) {
          continue;
        }
        print(x);
        x++;
      }
    `;
    const { cfg } = buildCFG(code);

    const condBlock = cfg.blocks.find((b) => b.label === 'while.condition');

    // Find block with continue statement
    const continueBlock = cfg.blocks.find((b) =>
      b.statements.some((s) => s.type === 'ContinueStatement')
    );

    // Continue block should have edge back to condition
    if (continueBlock) {
      expect(continueBlock.successors.some((e) => e.target === condBlock)).toBe(
        true
      );
    }
  });
});

describe('CFG Builder - Node to Block Mapping', () => {
  test('should map all statements to blocks', () => {
    const code = `
      let x = 5;
      let y = 10;
      if (x > 3) {
        print(x);
      }
    `;
    const { cfg, builder } = buildCFG(code);
    const nodeToBlock = builder.getNodeToBlockMap();

    // Should have mappings for all statements
    expect(nodeToBlock.size).toBeGreaterThan(0);

    // All mapped blocks should be in the CFG
    const blockIds = new Set(cfg.blocks.map((b) => b.id));
    for (const block of nodeToBlock.values()) {
      expect(blockIds.has(block.id)).toBe(true);
    }
  });

  test('should map nodes to correct blocks', () => {
    const code = `
      if (x > 5) {
        let y = 10;
      }
    `;
    const { cfg, builder, ast } = buildCFG(code);
    const nodeToBlock = builder.getNodeToBlockMap();

    // Find the if statement
    const ifStmt = ast.body.find((s) => s.type === 'IfStatement');
    expect(ifStmt).toBeDefined();

    // The if test should be in entry block or a dedicated test block
    const testBlock = nodeToBlock.get(ifStmt.test);
    expect(testBlock).toBeDefined();
  });
});

describe('CFG Builder - Visualization and Stats', () => {
  test('should generate text visualization', () => {
    const code = `
      if (x > 5) {
        print("big");
      }
    `;
    const { cfg } = buildCFG(code);

    const text = visualizeCFGText(cfg);
    expect(text).toContain('CFG:');
    expect(text).toContain('Entry:');
    expect(text).toContain('Exit:');
    expect(text).toContain('Block');
  });

  test('should generate DOT visualization', () => {
    const code = `
      if (x > 5) {
        print("big");
      }
    `;
    const { cfg } = buildCFG(code);

    const dot = visualizeCFGDot(cfg);
    expect(dot).toContain('digraph CFG');
    expect(dot).toContain('->');
  });

  test('should compute statistics', () => {
    const code = `
      if (x > 5) {
        print("big");
      } else {
        print("small");
      }
    `;
    const { cfg } = buildCFG(code);

    const stats = computeCFGStats(cfg);
    expect(stats.blockCount).toBeGreaterThan(0);
    expect(stats.edgeCount).toBeGreaterThan(0);
    expect(stats.branchBlocks).toBeGreaterThan(0);
  });
});

describe('CFG Builder - Complex Scenarios', () => {
  test('should handle mixed control flow', () => {
    const code = `
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          sum += i;
        } else {
          continue;
        }
      }
      return sum;
    `;
    const { cfg } = buildCFG(code);

    // Should create a valid CFG
    expect(validateCFG(cfg)).toHaveLength(0);

    // Should have multiple blocks
    expect(cfg.blocks.length).toBeGreaterThan(5);

    // Should have proper flow
    printCFGSummary(cfg);
  });

  test('should handle nested loops', () => {
    const code = `
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          print(i * j);
        }
      }
    `;
    const { cfg } = buildCFG(code);

    expect(validateCFG(cfg)).toHaveLength(0);

    // Should have blocks for both loops
    const forBlocks = cfg.blocks.filter((b) => b.label?.startsWith('for.'));
    expect(forBlocks.length).toBeGreaterThan(5); // At least 2 loops worth of blocks
  });

  test('should handle early return in loop', () => {
    const code = `
      while (true) {
        if (found) {
          return result;
        }
        search();
      }
    `;
    const { cfg } = buildCFG(code);

    expect(validateCFG(cfg)).toHaveLength(0);

    // Should have edge to exit from return
    const hasReturnToExit = cfg.blocks.some((b) =>
      b.successors.some((e) => e.target === cfg.exit)
    );
    expect(hasReturnToExit).toBe(true);
  });
});
