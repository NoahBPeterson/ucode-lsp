/**
 * CFGQueryEngine - reachability queries over a control flow graph.
 *
 * This engine once also answered flow-sensitive "type of variable X at offset Y"
 * queries for hover/completion. That path was never scope-aware (it read a
 * block's type state purely by name and so returned a global's type at a local
 * position) and was fully shadowed by the scope-aware symbol table, which is
 * consulted first everywhere. It contributed no correct information the symbol
 * table didn't already have, so it was removed. What remains is CFG reachability,
 * used to emit unreachable-code diagnostics.
 */

import { ControlFlowGraph, BasicBlock } from './types';

export class CFGQueryEngine {
  /** The CFG to query */
  private cfg: ControlFlowGraph;

  /**
   * Creates a new CFGQueryEngine.
   * @param cfg The control flow graph
   */
  constructor(cfg: ControlFlowGraph) {
    this.cfg = cfg;
  }

  /**
   * Gets all unreachable blocks in the CFG.
   *
   * Used for dead code detection and warnings.
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
}
