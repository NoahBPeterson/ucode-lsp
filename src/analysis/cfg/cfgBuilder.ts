/**
 * CFGBuilder - Constructs a Control Flow Graph from an AST
 *
 * This class traverses the AST and builds a CFG representing the control flow
 * through the program. It creates BasicBlocks for sequences of straight-line code
 * and Edges for control flow transfers (branches, loops, etc.).
 */

import {
  AstNode,
  ProgramNode,
  IfStatementNode,
  WhileStatementNode,
  ForStatementNode,
  ForInStatementNode,
  SwitchStatementNode,
  TryStatementNode,
  ReturnStatementNode,
  BreakStatementNode,
  ContinueStatementNode,
  ThrowStatementNode,
  BlockStatementNode,
  ConditionalExpressionNode,
  LogicalExpressionNode,
  ExpressionStatementNode,
  CallExpressionNode,
} from '../../ast/nodes';
import { ControlFlowGraph, BasicBlock, Edge } from './types';
import { TypeState } from './typeState';

/**
 * Context for tracking loop and switch statements during CFG construction.
 * This is needed to correctly handle break and continue statements.
 */
interface LoopContext {
  /** The block to jump to on 'continue' */
  continueTarget: BasicBlock;
  /** The block to jump to on 'break' */
  breakTarget: BasicBlock;
  /** The type of loop (for debugging) */
  type: 'while' | 'for' | 'for-in' | 'switch';
}

/**
 * CFGBuilder constructs a Control Flow Graph from an Abstract Syntax Tree.
 *
 * Key design decisions:
 * 1. Each BasicBlock contains a sequence of statements that execute sequentially
 * 2. Control flow statements (if, while, for, etc.) create new blocks and edges
 * 3. We maintain a mapping from AST nodes to blocks for position-based queries
 * 4. We track loop/switch contexts to handle break/continue correctly
 */
export class CFGBuilder {
  /** The CFG being constructed */
  private cfg: ControlFlowGraph;

  /** The current block we're adding statements to */
  private currentBlock: BasicBlock;

  /** Counter for generating unique block IDs */
  private nextBlockId = 0;

  /** Map from AST node to the block containing it */
  private nodeToBlock: Map<AstNode, BasicBlock> = new Map();

  /** Stack of loop/switch contexts for handling break/continue */
  private loopStack: LoopContext[] = [];

  /**
   * Creates a new CFGBuilder.
   * @param name Optional name for the CFG (e.g., function name)
   */
  constructor(name?: string) {
    // Initialize empty CFG first
    this.cfg = {
      entry: undefined as any, // Will be set below
      exit: undefined as any, // Will be set below
      blocks: [],
      ...(name && { name }),
    };

    // Now create entry and exit blocks
    this.cfg.entry = this.createBlock('entry');
    this.cfg.exit = this.createBlock('exit');
    this.currentBlock = this.cfg.entry;
  }

  /**
   * Builds a CFG from the given AST.
   * @param ast The root AST node (usually a ProgramNode or FunctionNode)
   * @returns The constructed CFG
   */
  build(ast: AstNode): ControlFlowGraph {
    this.visitNode(ast);

    // Connect the last block to the exit if not already connected
    if (this.currentBlock !== this.cfg.exit) {
      this.connect(this.currentBlock, this.cfg.exit);
    }

    return this.cfg;
  }

  /**
   * Returns the mapping from AST nodes to blocks.
   * This is used by the query engine to find types at specific positions.
   */
  getNodeToBlockMap(): Map<AstNode, BasicBlock> {
    return this.nodeToBlock;
  }

  /**
   * Creates a new BasicBlock with a unique ID.
   * @param label Optional label for debugging
   */
  private createBlock(label?: string): BasicBlock {
    const block: BasicBlock = {
      id: this.nextBlockId++,
      statements: [],
      predecessors: [],
      successors: [],
      typeStateIn: new TypeState(),
      typeStateOut: new TypeState(),
      ...(label && { label }),
    };
    this.cfg.blocks.push(block);
    return block;
  }

