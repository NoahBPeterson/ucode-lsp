/**
 * DataFlowAnalyzer - Performs data flow analysis on a CFG
 *
 * This analyzer uses a worklist algorithm to propagate type information
 * through the control flow graph until a fixed point is reached.
 *
 * It integrates with the existing TypeChecker and TypeNarrowing logic
 * to provide flow-sensitive type analysis.
 */

import {
  AstNode,
  IdentifierNode,
  VariableDeclarationNode,
  VariableDeclaratorNode,
  AssignmentExpressionNode,
  BinaryExpressionNode,
  CallExpressionNode,
  LiteralNode,
  UnaryExpressionNode,
} from '../../ast/nodes';
import { ControlFlowGraph, BasicBlock } from './types';
import { TypeState } from './typeState';
import {
  SymbolTable,
  UcodeType,
  UcodeDataType,
  getUnionTypes,
} from '../symbolTable';

/**
 * Configuration for data flow analysis
 */
export interface DataFlowConfig {
  /** Maximum iterations before giving up (prevents infinite loops) */
  maxIterations?: number;

  /** Whether to enable debug logging */
  debug?: boolean;
}

/**
 * Result of data flow analysis
 */
export interface DataFlowResult {
  /** Whether the analysis reached a fixed point */
  converged: boolean;

  /** Number of iterations taken */
  iterations: number;

  /** The analyzed CFG with populated type states */
  cfg: ControlFlowGraph;
}

/**
 * DataFlowAnalyzer performs iterative data flow analysis on a CFG.
 *
 * Algorithm:
 * 1. Initialize all blocks with empty type states
 * 2. Add entry block to worklist
 * 3. While worklist is not empty:
 *    a. Remove a block from worklist
 *    b. Merge type states from all predecessors → typeStateIn
 *    c. Apply transfer function to get typeStateOut
 *    d. If typeStateOut changed, add all successors to worklist
 * 4. Fixed point is reached when worklist is empty
 */
export class DataFlowAnalyzer {
  private cfg: ControlFlowGraph;
  private symbolTable: SymbolTable;
  private config: Required<DataFlowConfig>;

  constructor(
    cfg: ControlFlowGraph,
    symbolTable: SymbolTable,
    _sourceCode: string,
    config: DataFlowConfig = {}
  ) {
    this.cfg = cfg;
    this.symbolTable = symbolTable;
    this.config = {
      maxIterations: config.maxIterations ?? 1000,
      debug: config.debug ?? false,
    };
  }

  /**
   * Runs the data flow analysis.
   * Returns the result including convergence status and iterations.
   */
  analyze(): DataFlowResult {
    if (this.config.debug) {
      console.log(`\n=== Starting Data Flow Analysis for: ${this.cfg.name || 'unnamed'} ===`);
    }

    // Initialize: Set entry block's input to global variables
    this.initializeEntryBlock();

    // Worklist algorithm
    const worklist: BasicBlock[] = [this.cfg.entry];
    const worklistSet = new Set<number>([this.cfg.entry.id]);
    let iterations = 0;

    while (worklist.length > 0 && iterations < this.config.maxIterations) {
      iterations++;

      // Remove a block from the worklist
      const block = worklist.shift()!;
      worklistSet.delete(block.id);

      if (this.config.debug) {
        console.log(`\nIteration ${iterations}: Processing block ${block.id} (${block.label || 'unlabeled'})`);
      }

      // Merge type states from predecessors
      this.mergePredecessors(block);

      // Apply transfer function
      const oldStateOut = block.typeStateOut.clone();
      block.typeStateOut = this.transfer(block);

      // Check if output state changed
      if (!oldStateOut.equals(block.typeStateOut)) {
        if (this.config.debug) {
          console.log(`  Block ${block.id} output changed, adding successors to worklist`);
        }

        // Add all successors to worklist
        for (const edge of block.successors) {
          if (!worklistSet.has(edge.target.id)) {
            worklist.push(edge.target);
            worklistSet.add(edge.target.id);
          }
        }
      }
    }

    const converged = iterations < this.config.maxIterations;

    if (this.config.debug) {
      console.log(`\n=== Analysis Complete: ${converged ? 'CONVERGED' : 'MAX ITERATIONS'} (${iterations} iterations) ===\n`);
    }

    return {
      converged,
      iterations,
      cfg: this.cfg,
    };
  }

