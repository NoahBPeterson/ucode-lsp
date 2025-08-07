/**
 * Semantic Analyzer for ucode
 * Combines symbol table, type checking, and other semantic analyses
 */

import { AstNode, ProgramNode, VariableDeclarationNode, VariableDeclaratorNode, 
         FunctionDeclarationNode, FunctionExpressionNode, IdentifierNode, CallExpressionNode,
         BlockStatementNode, ReturnStatementNode, BreakStatementNode, 
         ContinueStatementNode, AssignmentExpressionNode, ImportDeclarationNode,
         ImportSpecifierNode, ImportDefaultSpecifierNode, ImportNamespaceSpecifierNode,
         PropertyNode, MemberExpressionNode, TryStatementNode, CatchClauseNode,
         ExportNamedDeclarationNode, ExportDefaultDeclarationNode, ArrowFunctionExpressionNode } from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, UcodeDataType } from './symbolTable';
import { TypeChecker, TypeCheckResult } from './types';
import { BaseVisitor } from './visitor';
import { Diagnostic, DiagnosticSeverity, TextDocument } from 'vscode-languageserver/node';
import { allBuiltinFunctions } from '../builtins';
import { FsObjectType, createFsObjectDataType } from './fsTypes';
import { logTypeRegistry } from './logTypes';
import { mathTypeRegistry } from './mathTypes';
import { nl80211TypeRegistry, Nl80211ObjectType, createNl80211ObjectDataType } from './nl80211Types';
import { resolvTypeRegistry } from './resolvTypes';
import { socketTypeRegistry } from './socketTypes';
import { structTypeRegistry } from './structTypes';
import { ubusTypeRegistry } from './ubusTypes';
import { uciTypeRegistry } from './uciTypes';
import { uloopTypeRegistry, UloopObjectType, createUloopObjectDataType, uloopObjectRegistry } from './uloopTypes';
import { createExceptionObjectDataType } from './exceptionTypes';

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
      
      // Special handling for require() calls
      if (node.init && node.init.type === 'CallExpression') {
        const callExpr = node.init as any; // CallExpressionNode
        if (callExpr.callee && callExpr.callee.type === 'Identifier' && callExpr.callee.name === 'require') {
          // Check if it's requiring a known module
          if (callExpr.arguments && callExpr.arguments.length === 1) {
            const arg = callExpr.arguments[0];
            if (arg.type === 'Literal' && typeof arg.value === 'string') {
              const moduleName = arg.value;
              // Handle known modules
              switch (moduleName) {
                case 'fs':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'fs' };
                  break;
                case 'debug':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'debug' };
                  break;
                case 'log':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'log' };
                  break;
                case 'math':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'math' };
                  break;
                case 'ubus':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'ubus' };
                  break;
                case 'uci':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'uci' };
                  break;
                case 'uloop':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'uloop' };
                  break;
                case 'digest':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'digest' };
                  break;
                case 'nl80211':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'nl80211' };
                  break;
                case 'resolv':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'resolv' };
                  break;
                case 'rtnl':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'rtnl' };
                  break;
                case 'socket':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'socket' };
                  break;
                case 'struct':
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName: 'struct' };
                  break;
                default:
                  break;
              }
            }
          }
        }
      }
      
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
                // Check if this is a uloop function call and assign the appropriate uloop type
                const uloopType = this.inferUloopType(node.init);
                if (uloopType) {
                  const dataType = createUloopObjectDataType(uloopType);
                  symbol.dataType = dataType;
                  // For uloop object variables, also force declaration in global scope to ensure completion access
                  this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
                } else {
                  // Don't overwrite module types that were set during declaration
                  if (symbol.type !== SymbolType.MODULE) {
                    symbol.dataType = initType as UcodeDataType;
                    // Debug logging for arrow function variables
                    if (node.init.type === 'ArrowFunctionExpression') {
                      // Function type detected
                    }
                  }
                }
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
    
    // Validate ubus module imports
    if (source === 'ubus' && specifier.type === 'ImportSpecifier') {
      if (!ubusTypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the ubus module. Available exports: ${ubusTypeRegistry.getValidImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }

    // Validate uci module imports
    if (source === 'uci' && specifier.type === 'ImportSpecifier') {
      if (!uciTypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the uci module. Available exports: ${
            uciTypeRegistry.getValidImports().join(', ')
          }`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }

    // Validate uloop module imports
    if (source === 'uloop' && specifier.type === 'ImportSpecifier') {
      if (!uloopTypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the uloop module. Available exports: ${
            uloopTypeRegistry.getValidImports().join(', ')
          }`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }

    // Validate struct module imports
    if (source === 'struct' && specifier.type === 'ImportSpecifier') {
      if (!structTypeRegistry.isValidImport(importedName)) {
        this.addDiagnostic(
          `'${importedName}' is not exported by the struct module. Available exports: ${structTypeRegistry.getValidImports().join(', ')}`,
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

  visitArrowFunctionExpression(node: ArrowFunctionExpressionNode): void {
    if (this.options.enableScopeAnalysis) {
      // Arrow functions are always anonymous and don't get declared in outer scope
      
      // Set context for nested return statement analysis
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node as any; // Type compatibility for analysis
      this.functionReturnTypes.set(node as any, []);

      // Enter function scope for parameters
      this.symbolTable.enterScope();
      this.functionScopes.push(this.symbolTable.getCurrentScope());

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
      // Fallback: use default visitor behavior
      super.visitArrowFunctionExpression(node);
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
      
    } else {
      super.visit(node);
    }
  }

  visitCatchClause(node: CatchClauseNode): void {
    if (this.options.enableScopeAnalysis) {
      // Enter catch scope
      this.symbolTable.enterScope();
      
      // Declare the catch parameter as an exception object if present
      if (node.param) {
        // Create exception object type with standard properties
        const exceptionObjectType = createExceptionObjectDataType();
        
        if (!this.symbolTable.declare(node.param.name, SymbolType.PARAMETER, exceptionObjectType, node.param)) {
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
      
      // IMPORTANT: Ensure the object identifier is marked as used for member expressions
      // This fixes the issue where variables like file_content are marked as unused
      // even when used in member expressions like file_content.read()
      if (!node.computed && node.object.type === 'Identifier') {
        const objectName = (node.object as IdentifierNode).name;
        // Explicitly mark the object identifier as used
        this.symbolTable.markUsed(objectName, node.object.start);
      }
      
      // For non-computed member access (obj.prop), don't visit the property as it's a property name, not a variable
      // For computed access (obj[prop]), visit the property as it's an expression/variable
      if (node.computed) {
        // Computed access: obj[prop] - the property is an expression/variable
        this.visit(node.property);
      }
      // Note: For non-computed access, don't visit the property to avoid "Undefined variable" errors
    } else {
      // If scope analysis is disabled, use default behavior
      super.visitMemberExpression(node);
    }
    
    // IMPORTANT: Always run type checking for member expressions to validate array/string methods
    if (this.options.enableTypeChecking) {
      // Reset errors before type checking this member expression
      this.typeChecker.resetErrors();
      
      // Type check the member expression for invalid array/string methods
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
    
    // Validate fs module method calls
    this.validateFsModuleMethod(node);
  }
  
  private validateFsModuleMethod(node: MemberExpressionNode): void {
    // Only check non-computed member expressions (obj.method)
    if (node.computed || node.property.type !== 'Identifier') {
      return;
    }
    
    // Check if this is a call on the fs module object
    if (node.object.type === 'Identifier') {
      const objectName = (node.object as IdentifierNode).name;
      const methodName = (node.property as IdentifierNode).name;
      
      // Look up the object symbol
      const symbol = this.symbolTable.lookup(objectName);
      if (!symbol) {
        return;
      }
      
      // Check if this is an fs module object
      if (symbol.type === SymbolType.MODULE && 
          typeof symbol.dataType === 'object' && 
          symbol.dataType.type === UcodeType.OBJECT &&
          'moduleName' in symbol.dataType &&
          symbol.dataType.moduleName === 'fs') {
        
        // Check if the method is valid for the fs module
        if (!this.isValidFsModuleMethod(methodName)) {
          this.addDiagnostic(
            `Method '${methodName}' is not available on the fs module. Did you mean to call this on a file handle? Use fs.open() first.`,
            node.property.start,
            node.property.end,
            DiagnosticSeverity.Error
          );
          return;
        }
      }
    }
  }
  
  private isValidFsModuleMethod(methodName: string): boolean {
    // Valid fs module methods from the C code
    const validFsMethods = new Set([
      'error', 'open', 'fdopen', 'opendir', 'popen', 'readlink', 
      'stat', 'lstat', 'mkdir', 'rmdir', 'symlink', 'unlink', 
      'getcwd', 'chdir', 'chmod', 'chown', 'rename', 'glob', 
      'dirname', 'basename', 'lsdir', 'mkstemp', 'access', 
      'readfile', 'writefile', 'realpath', 'pipe',
      // Pre-defined handles
      'stdin', 'stdout', 'stderr'
    ]);
    
    return validFsMethods.has(methodName);
  }

  visitCallExpression(node: CallExpressionNode): void {
    // Always handle scope analysis for function calls
    if (this.options.enableScopeAnalysis) {
      // Mark function callee as used if it's an identifier
      if (node.callee.type === 'Identifier') {
        const functionName = (node.callee as IdentifierNode).name;
        this.symbolTable.markUsed(functionName, node.callee.start);
      }
    }
    
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
        const nl80211Type = this.inferNl80211Type(node.right);
        const uloopType = this.inferUloopType(node.right);
        let dataType: UcodeDataType;
        
        if (fsType) {
          dataType = createFsObjectDataType(fsType);
        } else if (nl80211Type) {
          dataType = createNl80211ObjectDataType(nl80211Type);
        } else if (uloopType) {
          dataType = createUloopObjectDataType(uloopType);
        } else {
          // Check if this is a method call that returns a specific type
          const methodReturnType = this.inferMethodReturnType(node.right);
          if (methodReturnType) {
            dataType = methodReturnType;
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
        } else if (!symbol) {
          // Create new symbol for undeclared variable (implicit declaration)
          this.symbolTable.declare(variableName, SymbolType.VARIABLE, dataType, node.left as IdentifierNode);
        } else {
          // Symbol exists but wrong type, try to update it anyway
          this.symbolTable.updateSymbolType(variableName, dataType);
        }
        
        // For fs object variables, also force declaration in global scope to ensure completion access
        if (fsType) {
          this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, dataType);
        }
        
        // For uloop object variables, also force declaration in global scope to ensure completion access
        if (uloopType) {
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
    
    if (this.options.enableScopeAnalysis) {
      // Create a new scope for the for loop to properly handle loop variable declarations
      // This ensures that 'for (let i = 0; ...)' variables don't conflict between different loops
      this.symbolTable.enterScope();
      
      // Visit the loop components in the new scope
      if (node.init) {
        this.visit(node.init);
      }
      if (node.test) {
        this.visit(node.test);
      }
      if (node.update) {
        this.visit(node.update);
      }
      this.visit(node.body);
      
      // Exit the for loop scope
      this.symbolTable.exitScope();
    } else {
      // Fallback to default behavior if scope analysis is disabled
      super.visitForStatement(node);
    }
    
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  visitForInStatement(node: any): void {
    
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }
    
    if (this.options.enableScopeAnalysis) {
      // Handle the iterator variable (left side) - it's implicitly declared by the for...in loop
      // We declare it in the current scope so it's accessible to the loop body
      let iteratorName: string | null = null;
      let iteratorNode: any = null;
      
      if (node.left && node.left.type === 'Identifier') {
        // Simple case: for (var_name in ...)
        iteratorName = node.left.name;
        iteratorNode = node.left;
      } else if (node.left && node.left.type === 'VariableDeclaration' && node.left.declarations.length > 0) {
        // Declaration case: for (let var_name in ...)
        const declarator = node.left.declarations[0];
        if (declarator.id && declarator.id.type === 'Identifier') {
          iteratorName = declarator.id.name;
          iteratorNode = declarator.id;
        }
      }
      
      if (iteratorName && iteratorNode) {
        // Declare the iterator variable in the current scope
        // For-in loop iterators should have unknown type since we can't reliably infer the element type
        this.symbolTable.declare(iteratorName, SymbolType.VARIABLE, UcodeType.UNKNOWN as UcodeDataType, iteratorNode);
        // Mark it as used immediately since it's used by the loop construct itself
        this.symbolTable.markUsed(iteratorName, iteratorNode.start);
      } else {
      }
      
      // Visit the right side (the object being iterated over)
      this.visit(node.right);
      
      // Visit the loop body (which may create its own block scope)
      this.visit(node.body);
    } else {
      // Fallback to default behavior if scope analysis is disabled
      super.visitForInStatement(node);
    }
    
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

  private inferUloopType(node: AstNode): UloopObjectType | null {
    // Check if this is a call expression that returns a uloop object
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      
      if (callNode.callee.type === 'Identifier') {
        const funcName = (callNode.callee as IdentifierNode).name;
        
        // Map uloop functions to their return types
        switch (funcName) {
          case 'timer':
            return UloopObjectType.ULOOP_TIMER;
          case 'handle':
            return UloopObjectType.ULOOP_HANDLE;
          case 'process':
            return UloopObjectType.ULOOP_PROCESS;
          case 'task':
            return UloopObjectType.ULOOP_TASK;
          case 'interval':
            return UloopObjectType.ULOOP_INTERVAL;
          case 'signal':
            return UloopObjectType.ULOOP_SIGNAL;
          default:
            return null;
        }
      }
      // Handle module member calls like uloop.timer()
      else if (callNode.callee.type === 'MemberExpression') {
        const memberNode = callNode.callee as MemberExpressionNode;
        
        if (memberNode.object.type === 'Identifier') {
          const objectName = (memberNode.object as IdentifierNode).name;
          
          if (objectName === 'uloop' && memberNode.property.type === 'Identifier') {
            const methodName = (memberNode.property as IdentifierNode).name;
            
            switch (methodName) {
              case 'timer':
                return UloopObjectType.ULOOP_TIMER;
              case 'handle':
                return UloopObjectType.ULOOP_HANDLE;
              case 'process':
                return UloopObjectType.ULOOP_PROCESS;
              case 'task':
                return UloopObjectType.ULOOP_TASK;
              case 'interval':
                return UloopObjectType.ULOOP_INTERVAL;
              case 'signal':
                return UloopObjectType.ULOOP_SIGNAL;
              default:
                return null;
            }
          }
        }
      }
    }
    
    return null;
  }

  private inferMethodReturnType(node: AstNode): UcodeDataType | null {
    // Check if this is a call expression on a member expression (method call)
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      
      if (callNode.callee.type === 'MemberExpression') {
        const memberNode = callNode.callee as MemberExpressionNode;
        
        if (memberNode.object.type === 'Identifier' && memberNode.property.type === 'Identifier') {
          const objectName = (memberNode.object as IdentifierNode).name;
          const methodName = (memberNode.property as IdentifierNode).name;
          
          // Look up the object in the symbol table
          const symbol = this.symbolTable.lookup(objectName);
          if (symbol) {
            // Check if this is a uloop object method call
            const uloopType = uloopObjectRegistry.isVariableOfUloopType(symbol.dataType);
            if (uloopType) {
              const method = uloopObjectRegistry.getUloopMethod(uloopType, methodName);
              if (method) {
                // Special handling for methods that return fs objects
                if (method.returnType === 'fs.file | fs.proc | socket.socket') {
                  // Return fs.file type for autocomplete
                  return createFsObjectDataType(FsObjectType.FS_FILE);
                }
              }
            }
          }
        }
      }
    }
    
    return null;
  }

  visitExportNamedDeclaration(node: ExportNamedDeclarationNode): void {
    // For export function declarations like: export function foo() {}
    if (node.declaration) {
      // Visit the actual declaration (function, variable, etc.)
      this.visit(node.declaration);
    }
    
    // Handle export specifiers if present (export { name })
    for (const specifier of node.specifiers) {
      if (this.options.enableScopeAnalysis) {
        // Mark the exported identifier as used
        this.symbolTable.markUsed(specifier.local.name, specifier.local.start);
      }
    }
  }

  visitExportDefaultDeclaration(node: ExportDefaultDeclarationNode): void {
    // For export default declarations like: export default function() {}
    if (node.declaration) {
      // Visit the actual declaration
      this.visit(node.declaration);
    }
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