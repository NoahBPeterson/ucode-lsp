/**
 * CFGQueryEngine - Queries type information from a CFG
 *
 * This engine provides the interface between the CFG-based type analysis
 * and the LSP features (hover, completion, etc.).
 *
 * It answers questions like:
 * - What is the type of variable X at position Y?
 * - What variables are in scope at position Y?
 * - What is the narrowed type of X after a type guard?
 */

import { AstNode } from '../../ast/nodes';
import { UcodeDataType } from '../symbolTable';
import { ControlFlowGraph, BasicBlock } from './types';
import { TypeState } from './typeState';

/**
 * CFGQueryEngine provides position-based type queries for LSP features.
 *
 * The LSP operates on document offsets (character positions), so we need
 * to translate these offsets to CFG locations and extract type information.
 */
export class CFGQueryEngine {
  /** The CFG to query */
  private cfg: ControlFlowGraph;

  /** Map from AST nodes to the blocks containing them */
  private nodeToBlock: Map<AstNode, BasicBlock>;

  /**
   * Creates a new CFGQueryEngine.
   * @param cfg The control flow graph
   * @param nodeToBlock Mapping from AST nodes to blocks (from CFGBuilder)
   */
  constructor(cfg: ControlFlowGraph, nodeToBlock: Map<AstNode, BasicBlock>) {
    this.cfg = cfg;
    this.nodeToBlock = nodeToBlock;
  }

  /**
   * Gets the type of a variable at a specific position in the source code.
   *
   * @param varName The variable name
   * @param offset The character offset in the source
   * @returns The type of the variable at that position, or undefined if unknown
   */
  getTypeAtPosition(
    varName: string,
    offset: number
  ): UcodeDataType | undefined {
    // Find the block containing this offset
    const block = this.findBlockAtOffset(offset);
    if (!block) {
      return undefined;
    }

    // IMPORTANT: Use the pre-computed type state from the data flow analyzer!
    // The data flow analyzer has already computed typeStateIn for each block,
    // which includes type narrowing from conditional edges.
    //
    // We just need to find the right type state at the specific offset.
    // For most cases, the typeStateIn of the block is what we want, since it
    // includes narrowing from the incoming edges (like type guards).
    const result = block.typeStateIn.get(varName);

    return result;
  }

  /**
   * Gets the TypeState at a specific position in the source code.
   *
   * This is useful for debugging and for more complex queries.
   *
   * @param offset The character offset in the source
   * @returns The TypeState at that position, or undefined if not found
   */
  getTypeStateAtPosition(offset: number): TypeState | undefined {
    const block = this.findBlockAtOffset(offset);
    if (!block) {
      return undefined;
    }

    // Start with the type state at the entry of the block
    let currentState = block.typeStateIn.clone();

    // Walk through statements in the block up to the offset
    for (const statement of block.statements) {
      if (statement.start > offset) {
        break;
      }
      currentState = this.applyStatement(currentState, statement);
    }

    return currentState;
  }

  /**
   * Gets all variables in scope at a specific position.
   *
   * This is useful for completion and code navigation.
   *
   * @param offset The character offset in the source
   * @returns Array of variable names in scope
   */
  getVariablesInScope(offset: number): string[] {
    const state = this.getTypeStateAtPosition(offset);
    return state ? state.getAllKeys() : [];
  }

  /**
   * Finds the BasicBlock that contains a given source offset.
   *
   * This walks through all blocks and checks if any statement in the block
   * contains the offset.
   *
   * @param offset The character offset in the source
   * @returns The block containing this offset, or undefined
   */
  private findBlockAtOffset(offset: number): BasicBlock | undefined {
    for (const block of this.cfg.blocks) {
      for (const statement of block.statements) {
        if (statement.start <= offset && offset <= statement.end) {
          return block;
        }
      }
    }
    return undefined;
  }

  /**
   * Finds the BasicBlock that contains a given AST node.
   *
   * @param node The AST node
   * @returns The block containing this node, or undefined
   */
  findBlockForNode(node: AstNode): BasicBlock | undefined {
    return this.nodeToBlock.get(node);
  }

  /**
   * Gets the type state at the entry of a block.
   *
   * @param block The block
   * @returns The type state at the entry of the block
   */
  getTypeStateAtBlockEntry(block: BasicBlock): TypeState {
    return block.typeStateIn;
  }

  /**
   * Gets the type state at the exit of a block.
   *
   * @param block The block
   * @returns The type state at the exit of the block
   */
  getTypeStateAtBlockExit(block: BasicBlock): TypeState {
    return block.typeStateOut;
  }

  /**
   * Applies a statement to update the type state.
   *
   * This is a simplified version. In the full implementation, this logic
   * would be shared with the DataFlowAnalyzer's transfer function.
   *
   * For now, we just return the current state unchanged.
   *
   * @param state The current type state
   * @param _statement The statement to apply (unused in Phase 1)
   * @param _varName Optional variable name to track (unused in Phase 1)
   * @returns The updated type state
   */
  private applyStatement(
    state: TypeState,
    _statement: AstNode,
    _varName?: string
  ): TypeState {
    // TODO: Implement transfer function logic here
    // This will be integrated with the DataFlowAnalyzer in Phase 2

    // For now, just return the current state
    return state;
  }

  /**
   * Gets metadata about the CFG.
   */
  getCFGInfo(): {
    blockCount: number;
    edgeCount: number;
    entryBlockId: number;
    exitBlockId: number;
    name?: string;
  } {
    const edgeCount = this.cfg.blocks.reduce(
      (sum, block) => sum + block.successors.length,
      0
    );

    return {
      blockCount: this.cfg.blocks.length,
      edgeCount,
      entryBlockId: this.cfg.entry.id,
      exitBlockId: this.cfg.exit.id,
      ...(this.cfg.name && { name: this.cfg.name }),
    };
  }

  /**
   * Checks if a block is reachable from the entry block.
   *
   * This is useful for detecting dead code.
   *
   * @param block The block to check
   * @returns True if the block is reachable, false otherwise
   */
  isBlockReachable(block: BasicBlock): boolean {
    // BFS from entry block
    const visited = new Set<number>();
    const queue: BasicBlock[] = [this.cfg.entry];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current.id)) {
        continue;
      }

      visited.add(current.id);

      if (current.id === block.id) {
        return true;
      }

      for (const edge of current.successors) {
        queue.push(edge.target);
      }
    }

    return false;
  }

  /**
   * Gets all unreachable blocks in the CFG.
   *
   * This is useful for dead code detection and warnings.
   *
   * @returns Array of unreachable blocks
   */
  getUnreachableBlocks(): BasicBlock[] {
    const reachable = new Set<number>();
    const queue: BasicBlock[] = [this.cfg.entry];

    // BFS to find all reachable blocks
    while (queue.length > 0) {
      const current = queue.shift()!;

      if (reachable.has(current.id)) {
        continue;
      }

      reachable.add(current.id);

      for (const edge of current.successors) {
        queue.push(edge.target);
      }
    }

    // Return blocks that are not reachable
    return this.cfg.blocks.filter((block) => !reachable.has(block.id));
  }

  /**
   * Gets the CFG for direct access (useful for visualization and debugging).
   */
  getCFG(): ControlFlowGraph {
    return this.cfg;
  }
}
