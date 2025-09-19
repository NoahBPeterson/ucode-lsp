/**
 * Semantic Analyzer for ucode
 * Combines symbol table, type checking, and other semantic analyses
 */

import { AstNode, ProgramNode, VariableDeclarationNode, VariableDeclaratorNode, 
         FunctionDeclarationNode, FunctionExpressionNode, IdentifierNode, CallExpressionNode,
         BlockStatementNode, ReturnStatementNode, BreakStatementNode, 
         ContinueStatementNode, AssignmentExpressionNode, BinaryExpressionNode, ImportDeclarationNode,
         ImportSpecifierNode, ImportDefaultSpecifierNode, ImportNamespaceSpecifierNode,
         PropertyNode, MemberExpressionNode, TryStatementNode, CatchClauseNode,
         ExportNamedDeclarationNode, ExportDefaultDeclarationNode, ArrowFunctionExpressionNode,
         SpreadElementNode, TemplateLiteralNode, SwitchStatementNode } from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, UcodeDataType, createUnionType } from './symbolTable';
import { TypeChecker, TypeCheckResult } from './types';
import { BaseVisitor } from './visitor';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { allBuiltinFunctions } from '../builtins';
import { FileResolver } from './fileResolver';
import { FsObjectType, createFsObjectDataType } from './fsTypes';
import { fsModuleTypeRegistry } from './fsModuleTypes';
import { logTypeRegistry } from './logTypes';
import { mathTypeRegistry } from './mathTypes';
import { nl80211TypeRegistry, Nl80211ObjectType, createNl80211ObjectDataType } from './nl80211Types';
import { rtnlTypeRegistry } from './rtnlTypes';
import { resolvTypeRegistry } from './resolvTypes';
import { socketTypeRegistry } from './socketTypes';
import { structTypeRegistry } from './structTypes';
import { ubusTypeRegistry } from './ubusTypes';
import { uciTypeRegistry, UciObjectType, createUciObjectDataType } from './uciTypes';
import { uloopTypeRegistry, UloopObjectType, createUloopObjectDataType, uloopObjectRegistry } from './uloopTypes';
import { createExceptionObjectDataType } from './exceptionTypes';
import { UcodeErrorCode } from './errorConstants';

export interface SemanticAnalysisOptions {
  enableScopeAnalysis?: boolean;
  enableTypeChecking?: boolean;
  enableControlFlowAnalysis?: boolean;
  enableUnusedVariableDetection?: boolean;
  enableShadowingWarnings?: boolean;
  workspaceRoot?: string | undefined;
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
  private switchScopes: number[] = []; // Track switch statement scope levels
  private currentFunctionNode: FunctionDeclarationNode | null = null;
  private functionReturnTypes = new Map<FunctionDeclarationNode, UcodeType[]>();
  private processingFunctionCallCallee = false; // Track when processing function call callee
  private disabledLines: Set<number> = new Set(); // Track lines with disable comments
  private disabledRanges: Array<{ start: number; end: number }> = []; // Track disabled multi-line ranges
  private linesWithSuppressedDiagnostics: Set<number> = new Set(); // Track lines where diagnostics were suppressed
  private fileResolver: FileResolver;

  constructor(textDocument: TextDocument, options: SemanticAnalysisOptions = {}) {
    super();
    this.textDocument = textDocument;
    this.symbolTable = new SymbolTable();
    this.typeChecker = new TypeChecker(this.symbolTable);
    this.fileResolver = new FileResolver(options.workspaceRoot);
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
    this.typeChecker.resetErrors();
    this.functionScopes = [];
    this.loopScopes = [];
    this.switchScopes = [];
    this.currentFunctionNode = null;
    this.functionReturnTypes.clear();
    this.disabledLines.clear();
    this.disabledRanges = [];
    this.linesWithSuppressedDiagnostics.clear();

    try {
      // Parse disable comments before analysis
      this.parseDisableComments();

      // Visit the AST to perform semantic analysis
      this.visit(ast);

      // Post-analysis checks
      if (this.options.enableUnusedVariableDetection) {
        this.checkUnusedVariables();
      }
      
      // Check for unnecessary disable comments
      this.checkUnnecessaryDisableComments();

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

      // Check for redeclaration and shadowing
      const existingSymbol = this.symbolTable.lookupInCurrentScope(name);
      
      // Check if we have a real redeclaration (same scope, not builtin)
      if (existingSymbol && existingSymbol.type !== SymbolType.BUILTIN) {
        // True redeclaration in same scope - always an error
        this.addDiagnosticErrorCode(
          UcodeErrorCode.VARIABLE_REDECLARATION,
          `Variable '${name}' is already declared in this scope`,
          node.id.start,
          node.id.end,
          DiagnosticSeverity.Error,
        );
      } else {
        // Check for shadowing
        const shadowedSymbol = this.symbolTable.lookup(name);
        
        if (shadowedSymbol && shadowedSymbol.type === SymbolType.BUILTIN) {
          // Shadowing builtin function - show warning but allow it
          this.addDiagnosticErrorCode(
            UcodeErrorCode.SHADOWING_BUILTIN,
            `Variable '${name}' shadows builtin function '${name}()'`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Warning,
          );
        } else if (shadowedSymbol && this.options.enableShadowingWarnings) {
          // Shadowing variable/function from outer scope - show warning
          this.addDiagnosticErrorCode(
            UcodeErrorCode.VARIABLE_SHADOWING,
            `Variable '${name}' shadows ${shadowedSymbol.type} '${name}' from outer scope`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Warning,
          );
        }
        
        // Declare the symbol (allow shadowing builtins)
        this.symbolTable.declare(name, symbolType, dataType, node.id);
      }


      // Process initializer
      if (node.init) {
        this.visit(node.init);

        // Type inference if type checking is enabled
        if (this.options.enableTypeChecking) {
          this.processInitializerTypeInference(node, name);
        }
      }
    } else {
      super.visitVariableDeclarator(node);
    }
  }
       