  /**
   * Connects two blocks with an edge.
   * @param from Source block
   * @param to Target block
   * @param condition Optional condition for conditional edges
   * @param isNegative Whether the condition is negated (for else branches)
   */
  private connect(
    from: BasicBlock,
    to: BasicBlock,
    condition?: AstNode,
    isNegative = false
  ): Edge {
    const edge: Edge = {
      target: to,
      ...(condition && { condition }),
      ...(isNegative && { isNegative }),
    };
    from.successors.push(edge);
    to.predecessors.push(from);
    return edge;
  }

  /**
   * Adds a statement to the current block and records the node→block mapping.
   * @param node The AST node to add
   */
  private addStatement(node: AstNode): void {
    this.currentBlock.statements.push(node);
    this.nodeToBlock.set(node, this.currentBlock);
  }

  /**
   * Main dispatcher for visiting AST nodes.
   * Control flow statements get special handling, others are added to current block.
   */
  private visitNode(node: AstNode): void {
    switch (node.type) {
      case 'Program':
        this.visitProgram(node as ProgramNode);
        break;

      // Control flow statements
      case 'IfStatement':
        this.visitIfStatement(node as IfStatementNode);
        break;
      case 'WhileStatement':
        this.visitWhileStatement(node as WhileStatementNode);
        break;
      case 'ForStatement':
        this.visitForStatement(node as ForStatementNode);
        break;
      case 'ForInStatement':
        this.visitForInStatement(node as ForInStatementNode);
        break;
      case 'SwitchStatement':
        this.visitSwitchStatement(node as SwitchStatementNode);
        break;
      case 'TryStatement':
        this.visitTryStatement(node as TryStatementNode);
        break;

      // Jump statements
      case 'ReturnStatement':
        this.visitReturnStatement(node as ReturnStatementNode);
        break;
      case 'BreakStatement':
        this.visitBreakStatement(node as BreakStatementNode);
        break;
      case 'ContinueStatement':
        this.visitContinueStatement(node as ContinueStatementNode);
        break;
      case 'ThrowStatement':
        this.visitThrowStatement(node as ThrowStatementNode);
        break;

      // Block statement
      case 'BlockStatement':
        this.visitBlockStatement(node as BlockStatementNode);
        break;

      // Function declarations create new CFGs (not handled here)
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        // For now, just add as a statement. In the future, we might build
        // separate CFGs for each function.
        this.addStatement(node);
        break;

      // Expressions with control flow implications
      case 'ConditionalExpression':
        this.visitConditionalExpression(node as ConditionalExpressionNode);
        break;
      case 'LogicalExpression':
        this.visitLogicalExpression(node as LogicalExpressionNode);
        break;

      // Expression statements: check for die()/exit() calls
      case 'ExpressionStatement': {
        const exprStmt = node as ExpressionStatementNode;
        this.addStatement(node);
        if (exprStmt.expression.type === 'CallExpression') {
          const call = exprStmt.expression as CallExpressionNode;
          if (
            call.callee.type === 'Identifier' &&
            ((call.callee as any).name === 'die' || (call.callee as any).name === 'exit')
          ) {
            this.connect(this.currentBlock, this.cfg.exit);
            this.currentBlock = this.createBlock('after.die');
          }
        }
        break;
      }

      // All other statements and expressions
      default:
        this.addStatement(node);
        break;
    }
  }

  // ========== VISITOR METHODS ==========

  private visitProgram(node: ProgramNode): void {
    for (const statement of node.body) {
      this.visitNode(statement);
    }
  }

  private visitBlockStatement(node: BlockStatementNode): void {
    // Blocks don't create new CFG blocks, they just contain statements
    for (const statement of node.body) {
      this.visitNode(statement);
    }
  }

