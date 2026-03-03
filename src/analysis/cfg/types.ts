/**
 * Control Flow Graph (CFG) type definitions
 *
 * A CFG represents the flow of control through a program.
 * It consists of BasicBlocks (sequences of straight-line code) connected by Edges.
 */

import { AstNode } from '../../ast/nodes';
import { TypeState } from './typeState';

/**
 * A BasicBlock represents a maximal sequence of statements that execute sequentially
 * without any jumps or branches (except possibly at the end).
 */
export interface BasicBlock {
  /** Unique identifier for this block */
  id: number;

  /** The statements contained in this block */
  statements: AstNode[];

  /** Blocks that can jump to this block */
  predecessors: BasicBlock[];

  /** Edges to blocks that this block can jump to */
  successors: Edge[];

  /**
   * The type information for variables at the ENTRY of this block.
   * This is computed by merging the typeStateOut from all predecessors.
   */
  typeStateIn: TypeState;

  /**
   * The type information for variables at the EXIT of this block.
   * This is computed by applying the transfer function to typeStateIn.
   */
  typeStateOut: TypeState;

  /**
   * Optional label for debugging and visualization.
   * Examples: "entry", "exit", "if.then", "loop.body"
   */
  label?: string;
}

/**
 * An Edge represents a transfer of control from one block to another.
 *
 * Edges can be conditional (e.g., from an if statement) or unconditional.
 * When an edge is conditional, it stores the condition and whether it's negated.
 */
export interface Edge {
  /** The target block that control flows to */
  target: BasicBlock;

  /**
   * The condition that must be true to take this edge.
   * For example, in `if (x > 5)`, this would be the BinaryExpression node for `x > 5`.
   * Undefined for unconditional edges.
   */
  condition?: AstNode;

  /**
   * Whether the condition is negated.
   * - false (or undefined): The condition must be true to take this edge (e.g., 'then' branch)
   * - true: The condition must be false to take this edge (e.g., 'else' branch)
   */
  isNegative?: boolean;

  /**
   * The narrowed type state for this edge.
   * This is computed by applying type guards based on the condition.
   *
   * For example, if the condition is `typeof x === 'string'`:
   * - The positive edge would narrow x to 'string'
   * - The negative edge would exclude 'string' from x's type
   */
  narrowedState?: TypeState;
}

/**
 * The Control Flow Graph for a function or program.
 */
export interface ControlFlowGraph {
  /** The entry block (where execution starts) */
  entry: BasicBlock;

  /** The exit block (where all return paths converge) */
  exit: BasicBlock;

  /** All blocks in the CFG (includes entry and exit) */
  blocks: BasicBlock[];

  /**
   * Optional name for this CFG (e.g., function name or "top-level").
   * Useful for debugging and visualization.
   */
  name?: string;
}

/**
 * EdgeType categorizes different kinds of control flow edges.
 * This is useful for debugging and visualization.
 */
export enum EdgeType {
  /** Unconditional edge (e.g., sequential flow) */
  UNCONDITIONAL = 'unconditional',

  /** Condition is true (e.g., 'then' branch of if statement) */
  TRUE = 'true',

  /** Condition is false (e.g., 'else' branch of if statement) */
  FALSE = 'false',

  /** Loop back edge (e.g., end of while loop back to condition) */
  LOOP_BACK = 'loop_back',

  /** Exception edge (e.g., throw statement to catch block) */
  EXCEPTION = 'exception',
}

/**
 * Metadata for a CFG, useful for debugging and analysis.
 */
export interface CFGMetadata {
  /** Number of blocks in the CFG */
  blockCount: number;

  /** Number of edges in the CFG */
  edgeCount: number;

  /** Whether the CFG has any unreachable blocks */
  hasUnreachableBlocks: boolean;

  /** Maximum depth of nested control structures */
  maxNestingDepth: number;
}
