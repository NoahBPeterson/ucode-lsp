/**
 * Semantic Analyzer for ucode
 * Combines symbol table, type checking, and other semantic analyses
 */

import { AstNode, ProgramNode, VariableDeclarationNode, VariableDeclaratorNode, 
         FunctionDeclarationNode, IdentifierNode, CallExpressionNode, 
         BlockStatementNode, ReturnStatementNode, BreakStatementNode, 
         ContinueStatementNode, AssignmentExpressionNode } from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, UcodeDataType } from './symbolTable';
import { TypeChecker, TypeCheckResult } from './types';
import { BaseVisitor } from './visitor';
import { Diagnostic, DiagnosticSeverity, TextDocument } from 'vscode-languageserver/node';

export interface SemanticAnalysisOptions {
  enableScopeAnalysis?: boolean;
  enableTypeChecking?: boolean;
  enableControlFlowAnalysis?: boolean;
  enableUnusedVariableDetection?: boolean;
  enableShadowingWarnings?: boolean;
}

export interface SemanticAnalysisResult {
  diagnostics: Diagnostic[];
  symbolTable: SymbolTable;
  typeResults: Map<AstNode, TypeCheckResult>;
}

export class SemanticAnalyzer extends BaseVisitor {
  private symbolTable: SymbolTable;
  private typeChecker: TypeChecker;
  private diagnostics: Diagnostic[] = [];
  private textDocument: TextDocument;
  private options: SemanticAnalysisOptions;
  private functionScopes: number[] = []; // Track function scope levels
  private loopScopes: number[] = []; // Track loop scope levels
  private currentFunctionNode: FunctionDeclarationNode | null = null;
  private functionReturnTypes = new Map<FunctionDeclarationNode, UcodeType[]>();

  constructor(textDocument: TextDocument, options: SemanticAnalysisOptions = {}) {
    super();
    this.textDocument = textDocument;
    this.symbolTable = new SymbolTable();
    this.typeChecker = new TypeChecker(this.symbolTable);
    this.options = {
      enableScopeAnalysis: true,
      enableTypeChecking: true,
      enableControlFlowAnalysis: true,
      enableUnusedVariableDetection: true,
      enableShadowingWarnings: true,
      ...options
    };
  }

