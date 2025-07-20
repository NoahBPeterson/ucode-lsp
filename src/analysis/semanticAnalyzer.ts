/**
 * Semantic Analyzer for ucode
 * Combines symbol table, type checking, and other semantic analyses
 */

import { AstNode, ProgramNode, VariableDeclarationNode, VariableDeclaratorNode, 
         FunctionDeclarationNode, FunctionExpressionNode, IdentifierNode, CallExpressionNode,
         BlockStatementNode, ReturnStatementNode, BreakStatementNode, 
         ContinueStatementNode, AssignmentExpressionNode, ImportDeclarationNode,
         ImportSpecifierNode, ImportDefaultSpecifierNode, ImportNamespaceSpecifierNode,
         PropertyNode, MemberExpressionNode, TryStatementNode, CatchClauseNode } from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, UcodeDataType } from './symbolTable';
import { TypeChecker, TypeCheckResult } from './types';
import { BaseVisitor } from './visitor';
import { Diagnostic, DiagnosticSeverity, TextDocument } from 'vscode-languageserver/node';
import { allBuiltinFunctions } from '../builtins';
import { FsObjectType, createFsObjectDataType } from './fsTypes';
import { logTypeRegistry } from './logTypes';
import { mathTypeRegistry } from './mathTypes';
import { nl80211TypeRegistry, nl80211ObjectRegistry } from './nl80211Types';
import { Nl80211ObjectType, createNl80211ObjectDataType } from './nl80211Types';
import { resolvTypeRegistry } from './resolvTypes';
import { socketTypeRegistry } from './socketTypes';

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
      
      // Standard variable declaration
      let symbolType = SymbolType.VARIABLE;
      let dataType: UcodeDataType = UcodeType.UNKNOWN as UcodeDataType;
      
      // Check for redeclaration in current scope
      if (!this.symbolTable.declare(name, symbolType, dataType, node.id)) {
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
            // Check if this is an fs function call and assign the appropriate fs type
            const fsType = this.inferFsType(node.init);
            if (fsType) {
              const dataType = createFsObjectDataType(fsType);
              symbol.dataType = dataType;
              // For fs object variables, also force declaration in global scope to ensure completion access
              this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
            } else {
              // Check if this is an nl80211 function call and assign the appropriate nl80211 type
              const nl80211Type = this.inferNl80211Type(node.init);
              if (nl80211Type) {
                const dataType = createNl80211ObjectDataType(nl80211Type);
                symbol.dataType = dataType;
                // For nl80211 object variables, also force declaration in global scope to ensure completion access
                this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
              } else {
                symbol.dataType = initType as UcodeDataType;
              }
            }
          }
        }
      }
    } else {
      super.visitVariableDeclarator(node);
    }
  }

  visitImportDeclaration(node: ImportDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      // For now, just add imported symbols to the symbol table
      // TODO: Add proper file resolution and cross-file analysis
      for (const specifier of node.specifiers) {
        this.processImportSpecifier(specifier, node.source.value as string);
      }
    }
    
    // Continue with default traversal
    super.visitImportDeclaration(node);
  }

  visitImportSpecifier(node: ImportSpecifierNode): void {
    // Only visit the local identifier, not the imported one
    // This prevents the "undefined variable" error for the original name in aliases
    this.visit(node.local);
  }

  visitProperty(node: PropertyNode): void {
    // Only visit computed property keys (obj[key]), not literal keys (obj.key)
    if (node.computed) {
      this.visit(node.key);
    }
    // Always visit the property value
    this.visit(node.value);
  }

  private processImportSpecifier(specifier: ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode, source: string): void {
    let localName: string;
    let importedName: string;
    
    if (specifier.type === 'ImportSpecifier') {
      localName = specifier.local.name;
      importedName = specifier.imported.name;
    } else if (specifier.type === 'ImportDefaultSpecifier') {
      localName = specifier.local.name;
      importedName = 'default';
    } else { // ImportNamespaceSpecifier
      localName = specifier.local.name;
      importedName = '*';
    }
    
    // Validate log module imports
    if (source === 'log' && specifier.type === 'ImportSpecifier') {
      if (!logTypeRegistry.isValidLogImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the log module. Available exports: ${logTypeRegistry.getValidLogImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate math module imports
    if (source === 'math' && specifier.type === 'ImportSpecifier') {
      if (!mathTypeRegistry.isValidMathImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the math module. Available exports: ${mathTypeRegistry.getValidMathImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate nl80211 module imports
    if (source === 'nl80211' && specifier.type === 'ImportSpecifier') {
      if (!nl80211TypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the nl80211 module. Available exports: ${nl80211TypeRegistry.getValidImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate resolv module imports
    if (source === 'resolv' && specifier.type === 'ImportSpecifier') {
      if (!resolvTypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the resolv module. Available exports: ${resolvTypeRegistry.getValidImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate socket module imports
    if (source === 'socket' && specifier.type === 'ImportSpecifier') {
      if (!socketTypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the socket module. Available exports: ${socketTypeRegistry.getValidImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Add imported symbol to symbol table
    if (!this.symbolTable.declare(localName, SymbolType.IMPORTED, UcodeType.UNKNOWN as UcodeDataType, specifier.local)) {
      this.addDiagnostic(
        `Imported symbol '${localName}' is already declared in current scope`,
        specifier.local.start,
        specifier.local.end,
        DiagnosticSeverity.Error
      );
    } else {
      // Store import information in the symbol
      const symbol = this.symbolTable.lookup(localName);
      if (symbol) {
        symbol.importedFrom = source;
        symbol.importSpecifier = importedName;
        // TODO: Resolve actual definition location
      }
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

  visitFunctionExpression(node: FunctionExpressionNode): void {
    if (this.options.enableScopeAnalysis) {
      // For function expressions, we don't declare them in the outer scope
      // since they're anonymous (even if they have a name, it's only available inside the function)

      // Set context for nested return statement analysis.
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node as any; // Type compatibility - both have id, params, body
      this.functionReturnTypes.set(node as any, []);

      // Enter function scope
      this.symbolTable.enterScope();
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // If the function has a name (named function expression), declare it in the function's own scope
      if (node.id) {
        this.symbolTable.declare(node.id.name, SymbolType.FUNCTION, UcodeType.UNKNOWN as UcodeDataType, node.id);
      }

      // Declare parameters in the function scope
      for (const param of node.params) {
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, UcodeType.UNKNOWN as UcodeDataType, param);
      }

      // Visit the function body
      this.visit(node.body);

      // Exit function scope
      this.symbolTable.exitScope();
      this.functionScopes.pop();
      this.currentFunctionNode = previousFunction;
    } else {
      // Fallback: just visit the function body if scope analysis is disabled
      this.visit(node.body);
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

  visitTryStatement(node: TryStatementNode): void {
    if (this.options.enableScopeAnalysis) {
      // Visit the try block
      this.visit(node.block);
      
      // Visit the catch handler if present
      if (node.handler) {
        this.visit(node.handler);
      }
      
      // Visit the finally block if present
      if (node.finalizer) {
        this.visit(node.finalizer);
      }
    } else {
      super.visit(node);
    }
  }

  visitCatchClause(node: CatchClauseNode): void {
    if (this.options.enableScopeAnalysis) {
      // Enter catch scope
      this.symbolTable.enterScope();
      
      // Declare the catch parameter if present
      if (node.param) {
        if (!this.symbolTable.declare(node.param.name, SymbolType.PARAMETER, UcodeType.STRING as UcodeDataType, node.param)) {
          this.addDiagnostic(
            `Parameter '${node.param.name}' is already declared in this scope`,
            node.param.start,
            node.param.end,
            DiagnosticSeverity.Error
          );
        }
      }
      
      // Visit the catch body
      this.visit(node.body);
      
      // Exit catch scope
      this.symbolTable.exitScope();
    } else {
      super.visit(node);
    }
  }

  visitIdentifier(node: IdentifierNode): void {
    if (this.options.enableScopeAnalysis) {
      // Check if identifier is defined
      const symbol = this.symbolTable.lookup(node.name);
      if (!symbol) {
        // Check if it's a builtin function before reporting as undefined
        const isBuiltin = allBuiltinFunctions.has(node.name);
        if (!isBuiltin) {
          this.addDiagnostic(
            `Undefined variable: ${node.name}`,
            node.start,
            node.end,
            DiagnosticSeverity.Error
          );
        }
      } else {
        // Mark as used
        this.symbolTable.markUsed(node.name, node.start);
      }
    }
  }

  visitMemberExpression(node: MemberExpressionNode): void {
    if (this.options.enableScopeAnalysis) {
      // Visit the object part (e.g., 'constants' in 'constants.DT_HOSTINFO_FINAL_PATH')
      this.visit(node.object);
      
      // For non-computed member access (obj.prop), check if it's a namespace import, module, or fs object
      if (!node.computed && node.object.type === 'Identifier') {
        const objectName = (node.object as IdentifierNode).name;
        const symbol = this.symbolTable.lookup(objectName);
        
        // If the object is a namespace import, don't visit the property as it's not a variable
        if (symbol && symbol.type === SymbolType.IMPORTED && symbol.importSpecifier === '*') {
          // This is a namespace import member access (e.g., constants.DT_HOSTINFO_FINAL_PATH)
          // Don't visit the property name as it's not a variable reference
          return;
        }
        
        // If the object is an fs type, don't visit the property as it's a method name
        if (symbol && symbol.type === SymbolType.VARIABLE && symbol.dataType) {
          const { fsTypeRegistry } = require('./fsTypes');
          const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
          if (fsType) {
            // This is an fs object method access (e.g., file_content.write)
            // Don't visit the property name as it's not a variable reference
            return;
          }

          // If the object is an nl80211 type, don't visit the property as it's a method name
          const nl80211Type = nl80211ObjectRegistry.isVariableOfNl80211Type(symbol.dataType);
          if (nl80211Type) {
            // This is an nl80211 object method access (e.g., eventListener.set_commands)
            // Don't visit the property name as it's not a variable reference
            return;
          }
        }
      }
      
      // For computed access (obj[prop]) or other member access, visit the property
      this.visit(node.property);
    } else {
      // If scope analysis is disabled, use default behavior
      super.visitMemberExpression(node);
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
      // Handle fs type inference for assignment expressions FIRST (e.g., file_content = open(...))
      // This creates symbols for undeclared variables before type checking tries to look them up
      if (node.left.type === 'Identifier') {
        const variableName = (node.left as IdentifierNode).name;
        let symbol = this.symbolTable.lookup(variableName);
        
        // Check if this is an fs function call and assign the appropriate fs type
        const fsType = this.inferFsType(node.right);
        let dataType: UcodeDataType;
        
        if (fsType) {
          dataType = createFsObjectDataType(fsType);
        } else {
          // Check if this is an nl80211 function call and assign the appropriate nl80211 type
          const nl80211Type = this.inferNl80211Type(node.right);
          if (nl80211Type) {
            dataType = createNl80211ObjectDataType(nl80211Type);
          } else {
            // Use the inferred type from the right-hand side
            const rightType = this.typeChecker.checkNode(node.right);
            dataType = rightType as UcodeDataType;
          }
        }
        
        if (symbol && symbol.type === SymbolType.VARIABLE) {
          // Update existing variable symbol across all scopes
          symbol.dataType = dataType;
          // Also force update in case it's in a different scope
          this.symbolTable.updateSymbolType(variableName, dataType);
          console.log(`[SEMANTIC] Updated variable: ${variableName} to type: ${JSON.stringify(dataType)}`);
        } else if (!symbol) {
          // Create new symbol for undeclared variable (implicit declaration)
          this.symbolTable.declare(variableName, SymbolType.VARIABLE, dataType, node.left as IdentifierNode);
          console.log(`[SEMANTIC] Created new variable: ${variableName} with type: ${JSON.stringify(dataType)}`);
        } else {
          // Symbol exists but wrong type, try to update it anyway
          this.symbolTable.updateSymbolType(variableName, dataType);
          console.log(`[SEMANTIC] Force updated variable: ${variableName} to type: ${JSON.stringify(dataType)}`);
        }
        
        // For fs object variables, also force declaration in global scope to ensure completion access
        if (fsType) {
          this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, dataType);
        }
      }
      
      // Now check assignment type compatibility after symbols are created
      this.typeChecker.checkNode(node.left);
      this.typeChecker.checkNode(node.right);
      
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

  private inferFsType(node: AstNode): FsObjectType | null {
    // Check if this is a call expression that returns an fs object
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      if (callNode.callee.type === 'Identifier') {
        const funcName = (callNode.callee as IdentifierNode).name;
        
        // Map fs functions to their return types
        switch (funcName) {
          case 'open':
          case 'fdopen':
          case 'mkstemp':
            return FsObjectType.FS_FILE;
          case 'opendir':
            return FsObjectType.FS_DIR;
          case 'popen':
            return FsObjectType.FS_PROC;
          default:
            return null;
        }
      }
      // Handle module member calls like fs.open()
      else if (callNode.callee.type === 'MemberExpression') {
        const memberNode = callNode.callee as MemberExpressionNode;
        if (memberNode.object.type === 'Identifier' && 
            (memberNode.object as IdentifierNode).name === 'fs' &&
            memberNode.property.type === 'Identifier') {
          const methodName = (memberNode.property as IdentifierNode).name;
          
          switch (methodName) {
            case 'open':
            case 'fdopen':
            case 'mkstemp':
              return FsObjectType.FS_FILE;
            case 'opendir':
              return FsObjectType.FS_DIR;
            case 'popen':
              return FsObjectType.FS_PROC;
          }
        }
      }
    }
    
    return null;
  }

  private inferNl80211Type(node: AstNode): Nl80211ObjectType | null {
    // Check if this is a call expression that returns an nl80211 object
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      if (callNode.callee.type === 'Identifier') {
        const funcName = (callNode.callee as IdentifierNode).name;
        
        // Map nl80211 functions to their return types
        switch (funcName) {
          case 'listener':
            return Nl80211ObjectType.NL80211_LISTENER;
          default:
            return null;
        }
      }
      // Handle module member calls like nl80211.listener()
      else if (callNode.callee.type === 'MemberExpression') {
        const memberNode = callNode.callee as MemberExpressionNode;
        if (memberNode.object.type === 'Identifier' && 
            (memberNode.object as IdentifierNode).name === 'nl80211' &&
            memberNode.property.type === 'Identifier') {
          const methodName = (memberNode.property as IdentifierNode).name;
          
          switch (methodName) {
            case 'listener':
              return Nl80211ObjectType.NL80211_LISTENER;
          }
        }
      }
    }
    
    return null;
  }

  private addDiagnostic(message: string, start: number, end: number, severity: DiagnosticSeverity): void {
    // Check for duplicate diagnostics to prevent multiple identical errors
    const startPos = this.textDocument.positionAt(start);
    const endPos = this.textDocument.positionAt(end);
    
    const isDuplicate = this.diagnostics.some(existing => 
      existing.message === message &&
      existing.severity === severity &&
      existing.range.start.line === startPos.line &&
      existing.range.start.character === startPos.character &&
      existing.range.end.line === endPos.line &&
      existing.range.end.character === endPos.character
    );
    
    if (!isDuplicate) {
      this.diagnostics.push({
        severity,
        range: {
          start: startPos,
          end: endPos
        },
        message,
        source: 'ucode-semantic'
      });
    }
  }
}