  /**
   * Initializes the entry block with global variables and declarations.
   */
  private initializeEntryBlock(): void {
    const entryState = new TypeState();

    // Add all global variables from symbol table
    const allSymbols = this.symbolTable.getAllSymbols();
    for (const symbol of allSymbols) {
      // Add all symbols (we'll refine this later based on actual declaration positions)
      entryState.set(symbol.name, symbol.dataType);
    }

    this.cfg.entry.typeStateIn = entryState;
  }

  /**
   * Merges type states from all predecessor blocks.
   */
  private mergePredecessors(block: BasicBlock): void {
    if (block.predecessors.length === 0) {
      // No predecessors, keep existing typeStateIn
      return;
    }

    if (block.predecessors.length === 1) {
      // Single predecessor - use its output (possibly with narrowing from edge)
      const pred = block.predecessors[0]!;
      const edge = pred.successors.find((e) => e.target === block);

      if (edge?.narrowedState) {
        // Edge has narrowing applied (e.g., from if condition)
        block.typeStateIn = edge.narrowedState.clone();
      } else {
        // No narrowing, just use predecessor's output
        block.typeStateIn = pred.typeStateOut.clone();
      }
      return;
    }

    // Multiple predecessors - merge all their outputs
    const mergedState = new TypeState();

    for (const pred of block.predecessors) {
      const edge = pred.successors.find((e) => e.target === block);

      // Get the state flowing through this edge
      let stateToMerge: TypeState;
      if (edge?.narrowedState) {
        stateToMerge = edge.narrowedState;
      } else {
        stateToMerge = pred.typeStateOut;
      }

      // Merge into the accumulated state
      mergedState.merge(stateToMerge);
    }

    block.typeStateIn = mergedState;
  }

  /**
   * Transfer function: Computes the output state for a block
   * based on its input state and the statements it contains.
   */
  private transfer(block: BasicBlock): TypeState {
    let state = block.typeStateIn.clone();

    // Process each statement in the block
    for (const statement of block.statements) {
      state = this.applyStatement(state, statement);
    }

    // Apply narrowing to successor edges based on conditions
    this.applyEdgeNarrowing(block, state);

    return state;
  }

  /**
   * Applies a single statement to update the type state.
   */
  private applyStatement(state: TypeState, statement: AstNode): TypeState {
    switch (statement.type) {
      case 'VariableDeclaration':
        return this.applyVariableDeclaration(state, statement as VariableDeclarationNode);

      case 'AssignmentExpression':
        return this.applyAssignment(state, statement as AssignmentExpressionNode);

      case 'ExpressionStatement':
        // Expression statements might contain assignments
        const exprStmt = statement as any;
        if (exprStmt.expression) {
          return this.applyStatement(state, exprStmt.expression);
        }
        return state;

      default:
        // Most statements don't affect type state
        return state;
    }
  }

  /**
   * Applies a variable declaration to the type state.
   */
  private applyVariableDeclaration(
    state: TypeState,
    node: VariableDeclarationNode
  ): TypeState {
    for (const declarator of node.declarations) {
      const varDecl = declarator as VariableDeclaratorNode;
      const varName = (varDecl.id as IdentifierNode).name;

      if (varDecl.init) {
        // Variable has initializer - infer its type
        const initType = this.inferExpressionType(state, varDecl.init);
        state.set(varName, initType);
      } else {
        // No initializer - set to unknown
        state.set(varName, UcodeType.UNKNOWN);
      }
    }

    return state;
  }

  /**
   * Applies an assignment to the type state.
   */
  private applyAssignment(
    state: TypeState,
    node: AssignmentExpressionNode
  ): TypeState {
    // Only handle simple variable assignments for now
    if (node.left.type === 'Identifier') {
      const varName = (node.left as IdentifierNode).name;
      const rightType = this.inferExpressionType(state, node.right);
      state.set(varName, rightType);
    }

    return state;
  }

  /**
   * Infers the type of an expression using the current type state.
   */
  private inferExpressionType(state: TypeState, expr: AstNode): UcodeDataType {
    switch (expr.type) {
      case 'Literal':
        return this.inferLiteralType(expr as LiteralNode);

      case 'Identifier':
        const varName = (expr as IdentifierNode).name;
        return state.get(varName) || UcodeType.UNKNOWN;

      case 'ArrayExpression':
        return UcodeType.ARRAY;

      case 'ObjectExpression':
        return UcodeType.OBJECT;

      case 'BinaryExpression':
        return this.inferBinaryExpressionType(state, expr as BinaryExpressionNode);

      case 'UnaryExpression':
        return this.inferUnaryExpressionType(state, expr as UnaryExpressionNode);

      case 'CallExpression':
        return this.inferCallExpressionType(state, expr as CallExpressionNode);

      default:
        return UcodeType.UNKNOWN;
    }
  }