  /**
   * If statement: if (test) consequent else alternate
   *
   * CFG structure:
   *   [current]
   *       |
   *    [test]
   *     /   \
   *  [then] [else]
   *     \   /
   *    [merge]
   */
  private visitIfStatement(node: IfStatementNode): void {
    // Add the test to the current block
    this.addStatement(node.test);

    const thenBlock = this.createBlock('if.then');
    const elseBlock = node.alternate ? this.createBlock('if.else') : null;
    const mergeBlock = this.createBlock('if.merge');

    // Edge for the 'then' branch (condition is true)
    this.connect(this.currentBlock, thenBlock, node.test, false);

    // Edge for the 'else' branch (condition is false)
    if (elseBlock) {
      this.connect(this.currentBlock, elseBlock, node.test, true);
    } else {
      // No else block, false condition jumps directly to merge
      this.connect(this.currentBlock, mergeBlock, node.test, true);
    }

    // Visit the 'then' branch
    this.currentBlock = thenBlock;
    this.visitNode(node.consequent);
    // Only connect to merge if current block hasn't already jumped (e.g., via return)
    if (this.currentBlock.successors.length === 0) {
      this.connect(this.currentBlock, mergeBlock);
    }

    // Visit the 'else' branch if it exists
    if (elseBlock && node.alternate) {
      this.currentBlock = elseBlock;
      this.visitNode(node.alternate);
      if (this.currentBlock.successors.length === 0) {
        this.connect(this.currentBlock, mergeBlock);
      }
    }

    this.currentBlock = mergeBlock;
  }

  /**
   * While loop: while (test) body
   *
   * CFG structure:
   *   [current]
   *       |
   *   [condition] <--+
   *     /    \       |
   *  [body]  [after] |
   *     |            |
   *     +------------+
   */
  private visitWhileStatement(node: WhileStatementNode): void {
    const conditionBlock = this.createBlock('while.condition');
    const bodyBlock = this.createBlock('while.body');
    const afterLoopBlock = this.createBlock('while.after');

    // Jump from current block to condition
    this.connect(this.currentBlock, conditionBlock);
    this.currentBlock = conditionBlock;

    // Add test to condition block
    this.addStatement(node.test);

    // Edges from condition
    this.connect(conditionBlock, bodyBlock, node.test, false); // Loop continues
    this.connect(conditionBlock, afterLoopBlock, node.test, true); // Loop exits

    // Push loop context for break/continue
    this.loopStack.push({
      continueTarget: conditionBlock,
      breakTarget: afterLoopBlock,
      type: 'while',
    });

    // Visit loop body
    this.currentBlock = bodyBlock;
    this.visitNode(node.body);

    // End of body loops back to condition (unless there's a jump)
    if (this.currentBlock.successors.length === 0) {
      this.connect(this.currentBlock, conditionBlock);
    }

    // Pop loop context
    this.loopStack.pop();

    this.currentBlock = afterLoopBlock;
  }

  /**
   * For loop: for (init; test; update) body
   *
   * CFG structure:
   *   [current]
   *       |
   *    [init]
   *       |
   *   [condition] <--+
   *     /    \       |
   *  [body]  [after] |
   *     |            |
   *  [update]        |
   *     |            |
   *     +------------+
   */
  private visitForStatement(node: ForStatementNode): void {
    const initBlock = this.createBlock('for.init');
    const conditionBlock = this.createBlock('for.condition');
    const bodyBlock = this.createBlock('for.body');
    const updateBlock = this.createBlock('for.update');
    const afterLoopBlock = this.createBlock('for.after');

    // Init
    this.connect(this.currentBlock, initBlock);
    this.currentBlock = initBlock;
    if (node.init) {
      this.addStatement(node.init);
    }

    // Condition
    this.connect(this.currentBlock, conditionBlock);
    this.currentBlock = conditionBlock;
    if (node.test) {
      this.addStatement(node.test);
      this.connect(conditionBlock, bodyBlock, node.test, false);
      this.connect(conditionBlock, afterLoopBlock, node.test, true);
    } else {
      // No test means infinite loop (or until break)
      this.connect(conditionBlock, bodyBlock);
    }

    // Push loop context
    this.loopStack.push({
      continueTarget: updateBlock,
      breakTarget: afterLoopBlock,
      type: 'for',
    });

    // Body
    this.currentBlock = bodyBlock;
    this.visitNode(node.body);
    if (this.currentBlock.successors.length === 0) {
      this.connect(this.currentBlock, updateBlock);
    }

    // Update
    this.currentBlock = updateBlock;
    if (node.update) {
      this.addStatement(node.update);
    }
    this.connect(this.currentBlock, conditionBlock);

    // Pop loop context
    this.loopStack.pop();

    this.currentBlock = afterLoopBlock;
  }