  analyze(ast: AstNode): SemanticAnalysisResult {
    this.diagnostics = [];
    this.functionScopes = [];
    this.loopScopes = [];
    this.currentFunctionNode = null;
    this.functionReturnTypes.clear();

    try {
      // Visit the AST to perform semantic analysis
      this.visit(ast);

      // Post-analysis checks
      if (this.options.enableUnusedVariableDetection) {
        this.checkUnusedVariables();
      }

    } catch (error) {
      this.addDiagnostic(
        `Semantic analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ast.start,
        ast.end,
        DiagnosticSeverity.Error
      );
    }

    return {
      diagnostics: this.diagnostics,
      symbolTable: this.symbolTable,
      typeResults: new Map() // TODO: Implement type result tracking
    };
  }

  visitProgram(node: ProgramNode): void {
    // Global scope analysis
    super.visitProgram(node);
  }

  visitVariableDeclaration(node: VariableDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      for (const declarator of node.declarations) {
        this.visitVariableDeclarator(declarator, node.kind);
      }
    } else {
      super.visitVariableDeclaration(node);
    }
  }

  visitVariableDeclarator(node: VariableDeclaratorNode, _kind: string = 'let'): void {
    if (this.options.enableScopeAnalysis) {
      const name = node.id.name;
      
      // Check for redeclaration in current scope
      if (!this.symbolTable.declare(name, SymbolType.VARIABLE, UcodeType.UNKNOWN as UcodeDataType, node.id)) {
        this.addDiagnostic(
          `Variable '${name}' is already declared in this scope`,
          node.id.start,
          node.id.end,
          DiagnosticSeverity.Error
        );
      }

      // Check for shadowing
      if (this.options.enableShadowingWarnings) {
        const shadowedSymbol = this.symbolTable.checkShadowing(name);
        if (shadowedSymbol) {
          this.addDiagnostic(
            `Variable '${name}' shadows declaration from outer scope`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Warning
          );
        }
      }

      // Process initializer
      if (node.init) {
        this.visit(node.init);
        
        // Type inference if type checking is enabled
        if (this.options.enableTypeChecking) {
          const initType = this.typeChecker.checkNode(node.init);
          const symbol = this.symbolTable.lookup(name);
          if (symbol) {
            symbol.dataType = initType as UcodeDataType;
          }
        }
      }
    } else {
      super.visitVariableDeclarator(node);
    }
  }

  visitFunctionDeclaration(node: FunctionDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      const name = node.id.name;

      // Declare the function first with an UNKNOWN return type to handle recursion.
      if (!this.symbolTable.declare(name, SymbolType.FUNCTION, UcodeType.UNKNOWN as UcodeDataType, node.id)) {
        this.addDiagnostic(
          `Function '${name}' is already declared in this scope`,
          node.id.start,
          node.id.end,
          DiagnosticSeverity.Error
        );
      }

      // Set context for nested return statement analysis.
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node;
      this.functionReturnTypes.set(node, []);

      // Enter function scope
      this.symbolTable.enterScope();
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // Declare parameters
      for (const param of node.params) {
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, UcodeType.UNKNOWN as UcodeDataType, param);
      }

      // Visit the function body to find all return statements.
      this.visit(node.body);

      // Infer the final return type from all collected return types.
      const returnTypes = this.functionReturnTypes.get(node) || [];
      const inferredReturnType = this.typeChecker.getCommonReturnType(returnTypes);

      // Update the function's symbol with the now-known return type.
      const symbol = this.symbolTable.lookup(name);
      if (symbol) {
        symbol.dataType = inferredReturnType;
      }

      // Exit function scope
      this.symbolTable.exitScope();
      this.functionScopes.pop();
      this.currentFunctionNode = previousFunction;
    } else {
      super.visitFunctionDeclaration(node);
    }
  }

  visitBlockStatement(node: BlockStatementNode): void {
    if (this.options.enableScopeAnalysis) {
      // Enter block scope
      this.symbolTable.enterScope();
      
      // Visit all statements in the block
      for (const statement of node.body) {
        this.visit(statement);
      }

      // Exit block scope
      this.symbolTable.exitScope();
    } else {
      super.visitBlockStatement(node);
    }
  }

  visitIdentifier(node: IdentifierNode): void {
    if (this.options.enableScopeAnalysis) {
      // Check if identifier is defined
      const symbol = this.symbolTable.lookup(node.name);
      if (!symbol) {
        this.addDiagnostic(
          `Undefined variable: ${node.name}`,
          node.start,
          node.end,
          DiagnosticSeverity.Error
        );
      } else {
        // Mark as used
        this.symbolTable.markUsed(node.name, node.start);
      }
    }
  }

  visitCallExpression(node: CallExpressionNode): void {
    if (this.options.enableTypeChecking) {
      // Reset errors before type checking this call expression
      this.typeChecker.resetErrors();
      
      // Type check the function call
      this.typeChecker.checkNode(node);
      const result = this.typeChecker.getResult();
      
      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error);
      }
      
      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning);
      }
    }

    // Continue with default traversal
    super.visitCallExpression(node);
  }

  visitAssignmentExpression(node: AssignmentExpressionNode): void {
    if (this.options.enableTypeChecking) {
      // Check assignment type compatibility
      this.typeChecker.checkNode(node.left);
      this.typeChecker.checkNode(node.right);
      
      // Check for const reassignment
      if (node.left.type === 'Identifier') {
        const symbol = this.symbolTable.lookup((node.left as IdentifierNode).name);
        if (symbol && symbol.type === SymbolType.VARIABLE) {
          // TODO: Track const declarations properly
          // This would require extending the symbol table to track const vs let
        }
      }
      
      const result = this.typeChecker.getResult();
      
      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error);
      }
      
      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning);
      }
    }

    // Continue with default traversal
    super.visitAssignmentExpression(node);
  }

  visitReturnStatement(node: ReturnStatementNode): void {
    // Continue with default traversal to ensure argument expression is visited first
    super.visitReturnStatement(node);

    if (this.options.enableControlFlowAnalysis) {
      if (this.functionScopes.length === 0) {
        this.addDiagnostic(
          'Return statement outside function',
          node.start,
          node.end,
          DiagnosticSeverity.Error
        );
      } else if (this.currentFunctionNode) {
        // Determine the type of the returned value.
        const returnType = node.argument ? this.typeChecker.checkNode(node.argument) : UcodeType.NULL;
        
        // Store it for later inference.
        this.functionReturnTypes.get(this.currentFunctionNode)?.push(returnType);
      }
    }
  }

  visitBreakStatement(node: BreakStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      // Check if break is inside a loop
      if (this.loopScopes.length === 0) {
        this.addDiagnostic(
          'Break statement outside loop',
          node.start,
          node.end,
          DiagnosticSeverity.Error
        );
      }
    }

    // Continue with default traversal
    super.visitBreakStatement(node);
  }

  visitContinueStatement(node: ContinueStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      // Check if continue is inside a loop
      if (this.loopScopes.length === 0) {
        this.addDiagnostic(
          'Continue statement outside loop',
          node.start,
          node.end,
          DiagnosticSeverity.Error
        );
      }
    }

    // Continue with default traversal
    super.visitContinueStatement(node);
  }

  // Override loop visitors to track loop scopes
  visitWhileStatement(node: any): void {
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }
    
    super.visitWhileStatement(node);
    
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  visitForStatement(node: any): void {
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }
    
    super.visitForStatement(node);
    
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  visitForInStatement(node: any): void {
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }
    
    super.visitForInStatement(node);
    
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  private checkUnusedVariables(): void {
    const unusedVariables = this.symbolTable.getUnusedVariables();
    
    for (const symbol of unusedVariables) {
      // Don't warn about unused parameters or builtins
      if (symbol.type === SymbolType.PARAMETER || symbol.type === SymbolType.BUILTIN) {
        continue;
      }

      this.addDiagnostic(
        `Variable '${symbol.name}' is declared but never used`,
        symbol.node.start,
        symbol.node.end,
        DiagnosticSeverity.Warning
      );
    }
  }

  private addDiagnostic(message: string, start: number, end: number, severity: DiagnosticSeverity): void {
    this.diagnostics.push({
      severity,
      range: {
        start: this.textDocument.positionAt(start),
        end: this.textDocument.positionAt(end)
      },
      message,
      source: 'ucode-semantic'
    });
  }
}