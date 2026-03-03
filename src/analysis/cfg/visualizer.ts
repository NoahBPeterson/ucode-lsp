/**
 * CFG Visualizer - Converts CFGs to human-readable formats
 *
 * This module provides utilities for visualizing and debugging control flow graphs.
 * It can generate:
 * - Text-based representations (for console output)
 * - DOT format (for Graphviz visualization)
 * - JSON format (for programmatic inspection)
 */

import { ControlFlowGraph, BasicBlock, Edge } from './types';

/**
 * Generates a text-based representation of a CFG.
 *
 * Example output:
 * ```
 * CFG: myFunction
 * Entry: Block 0
 * Exit: Block 1
 *
 * Block 0 (entry):
 *   Statements: 2
 *   Successors: Block 2 (if true), Block 3 (if false)
 *
 * Block 2 (if.then):
 *   Statements: 1
 *   Successors: Block 4
 * ...
 * ```
 */
export function visualizeCFGText(cfg: ControlFlowGraph): string {
  const lines: string[] = [];

  lines.push(`CFG: ${cfg.name || 'unnamed'}`);
  lines.push(`Entry: Block ${cfg.entry.id}`);
  lines.push(`Exit: Block ${cfg.exit.id}`);
  lines.push(`Total Blocks: ${cfg.blocks.length}`);
  lines.push('');

  for (const block of cfg.blocks) {
    lines.push(visualizeBlockText(block));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates a text representation of a single BasicBlock.
 */
function visualizeBlockText(block: BasicBlock): string {
  const lines: string[] = [];

  // Block header
  const label = block.label ? ` (${block.label})` : '';
  lines.push(`Block ${block.id}${label}:`);

  // Statements
  lines.push(`  Statements: ${block.statements.length}`);
  if (block.statements.length > 0) {
    for (let i = 0; i < Math.min(block.statements.length, 5); i++) {
      const stmt = block.statements[i]!;
      lines.push(`    ${i + 1}. ${stmt.type} (${stmt.start}-${stmt.end})`);
    }
    if (block.statements.length > 5) {
      lines.push(`    ... (${block.statements.length - 5} more)`);
    }
  }

  // Predecessors
  if (block.predecessors.length > 0) {
    const predIds = block.predecessors.map((p) => p.id).join(', ');
    lines.push(`  Predecessors: Block(s) ${predIds}`);
  }

  // Successors
  if (block.successors.length > 0) {
    lines.push(`  Successors:`);
    for (const edge of block.successors) {
      lines.push(`    ${visualizeEdgeText(edge)}`);
    }
  } else {
    lines.push(`  Successors: none (terminal block)`);
  }

  // Type states (if populated)
  if (block.typeStateIn.size() > 0) {
    lines.push(`  Type State In: ${block.typeStateIn.toString()}`);
  }
  if (block.typeStateOut.size() > 0) {
    lines.push(`  Type State Out: ${block.typeStateOut.toString()}`);
  }

  return lines.join('\n');
}

/**
 * Generates a text representation of an Edge.
 */
function visualizeEdgeText(edge: Edge): string {
  let desc = `Block ${edge.target.id}`;

  if (edge.target.label) {
    desc += ` (${edge.target.label})`;
  }

  if (edge.condition) {
    const condType = edge.isNegative ? 'if false' : 'if true';
    desc += ` [${condType}]`;
  }

  return desc;
}

/**
 * Generates a DOT graph representation of a CFG.
 *
 * This can be visualized using Graphviz tools.
 *
 * Example usage:
 * ```typescript
 * const dot = visualizeCFGDot(cfg);
 * fs.writeFileSync('cfg.dot', dot);
 * // Then: dot -Tpng cfg.dot -o cfg.png
 * ```
 */
export function visualizeCFGDot(cfg: ControlFlowGraph): string {
  const lines: string[] = [];

  lines.push('digraph CFG {');
  lines.push('  rankdir=TB;');
  lines.push('  node [shape=box, style=rounded];');
  lines.push('');

  // Define nodes
  for (const block of cfg.blocks) {
    const label = block.label || `Block ${block.id}`;
    const stmtCount = block.statements.length;
    const nodeLabel = `${label}\\n${stmtCount} statement${stmtCount !== 1 ? 's' : ''}`;

    // Style entry and exit blocks differently
    let style = '';
    if (block.id === cfg.entry.id) {
      style = ', fillcolor=lightgreen, style=filled';
    } else if (block.id === cfg.exit.id) {
      style = ', fillcolor=lightcoral, style=filled';
    }

    lines.push(`  ${block.id} [label="${nodeLabel}"${style}];`);
  }

  lines.push('');

  // Define edges
  for (const block of cfg.blocks) {
    for (const edge of block.successors) {
      let edgeLabel = '';
      let edgeStyle = '';

      if (edge.condition) {
        edgeLabel = edge.isNegative ? 'false' : 'true';
        edgeStyle = ', style=dashed';
      }

      const label = edgeLabel ? ` [label="${edgeLabel}"${edgeStyle}]` : '';
      lines.push(`  ${block.id} -> ${edge.target.id}${label};`);
    }
  }

  lines.push('}');

  return lines.join('\n');
}

/**
 * Generates a JSON representation of a CFG.
 *
 * This is useful for programmatic inspection and testing.
 */
export function visualizeCFGJSON(cfg: ControlFlowGraph): string {
  const blocks = cfg.blocks.map((block) => ({
    id: block.id,
    label: block.label,
    statementCount: block.statements.length,
    statements: block.statements.map((s) => ({
      type: s.type,
      start: s.start,
      end: s.end,
    })),
    predecessors: block.predecessors.map((p) => p.id),
    successors: block.successors.map((edge) => ({
      target: edge.target.id,
      hasCondition: !!edge.condition,
      isNegative: edge.isNegative,
    })),
  }));

  const json = {
    name: cfg.name,
    entryId: cfg.entry.id,
    exitId: cfg.exit.id,
    blockCount: cfg.blocks.length,
    blocks,
  };

  return JSON.stringify(json, null, 2);
}

/**
 * Prints a summary of the CFG to the console.
 *
 * This is useful for quick debugging.
 */
export function printCFGSummary(cfg: ControlFlowGraph): void {
  console.log(`\n=== CFG Summary: ${cfg.name || 'unnamed'} ===`);
  console.log(`Blocks: ${cfg.blocks.length}`);
  console.log(`Entry: Block ${cfg.entry.id}`);
  console.log(`Exit: Block ${cfg.exit.id}`);

  const edgeCount = cfg.blocks.reduce(
    (sum, block) => sum + block.successors.length,
    0
  );
  console.log(`Edges: ${edgeCount}`);

  // Find unreachable blocks
  const reachable = new Set<number>();
  const queue = [cfg.entry];
  while (queue.length > 0) {
    const block = queue.shift()!;
    if (reachable.has(block.id)) continue;
    reachable.add(block.id);
    for (const edge of block.successors) {
      queue.push(edge.target);
    }
  }

  const unreachable = cfg.blocks.filter((b) => !reachable.has(b.id));
  if (unreachable.length > 0) {
    console.log(
      `Unreachable blocks: ${unreachable.map((b) => b.id).join(', ')}`
    );
  }

  console.log('===================================\n');
}

/**
 * Validates a CFG for common structural issues.
 *
 * Returns an array of validation errors (empty if valid).
 */
export function validateCFG(cfg: ControlFlowGraph): string[] {
  const errors: string[] = [];

  // Check that entry and exit are in the blocks list
  if (!cfg.blocks.includes(cfg.entry)) {
    errors.push('Entry block is not in the blocks list');
  }
  if (!cfg.blocks.includes(cfg.exit)) {
    errors.push('Exit block is not in the blocks list');
  }

  // Check that all block IDs are unique
  const ids = new Set<number>();
  for (const block of cfg.blocks) {
    if (ids.has(block.id)) {
      errors.push(`Duplicate block ID: ${block.id}`);
    }
    ids.add(block.id);
  }

  // Check that all edges reference blocks in the CFG
  const blockIds = new Set(cfg.blocks.map((b) => b.id));
  for (const block of cfg.blocks) {
    for (const edge of block.successors) {
      if (!blockIds.has(edge.target.id)) {
        errors.push(
          `Block ${block.id} has edge to non-existent block ${edge.target.id}`
        );
      }
    }
  }

  // Check that predecessor relationships are symmetric
  for (const block of cfg.blocks) {
    for (const edge of block.successors) {
      if (!edge.target.predecessors.includes(block)) {
        errors.push(
          `Block ${block.id} -> ${edge.target.id} edge lacks reverse predecessor link`
        );
      }
    }
  }

  return errors;
}

/**
 * Statistics about a CFG.
 */
export interface CFGStats {
  blockCount: number;
  edgeCount: number;
  avgSuccessorsPerBlock: number;
  maxSuccessorsPerBlock: number;
  terminalBlocks: number; // blocks with no successors
  branchBlocks: number; // blocks with 2+ successors
  unreachableBlocks: number;
}

/**
 * Computes statistics about a CFG.
 */
export function computeCFGStats(cfg: ControlFlowGraph): CFGStats {
  const blockCount = cfg.blocks.length;
  const edgeCount = cfg.blocks.reduce(
    (sum, block) => sum + block.successors.length,
    0
  );
  const avgSuccessorsPerBlock = blockCount > 0 ? edgeCount / blockCount : 0;
  const maxSuccessorsPerBlock = Math.max(
    ...cfg.blocks.map((b) => b.successors.length)
  );
  const terminalBlocks = cfg.blocks.filter(
    (b) => b.successors.length === 0
  ).length;
  const branchBlocks = cfg.blocks.filter(
    (b) => b.successors.length >= 2
  ).length;

  // Count unreachable blocks
  const reachable = new Set<number>();
  const queue = [cfg.entry];
  while (queue.length > 0) {
    const block = queue.shift()!;
    if (reachable.has(block.id)) continue;
    reachable.add(block.id);
    for (const edge of block.successors) {
      queue.push(edge.target);
    }
  }
  const unreachableBlocks = cfg.blocks.filter((b) => !reachable.has(b.id))
    .length;

  return {
    blockCount,
    edgeCount,
    avgSuccessorsPerBlock,
    maxSuccessorsPerBlock,
    terminalBlocks,
    branchBlocks,
    unreachableBlocks,
  };
}