  visitImportDeclaration(node: ImportDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      const modulePath = node.source.value as string;
      
      // Validate import specifiers against module exports
      for (const specifier of node.specifiers) {
        this.validateAndProcessImportSpecifier(specifier, modulePath);
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
    
    // Create appropriate data type for special imports first
    let dataType: UcodeDataType = UcodeType.UNKNOWN as UcodeDataType;
    
    // Special case: importing 'const' from nl80211 creates a constants object
    if (source === 'nl80211' && importedName === 'const') {
      dataType = {
        type: UcodeType.OBJECT,
        moduleName: 'nl80211-const'
      };
    } else if (source === 'nl80211' && nl80211TypeRegistry.getFunctionNames().includes(importedName)) {
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }
    
    // Special case: importing 'const' from rtnl creates a constants object
    if (source === 'rtnl' && importedName === 'const') {
      dataType = {
        type: UcodeType.OBJECT,
        moduleName: 'rtnl-const'
      };
    }
    
    // Special case: importing rtnl functions - set proper function type  
    if (source === 'rtnl' && rtnlTypeRegistry.getFunctionNames().includes(importedName)) {
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }

    // import { 'const' as rtnlconst } from 'rtnl';
    // How do you handle this?
    // Validate rtnl module imports
    if (source === 'rtnl' && specifier.type === 'ImportSpecifier' && importedName !== 'const') {
      if (!rtnlTypeRegistry.getFunctionNames().includes(importedName)) {
        let exports = (rtnlTypeRegistry.getFunctionNames().concat(rtnlTypeRegistry.getConstantNames())).join(', ');
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the rtnl module. Available exports: ${exports}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error,
        );
        return; // Don't add invalid import to symbol table
      }
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }
    
    // Special case: importing fs functions - set proper function type
    /*if (source === 'fs' && fsModuleTypeRegistry.getFunctionNames().includes(importedName)) {
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }*/

    // Validate fs module imports
    if (source === 'fs' && specifier.type === 'ImportSpecifier') {
      if (!fsModuleTypeRegistry.getFunctionNames().includes(importedName)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the fs module. Available exports: ${fsModuleTypeRegistry.getFunctionNames().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error,
        );
        return; // Don't add invalid import to symbol table
      }
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }
    
    // Validate log module imports
    if (source === 'log' && specifier.type === 'ImportSpecifier') {
      if (!logTypeRegistry.isValidLogImport(importedName)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the log module. Available exports: ${logTypeRegistry.getValidLogImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error,
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate math module imports
    if (source === 'math' && specifier.type === 'ImportSpecifier') {
      if (!mathTypeRegistry.isValidMathImport(importedName)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the math module. Available exports: ${mathTypeRegistry.getValidMathImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate nl80211 module imports
    if (source === 'nl80211' && specifier.type === 'ImportSpecifier' && importedName !== 'const') {
      if (!nl80211TypeRegistry.isValidNl80211Import(importedName)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the resolv module. Available exports: ${resolvTypeRegistry.getValidImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Validate rtnl module imports
    if (source === 'rtnl' && specifier.type === 'ImportSpecifier') {
      if (!rtnlTypeRegistry.isValidRtnlImport(importedName)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the rtnl module. Available exports: ${rtnlTypeRegistry.getValidImports().join(', ')}`,
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `'${importedName}' is not exported by the struct module. Available exports: ${structTypeRegistry.getValidImports().join(', ')}`,
          specifier.imported.start,
          specifier.imported.end,
          DiagnosticSeverity.Error
        );
        return; // Don't add invalid import to symbol table
      }
    }
    
    // Add imported symbol to symbol table
    if (!this.symbolTable.declare(localName, SymbolType.IMPORTED, dataType, specifier.local)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
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

  private validateAndProcessImportSpecifier(specifier: ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode, modulePath: string): void {
    // Try to resolve the module and validate exports
    const resolvedUri = this.fileResolver.resolveImportPath(modulePath, this.textDocument.uri);
    
    if (resolvedUri) {
      const moduleExports = this.fileResolver.getModuleExports(resolvedUri);
      
      if (moduleExports && specifier.type === 'ImportSpecifier') {
        // Validate named import against actual module exports
        const importedName = specifier.imported.name;
        const hasNamedExport = moduleExports.some(exp => exp.type === 'named' && exp.name === importedName);
        
        if (!hasNamedExport) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.EXPORT_NOT_FOUND,
            `Module ${modulePath} does not export '${importedName}'`,
            specifier.imported.start,
            specifier.imported.end,
            DiagnosticSeverity.Error
          );
          return; // Don't process invalid import
        }
      } else if (moduleExports && specifier.type === 'ImportDefaultSpecifier') {
        // Validate default import
        const hasDefaultExport = moduleExports.some(exp => exp.type === 'default');
        
        if (!hasDefaultExport) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.EXPORT_NOT_FOUND,
            `Module ${modulePath} does not have a default export`,
            specifier.local.start,
            specifier.local.end,
            DiagnosticSeverity.Error
          );
          return; // Don't process invalid import
        }
      }
      // Namespace imports (import * as name) are always valid as they import everything
    }
    // If module cannot be resolved, we cannot validate exports, so allow the import
    
    // Process the import (either validation passed or module not resolvable)
    this.processImportSpecifier(specifier, modulePath);
  }

  visitFunctionDeclaration(node: FunctionDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      const name = node.id.name;

      // Declare the function first with an UNKNOWN return type to handle recursion.
      if (!this.symbolTable.declare(name, SymbolType.FUNCTION, UcodeType.FUNCTION as UcodeDataType, node.id)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.FUNCTION_REDECLARATION,
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
      
      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
      }

      // Visit the function body to find all return statements.
      this.visit(node.body);

      // Infer the final return type from all collected return types.
      const returnTypes = this.functionReturnTypes.get(node) || [];
      const inferredReturnType = this.typeChecker.getCommonReturnType(returnTypes);

      // Update the function's symbol with the now-known return type.
      const symbol = this.symbolTable.lookup(name);
      if (symbol) {
        symbol.dataType = UcodeType.FUNCTION;  // Functions should always have type 'function'
        symbol.returnType = inferredReturnType; // Store the actual return type separately
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

      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
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

      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
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
          this.addDiagnosticErrorCode(
            UcodeErrorCode.PARAMETER_REDECLARATION,
            `Parameter '${node.param.name}' is already declared in this scope`,
            node.param.start,
            node.param.end,
            DiagnosticSeverity.Error,
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
      // Guard against empty or invalid identifier names
      if (!node.name || typeof node.name !== 'string' || node.name.trim() === '') {
        return; // Skip processing invalid identifier nodes
      }

      // Check if identifier is defined
      const symbol = this.symbolTable.lookup(node.name);
      if (!symbol) {
        // Check if it's a builtin function before reporting as undefined
        const isBuiltin = allBuiltinFunctions.has(node.name);
        
        // Don't report "Undefined variable" if this identifier is a function call callee
        // The TypeChecker will handle "Undefined function" diagnostic for function calls
        if (!isBuiltin && !this.processingFunctionCallCallee) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.UNDEFINED_VARIABLE,
            `Undefined variable: ${node.name}`,
            node.start,
            node.end,
            DiagnosticSeverity.Error,
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
        // Check if this looks like a module usage without import
        if (this.isKnownModuleName(objectName)) {
          this.addDiagnostic(
            `Cannot use '${objectName}' module without importing it first. Add: import { ${methodName} } from '${objectName}'; or import * as ${objectName} from '${objectName}';`,
            node.object.start,
            node.object.end,
            DiagnosticSeverity.Error
          );
        }
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
          this.addDiagnosticErrorCode(
            UcodeErrorCode.INVALID_IMPORT,
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

private inferImportedFsFunctionReturnType(node: AstNode): UcodeDataType | null {
    // Check if this is a call expression to an imported fs function
    if (node.type === 'CallExpression') {
      const callExpr = node as any; // CallExpressionNode
      if (callExpr.callee && callExpr.callee.type === 'Identifier') {
        const functionName = callExpr.callee.name;
        
        // Look up the function in the symbol table to check if it's an imported fs function
        const symbol = this.symbolTable.lookup(functionName);
        if (symbol && symbol.type === SymbolType.IMPORTED && symbol.importedFrom === 'fs') {
          // Get the function signature from the fs module registry
          const fsFunction = fsModuleTypeRegistry.getFunction(functionName);
          if (fsFunction) {
            return this.parseReturnTypeString(fsFunction.returnType);
          }
        }
      }
    }
    
    return null;
  }

  private inferImportedRtnlFunctionReturnType(node: AstNode): UcodeDataType | null {
    // Check if this is a call expression to an imported rtnl function
    if (node.type === 'CallExpression') {
      const callExpr = node as any; // CallExpressionNode
      if (callExpr.callee && callExpr.callee.type === 'Identifier') {
        const functionName = callExpr.callee.name;
        
        // Look up the function in the symbol table to check if it's an imported rtnl function
        const symbol = this.symbolTable.lookup(functionName);
        if (symbol && symbol.type === SymbolType.IMPORTED && symbol.importedFrom === 'rtnl') {
          // Get the function signature from the rtnl module registry
          const rtnlFunction = rtnlTypeRegistry.getFunction(functionName);
          if (rtnlFunction) {
            return this.parseReturnTypeString(rtnlFunction.returnType);
          }
        }
      }
    }
    
    return null;
  }

  private parseReturnTypeString(returnTypeStr: string): UcodeDataType {
    // Handle union types like "boolean | null"
    if (returnTypeStr.includes(' | ')) {
      const typeStrings = returnTypeStr.split(' | ').map(s => s.trim());
      const types: UcodeType[] = [];
      
      for (const typeStr of typeStrings) {
        switch (typeStr) {
          case 'boolean':
            types.push(UcodeType.BOOLEAN);
            break;
          case 'string':
            types.push(UcodeType.STRING);
            break;
          case 'number':
          case 'integer':
            types.push(UcodeType.INTEGER);
            break;
          case 'double':
            types.push(UcodeType.DOUBLE);
            break;
          case 'object':
            types.push(UcodeType.OBJECT);
            break;
          case 'array':
            types.push(UcodeType.ARRAY);
            break;
          case 'null':
            types.push(UcodeType.NULL);
            break;
          case 'function':
            types.push(UcodeType.FUNCTION);
            break;
          default:
            types.push(UcodeType.UNKNOWN);
            break;
        }
      }
      
      return createUnionType(types);
    }
    
    // Handle single types
    switch (returnTypeStr) {
      case 'boolean':
        return UcodeType.BOOLEAN;
      case 'string':
        return UcodeType.STRING;
      case 'number':
      case 'integer':
        return UcodeType.INTEGER;
      case 'double':
        return UcodeType.DOUBLE;
      case 'object':
        return UcodeType.OBJECT;
      case 'array':
        return UcodeType.ARRAY;
      case 'null':
        return UcodeType.NULL;
      case 'function':
        return UcodeType.FUNCTION;
      default:
        return UcodeType.UNKNOWN;
    }
  }

  private isKnownModuleName(objectName: string): boolean {
    // List of known ucode modules that require import
    const knownModules = new Set([
      'fs',      // File system operations
      'debug',   // Debug and profiling
      'log',     // Logging functions  
      'math',    // Mathematical operations
      'digest',  // Cryptographic hash functions
      'nl80211', // WiFi/802.11 networking
      'resolv',  // DNS resolution
      'socket',  // Network socket operations
      'struct',  // Binary data structure packing
      'ubus',    // OpenWrt unified bus
      'uci',     // OpenWrt unified configuration
      'uloop',   // Event loop operations
      'zlib',    // Data compression
      'rtnl'     // Routing netlink
    ]);
    
    return knownModules.has(objectName);
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

    // Visit the callee with special context to prevent "Undefined variable" for function calls
    this.processingFunctionCallCallee = true;
    this.visit(node.callee);
    this.processingFunctionCallCallee = false;
    
    // Visit arguments normally
    for (const arg of node.arguments) {
      this.visit(arg);
    }
    
    // DON'T call super.visitCallExpression() to avoid double traversal
  }

  visitSpreadElement(node: SpreadElementNode): void {
    // Visit the spread argument to ensure it's properly analyzed
    this.visit(node.argument);
    // No additional analysis needed for spread elements themselves
  }

  visitTemplateLiteral(node: TemplateLiteralNode): void {
    // Visit all embedded expressions in the template literal
    for (const expression of node.expressions) {
      this.visit(expression);
    }
    // Template quasis (the string parts) don't need visiting as they're just text
    // The template literal itself will be typed as string by the type checker
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
        const rtnlFunctionReturnType = this.inferImportedRtnlFunctionReturnType(node.right);
        let dataType: UcodeDataType;
        
        if (fsType) {
          dataType = createFsObjectDataType(fsType);
        } else if (nl80211Type) {
          dataType = createNl80211ObjectDataType(nl80211Type);
        } else if (uloopType) {
          dataType = createUloopObjectDataType(uloopType);
        } else if (rtnlFunctionReturnType) {
          dataType = rtnlFunctionReturnType;
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

  visitBinaryExpression(node: BinaryExpressionNode): void {
    // Continue with default traversal first to ensure child nodes are visited
    super.visitBinaryExpression(node);

    if (this.options.enableTypeChecking) {
      // Type check the binary expression for type warnings
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
  }

  visitReturnStatement(node: ReturnStatementNode): void {
    // Continue with default traversal to ensure argument expression is visited first
    super.visitReturnStatement(node);

    if (this.options.enableControlFlowAnalysis) {
      if (this.currentFunctionNode) {
        // Determine the type of the returned value.
        const returnType = node.argument ? this.typeChecker.checkNode(node.argument) : UcodeType.NULL;
        
        // Store it for later inference.
        this.functionReturnTypes.get(this.currentFunctionNode)?.push(returnType);
      }
    }
  }

  visitBreakStatement(node: BreakStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      // Check if break is inside a loop or switch statement
      if (this.loopScopes.length === 0 && this.switchScopes.length === 0) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.SYNTAX_ERROR,
          'Break statement outside loop or switch',
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.SYNTAX_ERROR,
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
      // Create a new scope for the for-in loop that will contain the iterator variables
      // This scope encompasses the entire loop body
      this.symbolTable.enterScope();
      
      // Handle iterator variables (left side) - for...in loops can have 1 or 2 variables
      // Single variable: for (let item in array) - item gets the value
      // Two variables: for (let i, item in array) - i gets the index, item gets the value
      
      if (node.left && node.left.type === 'Identifier') {
        // Simple case: for (var_name in ...)
        const iteratorName = node.left.name;
        const iteratorNode = node.left;
        
        this.symbolTable.declare(iteratorName, SymbolType.VARIABLE, UcodeType.UNKNOWN as UcodeDataType, iteratorNode);
        this.symbolTable.markUsed(iteratorName, iteratorNode.start);
      } else if (node.left && node.left.type === 'VariableDeclaration' && node.left.declarations.length > 0) {
        // Declaration case: for (let var_name in ...) or for (let i, item in ...)
        const declarations = node.left.declarations;
        
        if (declarations.length === 1) {
          // Single variable: gets the value
          const declarator = declarations[0];
          if (declarator.id && declarator.id.type === 'Identifier') {
            const iteratorName = declarator.id.name;
            const iteratorNode = declarator.id;
            
            this.symbolTable.declare(iteratorName, SymbolType.VARIABLE, UcodeType.UNKNOWN as UcodeDataType, iteratorNode);
            this.symbolTable.markUsed(iteratorName, iteratorNode.start);
          }
        } else if (declarations.length === 2) {
          // Two variables: first gets the index (number), second gets the value
          const indexDeclarator = declarations[0];
          const valueDeclarator = declarations[1];
          
          if (indexDeclarator.id && indexDeclarator.id.type === 'Identifier') {
            const indexName = indexDeclarator.id.name;
            const indexNode = indexDeclarator.id;
            
            // Index variable type depends on what's being iterated over
            // For objects: key is string, for arrays: index is integer, for unknown: unknown
            const rightType = this.typeChecker.checkNode(node.right);
            let keyType: UcodeDataType;
            
            if (rightType === UcodeType.OBJECT) {
              keyType = UcodeType.STRING as UcodeDataType;  // Object keys are strings
            } else if (rightType === UcodeType.ARRAY) {
              keyType = UcodeType.INTEGER as UcodeDataType; // Array indices are integers
            } else {
              keyType = UcodeType.UNKNOWN as UcodeDataType; // Unknown type being iterated
            }
            
            this.symbolTable.declare(indexName, SymbolType.VARIABLE, keyType, indexNode);
            this.symbolTable.markUsed(indexName, indexNode.start);
          }
          
          if (valueDeclarator.id && valueDeclarator.id.type === 'Identifier') {
            const valueName = valueDeclarator.id.name;
            const valueNode = valueDeclarator.id;
            
            // Value variable type depends on the array element type
            this.symbolTable.declare(valueName, SymbolType.VARIABLE, UcodeType.UNKNOWN as UcodeDataType, valueNode);
            this.symbolTable.markUsed(valueName, valueNode.start);
          }
        }
      }
      
      // Visit the right side (the object being iterated over)
      this.visit(node.right);
      
      // Visit the loop body (iterator variables are now in scope)
      this.visit(node.body);
      
      // Exit the for-in loop scope
      this.symbolTable.exitScope();
    } else {
      // Fallback to default behavior if scope analysis is disabled
      super.visitForInStatement(node);
    }
    
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  visitSwitchStatement(node: SwitchStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      // Track that we're entering a switch statement
      this.switchScopes.push(this.symbolTable.getCurrentScope());
    }

    // Continue with default traversal
    super.visitSwitchStatement(node);

    if (this.options.enableControlFlowAnalysis) {
      // Pop the switch scope when exiting
      this.switchScopes.pop();
    }
  }

  private checkUnusedVariables(): void {
    const unusedVariables = this.symbolTable.getUnusedVariables();
    
    // Global VM variables that should not trigger unused warnings
    const globalVMVariables = new Set(['ARGV', 'NaN', 'Infinity', 'REQUIRE_SEARCH_PATH', 'modules', 'global']);
    
    for (const symbol of unusedVariables) {
      // Don't warn about unused parameters, builtins, or global VM variables
      if (symbol.type === SymbolType.PARAMETER || 
          symbol.type === SymbolType.BUILTIN ||
          globalVMVariables.has(symbol.name)) {
        continue;
      }

      this.addDiagnosticErrorCode(
        UcodeErrorCode.UNUSED_VARIABLE,
        `Variable '${symbol.name}' is declared but never used`,
        symbol.node.start,
        symbol.node.end,
        DiagnosticSeverity.Warning,
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

  private inferUciType(node: AstNode): UciObjectType | null {
    // Check if this is a call expression that returns a uci object
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      if (callNode.callee.type === 'Identifier') {
        const funcName = (callNode.callee as IdentifierNode).name;
        
        // Map uci functions to their return types
        switch (funcName) {
          case 'cursor':
            return UciObjectType.UCI_CURSOR;
          default:
            return null;
        }
      }
      // Handle module member calls like uci.cursor()
      else if (callNode.callee.type === 'MemberExpression') {
        const memberNode = callNode.callee as MemberExpressionNode;
        if (memberNode.object.type === 'Identifier' && 
            (memberNode.object as IdentifierNode).name === 'uci' &&
            memberNode.property.type === 'Identifier') {
          const methodName = (memberNode.property as IdentifierNode).name;
          
          switch (methodName) {
            case 'cursor':
              return UciObjectType.UCI_CURSOR;
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

  private inferFunctionCallReturnType(node: AstNode): UcodeDataType | null {
    if (node.type !== 'CallExpression') {
      return null;
    }
    
    const callExpr = node as CallExpressionNode;
    if (callExpr.callee.type !== 'Identifier') {
      return null;
    }
    
    const funcName = (callExpr.callee as IdentifierNode).name;
    const symbol = this.symbolTable.lookup(funcName);
    
    if (symbol && (symbol.type === SymbolType.FUNCTION || symbol.type === SymbolType.IMPORTED)) {
      // Return the raw return type without conversion to preserve unions
      return symbol.returnType || null;
    }
    
    return null;
  }

  private processInitializerTypeInference(node: VariableDeclaratorNode, name: string): void {
    if (!node.init) {
      return;
    }
    
    const symbol = this.symbolTable.lookup(name);
    if (symbol) {
      // Check if this is an fs function call and assign the appropriate fs type
      const fsType = this.inferFsType(node.init!);
      if (fsType) {
        const dataType = createFsObjectDataType(fsType);
        symbol.dataType = dataType;
        // For fs object variables, also force declaration in global scope to ensure completion access
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        return;
      }

      // Check if this is an nl80211 function call and assign the appropriate nl80211 type
      const nl80211Type = this.inferNl80211Type(node.init!);
      if (nl80211Type) {
        const dataType = createNl80211ObjectDataType(nl80211Type);
        symbol.dataType = dataType;
        // For nl80211 object variables, also force declaration in global scope to ensure completion access
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        return;
      }

      // Check if this is a uloop function call and assign the appropriate uloop type
      const uloopType = this.inferUloopType(node.init!);
      if (uloopType) {
        const dataType = createUloopObjectDataType(uloopType);
        symbol.dataType = dataType;
        // For uloop object variables, also force declaration in global scope to ensure completion access
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        return;
      }

      // Check if this is a uci function call and assign the appropriate uci type
      const uciType = this.inferUciType(node.init!);
      if (uciType) {
        const dataType = createUciObjectDataType(uciType);
        symbol.dataType = dataType;
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        return;
      }

      // Check if this is an imported fs function call and assign the proper union return type
      const importedFsReturnType = this.inferImportedFsFunctionReturnType(node.init!);
      if (importedFsReturnType) {
        symbol.dataType = importedFsReturnType;
        return;
      }

      // Check if this is a function call and preserve the return type (including unions)
      const functionReturnType = this.inferFunctionCallReturnType(node.init!);
      if (functionReturnType) {
        symbol.dataType = functionReturnType;
        return;
      }

      // Don't overwrite module types that were set during declaration
      if (symbol.type !== SymbolType.MODULE) {
        // For non-function calls, fall back to type checker result
        const initType = this.typeChecker.checkNode(node.init);
        symbol.dataType = initType as UcodeDataType;
        // Debug logging for arrow function variables
        if (node.init.type === 'ArrowFunctionExpression') {
          // Function type detected
        }
      }
    }
  }

  visitExportNamedDeclaration(node: ExportNamedDeclarationNode): void {
    // For export function declarations like: export function foo() {}
    if (node.declaration) {
      // Visit the actual declaration (function, variable, etc.)
      this.visit(node.declaration);
      
      // Mark the exported declaration as used to prevent unused variable warnings
      if (this.options.enableScopeAnalysis) {
        if (node.declaration.type === 'FunctionDeclaration') {
          const funcDecl = node.declaration as FunctionDeclarationNode;
          if (funcDecl.id) {
            this.symbolTable.markUsed(funcDecl.id.name, funcDecl.id.start);
          }
        } else if (node.declaration.type === 'VariableDeclaration') {
          const varDecl = node.declaration as VariableDeclarationNode;
          for (const declarator of varDecl.declarations) {
            if (declarator.id.type === 'Identifier') {
              const id = declarator.id as IdentifierNode;
              this.symbolTable.markUsed(id.name, id.start);
            }
          }
        }
      }
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
      
      // Mark the exported declaration as used to prevent unused variable warnings
      if (this.options.enableScopeAnalysis) {
        if (node.declaration.type === 'FunctionDeclaration') {
          const funcDecl = node.declaration as FunctionDeclarationNode;
          if (funcDecl.id) {
            this.symbolTable.markUsed(funcDecl.id.name, funcDecl.id.start);
          }
        } else if (node.declaration.type === 'Identifier') {
          // export default myVariable;
          const id = node.declaration as IdentifierNode;
          this.symbolTable.markUsed(id.name, id.start);
        }
      }
    }
  }

  private addDiagnosticErrorCode(
    errorCode: UcodeErrorCode,
    message: string,
    start: number, 
    end: number, 
    severity: DiagnosticSeverity
  ): void {
    // Check if diagnostic should be converted to lower severity by disable comment
    if (this.shouldReduceSeverity(start, end)) {
      // Convert errors to warnings, warnings to information
      if (severity === DiagnosticSeverity.Error) {
        severity = DiagnosticSeverity.Warning;
        // Track that this line had an error that was suppressed
        const startPos = this.textDocument.positionAt(start);
        this.linesWithSuppressedDiagnostics.add(startPos.line);
      } else if (severity === DiagnosticSeverity.Warning) {
        severity = DiagnosticSeverity.Information;
        // Track that this line had a warning that was suppressed
        const startPos = this.textDocument.positionAt(start);
        this.linesWithSuppressedDiagnostics.add(startPos.line);
      }
    }

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
      const diagnostic: Diagnostic = {
        severity: severity,
        range: {
          start: startPos,
          end: endPos
        },
        message,
        source: 'ucode-semantic'
      };

      // Add error code if available
      if (errorCode) {
        diagnostic.code = errorCode;
      }

      this.diagnostics.push(diagnostic);
    }
  }

private addDiagnostic(
    message: string, 
    start: number, 
    end: number, 
    severity?: DiagnosticSeverity
  ): void {
    let finalSeverity: DiagnosticSeverity = severity || DiagnosticSeverity.Error;

    // Check if diagnostic should be converted to lower severity by disable comment
    if (this.shouldReduceSeverity(start, end)) {
      // Convert errors to warnings, warnings to information
      if (finalSeverity === DiagnosticSeverity.Error) {
        finalSeverity = DiagnosticSeverity.Warning;
        // Track that this line had an error that was suppressed
        const startPos = this.textDocument.positionAt(start);
        this.linesWithSuppressedDiagnostics.add(startPos.line);
      } else if (finalSeverity === DiagnosticSeverity.Warning) {
        finalSeverity = DiagnosticSeverity.Information;
        // Track that this line had a warning that was suppressed
        const startPos = this.textDocument.positionAt(start);
        this.linesWithSuppressedDiagnostics.add(startPos.line);
      }
    }

    // Check for duplicate diagnostics to prevent multiple identical errors
    const startPos = this.textDocument.positionAt(start);
    const endPos = this.textDocument.positionAt(end);
    
    const isDuplicate = this.diagnostics.some(existing => 
      existing.message === message &&
      existing.severity === finalSeverity &&
      existing.range.start.line === startPos.line &&
      existing.range.start.character === startPos.character &&
      existing.range.end.line === endPos.line &&
      existing.range.end.character === endPos.character
    );
    
    if (!isDuplicate) {
      const diagnostic: Diagnostic = {
        severity: finalSeverity,
        range: {
          start: startPos,
          end: endPos
        },
        message,
        source: 'ucode-semantic'
      };

      this.diagnostics.push(diagnostic);
    }
  }

  /**
   * Parse disable comments from the document
   */
  private parseDisableComments(): void {
    const text = this.textDocument.getText();
    const lines = text.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      // Check if line contains "// ucode-lsp disable" comment
      if (line && line.includes('// ucode-lsp disable')) {
        this.disabledLines.add(lineIndex);
        
        // For multi-line statements, we need to find the statement boundaries
        // This is a simplified approach - look for statements that start on this line
        // and extend to multiple lines (like function calls with multiple arguments)
        const statementEnd = this.findStatementEnd(text, lineIndex);
        
        if (statementEnd > lineIndex) {
          this.disabledRanges.push({
            start: lineIndex,
            end: statementEnd
          });
        }
      }
    }
  }

  /**
   * Find the end line of a multi-line statement starting at the given line
   */
  private findStatementEnd(text: string, startLine: number): number {
    let braceDepth = 0;
    let parenDepth = 0;
    let currentLine = startLine;
    
    // Get the line with the disable comment
    const lines = text.split(/\r?\n/);
    const commentLine = lines[startLine];
    
    if (!commentLine) {
      return startLine;
    }
    
    // Look for opening braces or parentheses on the comment line
    for (const char of commentLine) {
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      if (char === '{') braceDepth++;
      if (char === '}') braceDepth--;
    }
    
    // If we have unclosed parentheses or braces, find where they close
    if (parenDepth > 0 || braceDepth > 0) {
      for (let i = startLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        
        for (const char of line) {
          if (char === '(') parenDepth++;
          if (char === ')') parenDepth--;
          if (char === '{') braceDepth++;
          if (char === '}') braceDepth--;
        }
        
        currentLine = i;
        
        // If all parentheses and braces are closed, we found the end
        if (parenDepth <= 0 && braceDepth <= 0) {
          break;
        }
      }
    }
    
    return currentLine;
  }

  /**
   * Check if a diagnostic should be converted to lower severity based on disable comments
   */
  private shouldReduceSeverity(start: number, end: number): boolean {
    const startPos = this.textDocument.positionAt(start);
    const endPos = this.textDocument.positionAt(end);
    
    // Check if the diagnostic is on a disabled line
    if (this.disabledLines.has(startPos.line)) {
      return true;
    }
    
    // Check if the diagnostic is within a disabled range
    for (const range of this.disabledRanges) {
      if (startPos.line >= range.start && endPos.line <= range.end) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check for disable comments that don't suppress any diagnostics
   */
  private checkUnnecessaryDisableComments(): void {
    for (const lineNumber of this.disabledLines) {
      // If this line has a disable comment but no diagnostics were suppressed on it
      if (!this.linesWithSuppressedDiagnostics.has(lineNumber)) {
        const lineText = this.textDocument.getText({
          start: { line: lineNumber, character: 0 },
          end: { line: lineNumber + 1, character: 0 }
        }).replace(/\r?\n$/, ''); // Remove trailing newline

        // Find the position of the disable comment
        const commentIndex = lineText.indexOf('// ucode-lsp disable');
        if (commentIndex >= 0) {
          const start = this.textDocument.offsetAt({ line: lineNumber, character: commentIndex });
          const end = this.textDocument.offsetAt({ line: lineNumber, character: commentIndex + '// ucode-lsp disable'.length });

          this.addDiagnostic(
            'No diagnostic disabled by this comment',
            start,
            end,
            DiagnosticSeverity.Error
          );
        }
      }
    }
  }
}