  /**
   * For-in loop: for (left in right) body
   *
   * CFG structure:
   *   [current]
   *       |
   *   [setup]
   *       |
   *   [condition] <--+
   *     /    \       |
   *  [body]  [after] |
   *     |            |
   *     +------------+
   */
  private visitForInStatement(node: ForInStatementNode): void {
    const setupBlock = this.createBlock('for-in.setup');
    const conditionBlock = this.createBlock('for-in.condition');
    const bodyBlock = this.createBlock('for-in.body');
    const afterLoopBlock = this.createBlock('for-in.after');

    // Setup
    this.connect(this.currentBlock, setupBlock);
    this.currentBlock = setupBlock;
    this.addStatement(node.left);
    this.addStatement(node.right);

    // Condition (implicit - iterator has next element)
    this.connect(this.currentBlock, conditionBlock);
    this.currentBlock = conditionBlock;
    this.connect(conditionBlock, bodyBlock);
    this.connect(conditionBlock, afterLoopBlock);

    // Push loop context
    this.loopStack.push({
      continueTarget: conditionBlock,
      breakTarget: afterLoopBlock,
      type: 'for-in',
    });

    // Body
    this.currentBlock = bodyBlock;
    this.visitNode(node.body);
    if (this.currentBlock.successors.length === 0) {
      this.connect(this.currentBlock, conditionBlock);
    }

    // Pop loop context
    this.loopStack.pop();

    this.currentBlock = afterLoopBlock;
  }

  /**
   * Switch statement: switch (discriminant) { cases }
   *
   * CFG structure:
   *   [current]
   *       |
   *  [discriminant]
   *     /  |  \  \
   *  [case1][case2]...[default]
   *     |    |         |
   *     +----+----+----+
   *              |
   *          [after]
   */
  private visitSwitchStatement(node: SwitchStatementNode): void {
    // Add discriminant to current block
    this.addStatement(node.discriminant);
    const discriminantBlock = this.currentBlock;

    const afterSwitchBlock = this.createBlock('switch.after');
    const caseBlocks: BasicBlock[] = [];

    // Create blocks for each case
    for (let i = 0; i < node.cases.length; i++) {
      const caseNode = node.cases[i]!;
      const label = caseNode.test ? `switch.case${i}` : 'switch.default';
      const caseBlock = this.createBlock(label);
      caseBlocks.push(caseBlock);

      // Connect discriminant to case (conditional edge based on test)
      if (caseNode.test) {
        this.connect(discriminantBlock, caseBlock, caseNode.test, false);
      } else {
        // Default case (unconditional)
        this.connect(discriminantBlock, caseBlock);
      }
    }

    // If no default case, connect discriminant to after block
    const hasDefault = node.cases.some((c) => c.test === null);
    if (!hasDefault) {
      this.connect(discriminantBlock, afterSwitchBlock);
    }

    // Push switch context for break
    this.loopStack.push({
      continueTarget: afterSwitchBlock, // continue not valid in switch, but we need a target
      breakTarget: afterSwitchBlock,
      type: 'switch',
    });

    // Visit each case
    for (let i = 0; i < node.cases.length; i++) {
      const caseNode = node.cases[i]!;
      const caseBlock = caseBlocks[i]!;

      this.currentBlock = caseBlock;

      // Add case test to the block (for debugging)
      if (caseNode.test) {
        this.addStatement(caseNode.test);
      }

      // Visit case statements
      for (const statement of caseNode.consequent) {
        this.visitNode(statement);
      }

      // If no explicit break, fall through to next case
      if (
        this.currentBlock.successors.length === 0 &&
        i < node.cases.length - 1
      ) {
        this.connect(this.currentBlock, caseBlocks[i + 1]!);
      } else if (
        this.currentBlock.successors.length === 0 &&
        i === node.cases.length - 1
      ) {
        // Last case falls through to after block
        this.connect(this.currentBlock, afterSwitchBlock);
      }
    }

    // Pop switch context
    this.loopStack.pop();

    this.currentBlock = afterSwitchBlock;
  }