  /**
   * Infers the type of a literal.
   */
  private inferLiteralType(node: LiteralNode): UcodeDataType {
    switch (node.literalType) {
      case 'string':
        return UcodeType.STRING;
      case 'number':
      case 'double':
        return typeof node.value === 'number' && Number.isInteger(node.value)
          ? UcodeType.INTEGER
          : UcodeType.DOUBLE;
      case 'boolean':
        return UcodeType.BOOLEAN;
      case 'null':
        return UcodeType.NULL;
      case 'regexp':
        return UcodeType.REGEX;
      default:
        return UcodeType.UNKNOWN;
    }
  }

  /**
   * Infers the type of a binary expression.
   */
  private inferBinaryExpressionType(
    state: TypeState,
    node: BinaryExpressionNode
  ): UcodeDataType {
    const leftType = this.inferExpressionType(state, node.left);
    const rightType = this.inferExpressionType(state, node.right);

    // Comparison operators return boolean
    if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(node.operator)) {
      return UcodeType.BOOLEAN;
    }

    // Logical operators
    if (node.operator === '&&' || node.operator === '||') {
      return UcodeType.BOOLEAN;
    }

    // Arithmetic operators
    if (['+', '-', '*', '/', '%', '**'].includes(node.operator)) {
      // If either operand is double, result is double
      const types = [...getUnionTypes(leftType), ...getUnionTypes(rightType)];
      if (types.includes(UcodeType.DOUBLE)) {
        return UcodeType.DOUBLE;
      }
      return UcodeType.INTEGER;
    }

    // String concatenation
    if (node.operator === '+') {
      const types = [...getUnionTypes(leftType), ...getUnionTypes(rightType)];
      if (types.includes(UcodeType.STRING)) {
        return UcodeType.STRING;
      }
    }