  /**
   * Try-catch: try { block } catch (param) { handler }
   *
   * CFG structure:
   *   [current]
   *       |
   *   [try block] --exception--> [catch block]
   *       |                           |
   *       +----------+----------------+
   *                  |
   *              [after]
   */
  private visitTryStatement(node: TryStatementNode): void {
    const tryBlock = this.createBlock('try');
    const catchBlock = node.handler ? this.createBlock('catch') : null;
    const afterTryBlock = this.createBlock('try.after');

    // Jump to try block
    this.connect(this.currentBlock, tryBlock);
    this.currentBlock = tryBlock;

    // Visit try block
    this.visitNode(node.block);

    // Normal exit from try
    if (this.currentBlock.successors.length === 0) {
      this.connect(this.currentBlock, afterTryBlock);
    }

    // Exception edge from try to catch (if catch exists)
    if (catchBlock && node.handler) {
      this.connect(tryBlock, catchBlock);

      this.currentBlock = catchBlock;
      if (node.handler.param) {
        this.addStatement(node.handler.param);
      }
      this.visitNode(node.handler.body);

      if (this.currentBlock.successors.length === 0) {
        this.connect(this.currentBlock, afterTryBlock);
      }
    }

    this.currentBlock = afterTryBlock;
  }

  /**
   * Return statement: return argument;
   * Jumps to the exit block.
   */
  private visitReturnStatement(node: ReturnStatementNode): void {
    if (node.argument) {
      this.addStatement(node.argument);
    }
    this.addStatement(node);
    this.connect(this.currentBlock, this.cfg.exit);
    // Create a new block for any unreachable code after return
    this.currentBlock = this.createBlock('after.return');
  }

  /**
   * Break statement: break;
   * Jumps to the break target of the current loop/switch.
   */
  private visitBreakStatement(node: BreakStatementNode): void {
    this.addStatement(node);
    const loopContext = this.loopStack[this.loopStack.length - 1];
    if (loopContext) {
      this.connect(this.currentBlock, loopContext.breakTarget);
    } else {
      // Break outside loop/switch (semantic error, but we handle it gracefully)
      // Just add to current block without creating an edge
    }
    // Create a new block for any unreachable code after break
    this.currentBlock = this.createBlock('after.break');
  }

  /**
   * Continue statement: continue;
   * Jumps to the continue target of the current loop.
   */
  private visitContinueStatement(node: ContinueStatementNode): void {
    this.addStatement(node);
    const loopContext = this.loopStack[this.loopStack.length - 1];
    if (loopContext) {
      this.connect(this.currentBlock, loopContext.continueTarget);
    } else {
      // Continue outside loop (semantic error, but we handle it gracefully)
    }
    // Create a new block for any unreachable code after continue
    this.currentBlock = this.createBlock('after.continue');
  }

  /**
   * Throw statement: throw argument;
   * For now, treat as jumping to exit. In the future, we could model
   * exception flow more precisely.
   */
  private visitThrowStatement(node: ThrowStatementNode): void {
    this.addStatement(node.argument);
    this.addStatement(node);
    // For now, throw jumps to exit (simplified model)
    this.connect(this.currentBlock, this.cfg.exit);
    this.currentBlock = this.createBlock('after.throw');
  }

  /**
   * Conditional expression: test ? consequent : alternate
   *
   * This is tricky because it's an expression, not a statement.
   * For now, we treat it as a single statement and don't split blocks.
   * In a more sophisticated implementation, we could split blocks here.
   */
  private visitConditionalExpression(node: ConditionalExpressionNode): void {
    // Simplified: treat as a single statement
    this.addStatement(node);
  }

  /**
   * Logical expression: left && right, left || right
   *
   * These have short-circuit evaluation, so they affect control flow.
   * For now, we treat them as single statements.
   * In a more sophisticated implementation, we could split blocks.
   */
  private visitLogicalExpression(node: LogicalExpressionNode): void {
    // Simplified: treat as a single statement
    this.addStatement(node);
  }
}