    return UcodeType.UNKNOWN;
  }

  /**
   * Infers the type of a unary expression.
   */
  private inferUnaryExpressionType(
    state: TypeState,
    node: UnaryExpressionNode
  ): UcodeDataType {
    if (node.operator === '!') {
      return UcodeType.BOOLEAN;
    }

    if (node.operator === '-' || node.operator === '+') {
      const argType = this.inferExpressionType(state, node.argument);
      return argType; // Preserve integer/double
    }

    return UcodeType.UNKNOWN;
  }

  /**
   * Infers the type of a call expression.
   * For now, we use the return type from symbol table if available.
   */
  private inferCallExpressionType(
    _state: TypeState,
    node: CallExpressionNode
  ): UcodeDataType {
    if (node.callee.type === 'Identifier') {
      const funcName = (node.callee as IdentifierNode).name;

      // Look up function in symbol table
      const symbol = this.symbolTable.lookup(funcName);
      if (symbol?.returnType) {
        return symbol.returnType;
      }

      // Check built-in functions with known return types
      const builtinReturnType = this.getBuiltinReturnType(funcName);
      if (builtinReturnType) {
        return builtinReturnType;
      }
    }

    return UcodeType.UNKNOWN;
  }

  /**
   * Gets the return type of a built-in function.
   */
  private getBuiltinReturnType(
    funcName: string
  ): UcodeDataType | null {
    // Built-in functions with known return types
    const builtinReturns: Record<string, UcodeDataType> = {
      print: UcodeType.INTEGER,
      printf: UcodeType.INTEGER,
      sprintf: UcodeType.STRING,
      length: UcodeType.INTEGER,
      substr: UcodeType.STRING,
      split: UcodeType.ARRAY,
      join: UcodeType.STRING,
      trim: UcodeType.STRING,
      ltrim: UcodeType.STRING,
      rtrim: UcodeType.STRING,
      chr: UcodeType.STRING,
      ord: UcodeType.INTEGER,
      uc: UcodeType.STRING,
      lc: UcodeType.STRING,
      type: UcodeType.STRING,
      keys: UcodeType.ARRAY,
      values: UcodeType.ARRAY,
      push: UcodeType.INTEGER,
      pop: UcodeType.UNKNOWN,
      shift: UcodeType.UNKNOWN,
      unshift: UcodeType.INTEGER,
      iptoarr: UcodeType.ARRAY,
      arrtoip: UcodeType.STRING,
      int: UcodeType.INTEGER,
      match: UcodeType.ARRAY,
      replace: UcodeType.STRING,
      system: UcodeType.INTEGER,
      time: UcodeType.INTEGER,
      sleep: UcodeType.NULL,
      wildcard: UcodeType.BOOLEAN,
      regexp: UcodeType.REGEX,
      exists: UcodeType.BOOLEAN,
    };

    return builtinReturns[funcName] || null;
  }

  /**
   * Applies type narrowing to edges based on conditions.
   *
   * For example, in `if (typeof x === 'string')`, the true edge
   * should narrow x to string, and the false edge should exclude string.
   */
  private applyEdgeNarrowing(block: BasicBlock, state: TypeState): void {
    for (const edge of block.successors) {
      if (edge.condition) {
        // Apply narrowing based on the condition
        const narrowedState = this.applyTypeGuard(
          state,
          edge.condition,
          edge.isNegative || false
        );
        edge.narrowedState = narrowedState;
      }
    }
  }

  /**
   * Applies type guard narrowing based on a condition.
   */
  private applyTypeGuard(
    state: TypeState,
    condition: AstNode,
    isNegative: boolean
  ): TypeState {
    const narrowedState = state.clone();

    // Extract type guard from condition
    const guard = this.extractTypeGuard(condition);
    if (!guard) {
      return narrowedState;
    }

    const currentType = state.get(guard.variableName);
    if (!currentType) {
      return narrowedState;
    }

    // Apply narrowing
    if (guard.guardType === 'null-check') {
      if (isNegative) {
        // x !== null: remove null from type
        narrowedState.exclude(guard.variableName, UcodeType.NULL);
      } else {
        // x === null: narrow to null
        narrowedState.narrow(guard.variableName, UcodeType.NULL);
      }
    } else if (guard.guardType === 'type-check' && guard.narrowToType) {
      if (isNegative) {
        // typeof x !== 'string': exclude string
        narrowedState.exclude(guard.variableName, guard.narrowToType);
      } else {
        // typeof x === 'string': narrow to string
        narrowedState.narrow(guard.variableName, guard.narrowToType);
      }
    }

    return narrowedState;
  }

  /**
   * Extracts type guard information from a condition expression.
   */
  private extractTypeGuard(
    condition: AstNode
  ): { variableName: string; guardType: 'null-check' | 'type-check'; narrowToType?: UcodeType } | null {
    if (condition.type !== 'BinaryExpression') {
      return null;
    }

    const binary = condition as BinaryExpressionNode;

    // Handle: x === null or x !== null
    if (binary.operator === '===' || binary.operator === '!==' || binary.operator === '==' || binary.operator === '!=') {
      if (binary.left.type === 'Identifier' && binary.right.type === 'Literal') {
        const varName = (binary.left as IdentifierNode).name;
        const literal = binary.right as LiteralNode;

        if (literal.value === null) {
          return { variableName: varName, guardType: 'null-check' };
        }
      }

      // Handle: typeof x === 'string'
      if (binary.left.type === 'CallExpression') {
        const call = binary.left as CallExpressionNode;
        if (
          call.callee.type === 'Identifier' &&
          (call.callee as IdentifierNode).name === 'type' &&
          call.arguments.length === 1 &&
          call.arguments[0]!.type === 'Identifier' &&
          binary.right.type === 'Literal'
        ) {
          const varName = (call.arguments[0] as IdentifierNode).name;
          const typeString = (binary.right as LiteralNode).value as string;
          const narrowToType = this.stringToUcodeType(typeString);

          if (narrowToType) {
            return { variableName: varName, guardType: 'type-check', narrowToType };
          }
        }
      }
    }

    return null;
  }

  /**
   * Converts a type string (from `type()` function) to UcodeType.
   */
  private stringToUcodeType(typeStr: string): UcodeType | null {
    const typeMap: Record<string, UcodeType> = {
      string: UcodeType.STRING,
      int: UcodeType.INTEGER,
      double: UcodeType.DOUBLE,
      bool: UcodeType.BOOLEAN,
      array: UcodeType.ARRAY,
      object: UcodeType.OBJECT,
      function: UcodeType.FUNCTION,
      null: UcodeType.NULL,
    };

    return typeMap[typeStr] || null;
  }
}
