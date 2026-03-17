/**
 * Semantic Analyzer for ucode
 * Combines symbol table, type checking, and other semantic analyses
 */

import { AstNode, ProgramNode, VariableDeclarationNode, VariableDeclaratorNode, 
         FunctionDeclarationNode, FunctionExpressionNode, IdentifierNode, CallExpressionNode,
         BlockStatementNode, ReturnStatementNode, BreakStatementNode, 
         ContinueStatementNode, AssignmentExpressionNode, BinaryExpressionNode, UnaryExpressionNode, LogicalExpressionNode, ImportDeclarationNode,
         ImportSpecifierNode, ImportDefaultSpecifierNode, ImportNamespaceSpecifierNode,
         PropertyNode, MemberExpressionNode, TryStatementNode, CatchClauseNode,
         ExportNamedDeclarationNode, ExportDefaultDeclarationNode, ArrowFunctionExpressionNode,
         SpreadElementNode, TemplateLiteralNode, SwitchStatementNode, LiteralNode, IfStatementNode, ObjectExpressionNode, ConditionalExpressionNode } from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, UcodeDataType, createUnionType, isArrayType, getArrayElementType, type Symbol as SymbolEntry } from './symbolTable';
import { TypeChecker, TypeCheckResult } from './types';
import { BaseVisitor } from './visitor';
import { Diagnostic, DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { allBuiltinFunctions } from '../builtins';
import { FileResolver } from './fileResolver';
import { CFGBuilder } from './cfg/cfgBuilder';
import { DataFlowAnalyzer } from './cfg/dataFlowAnalyzer';
import { CFGQueryEngine } from './cfg/queryEngine';
import { type ControlFlowGraph } from './cfg/types';
import { FsObjectType, createFsObjectDataType } from './fsTypes';
import { fsModuleTypeRegistry, fsConstants, getFsReturnObjectType } from './fsModuleTypes';
import { Nl80211ObjectType, createNl80211ObjectDataType } from './nl80211Types';
import { nl80211TypeRegistry } from './nl80211Types';
import { rtnlTypeRegistry } from './rtnlTypes';
import { UciObjectType, createUciObjectDataType } from './uciTypes';
import { UloopObjectType, createUloopObjectDataType, uloopObjectRegistry } from './uloopTypes';
import { createExceptionObjectDataType } from './exceptionTypes';
import { UcodeErrorCode } from './errorConstants';
import { parseJsDocComment, resolveTypeExpression, parseImportTypeExpression, extractTypedef, type ParsedTypedef } from './jsdocParser';
import { JsDocCommentNode } from '../ast/nodes';
import { IoObjectType, createIoHandleDataType } from './ioTypes';
import { Either, Option } from 'effect';
import { MODULE_REGISTRIES, OBJECT_REGISTRIES, isKnownModule, isKnownObjectType, resolveReturnObjectType, validateImport } from './moduleDispatch';

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
  typeChecker?: TypeChecker;
  ast?: ProgramNode;
  cfg?: ControlFlowGraph;
  cfgQueryEngine?: CFGQueryEngine;
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
  private commonjsImports: Map<string, { importedFrom: string; importSpecifier: string }> = new Map();
  private currentFunctionNode: FunctionDeclarationNode | null = null;
  private functionReturnTypes = new Map<FunctionDeclarationNode, { node: ReturnStatementNode, type: UcodeType }[]>();
  private functionReturnPropertyTypes = new Map<FunctionDeclarationNode, Map<string, UcodeDataType>[]>();
  private processingFunctionCallCallee = false; // Track when processing function call callee
  private cfg: ControlFlowGraph | null = null;
  private cfgQueryEngine: CFGQueryEngine | null = null;
  private readonly moduleFunctionProviders: Record<string, () => string[]> = Object.fromEntries(
    Object.entries(MODULE_REGISTRIES).map(([name, reg]) => [name, () => reg.getFunctionNames()])
  );
  private disabledLines: Set<number> = new Set(); // Track lines with disable comments
  private disabledRanges: Array<{ start: number; end: number }> = []; // Track disabled multi-line ranges
  private linesWithSuppressedDiagnostics: Set<number> = new Set(); // Track lines where diagnostics were suppressed
  private assignmentLeftDepth = 0;
  private fileResolver: FileResolver;
  private currentASTRoot: ProgramNode | null = null;
  private thisPropertyStack: Map<string, UcodeDataType>[] = []; // Track `this` context for object method property types
  private truthinessDepth = 0; // Track when we're inside a truthiness context (if test, !, ternary test)
  private callbackElementType: UcodeDataType | null = null; // Element type to pass to callback parameters (filter/map/sort)
  private typedefRegistry: Map<string, ParsedTypedef> = new Map(); // File-level @typedef definitions
  private strictMode = false; // Whether 'use strict'; is present

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
    this.functionReturnPropertyTypes.clear();
    this.disabledLines.clear();
    this.disabledRanges = [];
    this.linesWithSuppressedDiagnostics.clear();

    // Store the AST root for later reference
    if (ast.type === 'Program') {
      this.currentASTRoot = ast as ProgramNode;
      // Pass the AST to TypeChecker for direct analysis
      this.typeChecker.setAST(this.currentASTRoot);
      // Detect 'use strict'; directive
      this.strictMode = this.detectStrictMode(this.currentASTRoot);
    }

    try {
      // Parse disable comments before analysis
      this.parseDisableComments();

      // Scan JSDoc comments for @typedef definitions
      this.scanTypedefs();

      // Visit the AST to perform semantic analysis
      this.visit(ast);

      // CFG-based data flow analysis (if enabled)
      if (this.options.enableControlFlowAnalysis && this.currentASTRoot) {
        try {
          // Build the Control Flow Graph
          const cfgBuilder = new CFGBuilder('top-level');
          this.cfg = cfgBuilder.build(this.currentASTRoot);

          // Run data flow analysis on the CFG
          const dataFlowAnalyzer = new DataFlowAnalyzer(
            this.cfg,
            this.symbolTable,
            this.textDocument.getText()
          );
          const dfResult = dataFlowAnalyzer.analyze();

          // Create query engine for LSP features to use
          this.cfgQueryEngine = new CFGQueryEngine(
            this.cfg,
            cfgBuilder.getNodeToBlockMap()
          );

          // Pass CFG query engine to TypeChecker for flow-sensitive type checking
          if (this.typeChecker) {
            this.typeChecker.setCFGQueryEngine(this.cfgQueryEngine);
          }

          // Filter out false "Undefined function" errors for variables with unknown type from CFG
          this.filterUndefinedFunctionErrorsWithCFG();

          // Detect unreachable code
          this.detectUnreachableCode();

          // Log CFG analysis result for debugging
          if (!dfResult.converged) {
            console.warn(`CFG analysis did not converge after ${dfResult.iterations} iterations`);
          }
        } catch (cfgError) {
          // CFG analysis is best-effort; don't fail the whole analysis if it errors
          console.error('CFG analysis error:', cfgError);
          this.cfg = null;
          this.cfgQueryEngine = null;
          if (this.typeChecker) {
            this.typeChecker.setCFGQueryEngine(null);
          }
        }
      }

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

    // Post-process diagnostics to apply flow-sensitive narrowing
    this.diagnostics = this.filterDiagnosticsWithFlowSensitiveAnalysis(this.diagnostics);

    const result: SemanticAnalysisResult = {
      diagnostics: this.diagnostics,
      symbolTable: this.symbolTable,
      typeResults: new Map(), // TODO: Implement type result tracking
      typeChecker: this.typeChecker
    };

    if (this.currentASTRoot) {
      result.ast = this.currentASTRoot;
    }

    if (this.cfg) {
      result.cfg = this.cfg;
    }

    if (this.cfgQueryEngine) {
      result.cfgQueryEngine = this.cfgQueryEngine;
    }

    return result;
  }

  visitProgram(node: ProgramNode): void {
    // Hoist top-level function declarations so forward references resolve
    this.hoistFunctionDeclarations(node);
    // Global scope analysis
    super.visitProgram(node);
  }

  /**
   * Pre-register all top-level function declarations in the symbol table
   * so that forward references (calling a function before its declaration) work.
   */
  private hoistFunctionDeclarations(node: ProgramNode): void {
    if (!this.options.enableScopeAnalysis) return;
    for (const stmt of node.body) {
      if (stmt.type === 'FunctionDeclaration') {
        const funcNode = stmt as FunctionDeclarationNode;
        if (funcNode.id && funcNode.id.name) {
          // Use a synthetic node with start=0 so lookupAtPosition sees the
          // hoisted symbol as declared before any forward reference.
          const hoistedNode = { ...funcNode.id, start: 0 };
          this.symbolTable.declare(funcNode.id.name, SymbolType.FUNCTION, UcodeType.FUNCTION as UcodeDataType, hoistedNode);
        }
      }
    }
  }

  visitVariableDeclaration(node: VariableDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      // Propagate JSDoc from variable declaration to function init expressions
      if (node.leadingJsDoc && node.declarations.length === 1) {
        const init = node.declarations[0]?.init;
        if (init) {
          if (init.type === 'FunctionExpression' && !(init as FunctionExpressionNode).leadingJsDoc) {
            (init as FunctionExpressionNode).leadingJsDoc = node.leadingJsDoc;
          } else if (init.type === 'ArrowFunctionExpression' && !(init as ArrowFunctionExpressionNode).leadingJsDoc) {
            (init as ArrowFunctionExpressionNode).leadingJsDoc = node.leadingJsDoc;
          }
        }
      }
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

      // SSA-style immediate type inference for literals to prevent later assignments from affecting initial type
      if (node.init) {
        switch (node.init.type) {
          case 'ArrayExpression':
            dataType = UcodeType.ARRAY as UcodeDataType;
            break;
          case 'ObjectExpression':
            dataType = UcodeType.OBJECT as UcodeDataType;
            break;
          case 'Literal':
            const literal = node.init as any;
            if (literal.literalType === 'regexp') {
              dataType = UcodeType.REGEX as UcodeDataType;
            } else if (typeof literal.value === 'string') {
              dataType = UcodeType.STRING as UcodeDataType;
            } else if (typeof literal.value === 'number') {
              // Check if it's an integer or double
              dataType = Number.isInteger(literal.value) ? UcodeType.INTEGER as UcodeDataType : UcodeType.DOUBLE as UcodeDataType;
            } else if (typeof literal.value === 'boolean') {
              dataType = UcodeType.BOOLEAN as UcodeDataType;
            } else if (literal.value === null) {
              dataType = UcodeType.NULL as UcodeDataType;
            }
            break;
        }
      }

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
              if (isKnownModule(moduleName)) {
                symbolType = SymbolType.MODULE;
                dataType = { type: UcodeType.OBJECT, moduleName };
              } else if (moduleName.startsWith('./') || moduleName.startsWith('../') || moduleName.startsWith('/')) {
                // Handle file path requires similar to ES6 imports
                const resolvedUri = this.fileResolver.resolveImportPath(moduleName, this.textDocument.uri);
                if (resolvedUri) {
                  symbolType = SymbolType.IMPORTED;
                  dataType = {
                    type: UcodeType.OBJECT,
                    isDefaultImport: true  // CommonJS require gets the default export
                  };

                  // Store the import info to be added after declaration
                  this.commonjsImports.set(name, {
                    importedFrom: this.normalizeImportedFrom(moduleName, resolvedUri),
                    importSpecifier: 'default'
                  });
                }
              } else if (this.isDotNotationModule(moduleName)) {
                // Convert dot notation to file path: 'u1905.u1905d.src.u1905.log' -> './u1905/u1905d/src/u1905/log.uc'
                const filePath = this.convertDotNotationToPath(moduleName);
                const resolvedUri = this.fileResolver.resolveImportPath(filePath, this.textDocument.uri);
                if (resolvedUri) {
                  symbolType = SymbolType.IMPORTED;
                  dataType = {
                    type: UcodeType.OBJECT,
                    isDefaultImport: true  // CommonJS require gets the default export
                  };

                  // Store the import info to be added after declaration
                  this.commonjsImports.set(name, {
                    importedFrom: this.normalizeImportedFrom(filePath, resolvedUri),
                    importSpecifier: 'default'
                  });
                }
              }
            }
          }
        }
      }

      // Handle || require('module') pattern (e.g., let _fs = fs_mod || require('fs'))
      // Parser emits BinaryExpression for || and ??, not LogicalExpression
      if (node.init && node.init.type === 'BinaryExpression') {
        const binary = node.init as BinaryExpressionNode;
        if (binary.operator === '||' || binary.operator === '??') {
          const requireCall = binary.right;
          if (requireCall && requireCall.type === 'CallExpression') {
            const call = requireCall as CallExpressionNode;
            if (call.callee?.type === 'Identifier' && (call.callee as IdentifierNode).name === 'require' &&
                call.arguments?.length === 1) {
              const arg = call.arguments[0];
              if (arg && arg.type === 'Literal' && typeof (arg as LiteralNode).value === 'string') {
                const moduleName = (arg as LiteralNode).value as string;
                if (isKnownModule(moduleName)) {
                  symbolType = SymbolType.MODULE;
                  dataType = { type: UcodeType.OBJECT, moduleName };
                }
              }
            }
          }
        }
      }

      // Handle member expression assignments (e.g., const logger = logs.default)
      if (node.init && node.init.type === 'MemberExpression') {
        const memberExpr = node.init as any; // MemberExpressionNode
        if (memberExpr.object && memberExpr.object.type === 'Identifier') {
          const objectName = memberExpr.object.name;
          const sourceSymbol = this.symbolTable.lookup(objectName);
          
          if (sourceSymbol && sourceSymbol.type === SymbolType.IMPORTED && 
              sourceSymbol.dataType && typeof sourceSymbol.dataType === 'object' && 
              'isDefaultImport' in sourceSymbol.dataType && sourceSymbol.dataType.isDefaultImport) {
            
            // Check if accessing 'default' property
            if (memberExpr.property && memberExpr.property.type === 'Identifier' && 
                memberExpr.property.name === 'default') {
              
              // Propagate the import information to the new variable
              symbolType = SymbolType.IMPORTED;
              dataType = {
                type: UcodeType.OBJECT,
                isDefaultImport: true
              };
              
              // Store the import info for the new variable
              this.commonjsImports.set(name, {
                importedFrom: sourceSymbol.importedFrom!,
                importSpecifier: 'default'
              });
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
        this.symbolTable.declare(name, symbolType, dataType, node.id, node.init || undefined);

        const declaredSymbol = this.symbolTable.lookup(name);
        if (declaredSymbol && node.init && this.isLiteralType(dataType, node.init)) {
          declaredSymbol.initialLiteralType = dataType;
        }
        if (declaredSymbol) {
          this.setDeclarationTypeIfUnset(declaredSymbol, dataType);
        }
        
        // Add import information if this is a CommonJS require
        const commonjsImport = this.commonjsImports.get(name);
        if (commonjsImport) {
          const symbol = this.symbolTable.lookup(name);
          if (symbol) {
            symbol.importedFrom = commonjsImport.importedFrom;
            symbol.importSpecifier = commonjsImport.importSpecifier;
          }
          this.commonjsImports.delete(name); // Clean up
        }
      }


      // Process initializer
      if (node.init) {
        this.visit(node.init);

        // Type inference if type checking is enabled
        if (this.options.enableTypeChecking) {
          this.processInitializerTypeInference(node, name);
        }

        // Upgrade array literal type to ArrayType if element type can be inferred
        if (node.init.type === 'ArrayExpression') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            // Trigger type checker to infer element types and set _fullType
            this.typeChecker.checkNode(node.init);
            const fullType = (node.init as any)._fullType;
            if (fullType && isArrayType(fullType)) {
              sym.dataType = fullType;
              sym.initialLiteralType = fullType;
            }
          }
        }

        // Upgrade symbol type from function call results that have rich _fullType
        // (e.g., split() → array<string>, reverse([1,2]) → array<integer>, pop(arr) → element type)
        if (node.init.type === 'CallExpression' || node.init.type === 'MemberExpression') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            // Trigger type checker to process narrowedReturnType and set _fullType
            this.typeChecker.checkNode(node.init);
            const fullType = (node.init as any)._fullType;
            if (fullType && typeof fullType === 'object') {
              sym.dataType = fullType;
            }
          }
        }

        // When initializer is an identifier, check if it has a narrowed type at this position
        // (e.g., after equality guard: if (readfile != rf) return; let d = readfile;)
        if (node.init.type === 'Identifier') {
          const sym = this.symbolTable.lookup(name);
          if (sym && sym.dataType === UcodeType.UNKNOWN) {
            const initName = (node.init as IdentifierNode).name;
            const narrowedType = this.typeChecker.getNarrowedTypeAtPosition(initName, node.init.start);
            if (narrowedType && narrowedType !== UcodeType.UNKNOWN) {
              sym.dataType = narrowedType;
              // Also propagate import info from the equality source for richer hover
              const eqSymbol = this.typeChecker.getEqualityNarrowSymbolAtPosition(initName, node.init.start);
              if (eqSymbol?.importedFrom) {
                sym.importedFrom = eqSymbol.importedFrom;
                if (eqSymbol.importSpecifier) {
                  sym.importSpecifier = eqSymbol.importSpecifier;
                }
                sym.type = SymbolType.IMPORTED;
              }
            }
          }
        }

        // Case 1: Populate propertyTypes from object literal at declaration
        if (node.init.type === 'ObjectExpression') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            const propTypes = this.inferObjectLiteralPropertyTypes(node.init as ObjectExpressionNode);
            if (propTypes) sym.propertyTypes = propTypes;
          }
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
        this.validateAndProcessImportSpecifier(specifier, modulePath, node.source);
      }
    }

    // DON'T call super.visitImportDeclaration(node) here!
    // The base class visits specifiers and their local identifiers, which would mark
    // them as "used" immediately, preventing unused import warnings.
    // validateAndProcessImportSpecifier already declares the imports in the symbol table.
  }

  visitImportSpecifier(_node: ImportSpecifierNode): void {
    // Don't visit the local identifier here - it's already declared in the symbol table
    // by processImportSpecifier. Visiting it would mark it as "used" immediately,
    // preventing unused import warnings.
    // We also don't visit the imported identifier to prevent "undefined variable" errors
    // for the original name in aliased imports (e.g., import { foo as bar })
  }

  visitProperty(node: PropertyNode): void {
    // Only visit computed property keys (obj[key]), not literal keys (obj.key)
    if (node.computed) {
      this.visit(node.key);
    }
    // Always visit the property value
    this.visit(node.value);
  }

  private processImportSpecifier(specifier: ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode, source: string, defaultIsFunction: boolean = false, resolvedUri?: string | null): void {
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

    // Mark default imports explicitly
    if (specifier.type === 'ImportDefaultSpecifier') {
      if (defaultIsFunction) {
        dataType = UcodeType.FUNCTION as UcodeDataType;
      } else {
        dataType = {
          type: UcodeType.OBJECT,
          isDefaultImport: true
        };
      }
    }

    if (specifier.type === 'ImportNamespaceSpecifier') {
      dataType = {
        type: UcodeType.OBJECT,
        moduleName: source
      };
    }
    
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
    // Set function data type for rtnl imported functions
    if (source === 'rtnl' && MODULE_REGISTRIES.rtnl.getFunctionNames().includes(importedName)) {
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }

    // Set function data type for fs imported functions
    if (source === 'fs' && MODULE_REGISTRIES.fs.getFunctionNames().includes(importedName)) {
      dataType = UcodeType.FUNCTION as UcodeDataType;
    }

    // Validate imports from known modules (skips debug/digest/io/zlib which allow any import)
    if (isKnownModule(source) && specifier.type === 'ImportSpecifier') {
      // nl80211/rtnl allow 'const' as a special bulk import — skip validation for it
      if ((source === 'nl80211' || source === 'rtnl') && importedName === 'const') {
        // 'const' import is always valid
      } else {
        const result = validateImport(source, importedName);
        if (Either.isLeft(result)) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.EXPORT_NOT_FOUND,
            result.left,
            specifier.imported.start,
            specifier.imported.end,
            DiagnosticSeverity.Error
          );
          return; // Don't add invalid import to symbol table
        }
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
        // Convert dot notation to file path if needed, then resolve to URI
        let actualModulePath = source;
        if (this.isDotNotationModule(source)) {
          actualModulePath = this.convertDotNotationToPath(source);
        }

        const effectiveUri = resolvedUri || this.fileResolver.resolveImportPath(actualModulePath, this.textDocument.uri);
        symbol.importedFrom = this.normalizeImportedFrom(source, effectiveUri);
        symbol.importSpecifier = importedName;

        // Populate propertyTypes for object default imports (not function)
        if (specifier.type === 'ImportDefaultSpecifier' && !defaultIsFunction && effectiveUri && effectiveUri.startsWith('file://')) {
          const exportInfo = this.fileResolver.getDefaultExportPropertyTypes(effectiveUri);
          if (exportInfo) {
            symbol.propertyTypes = exportInfo.propertyTypes;
            if (exportInfo.nestedPropertyTypes) {
              symbol.nestedPropertyTypes = exportInfo.nestedPropertyTypes;
            }
            // Populate return types for function-valued properties (e.g., sh.exec() → string)
            if (exportInfo.functionReturnTypes) {
              const pfrt = new Map<string, string>();
              for (const [name, retType] of exportInfo.functionReturnTypes) {
                pfrt.set(name, typeof retType === 'string' ? retType : 'unknown');
              }
              if (pfrt.size > 0) {
                symbol.propertyFunctionReturnTypes = pfrt;
              }
            }
          }
        }

        // Populate returnType and returnPropertyTypes for function default imports
        if (specifier.type === 'ImportDefaultSpecifier' && defaultIsFunction && effectiveUri && effectiveUri.startsWith('file://')) {
          const returnInfo = this.fileResolver.getDefaultExportFunctionReturnInfo(effectiveUri);
          if (returnInfo) {
            symbol.returnType = returnInfo.returnType;
            symbol.returnPropertyTypes = returnInfo.returnPropertyTypes;
            if (returnInfo.propertyFunctionReturnTypes) {
              symbol.propertyFunctionReturnTypes = returnInfo.propertyFunctionReturnTypes;
            }
          }
        }
      }
    }
  }

  private validateAndProcessImportSpecifier(
    specifier: ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode,
    modulePath: string,
    sourceNode: AstNode
  ): void {
    // Check if this is a built-in module - skip file resolution for these
    const isBuiltinModule = isKnownModule(modulePath);

    if (isBuiltinModule) {
      // Builtin C modules don't have default exports — only named and namespace imports are valid
      if (specifier.type === 'ImportDefaultSpecifier') {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.EXPORT_NOT_FOUND,
          `Builtin module '${modulePath}' does not have a default export. Use: import * as ${specifier.local.name} from '${modulePath}'; or import { ... } from '${modulePath}';`,
          specifier.local.start,
          specifier.local.start + specifier.local.name.length - 1,
          DiagnosticSeverity.Error
        );
        return;
      }
      this.processImportSpecifier(specifier, modulePath);
      return;
    }

    // Convert dot notation to file path if needed
    let actualModulePath = modulePath;
    if (this.isDotNotationModule(modulePath)) {
      actualModulePath = this.convertDotNotationToPath(modulePath);
    }

    // Try to resolve the module and validate exports
    const resolvedUri = this.fileResolver.resolveImportPath(actualModulePath, this.textDocument.uri);

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

      // For default imports, check if the exported value is a function
      let defaultIsFunction = false;
      if (specifier.type === 'ImportDefaultSpecifier' && moduleExports) {
        const defaultExport = moduleExports.find(exp => exp.type === 'default');
        if (defaultExport) {
          defaultIsFunction = defaultExport.isFunction;
        }
      }

      // Process the import since the module was found
      this.processImportSpecifier(specifier, modulePath, defaultIsFunction, resolvedUri);
    } else {
      // Module cannot be resolved - add a warning on the source path, not the imported identifier
      this.addDiagnosticErrorCode(
        UcodeErrorCode.MODULE_NOT_FOUND,
        `Cannot find module '${modulePath}'`,
        sourceNode.start,
        sourceNode.end,
        DiagnosticSeverity.Warning
      );

      // Still process the import to avoid cascading errors
      this.processImportSpecifier(specifier, modulePath);
    }
  }

  private normalizeImportedFrom(source: string, resolvedUri: string | null): string {
    if (resolvedUri && resolvedUri.startsWith('builtin://')) {
      return source;
    }
    return resolvedUri || source;
  }

  private applyJsDocToParams(
    jsDocNode: JsDocCommentNode | undefined,
    params: IdentifierNode[]
  ): void {
    if (!jsDocNode) {
      // No JSDoc — declare all params as UNKNOWN
      for (const param of params) {
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, UcodeType.UNKNOWN as UcodeDataType, param);
      }
      return;
    }

    const parsed = parseJsDocComment(jsDocNode.value);
    const paramTags = parsed.tags.filter(t => t.tag === 'param');

    // Build map of JSDoc param names to their resolved info
    interface JsDocParamInfo {
      type: UcodeDataType;
      description?: string | undefined;
      propertyTypes?: Map<string, UcodeDataType> | undefined;
      nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>> | undefined;
      propertyFunctionReturnTypes?: Map<string, string> | undefined;
    }
    const jsdocParams = new Map<string, JsDocParamInfo>();
    for (const tag of paramTags) {
      if (!tag.name) continue;

      // Try import() type expression first: @param {import('pkg').property} name
      const importExpr = parseImportTypeExpression(tag.typeExpression);
      if (importExpr) {
        const importResolved = this.resolveImportTypeExpression(importExpr.modulePath, importExpr.propertyName);
        if (importResolved) {
          jsdocParams.set(tag.name, { ...importResolved, description: tag.description });
          continue;
        }
        // Fall through to unknown type diagnostic
      }

      const resolved = resolveTypeExpression(tag.typeExpression);
      if (resolved === null) {
        // Check typedef registry before emitting UC7001
        const typedef = this.typedefRegistry.get(tag.typeExpression);
        if (typedef) {
          const propTypes = new Map<string, UcodeDataType>();
          for (const [propName, propInfo] of typedef.properties) {
            propTypes.set(propName, propInfo.type);
          }
          jsdocParams.set(tag.name, {
            type: UcodeType.OBJECT as UcodeDataType,
            description: tag.description,
            propertyTypes: propTypes.size > 0 ? propTypes : undefined,
          });
          continue;
        }
        this.addDiagnosticErrorCode(
          UcodeErrorCode.JSDOC_UNKNOWN_TYPE,
          `Unknown type '${tag.typeExpression}' in @param annotation`,
          jsDocNode.start, jsDocNode.end - 1,
          DiagnosticSeverity.Warning
        );
        continue;
      }
      jsdocParams.set(tag.name, { type: resolved, description: tag.description });
    }

    // Check for @param names that don't match any actual parameter
    const actualParamNames = new Set(params.map(p => p.name));
    for (const tag of paramTags) {
      if (tag.name && !actualParamNames.has(tag.name)) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.JSDOC_PARAM_MISMATCH,
          `@param '${tag.name}' does not match any parameter. Parameters: ${params.map(p => p.name).join(', ')}`,
          jsDocNode.start, jsDocNode.end - 1,
          DiagnosticSeverity.Warning
        );
      }
    }

    // Apply types to parameters
    for (const param of params) {
      const jsdocInfo = jsdocParams.get(param.name);
      if (jsdocInfo) {
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, jsdocInfo.type, param);
        const sym = this.symbolTable.lookup(param.name);
        if (sym) {
          if (jsdocInfo.description) sym.jsdocDescription = jsdocInfo.description;
          if (jsdocInfo.propertyTypes) sym.propertyTypes = jsdocInfo.propertyTypes;
          if (jsdocInfo.nestedPropertyTypes) sym.nestedPropertyTypes = jsdocInfo.nestedPropertyTypes;
          if (jsdocInfo.propertyFunctionReturnTypes) sym.propertyFunctionReturnTypes = jsdocInfo.propertyFunctionReturnTypes;
        }
      } else {
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, UcodeType.UNKNOWN as UcodeDataType, param);
      }
    }
  }

  /**
   * Resolve an import() type expression via fileResolver.
   * Handles: import('module') and import('module').property
   */
  private resolveImportTypeExpression(
    modulePath: string,
    propertyName?: string | undefined
  ): { type: UcodeDataType; propertyTypes?: Map<string, UcodeDataType> | undefined; nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>> | undefined; propertyFunctionReturnTypes?: Map<string, string> | undefined } | null {
    // Check if it's a known builtin module
    if (isKnownModule(modulePath)) {
      if (propertyName) {
        // import('fs').file → known object type like 'fs.file'
        const objectTypeName = `${modulePath}.${propertyName}`;
        if (isKnownObjectType(objectTypeName)) {
          return { type: { type: UcodeType.OBJECT, moduleName: objectTypeName } };
        }
        return null;
      }
      // import('fs') → the module itself
      return { type: { type: UcodeType.OBJECT, moduleName: modulePath } };
    }

    // Resolve user module via fileResolver
    const resolvedUri = this.fileResolver.resolveImportPath(modulePath, this.textDocument.uri);
    if (!resolvedUri || !resolvedUri.startsWith('file://')) return null;

    // Get the module's default export info
    const exports = this.fileResolver.getModuleExports(resolvedUri);
    const defaultExport = exports?.find(e => e.type === 'default');

    if (defaultExport?.isFunction) {
      // Default export is a factory function
      const returnInfo = this.fileResolver.getDefaultExportFunctionReturnInfo(resolvedUri);
      if (!returnInfo) return null;

      if (propertyName) {
        // import('config').cfg → a property of the factory return value
        const propType = returnInfo.returnPropertyTypes?.get(propertyName);
        if (!propType) return null;
        return { type: propType };
      }
      // import('config') → the factory function return type with all properties
      return {
        type: returnInfo.returnType ?? UcodeType.OBJECT as UcodeDataType,
        propertyTypes: returnInfo.returnPropertyTypes,
        propertyFunctionReturnTypes: returnInfo.propertyFunctionReturnTypes
      };
    }

    // Default export is an object
    const exportInfo = this.fileResolver.getDefaultExportPropertyTypes(resolvedUri);
    if (!exportInfo) return null;

    if (propertyName) {
      // import('pkg').pkg → the 'pkg' property of the default export
      const propType = exportInfo.propertyTypes?.get(propertyName);
      if (!propType) return null;

      // Get nested property types for this property (enables member completions)
      const nestedProps = exportInfo.nestedPropertyTypes?.get(propertyName);
      const result: { type: UcodeDataType; propertyTypes?: Map<string, UcodeDataType> | undefined; propertyFunctionReturnTypes?: Map<string, string> | undefined } = { type: propType };
      if (nestedProps) {
        result.propertyTypes = nestedProps;
      }
      return result;
    }

    // import('pkg') → the default export itself with all properties
    return {
      type: { type: UcodeType.OBJECT, isDefaultImport: true },
      propertyTypes: exportInfo.propertyTypes,
      nestedPropertyTypes: exportInfo.nestedPropertyTypes
    };
  }

  visitFunctionDeclaration(node: FunctionDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      const name = node.id.name;

      // Declare the function (may already exist from hoisting pre-pass).
      const existing = this.symbolTable.lookup(name);
      const alreadyHoisted = existing && existing.type === SymbolType.FUNCTION;
      if (!alreadyHoisted) {
        if (!this.symbolTable.declare(name, SymbolType.FUNCTION, UcodeType.FUNCTION as UcodeDataType, node.id)) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.FUNCTION_REDECLARATION,
            `Function '${name}' is already declared in this scope`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Error
          );
        }
      } else {
        // Update the hoisted symbol's node to the real declaration node
        // so that diagnostic ranges (e.g., "unused variable") point to the
        // actual function declaration, not the synthetic hoisted position.
        existing.node = node.id;
        existing.declaredAt = node.id.start;
      }

      // Set context for nested return statement analysis.
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node;
      this.functionReturnTypes.set(node, []);
      this.functionReturnPropertyTypes.set(node, []);

      // Enter function scope
      this.symbolTable.enterScope();
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // Declare parameters (with JSDoc type annotations if present)
      this.applyJsDocToParams(node.leadingJsDoc, node.params);

      // Emit diagnostic for unknown-typed params (strict mode only)
      if (this.strictMode && !node.leadingJsDoc && node.params.length > 0) {
        const unknownParams = node.params.filter(p => {
          const sym = this.symbolTable.lookup(p.name);
          return !sym || sym.dataType === UcodeType.UNKNOWN;
        });
        if (unknownParams.length > 0) {
          const names = unknownParams.map(p => p.name).join(', ');
          this.addDiagnosticErrorCode(
            UcodeErrorCode.JSDOC_MISSING_ANNOTATIONS,
            `Function '${name}' has ${unknownParams.length} parameter${unknownParams.length > 1 ? 's' : ''} with unknown type${unknownParams.length > 1 ? 's' : ''}: ${names}. Add /** @param */ annotations.`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Information
          );
        }
      }

      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
        const restSym = this.symbolTable.lookup(node.restParam.name);
        if (restSym) restSym.isRestParam = true;
      }

      // Visit the function body to find all return statements.
      this.visit(node.body);

      // Infer the final return type from all collected return types.
      const returnEntries = this.functionReturnTypes.get(node) || [];
      const returnTypes = returnEntries.map(e => e.type);
      const inferredReturnType = this.typeChecker.getCommonReturnType(returnTypes);

      // Update the function's symbol with the now-known return type.
      const symbol = this.symbolTable.lookup(name);
      if (symbol) {
        symbol.dataType = UcodeType.FUNCTION;  // Functions should always have type 'function'
        symbol.returnType = inferredReturnType; // Store the actual return type separately

        // Merge return property types (intersection: keep props present in ALL return branches)
        const returnPropEntries = this.functionReturnPropertyTypes.get(node) || [];
        if (returnPropEntries.length > 0) {
          const merged = new Map<string, UcodeDataType>(returnPropEntries[0]);
          for (let i = 1; i < returnPropEntries.length; i++) {
            const entry = returnPropEntries[i]!;
            for (const key of merged.keys()) {
              if (!entry.has(key)) {
                merged.delete(key);
              }
            }
          }
          if (merged.size > 0) symbol.returnPropertyTypes = merged;
        }
      }

      // Exit function scope
      this.symbolTable.exitScope(node.end);
      this.functionScopes.pop();
      this.currentFunctionNode = previousFunction;
    } else {
      super.visitFunctionDeclaration(node);
    }
  }

  visitObjectExpression(node: ObjectExpressionNode): void {
    // Extract property types for `this` context inside method bodies
    const propTypes = this.inferObjectLiteralPropertyTypes(node);
    if (propTypes) {
      this.thisPropertyStack.push(propTypes);
    }
    super.visitObjectExpression(node);
    if (propTypes) {
      this.thisPropertyStack.pop();
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
      this.functionReturnPropertyTypes.set(node as any, []);

      // Enter function scope
      this.symbolTable.enterScope();
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // If the function has a name (named function expression), declare it in the function's own scope
      if (node.id) {
        this.symbolTable.declare(node.id.name, SymbolType.FUNCTION, UcodeType.UNKNOWN as UcodeDataType, node.id);
      }

      // Declare parameters in the function scope (with JSDoc type annotations if present)
      this.applyJsDocToParams(node.leadingJsDoc, node.params);

      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
        const restSym = this.symbolTable.lookup(node.restParam.name);
        if (restSym) restSym.isRestParam = true;
      }

      // Declare `this` with property types from enclosing object literal
      if (this.thisPropertyStack.length > 0) {
        const thisProps = this.thisPropertyStack[this.thisPropertyStack.length - 1]!;
        this.symbolTable.declare('this', SymbolType.VARIABLE, UcodeType.OBJECT as UcodeDataType, node);
        const thisSym = this.symbolTable.lookup('this');
        if (thisSym) {
          thisSym.propertyTypes = new Map(thisProps);
        }
      }

      // Visit the function body
      this.visit(node.body);

      // Exit function scope
      this.symbolTable.exitScope(node.end);
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
      this.functionReturnPropertyTypes.set(node as any, []);

      // Enter function scope for parameters
      this.symbolTable.enterScope();
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // Declare parameters — JSDoc takes priority over callback inference
      if (node.leadingJsDoc) {
        this.applyJsDocToParams(node.leadingJsDoc, node.params);
      } else {
        // For callback parameters (filter/map/sort), infer first param type from array element type
        for (let i = 0; i < node.params.length; i++) {
          const param = node.params[i]!;
          const paramType = (i === 0 && this.callbackElementType) ? this.callbackElementType : UcodeType.UNKNOWN as UcodeDataType;
          this.symbolTable.declare(param.name, SymbolType.PARAMETER, paramType, param);
        }
      }

      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
        const restSym = this.symbolTable.lookup(node.restParam.name);
        if (restSym) restSym.isRestParam = true;
      }

      // Visit the function body
      // For BlockStatement bodies, visit statements directly to avoid creating an extra scope
      if (node.body.type === 'BlockStatement') {
        const blockBody = (node.body as BlockStatementNode).body;
        for (const statement of blockBody) {
          this.visit(statement);
        }
      } else {
        // For expression bodies, visit normally
        this.visit(node.body);
      }

      // Exit function scope
      this.symbolTable.exitScope(node.end);
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
      this.symbolTable.exitScope(node.end);
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
        } else {
          // Add property types for exception object properties
          const symbol = this.symbolTable.lookup(node.param.name);
          if (symbol) {
            symbol.propertyTypes = new Map([
              ['message', UcodeType.STRING],
              ['type', UcodeType.STRING],
              ['stacktrace', UcodeType.ARRAY]
            ]);
          }
        }
      }

      // Visit the catch body
      this.visit(node.body);

      // Exit catch scope
      this.symbolTable.exitScope(node.end);
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

        // Check if it was set as a property on the global object (e.g., global.FOO = ...)
        const globalSymbol = this.symbolTable.lookup('global');
        const isGlobalProperty = globalSymbol?.propertyTypes?.has(node.name);

        // Don't report "Undefined variable" if this identifier is a function call callee
        // The TypeChecker will handle "Undefined function" diagnostic for function calls
        if (!isBuiltin && !isGlobalProperty && !this.processingFunctionCallCallee) {
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
    // // console.log('DEBUG: visitMemberExpression called for:', (node.object as any).name + '.' + (node.property as any).name);
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
      if (this.assignmentLeftDepth > 0) {
        this.typeChecker.withAssignmentTarget(() => this.typeChecker.checkNode(node));
      } else {
        // Type check the member expression for invalid array/string methods
        this.typeChecker.checkNode(node);
      }
      const result = this.typeChecker.getResult();
      
      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }
      
      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
    }
    
    // Validate builtin module method calls
    this.validateModuleMember(node);
  }
  
  private validateModuleMember(node: MemberExpressionNode): void {
    // console.log('DEBUG: validateModuleMember called for:', (node.object as any).name + '.' + (node.property as any).name);
    // Only check non-computed member expressions (obj.method)
    if (node.computed || node.property.type !== 'Identifier') {
      // console.log('DEBUG: skipping - computed or not identifier');
      return;
    }

    if (node.object.type !== 'Identifier') {
      // console.log('DEBUG: skipping - object not identifier');
      return;
    }

    const objectName = (node.object as IdentifierNode).name;
    const methodName = (node.property as IdentifierNode).name;

    // Look up the object symbol
    const symbol = this.symbolTable.lookup(objectName);
    if (!symbol) {
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

    // Only validate method calls
    if (!this.processingFunctionCallCallee) {
      return;
    }

    const moduleName = this.getModuleNameFromSymbol(symbol);
    if (!moduleName) {
      // console.log('DEBUG: no module name found, returning');
      return;
    }

    if (moduleName === 'fs') {
      const isValid = this.isValidFsModuleMethod(methodName);
      if (!isValid) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_IMPORT,
          `Method '${methodName}' is not available on the fs module. Did you mean to call this on a file handle? Use fs.open() first.`,
          node.property.start,
          node.property.end,
          DiagnosticSeverity.Error
        );
      }
      return;
    }

    const provider = this.moduleFunctionProviders[moduleName];
    if (!provider) {
      return;
    }

    const functionNames = provider();
    if (functionNames.includes(methodName)) {
      return;
    }

    const availableFunctions = functionNames.join(', ');
    this.addDiagnosticErrorCode(
      UcodeErrorCode.INVALID_IMPORT,
      `Method '${methodName}' is not available on the ${moduleName} module. Available functions: ${availableFunctions}`,
      node.property.start,
      node.property.end,
      DiagnosticSeverity.Error
    );
  }

  private getStaticPropertyName(propertyNode: AstNode): string | null {
    if (propertyNode.type === 'Identifier') {
      return (propertyNode as IdentifierNode).name;
    }

    if (propertyNode.type === 'Literal') {
      const literalProperty = propertyNode as LiteralNode;
      if (literalProperty.value === undefined || literalProperty.value === null) {
        return null;
      }

      return String(literalProperty.value);
    }

    return null;
  }
  
  private getModuleNameFromSymbol(symbol: SymbolEntry): string | null {
    if (symbol.type !== SymbolType.MODULE && symbol.type !== SymbolType.IMPORTED) {
      return null;
    }

    let candidate: string | undefined;

    if (symbol.importedFrom && typeof symbol.importedFrom === 'string') {
      candidate = symbol.importedFrom;
    }

    if (!candidate && typeof symbol.dataType === 'object' && symbol.dataType !== null) {
      const dataType = symbol.dataType as { moduleName?: unknown };
      if (typeof dataType.moduleName === 'string') {
        candidate = dataType.moduleName;
      }
    }

    if (!candidate) {
      return null;
    }

    // Normalize derived module names like "fs.file" or "rtnl-const"
    const normalized = candidate.replace(/^builtin:\/\//, '').split(/[.-]/)[0];

    if (normalized === 'fs' || normalized === 'rtnl') {
      return normalized;
    }

    if (normalized !== undefined && Object.prototype.hasOwnProperty.call(this.moduleFunctionProviders, normalized)) {
      return normalized;
    }

    return null;
  }
  
  private isValidFsModuleMethod(methodName: string): boolean {
    // Check against the fs module registry (functions + constants) and pre-defined handles
    return fsModuleTypeRegistry.isFsModuleFunction(methodName) ||
      fsConstants.has(methodName) ||
      methodName === 'stdin' || methodName === 'stdout' || methodName === 'stderr';
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
          case 'string[]':
          case 'array[]':
            types.push(UcodeType.ARRAY);
            break;
          case 'null':
            types.push(UcodeType.NULL);
            break;
          case 'function':
            types.push(UcodeType.FUNCTION);
            break;
          default:
            if (isKnownObjectType(typeStr)) {
              types.push(typeStr as UcodeType);
            } else {
              types.push(UcodeType.UNKNOWN);
            }
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
        // Handle known object types like "uci.cursor", "fs.file", etc.
        if (isKnownObjectType(returnTypeStr)) {
          return { moduleName: returnTypeStr } as UcodeDataType;
        }
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
      // Pass truthiness context to the type checker so builtins in if-test contexts
      // don't warn about unknown args (e.g., if (!length(args)) is a valid pattern)
      this.typeChecker.setTruthinessDepth(this.truthinessDepth);
      this.typeChecker.checkNode(node);
      this.typeChecker.setTruthinessDepth(0);
      const result = this.typeChecker.getResult();

      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }

      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
    }

    // Visit the callee with special context to prevent "Undefined variable" for function calls
    this.processingFunctionCallCallee = true;
    this.visit(node.callee);
    this.processingFunctionCallCallee = false;

    // For filter/map/sort, infer callback parameter types from array element type
    const savedCallbackElementType = this.callbackElementType;
    if (node.callee.type === 'Identifier' &&
        node.arguments.length >= 2) {
      const funcName = (node.callee as IdentifierNode).name;
      if (funcName === 'filter' || funcName === 'map' || funcName === 'sort') {
        const arrArg = node.arguments[0]!;
        const arrType = this.resolveNodeFullType(arrArg);
        if (arrType && isArrayType(arrType)) {
          this.callbackElementType = getArrayElementType(arrType);
        }
      }
    }

    // Visit arguments normally
    for (const arg of node.arguments) {
      this.visit(arg);
    }

    // Restore callback element type
    this.callbackElementType = savedCallbackElementType;

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
    this.assignmentLeftDepth++;
    this.visit(node.left);
    this.assignmentLeftDepth--;
    this.visit(node.right);
    if (this.options.enableTypeChecking) {
      // Track assignments to object properties (e.g., obj.foo = "bar")
      if (node.left.type === 'MemberExpression') {
        const memberNode = node.left as MemberExpressionNode;
        if (!memberNode.computed && memberNode.object.type === 'Identifier') {
          const objectName = (memberNode.object as IdentifierNode).name;
          const propertyName = this.getStaticPropertyName(memberNode.property);

          if (propertyName) {
            const targetSymbol = this.symbolTable.lookup(objectName);

            if (targetSymbol && (objectName === 'global' || (targetSymbol.type !== SymbolType.MODULE && targetSymbol.type !== SymbolType.IMPORTED))) {
              const propertyType = this.inferAssignmentDataType(node.right);

              if (!targetSymbol.propertyTypes) {
                targetSymbol.propertyTypes = new Map<string, UcodeDataType>();
              }

              targetSymbol.propertyTypes.set(propertyName, propertyType);
            }
          }
        }
      }

      // Handle special type inference for assignment expressions FIRST (e.g., file_content = open(...))
      // This creates symbols for undeclared variables before type checking tries to look them up
      // Only handle cases that need early inference for undeclared variables
      if (node.left.type === 'Identifier') {
        const variableName = (node.left as IdentifierNode).name;
        let symbol = this.symbolTable.lookup(variableName);
        
        // Only create symbols for undeclared variables with special types
        if (!symbol) {
          const fsType = this.inferFsType(node.right);
          const nl80211Type = this.inferNl80211Type(node.right);
          const uloopType = this.inferUloopType(node.right);
          const ioType = this.inferIoType(node.right);
          const rtnlFunctionReturnType = this.inferImportedRtnlFunctionReturnType(node.right);

          let earlyDataType: UcodeDataType | null = null;

          if (fsType) {
            earlyDataType = createFsObjectDataType(fsType);
          } else if (nl80211Type) {
            earlyDataType = createNl80211ObjectDataType(nl80211Type);
          } else if (uloopType) {
            earlyDataType = createUloopObjectDataType(uloopType);
          } else if (ioType) {
            earlyDataType = createIoHandleDataType();
          } else if (rtnlFunctionReturnType) {
            earlyDataType = rtnlFunctionReturnType;
          }

          // Only create new symbols for undeclared variables with special types
          if (earlyDataType) {
            this.symbolTable.declare(variableName, SymbolType.VARIABLE, earlyDataType, node.left as IdentifierNode);

            // For special object variables, also force declaration in global scope
            if (fsType) {
              this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, earlyDataType);
            }
            if (uloopType) {
              this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, earlyDataType);
            }
            if (ioType) {
              this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, earlyDataType);
            }
          }
        }
      }
      
      // Now check assignment type compatibility after symbols are created
      this.typeChecker.withAssignmentTarget(() => this.typeChecker.checkNode(node.left));
      this.typeChecker.checkNode(node.right);
      
      const result = this.typeChecker.getResult();
      
      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }
      
      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
      
      // After type checking, update variable types for general function calls
      if (node.left.type === 'Identifier') {
        const variableName = (node.left as IdentifierNode).name;
        let symbol = this.symbolTable.lookup(variableName);
        
        // Skip if we already handled this in the early inference phase
        const fsType = this.inferFsType(node.right);
        const nl80211Type = this.inferNl80211Type(node.right);
        const uloopType = this.inferUloopType(node.right);
        const ioType = this.inferIoType(node.right);
        const rtnlFunctionReturnType = this.inferImportedRtnlFunctionReturnType(node.right);

        // Skip require() calls - they're handled specially in visitVariableDeclarator
        const isRequireCall = node.right.type === 'CallExpression' &&
                             (node.right as CallExpressionNode).callee.type === 'Identifier' &&
                             ((node.right as CallExpressionNode).callee as IdentifierNode).name === 'require';

        // If an io type was inferred but the symbol already existed, update its type now
        if (ioType && symbol) {
          const dataType = createIoHandleDataType();
          symbol.dataType = dataType;
          this.symbolTable.updateSymbolType(variableName, dataType);
          this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, dataType);
        }

        if (!fsType && !nl80211Type && !uloopType && !ioType && !rtnlFunctionReturnType && !isRequireCall) {
          // Check for all types of function calls that return specific types
          const methodReturnType = this.inferMethodReturnType(node.right);
          const functionReturnType = this.inferFunctionCallReturnType(node.right);
          let dataType: UcodeDataType;
          
          if (methodReturnType) {
            dataType = methodReturnType;
          } else if (functionReturnType) {
            dataType = functionReturnType;
          } else {
            // Use the inferred type from the right-hand side
            const rightType = this.typeChecker.checkNode(node.right);
            // Prefer _fullType (preserves unions) over simple UcodeType return
            const fullType = (node.right as any)._fullType as UcodeDataType | undefined;
            dataType = fullType || rightType as UcodeDataType;
          }
          
          if (symbol && symbol.type === SymbolType.VARIABLE) {
            // SSA: If this is a literal type, preserve original but track current type
            const isLiteralVariable = symbol.initialLiteralType !== undefined;
            if (isLiteralVariable) {
              // Update current type but preserve original literal type
              symbol.currentType = dataType;
              symbol.currentTypeEffectiveFrom = node.end;
            } else {
              // Regular variable, update normally
              symbol.currentType = undefined;
              symbol.currentTypeEffectiveFrom = undefined;
              symbol.dataType = dataType;
              this.symbolTable.updateSymbolType(variableName, dataType);
            }
          } else if (!symbol) {
            this.symbolTable.declare(variableName, SymbolType.VARIABLE, dataType, node.left as IdentifierNode);
          } else if (symbol.type === SymbolType.PARAMETER) {
            // Parameters: preserve declared type (unknown), track reassigned type via SSA
            symbol.currentType = dataType;
            symbol.currentTypeEffectiveFrom = node.end;
          } else {
            // SSA: If this is a literal type, preserve original but track current type
            const isLiteralVariable = symbol && symbol.initialLiteralType !== undefined;
            if (isLiteralVariable) {
              // Update current type but preserve original literal type
              symbol.currentType = dataType;
              symbol.currentTypeEffectiveFrom = node.end;
            } else {
              // Regular variable, update normally
              symbol.currentType = undefined;
              symbol.currentTypeEffectiveFrom = undefined;
              this.symbolTable.updateSymbolType(variableName, dataType);
            }
          }

          // Case 2: Update propertyTypes on reassignment with object literal
          if (node.right.type === 'ObjectExpression' && symbol) {
            const propTypes = this.inferObjectLiteralPropertyTypes(node.right as ObjectExpressionNode);
            if (propTypes) symbol.propertyTypes = propTypes;
          }

          // Propagate return property types from function call at assignment
          if (functionReturnType && symbol && node.right.type === 'CallExpression') {
            const callExpr = node.right as CallExpressionNode;
            if (callExpr.callee.type === 'Identifier') {
              const funcSym = this.symbolTable.lookup((callExpr.callee as IdentifierNode).name);
              if (funcSym?.returnPropertyTypes) {
                symbol.propertyTypes = new Map(funcSym.returnPropertyTypes);
              }
              if (funcSym?.propertyFunctionReturnTypes) {
                symbol.propertyFunctionReturnTypes = new Map(funcSym.propertyFunctionReturnTypes);
              }
            }
          }
        }
      }
    }

    // Base traversal already happened at the beginning of this method
  }

  visitUnaryExpression(node: UnaryExpressionNode): void {
    // Track ! operator as truthiness context
    if (node.operator === '!') this.truthinessDepth++;
    super.visitUnaryExpression(node);
    if (node.operator === '!') this.truthinessDepth--;

    if (this.options.enableTypeChecking) {
      this.typeChecker.setTruthinessDepth(this.truthinessDepth);
      this.typeChecker.checkNode(node);
      this.typeChecker.setTruthinessDepth(0);
      const result = this.typeChecker.getResult();

      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }

      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
    }
  }

  visitConditionalExpression(node: ConditionalExpressionNode): void {
    // Ternary test is a truthiness context
    this.truthinessDepth++;
    this.visit(node.test);
    this.truthinessDepth--;
    this.visit(node.consequent);
    this.visit(node.alternate);
  }

  visitBinaryExpression(node: BinaryExpressionNode): void {
    // Comparison operators make builtin calls safe — null compares harmlessly
    // (e.g., length(x) > 0 → null > 0 is false, not an error)
    const isComparison = node.operator === '>' || node.operator === '>=' ||
                         node.operator === '<' || node.operator === '<=' ||
                         node.operator === '==' || node.operator === '!=' ||
                         node.operator === '===' || node.operator === '!==';
    if (isComparison) this.truthinessDepth++;
    super.visitBinaryExpression(node);
    if (isComparison) this.truthinessDepth--;

    if (this.options.enableTypeChecking) {

      // Type check the binary expression for type warnings
      // Propagate truthiness context so builtins in if-tests don't warn
      // Include comparison context: the type checker re-checks children via checkBinaryExpression
      const effectiveTruthiness = isComparison ? this.truthinessDepth + 1 : this.truthinessDepth;
      this.typeChecker.setTruthinessDepth(effectiveTruthiness);
      this.typeChecker.checkNode(node);
      this.typeChecker.setTruthinessDepth(0);
      const result = this.typeChecker.getResult();

      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }

      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
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
        this.functionReturnTypes.get(this.currentFunctionNode)?.push({ node, type: returnType });

        // Collect property types from returned object literals
        if (node.argument?.type === 'ObjectExpression') {
          const propTypes = this.inferObjectLiteralPropertyTypes(node.argument as ObjectExpressionNode);
          if (propTypes) {
            this.functionReturnPropertyTypes.get(this.currentFunctionNode)?.push(propTypes);
          }
        }
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

  visitIfStatement(node: IfStatementNode): void {
    // Visit the test in truthiness context so builtins with unknown args don't warn
    // (e.g., if (!length(args)) is a valid type-check pattern)
    this.truthinessDepth++;
    this.visit(node.test);
    this.truthinessDepth--;

    // Push indirect type guard contexts BEFORE visiting the body so builtin validators
    // see narrowed types for patterns like: t = type(value); if (t == "object") { keys(value) }
    // Only do this for INDIRECT guards (where the condition uses a variable assigned from type()).
    // Direct guards (type(x) == "...") are handled by the type checker's checkIfStatement.
    let guardCount = 0;
    if (this.options.enableTypeChecking && node.test?.type === 'BinaryExpression') {
      const test = node.test as BinaryExpressionNode;
      if (test.left.type === 'Identifier' && test.right.type === 'Literal') {
        // Only push guards if this is an indirect type check (identifier == string literal)
        // where the identifier was assigned from type(). Direct type(x) == "..." is handled later.
        const guards = this.typeChecker.analyzeIfGuards(node);
        for (const guard of guards) {
          if (node.consequent) {
            this.typeChecker.pushGuardContextPublic(
              guard.variableName, guard.positiveNarrowing,
              node.consequent.start, node.consequent.end
            );
            guardCount++;
          }
        }
      }
    }

    // Visit consequent and alternate normally
    if (node.consequent) this.visit(node.consequent);

    // Pop consequent guards
    for (let i = 0; i < guardCount; i++) {
      this.typeChecker.popGuardContextPublic();
    }

    if (node.alternate) this.visit(node.alternate);

    if (this.options.enableTypeChecking) {
      // Type check the if statement AFTER visiting to ensure all local variables are declared
      this.typeChecker.checkNode(node);
      const result = this.typeChecker.getResult();

      // Add type errors to diagnostics
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }

      // Add type warnings to diagnostics
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
    }
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
      this.symbolTable.exitScope(node.end);
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
          // Single variable: gets the value for arrays, the key for objects
          const declarator = declarations[0];
          if (declarator.id && declarator.id.type === 'Identifier') {
            const iteratorName = declarator.id.name;
            const iteratorNode = declarator.id;

            // Infer the iterator variable type from what's being iterated
            const rightType = this.typeChecker.checkNode(node.right);
            let iterType: UcodeDataType;
            if (rightType === UcodeType.ARRAY) {
              // Check for ArrayType element info from the symbol or _fullType
              const rightFullType = this.getIterableFullType(node.right);
              if (rightFullType && isArrayType(rightFullType)) {
                iterType = getArrayElementType(rightFullType);
              } else {
                iterType = UcodeType.UNKNOWN as UcodeDataType;
              }
            } else if (rightType === UcodeType.OBJECT) {
              iterType = UcodeType.STRING as UcodeDataType; // object keys are strings
            } else if (rightType === UcodeType.STRING) {
              iterType = UcodeType.STRING as UcodeDataType; // iterating string chars
            } else {
              iterType = UcodeType.UNKNOWN as UcodeDataType;
            }

            this.symbolTable.declare(iteratorName, SymbolType.VARIABLE, iterType, iteratorNode);
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
            const rightFullType = this.getIterableFullType(node.right);
            let valueType: UcodeDataType = UcodeType.UNKNOWN as UcodeDataType;
            if (rightFullType && isArrayType(rightFullType)) {
              valueType = getArrayElementType(rightFullType);
            }
            this.symbolTable.declare(valueName, SymbolType.VARIABLE, valueType, valueNode);
            this.symbolTable.markUsed(valueName, valueNode.start);
          }
        }
      }
      
      // Visit the right side (the object being iterated over)
      this.visit(node.right);
      
      // Visit the loop body (iterator variables are now in scope)
      this.visit(node.body);
      
      // Exit the for-in loop scope
      this.symbolTable.exitScope(node.end);
    } else {
      // Fallback to default behavior if scope analysis is disabled
      super.visitForInStatement(node);
    }

    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  /** Get the full UcodeDataType for an iterable expression (identifier lookup or _fullType). */
  private getIterableFullType(node: any): UcodeDataType | null {
    if (node.type === 'Identifier') {
      const sym = this.symbolTable.lookup(node.name);
      if (sym) return sym.dataType;
    }
    return (node as any)._fullType || null;
  }

  visitSwitchStatement(node: SwitchStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      // Track that we're entering a switch statement
      this.switchScopes.push(this.symbolTable.getCurrentScope());
    }

    if (this.options.enableTypeChecking) {
      // Only type-check the discriminant here. The full switch body will be
      // type-checked by individual visit methods (visitCallExpression, etc.)
      // which run after super.visitSwitchStatement declares local variables.
      // Running checkNode on the whole switch would produce spurious warnings
      // for variables not yet declared in the symbol table.
      this.typeChecker.checkNode(node.discriminant);
      const result = this.typeChecker.getResult();

      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }

      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
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
    if (node.type !== 'CallExpression') return null;

    const callNode = node as CallExpressionNode;

    // Named import: open(), statvfs(), etc.
    if (callNode.callee.type === 'Identifier') {
      const funcName = (callNode.callee as IdentifierNode).name;
      // Skip if imported from a non-fs module (e.g. io.open)
      const symbol = this.symbolTable.lookup(funcName);
      if (symbol && symbol.type === SymbolType.IMPORTED && symbol.importedFrom && symbol.importedFrom !== 'fs') {
        return null;
      }
      return getFsReturnObjectType(funcName);
    }

    // Member expression: fs.open(), fs.statvfs(), etc.
    if (callNode.callee.type === 'MemberExpression') {
      const memberNode = callNode.callee as MemberExpressionNode;
      if (memberNode.object.type === 'Identifier' &&
          (memberNode.object as IdentifierNode).name === 'fs' &&
          memberNode.property.type === 'Identifier') {
        return getFsReturnObjectType((memberNode.property as IdentifierNode).name);
      }
    }

    return null;
  }

  private inferIoType(node: AstNode): IoObjectType | null {
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      if (callNode.callee.type === 'Identifier') {
        const funcName = (callNode.callee as IdentifierNode).name;

        // Only infer io.handle if the function was imported from 'io'
        const symbol = this.symbolTable.lookup(funcName);
        if (!symbol || symbol.type !== SymbolType.IMPORTED || symbol.importedFrom !== 'io') {
          return null;
        }

        const originalName = symbol.importSpecifier || funcName;
        switch (originalName) {
          case 'open':
          case 'new':
          case 'from':
            return IoObjectType.IO_HANDLE;
          default:
            return null;
        }
      }
      // Handle module member calls like io.open()
      else if (callNode.callee.type === 'MemberExpression') {
        const memberNode = callNode.callee as MemberExpressionNode;
        if (memberNode.object.type === 'Identifier' &&
            memberNode.property.type === 'Identifier') {
          const objName = (memberNode.object as IdentifierNode).name;
          const objSymbol = this.symbolTable.lookup(objName);
          // Must be the io module (default import)
          if (objSymbol && objSymbol.importedFrom === 'io') {
            const methodName = (memberNode.property as IdentifierNode).name;
            switch (methodName) {
              case 'open':
              case 'new':
              case 'from':
                return IoObjectType.IO_HANDLE;
            }
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
    if (node.type !== 'CallExpression') return null;

    const callNode = node as CallExpressionNode;
    if (callNode.callee.type !== 'MemberExpression') return null;

    const memberNode = callNode.callee as MemberExpressionNode;
    if (memberNode.property.type !== 'Identifier') return null;
    const methodName = (memberNode.property as IdentifierNode).name;

    // Case 1: obj.method() where obj is an Identifier in the symbol table
    if (memberNode.object.type === 'Identifier') {
      const objectName = (memberNode.object as IdentifierNode).name;
      const symbol = this.symbolTable.lookup(objectName);
      if (symbol) {
        // Check if this is a uloop object method call
        const uloopType = uloopObjectRegistry.isVariableOfUloopType(symbol.dataType);
        if (uloopType) {
          const method = uloopObjectRegistry.getUloopMethod(uloopType, methodName);
          if (method) {
            if (method.returnType === 'fs.file | fs.proc | socket.socket') {
              return createFsObjectDataType(FsObjectType.FS_FILE);
            }
          }
        }

        // Check propertyFunctionReturnTypes — e.g., config.uci_ctx() -> uci.cursor
        if (symbol.propertyFunctionReturnTypes?.has(methodName)) {
          const returnTypeHint = symbol.propertyFunctionReturnTypes.get(methodName)!;
          return this.parseReturnTypeString(returnTypeHint);
        }

        // Check known object type methods (fs.file, uci.cursor, io.handle, etc.)
        if (symbol.dataType && typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType) {
          const mn = (symbol.dataType as any).moduleName as string;
          if (isKnownObjectType(mn)) {
            const methodSig = OBJECT_REGISTRIES[mn].getMethod(methodName);
            if (Option.isSome(methodSig)) {
              return this.parseReturnTypeString(methodSig.value.returnType);
            }
          }
        }
      }
    }

    // Case 2: Call chain — expr().method() where expr() is a CallExpression
    // e.g., fs.open("/tmp/x").read("all"), cursor().foreach(...)
    if (memberNode.object.type === 'CallExpression') {
      const innerCall = memberNode.object as CallExpressionNode;
      const objType = this.resolveCallExpressionObjectType(innerCall);
      if (objType && isKnownObjectType(objType)) {
        const methodSig = OBJECT_REGISTRIES[objType].getMethod(methodName);
        if (Option.isSome(methodSig)) {
          return this.parseReturnTypeString(methodSig.value.returnType);
        }
      }
    }

    return null;
  }

  /**
   * Resolve the object type returned by a CallExpression.
   * Handles: cursor(), fs.open(), io.open(), etc.
   */
  private resolveCallExpressionObjectType(call: CallExpressionNode): string | null {
    // Simple call: cursor()
    if (call.callee.type === 'Identifier') {
      const funcName = (call.callee as IdentifierNode).name;
      return resolveReturnObjectType(funcName);
    }
    // Member call: fs.open(), uci.cursor()
    if (call.callee.type === 'MemberExpression') {
      const member = call.callee as MemberExpressionNode;
      if (member.object.type === 'Identifier' && member.property.type === 'Identifier') {
        const moduleName = (member.object as IdentifierNode).name;
        const funcName = (member.property as IdentifierNode).name;
        return resolveReturnObjectType(funcName, moduleName);
      }
    }
    return null;
  }

  /**
   * Resolve the full data type of a node (including ArrayType with element info).
   * Used to extract array element types for callback parameter inference.
   */
  private resolveNodeFullType(node: AstNode): UcodeDataType | null {
    // Check _fullType set by the type checker (e.g., split() → ArrayType)
    if ((node as any)._fullType) {
      return (node as any)._fullType;
    }
    if (node.type === 'Identifier') {
      const sym = this.symbolTable.lookup((node as IdentifierNode).name);
      if (sym) return sym.dataType;
    }
    return null;
  }

  private inferAssignmentDataType(expression: AstNode): UcodeDataType {
    if (expression.type === 'Identifier') {
      const sourceName = (expression as IdentifierNode).name;
      const sourceSymbol = this.symbolTable.lookup(sourceName);
      if (sourceSymbol) {
        return sourceSymbol.dataType;
      }
    }

    const fsType = this.inferFsType(expression);
    if (fsType) {
      return createFsObjectDataType(fsType);
    }

    const nl80211Type = this.inferNl80211Type(expression);
    if (nl80211Type) {
      return createNl80211ObjectDataType(nl80211Type);
    }

    const uloopType = this.inferUloopType(expression);
    if (uloopType) {
      return createUloopObjectDataType(uloopType);
    }

    const ioType = this.inferIoType(expression);
    if (ioType) {
      return createIoHandleDataType();
    }

    const uciType = this.inferUciType(expression);
    if (uciType) {
      return createUciObjectDataType(uciType);
    }

    const importedFsReturnType = this.inferImportedFsFunctionReturnType(expression);
    if (importedFsReturnType) {
      return importedFsReturnType;
    }

    const rtnlReturnType = this.inferImportedRtnlFunctionReturnType(expression);
    if (rtnlReturnType) {
      return rtnlReturnType;
    }

    const methodReturnType = this.inferMethodReturnType(expression);
    if (methodReturnType) {
      return methodReturnType;
    }

    const functionReturnType = this.inferFunctionCallReturnType(expression);
    if (functionReturnType) {
      return functionReturnType;
    }

    const inferredType = this.typeChecker.checkNode(expression);
    return inferredType as UcodeDataType;
  }

  private inferObjectLiteralPropertyTypes(node: ObjectExpressionNode): Map<string, UcodeDataType> | null {
    const propTypes = new Map<string, UcodeDataType>();
    for (const prop of node.properties) {
      // Skip spread elements — they don't have key/value
      if (prop.type === 'SpreadElement') continue;
      const key = this.getStaticPropertyName(prop.key);
      if (!key) continue;
      const val = prop.value;
      let valType: UcodeDataType;
      if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
        valType = UcodeType.FUNCTION as UcodeDataType;
      } else if (val.type === 'Identifier') {
        const sym = this.symbolTable.lookup((val as IdentifierNode).name);
        valType = sym ? sym.dataType : UcodeType.UNKNOWN as UcodeDataType;
      } else if (val.type === 'Literal') {
        const lit = val as LiteralNode;
        if (typeof lit.value === 'string') valType = UcodeType.STRING as UcodeDataType;
        else if (typeof lit.value === 'boolean') valType = UcodeType.BOOLEAN as UcodeDataType;
        else if (typeof lit.value === 'number') {
          valType = (Number.isInteger(lit.value) ? UcodeType.INTEGER : UcodeType.DOUBLE) as UcodeDataType;
        } else if (lit.value === null) valType = UcodeType.NULL as UcodeDataType;
        else valType = UcodeType.UNKNOWN as UcodeDataType;
      } else if (val.type === 'ObjectExpression') {
        valType = UcodeType.OBJECT as UcodeDataType;
      } else if (val.type === 'ArrayExpression') {
        valType = UcodeType.ARRAY as UcodeDataType;
      } else {
        valType = this.typeChecker.checkNode(val) as UcodeDataType;
      }
      propTypes.set(key, valType);
    }
    return propTypes.size > 0 ? propTypes : null;
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
      // Builtins are handled by the type checker which narrows return types based on argument types
      return symbol.returnType || null;
    }

    return null;
  }

  private setDeclarationTypeIfUnset(symbol: SymbolEntry, dataType: UcodeDataType): void {
    if (symbol.initialLiteralType === undefined && dataType !== UcodeType.UNKNOWN) {
      if (typeof dataType === 'string' || isArrayType(dataType)) {
        symbol.initialLiteralType = dataType;
      }
    }
  }

  private isLiteralType(dataType: UcodeDataType, initNode: any): boolean {
    // Check if the dataType corresponds to a literal type and if the init node is actually a literal
    if (!initNode) return false;
    
    switch (initNode.type) {
      case 'ArrayExpression':
        return dataType === UcodeType.ARRAY || isArrayType(dataType);
      case 'ObjectExpression':
        return dataType === UcodeType.OBJECT;
      case 'Literal':
        if (initNode.literalType === 'regexp') {
          return dataType === UcodeType.REGEX;
        }
        if (typeof initNode.value === 'string') return dataType === UcodeType.STRING;
        if (typeof initNode.value === 'number') return dataType === UcodeType.INTEGER || dataType === UcodeType.DOUBLE;
        if (typeof initNode.value === 'boolean') return dataType === UcodeType.BOOLEAN;
        if (initNode.value === null) return dataType === UcodeType.NULL;
        break;
    }
    return false;
  }

  private processInitializerTypeInference(node: VariableDeclaratorNode, name: string): void {
    if (!node.init) {
      return;
    }


    const symbol = this.symbolTable.lookup(name);
    if (symbol) {
      // Handle simple aliasing of imported modules (e.g., let alias = fs;)
      if (node.init.type === 'Identifier') {
        const sourceName = (node.init as IdentifierNode).name;
        const sourceSymbol = this.symbolTable.lookup(sourceName);

        if (sourceSymbol && (sourceSymbol.type === SymbolType.IMPORTED || sourceSymbol.type === SymbolType.MODULE)) {
          symbol.type = sourceSymbol.type;
          symbol.dataType = sourceSymbol.dataType;

          if (sourceSymbol.importedFrom !== undefined) {
            symbol.importedFrom = sourceSymbol.importedFrom;
          } else {
            delete symbol.importedFrom;
          }

          if (sourceSymbol.importSpecifier !== undefined) {
            symbol.importSpecifier = sourceSymbol.importSpecifier;
          } else {
            delete symbol.importSpecifier;
          }
          this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
          return;
        }

        if (sourceSymbol) {
          symbol.dataType = sourceSymbol.dataType;
          this.symbolTable.updateSymbolType(name, sourceSymbol.dataType);

          if (sourceSymbol.propertyTypes) {
            symbol.propertyTypes = sourceSymbol.propertyTypes;
          }
          this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
          return;
        }
      }

      // Handle default imports accessed via global properties (e.g., let e = global.d;)
      if (node.init.type === 'MemberExpression') {
        const memberNode = node.init as MemberExpressionNode;
        if (!memberNode.computed && memberNode.object.type === 'Identifier') {
          const objectName = (memberNode.object as IdentifierNode).name;
          const propertyName = this.getStaticPropertyName(memberNode.property);

          if (propertyName) {
            const objectSymbol = this.symbolTable.lookup(objectName);
            if (objectSymbol && objectSymbol.propertyTypes && objectSymbol.propertyTypes.has(propertyName)) {
              const propertyType = objectSymbol.propertyTypes.get(propertyName)!;
              symbol.dataType = propertyType;
              this.symbolTable.updateSymbolType(name, propertyType);
              this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
              // Propagate nested property types (e.g., _pkg_mod.pkg → pkg with its own propertyTypes)
              if (objectSymbol.nestedPropertyTypes && objectSymbol.nestedPropertyTypes.has(propertyName)) {
                symbol.propertyTypes = objectSymbol.nestedPropertyTypes.get(propertyName)!;
              }
              return;
            }
          }
        }
      }

      // DEBUG
      // Check if this is an fs function call and assign the appropriate fs type
      const fsType = this.inferFsType(node.init!);
      if (fsType) {
        const dataType = createFsObjectDataType(fsType);
        symbol.dataType = dataType;
        // For fs object variables, also force declaration in global scope to ensure completion access
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
        return;
      }

      // Check if this is an nl80211 function call and assign the appropriate nl80211 type
      const nl80211Type = this.inferNl80211Type(node.init!);
      if (nl80211Type) {
        const dataType = createNl80211ObjectDataType(nl80211Type);
        symbol.dataType = dataType;
        // For nl80211 object variables, also force declaration in global scope to ensure completion access
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
        return;
      }

      // Check if this is a uloop function call and assign the appropriate uloop type
      const uloopType = this.inferUloopType(node.init!);
      if (uloopType) {
        const dataType = createUloopObjectDataType(uloopType);
        symbol.dataType = dataType;
        // For uloop object variables, also force declaration in global scope to ensure completion access
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
        return;
      }

      // Check if this is an io function call and assign io.handle type
      const ioType = this.inferIoType(node.init!);
      if (ioType) {
        const dataType = createIoHandleDataType();
        symbol.dataType = dataType;
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
        return;
      }

      // Check if this is a uci function call and assign the appropriate uci type
      const uciType = this.inferUciType(node.init!);
      if (uciType) {
        const dataType = createUciObjectDataType(uciType);
        symbol.dataType = dataType;
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, dataType);
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
        return;
      }

      // Don't overwrite module types, imported types, or literal types that were set during declaration
      if (symbol.type !== SymbolType.MODULE && symbol.type !== SymbolType.IMPORTED && 
          !this.isLiteralType(symbol.dataType, node.init)) {
        // Check if this is an imported fs function call and assign the proper union return type
        const importedFsReturnType = this.inferImportedFsFunctionReturnType(node.init!);
        if (importedFsReturnType) {
          symbol.dataType = importedFsReturnType;
          this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
          return;
        }

        // Check if this is a method call chain and resolve the return type
        const methodReturnType = this.inferMethodReturnType(node.init!);
        if (methodReturnType) {
          symbol.dataType = methodReturnType;
          this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
          return;
        }

        // Check if this is a function call and preserve the return type (including unions)
        const functionReturnType = this.inferFunctionCallReturnType(node.init!);
        if (functionReturnType) {
          symbol.dataType = functionReturnType;
          this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
          // Propagate return property types from function to variable
          if (node.init!.type === 'CallExpression') {
            const callExpr = node.init! as CallExpressionNode;
            if (callExpr.callee.type === 'Identifier') {
              const funcSym = this.symbolTable.lookup((callExpr.callee as IdentifierNode).name);
              if (funcSym?.returnPropertyTypes) {
                symbol.propertyTypes = new Map(funcSym.returnPropertyTypes);
              }
              if (funcSym?.propertyFunctionReturnTypes) {
                symbol.propertyFunctionReturnTypes = new Map(funcSym.propertyFunctionReturnTypes);
              }
            }
          }
          return;
        }
        // For non-function calls, fall back to type checker result.
        // Suppress validation warnings — this call is for type inference only;
        // validation was already done during the visit pass.
        this.typeChecker.setTruthinessDepth(1);
        const initType = this.typeChecker.checkNode(node.init);
        this.typeChecker.setTruthinessDepth(0);
        // Prefer _fullType (preserves unions) over simple UcodeType return
        const fullType = (node.init as any)._fullType as UcodeDataType | undefined;
        symbol.dataType = fullType || initType as UcodeDataType;
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
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
    // Parser node.end is inclusive (points to last char); LSP ranges need exclusive end
    const endPos = this.textDocument.positionAt(end + 1);

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
    severity?: DiagnosticSeverity,
    code?: string,
    data?: any
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
    // Parser node.end is inclusive (points to last char); LSP ranges need exclusive end
    const endPos = this.textDocument.positionAt(end + 1);
    
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
        source: 'ucode-semantic',
        ...(code && { code }),
        ...(data && { data })
      };

      if (data?.unnecessary) {
        diagnostic.tags = [DiagnosticTag.Unnecessary];
      }

      this.diagnostics.push(diagnostic);
    }
  }

  private detectStrictMode(ast: ProgramNode): boolean {
    if (!ast.body || ast.body.length === 0) return false;
    const first = ast.body[0];
    if (first?.type === 'ExpressionStatement') {
      const expr = (first as any).expression;
      if (expr?.type === 'Literal' && expr.value === 'use strict') {
        return true;
      }
    }
    return false;
  }

  /**
   * Scan document for JSDoc @typedef definitions and populate the typedef registry.
   */
  private scanTypedefs(): void {
    this.typedefRegistry.clear();
    const text = this.textDocument.getText();
    // Match /** ... */ blocks containing @typedef
    const jsdocRegex = /\/\*\*([\s\S]*?)\*\//g;
    let match: RegExpExecArray | null;
    while ((match = jsdocRegex.exec(text)) !== null) {
      const commentBody = match[1]!;
      if (!commentBody.includes('@typedef')) continue;
      const parsed = parseJsDocComment(commentBody);
      const typedef = extractTypedef(parsed);
      if (typedef) {
        this.typedefRegistry.set(typedef.name, typedef);
      }
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

  /**
   * Check if a module name uses dot notation format (e.g., 'u1905.u1905d.src.u1905.log')
   * Dot notation modules contain only alphanumeric characters, dots, and underscores
   */
  private isDotNotationModule(moduleName: string): boolean {
    // Must contain at least one dot and only valid identifier characters
    // Each part must start with a letter or underscore, followed by letters, numbers, or underscores
    return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(moduleName);
  }

  /**
   * Convert dot notation module name to relative file path
   * Example: 'u1905.u1905d.src.u1905.log' -> './u1905/u1905d/src/u1905/log.uc'
   */
  private convertDotNotationToPath(moduleName: string): string {
    // Extract namespace from current file path
    // e.g., if current file is /path/to/foo/bar/baz/file.uc, we need to check if
    // the module name starts with any of: "foo.bar.baz", "bar.baz", or "baz"
    const currentUri = this.textDocument.uri;
    const currentPath = currentUri.replace('file://', '');
    const pathParts = currentPath.split('/');

    // Remove the filename to get directory parts
    const dirParts = pathParts.slice(0, -1);

    // Try matching from the deepest directory up to the root
    // For /path/to/foo/bar/baz/file.uc:
    // Try: "foo.bar.baz", then "bar.baz", then "baz"
    for (let i = 0; i < dirParts.length; i++) {
      const namespaceParts = dirParts.slice(i);
      const namespaceDotted = namespaceParts.join('.');

      if (moduleName.startsWith(namespaceDotted + '.')) {
        // Strip the namespace prefix and resolve as relative to current directory
        // e.g., "foo.bar.baz.other" with namespace "foo.bar.baz" -> "other" -> "./other.uc"
        const relativeName = moduleName.substring(namespaceDotted.length + 1);
        return './' + relativeName.replace(/\./g, '/') + '.uc';
      }
    }

    // Default behavior: convert dot notation to path
    // "foo.bar.baz" -> "./foo/bar/baz.uc"
    return './' + moduleName.replace(/\./g, '/') + '.uc';
  }


  private findContainingNullGuard(node: AstNode, variableName: string, position: number): boolean {
    // Check if this is an if statement
    if (node.type === 'IfStatement') {
      const ifNode = node as IfStatementNode;
      
      // Check if the position is within the consequent block
      if (ifNode.consequent && 
          position >= ifNode.consequent.start && 
          position <= ifNode.consequent.end) {
        
        // Check if the if condition is a null guard for our variable
        if (this.isNullGuard(ifNode.test, variableName)) {
          return true;
        }
      }
    }

    // Recursively check all child nodes
    if ((node as any).body) {
      const body = (node as any).body;
      if (Array.isArray(body)) {
        for (const child of body) {
          if (this.findContainingNullGuard(child, variableName, position)) {
            return true;
          }
        }
      } else {
        if (this.findContainingNullGuard(body, variableName, position)) {
          return true;
        }
      }
    }

    // Check other common child properties
    const childProps = ['consequent', 'alternate', 'test', 'left', 'right', 'argument', 'callee', 'arguments'];
    for (const prop of childProps) {
      const child = (node as any)[prop];
      if (child) {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type) {
              if (this.findContainingNullGuard(item, variableName, position)) {
                return true;
              }
            }
          }
        } else if (typeof child === 'object' && child.type) {
          if (this.findContainingNullGuard(child, variableName, position)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private isNullGuard(testNode: AstNode, variableName: string): boolean {
    if (!testNode || testNode.type !== 'BinaryExpression') {
      return false;
    }

    const binaryExpr = testNode as BinaryExpressionNode;
    
    // Check for "variableName != null" pattern
    if ((binaryExpr.operator === '!=' || binaryExpr.operator === '!==') &&
        binaryExpr.left.type === 'Identifier' &&
        (binaryExpr.left as IdentifierNode).name === variableName &&
        binaryExpr.right.type === 'Literal' &&
        (binaryExpr.right as any).value === null) {
      return true;
    }

    return false;
  }

  /**
   * Filter out "Undefined function" errors for variables that have unknown type from CFG
   * This prevents false positives for dynamically-looked-up functions
   */
  private detectUnreachableCode(): void {
    // Check top-level CFG
    if (this.cfgQueryEngine && this.cfg) {
      this.emitUnreachableDiagnostics(this.cfgQueryEngine, this.cfg);
    }

    // Build per-function CFGs with never-returns inference
    if (this.currentASTRoot) {
      // Collect all function declarations for multi-pass analysis
      const funcNodes: any[] = [];
      this.collectFunctionNodes(this.currentASTRoot, funcNodes);

      // Phase 1: Initial pass with default terminators (die/exit)
      const terminators = new Set(['die', 'exit']);
      this.analyzeAllFunctions(funcNodes, terminators);

      // Phase 2: Fixpoint iteration — infer never-returns and re-analyze
      let changed = true;
      while (changed) {
        changed = false;
        for (const funcNode of funcNodes) {
          const name = funcNode.id?.name;
          if (!name || !funcNode.body) continue;
          const symbol = this.symbolTable.lookup(name);
          if (!symbol || symbol.neverReturns) continue;

          try {
            const builder = new CFGBuilder(name, terminators);
            const cfg = builder.build(funcNode.body);
            if (this.functionNeverReturns(cfg, terminators)) {
              symbol.neverReturns = true;
              terminators.add(name);
              changed = true;
            }
          } catch (_) {
            // skip
          }
        }
      }

      // Phase 3: Re-emit diagnostics with final terminator set if it grew
      if (terminators.size > 2) {
        // Clear previously emitted UC4001 diagnostics so we can re-emit with updated info
        this.diagnostics = this.diagnostics.filter(
          d => (d as any).code !== UcodeErrorCode.UNREACHABLE_CODE
        );
        // Re-emit top-level
        if (this.cfgQueryEngine && this.cfg) {
          this.emitUnreachableDiagnostics(this.cfgQueryEngine, this.cfg);
        }
        this.analyzeAllFunctions(funcNodes, terminators);
      }
    }
  }

  /**
   * Collect all function declaration/expression nodes from the AST.
   */
  private collectFunctionNodes(node: AstNode, result: any[]): void {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      result.push(node);
    }
    for (const key of Object.keys(node)) {
      const val = (node as any)[key];
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          for (const child of val) {
            if (child && typeof child.type === 'string') {
              this.collectFunctionNodes(child, result);
            }
          }
        } else if (typeof val.type === 'string') {
          this.collectFunctionNodes(val, result);
        }
      }
    }
  }

  /**
   * Build CFGs for all functions and emit unreachable diagnostics.
   */
  private analyzeAllFunctions(funcNodes: any[], terminators: Set<string>): void {
    for (const funcNode of funcNodes) {
      if (!funcNode.body) continue;
      try {
        const builder = new CFGBuilder(funcNode.id?.name || 'anonymous', terminators);
        const cfg = builder.build(funcNode.body);
        const engine = new CFGQueryEngine(cfg, builder.getNodeToBlockMap());
        this.emitUnreachableDiagnostics(engine, cfg);
        this.narrowFunctionReturnType(funcNode, engine, cfg);
      } catch (_) {
        // Best-effort; skip functions that fail CFG construction
      }
    }
  }

  /**
   * Check if a function never returns normally.
   * A function never returns if no reachable predecessor of the exit block
   * provides a normal return path (ReturnStatement or fall-through).
   */
  private functionNeverReturns(cfg: ControlFlowGraph, terminators: Set<string>): boolean {
    // Find reachable blocks
    const reachable = new Set<number>();
    const queue = [cfg.entry];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current.id)) continue;
      reachable.add(current.id);
      for (const edge of current.successors) {
        queue.push(edge.target);
      }
    }

    // If exit is not reachable at all, function never returns
    if (!reachable.has(cfg.exit.id)) return true;

    // Check each reachable predecessor of exit
    for (const pred of cfg.exit.predecessors) {
      if (!reachable.has(pred.id)) continue;
      if (pred.statements.length === 0) {
        // Empty block reaching exit = fall-through = function can return
        return false;
      }
      const lastStmt = pred.statements[pred.statements.length - 1]!;
      if (lastStmt.type === 'ThrowStatement') {
        // Abnormal termination — doesn't count as normal return
        continue;
      }
      if (lastStmt.type === 'ExpressionStatement') {
        const expr = (lastStmt as any).expression;
        if (expr && expr.type === 'CallExpression' && expr.callee?.type === 'Identifier') {
          const calleeName = (expr.callee as any).name;
          if (calleeName && terminators.has(calleeName)) {
            // Terminator call — doesn't count as normal return
            continue;
          }
        }
      }
      // ReturnStatement or any other statement reaching exit = function can return
      return false;
    }

    // No reachable predecessor provides a normal return
    return true;
  }

  private emitUnreachableDiagnostics(engine: CFGQueryEngine, cfg: ControlFlowGraph): void {
    const unreachableBlocks = engine.getUnreachableBlocks();

    for (const block of unreachableBlocks) {
      if (block.statements.length === 0) continue;
      if (block === cfg.exit) continue;

      const firstStmt = block.statements[0]!;
      const lastStmt = block.statements[block.statements.length - 1]!;

      this.addDiagnostic(
        'Unreachable code detected',
        firstStmt.start,
        lastStmt.end,
        DiagnosticSeverity.Hint,
        UcodeErrorCode.UNREACHABLE_CODE,
        { unnecessary: true }
      );
    }
  }

  private narrowFunctionReturnType(funcNode: any, engine: CFGQueryEngine, cfg: ControlFlowGraph): void {
    const returnEntries = this.functionReturnTypes.get(funcNode as FunctionDeclarationNode);
    if (!returnEntries || returnEntries.length === 0) return;

    // Collect start offsets of all statements in unreachable blocks
    const unreachableOffsets = new Set<number>();
    for (const block of engine.getUnreachableBlocks()) {
      if (block === cfg.exit) continue;
      for (const stmt of block.statements) {
        unreachableOffsets.add(stmt.start);
      }
    }

    // Filter to only reachable return entries
    const reachableEntries = returnEntries.filter(e => !unreachableOffsets.has(e.node.start));
    if (reachableEntries.length === returnEntries.length) return; // nothing changed

    // Update the stored entries
    this.functionReturnTypes.set(funcNode as FunctionDeclarationNode, reachableEntries);

    // Re-compute and update the function symbol's return type
    const name = funcNode.id?.name;
    if (name) {
      const symbol = this.symbolTable.lookup(name);
      if (symbol) {
        const reachableTypes = reachableEntries.map(e => e.type);
        symbol.returnType = this.typeChecker.getCommonReturnType(reachableTypes);
      }
    }
  }

  private filterUndefinedFunctionErrorsWithCFG(): void {
    if (!this.cfgQueryEngine || !this.typeChecker) {
      return;
    }

    const typeCheckerErrors = this.typeChecker.getErrors();
    const filteredErrors = typeCheckerErrors.filter(error => {
      // Check if this is an "Undefined function" error
      if (!error.message.startsWith('Undefined function:')) {
        return true; // Keep other errors
      }

      // Extract function name from error message
      const match = error.message.match(/Undefined function: (\w+)/);
      if (!match) {
        return true; // Keep if we can't parse
      }

      const funcName = match[1];
      if (!funcName) {
        return true; // Keep if we can't extract name
      }

      // First check if symbol exists in symbol table (it might be a local variable)
      const symbol = this.symbolTable.lookupAtPosition(funcName, error.start);

      // If symbol exists and has unknown type, suppress the error
      if (symbol && symbol.dataType === 'unknown') {
        return false; // Filter out - we don't know if it's callable
      }

      // Also check CFG for type information
      const cfgType = this.cfgQueryEngine!.getTypeAtPosition(funcName, error.start);

      // If CFG says the type is unknown (not undefined/missing), suppress the error
      // Unknown means we don't know if it's callable or not, so don't report error
      if (cfgType === 'unknown') {
        return false; // Filter out this error
      }

      return true; // Keep the error
    });

    // Update TypeChecker with filtered errors
    this.typeChecker.setErrors(filteredErrors);
  }

  /**
   * Re-check an expression with CFG-based type information.
   * Returns true if the diagnostic should be filtered (expression is valid with CFG types).
   */
  private recheckExpressionWithCFG(diagnostic: Diagnostic): boolean {
    const diagnosticData = (diagnostic as any).data;
    if (
      !diagnosticData ||
      !diagnosticData.variableName ||
      typeof diagnosticData.argumentOffset !== 'number' ||
      !Array.isArray(diagnosticData.expectedTypes) ||
      diagnosticData.expectedTypes.length === 0 ||
      !this.cfgQueryEngine ||
      !this.typeChecker
    ) {
      return false; // Can't re-check without necessary data
    }

    const varName: string = diagnosticData.variableName;
    const argumentOffset: number = diagnosticData.argumentOffset;

    // Query CFG for the variable's type at this position
    const cfgType = this.cfgQueryEngine.getTypeAtPosition(varName, argumentOffset);

    // Check if CFG type satisfies any of the expected types
    const expectedTypes = diagnosticData.expectedTypes as UcodeType[];
    const typeNarrowing = this.typeChecker.getTypeNarrowing();

    if (cfgType && typeNarrowing.isSubtypeOfUnion(cfgType, expectedTypes)) {
      return true; // Filter this diagnostic
    }

    // Use type checker's comprehensive AST-based guard detection
    // This handles null checks, truthy guards, builtin call guards, etc.
    const narrowedType = this.typeChecker.getNarrowedTypeAtPosition(varName, argumentOffset);
    if (narrowedType && typeNarrowing.isSubtypeOfUnion(narrowedType, expectedTypes)) {
      return true;
    }

    // Fall back to semantic analyzer's type() guard detection
    const guardTypes = this.findTypeGuardNarrowedTypes(varName, argumentOffset);
    if (
      guardTypes &&
      guardTypes.length > 0 &&
      guardTypes.every(type => expectedTypes.includes(type))
    ) {
      return true;
    }

    return false;
  }

  private filterDiagnosticsWithFlowSensitiveAnalysis(diagnostics: Diagnostic[]): Diagnostic[] {
    if (!this.currentASTRoot || !this.cfgQueryEngine) {
      return diagnostics;
    }

    return diagnostics.filter(diagnostic => {
      // Option C: Selective Re-checking
      // Check if this is a recheckable diagnostic (nullable-argument with variable name and AST node)
      if ((diagnostic as any).code === 'nullable-argument') {
        const diagnosticData = (diagnostic as any).data;
        if (
          diagnosticData &&
          diagnosticData.variableName &&
          typeof diagnosticData.argumentOffset === 'number' &&
          Array.isArray(diagnosticData.expectedTypes)
        ) {
          // Re-check this expression with CFG types
          const shouldFilter = this.recheckExpressionWithCFG(diagnostic);
          if (shouldFilter) {
            return false; // Filter out this diagnostic
          }
        }

        // Handle case where arg is a call to a null-propagating builtin (e.g., keys(obj.prop))
        // and the inner argument is property-access guarded by an enclosing if-block
        if (
          diagnosticData &&
          !diagnosticData.variableName &&
          typeof diagnosticData.argumentOffset === 'number'
        ) {
          if (this.isNullableArgGuardedByPropertyAccess(diagnosticData.argumentOffset)) {
            return false;
          }
        }
      }

      // Legacy: Check if this is a builtin argument warning about "may be X"
      if (diagnostic.message.includes("may be") && diagnostic.severity === DiagnosticSeverity.Warning) {
        const diagnosticData = (diagnostic as any).data;
        if (diagnosticData && diagnosticData.variableName) {
          // This is the old path for diagnostics without AST nodes
          // Keep this for backward compatibility
        }
      }

      // Check if this is a null-related diagnostic on 'in' operator
      if (diagnostic.message.includes("'in' operator") &&
          diagnostic.message.includes("possibly 'null'")) {

        // Try to determine what variable this diagnostic is about
        // This is a heuristic based on the diagnostic message
        const variableMatch = diagnostic.message.match(/Argument is possibly 'null'/);

        if (variableMatch) {
          // Find the AST node at this position
          const position = diagnostic.range.start.character;
          const line = diagnostic.range.start.line;

          // Convert line-based position to character position (approximation)
          const textLines = this.textDocument.getText().split('\n');
          let charPosition = 0;
          for (let i = 0; i < line && i < textLines.length; i++) {
            const lineText = textLines[i];
            if (lineText !== undefined) {
              charPosition += lineText.length + 1; // +1 for newline
            }
          }
          charPosition += position;

          // Find if this position contains a null guard
          if (this.currentASTRoot && this.findNullGuardAtPosition(this.currentASTRoot, charPosition)) {
            return false; // Filter out this diagnostic
          }
        }
      }

      return true; // Keep all other diagnostics
    });
  }

  private findTypeGuardNarrowedTypes(variableName: string, offset: number): UcodeType[] | null {
    if (!this.currentASTRoot) {
      return null;
    }

    return this.searchTypeGuardForPosition(this.currentASTRoot, variableName, offset);
  }

  private searchTypeGuardForPosition(node: AstNode, variableName: string, offset: number): UcodeType[] | null {
    if (!this.nodeContainsPosition(node, offset)) {
      return null;
    }

    switch (node.type) {
      case 'IfStatement': {
        const ifNode = node as IfStatementNode;
        if (this.nodeContainsPosition(ifNode.consequent, offset)) {
          const guardInfo = this.collectTypeGuardTypes(ifNode.test, variableName);
          if (guardInfo.pure && guardInfo.types.size > 0) {
            return Array.from(guardInfo.types);
          }
        }

        const inConsequent = this.searchTypeGuardForPosition(ifNode.consequent, variableName, offset);
        if (inConsequent) {
          return inConsequent;
        }

        if (ifNode.alternate) {
          const inAlternate = this.searchTypeGuardForPosition(ifNode.alternate, variableName, offset);
          if (inAlternate) {
            return inAlternate;
          }
        }
        return null;
      }

      case 'BlockStatement': {
        const blockNode = node as BlockStatementNode;
        for (const statement of blockNode.body) {
          const result = this.searchTypeGuardForPosition(statement, variableName, offset);
          if (result) {
            return result;
          }
        }
        return null;
      }

      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const body = (node as any).body;
        if (body) {
          return this.searchTypeGuardForPosition(body, variableName, offset);
        }
        return null;
      }

      default:
        break;
    }

    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (!child) {
        continue;
      }

      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) {
            const result = this.searchTypeGuardForPosition(item as AstNode, variableName, offset);
            if (result) {
              return result;
            }
          }
        }
      } else if (typeof child === 'object' && 'type' in child) {
        const result = this.searchTypeGuardForPosition(child as AstNode, variableName, offset);
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  private collectTypeGuardTypes(condition: AstNode, variableName: string): { types: Set<UcodeType>; pure: boolean } {
    const result = { types: new Set<UcodeType>(), pure: true };

    const visit = (expr: AstNode | null | undefined): void => {
      if (!expr || !result.pure) {
        return;
      }

      switch (expr.type) {
        case 'LogicalExpression': {
          const logical = expr as LogicalExpressionNode;
          visit(logical.left);
          visit(logical.right);
          return;
        }

        case 'BinaryExpression': {
          const binary = expr as BinaryExpressionNode;
          if (binary.operator === '==' || binary.operator === '===') {
            const direct = this.extractTypeCheck(binary.left, binary.right, variableName);
            const reversed = this.extractTypeCheck(binary.right, binary.left, variableName);

            const matchedType = direct ?? reversed;
            if (matchedType) {
              result.types.add(matchedType);
              return;
            }
          }

          result.pure = false;
          return;
        }

        default:
          result.pure = false;
          return;
      }
    };

    visit(condition);
    return result;
  }

  private extractTypeCheck(left: AstNode, right: AstNode, variableName: string): UcodeType | null {
    if (
      left.type === 'CallExpression' &&
      this.isTypeCallOnVariable(left as CallExpressionNode, variableName) &&
      right.type === 'Literal'
    ) {
      const literal = right as LiteralNode;
      if (typeof literal.value === 'string') {
        return this.mapTypeStringToUcodeType(literal.value);
      }
    }

    return null;
  }

  private isTypeCallOnVariable(node: CallExpressionNode, variableName: string): boolean {
    if (node.callee.type !== 'Identifier') {
      return false;
    }

    if ((node.callee as IdentifierNode).name !== 'type') {
      return false;
    }

    if (!node.arguments || node.arguments.length !== 1) {
      return false;
    }

    const arg = node.arguments[0];
    return !!arg && arg.type === 'Identifier' && (arg as IdentifierNode).name === variableName;
  }

  private mapTypeStringToUcodeType(typeStr: string): UcodeType | null {
    switch (typeStr) {
      case 'string':
        return UcodeType.STRING;
      case 'int':
        return UcodeType.INTEGER;
      case 'double':
        return UcodeType.DOUBLE;
      case 'bool':
        return UcodeType.BOOLEAN;
      case 'array':
        return UcodeType.ARRAY;
      case 'object':
        return UcodeType.OBJECT;
      case 'function':
        return UcodeType.FUNCTION;
      case 'null':
        return UcodeType.NULL;
      default:
        return null;
    }
  }

  private nodeContainsPosition(node: AstNode | null | undefined, offset: number): boolean {
    if (!node || typeof node !== 'object') {
      return false;
    }

    if (typeof (node as any).start !== 'number' || typeof (node as any).end !== 'number') {
      return false;
    }

    return offset >= (node as any).start && offset <= (node as any).end;
  }

  /**
   * Check if a nullable-argument diagnostic at the given offset should be suppressed
   * because the argument is a call to a null-propagating builtin whose inner argument
   * is property-access guarded by an enclosing if-block.
   *
   * Example: if (obj.prop['key'] != null) length(keys(obj.prop)) — obj.prop is guarded
   */
  private isNullableArgGuardedByPropertyAccess(argumentOffset: number): boolean {
    if (!this.currentASTRoot) return false;

    // Find the AST node at the argument offset
    const argNode = this.findCallExpressionAt(this.currentASTRoot, argumentOffset);
    if (!argNode || argNode.type !== 'CallExpression') return false;

    const callNode = argNode as CallExpressionNode;
    // Check if it's a null-propagating builtin
    if (callNode.callee.type !== 'Identifier') return false;
    const funcName = (callNode.callee as IdentifierNode).name;
    const nullPropagating = ['keys', 'values', 'length', 'sort', 'reverse', 'uniq',
      'pop', 'shift', 'slice', 'splice', 'join', 'split', 'trim', 'ltrim', 'rtrim',
      'index', 'rindex', 'filter', 'map', 'substr', 'match'];
    if (!nullPropagating.includes(funcName)) return false;

    // Get the first argument
    if (!callNode.arguments || callNode.arguments.length === 0) return false;
    const innerArg = callNode.arguments[0];
    if (!innerArg) return false;

    // Build the dotted path for the inner argument (e.g., env.netifd_mark)
    const memberPath = this.getMemberExpressionPath(innerArg);
    if (!memberPath) return false;

    // Check if there's an enclosing if-block that property-access guards this path
    return this.hasPropertyAccessGuard(this.currentASTRoot, memberPath, argumentOffset);
  }

  /**
   * Build a dotted path string from a MemberExpression node.
   * Returns null for computed access or non-identifier bases.
   * e.g., env.netifd_mark → "env.netifd_mark"
   */
  private getMemberExpressionPath(node: AstNode): string | null {
    if (node.type === 'Identifier') {
      return (node as IdentifierNode).name;
    }
    if (node.type === 'MemberExpression') {
      const member = node as MemberExpressionNode;
      if (!member.computed && member.property.type === 'Identifier') {
        const objPath = this.getMemberExpressionPath(member.object);
        if (objPath) {
          return `${objPath}.${(member.property as IdentifierNode).name}`;
        }
      }
    }
    return null;
  }

  /**
   * Check if there's an enclosing if-block whose condition implies the given
   * member path is an object (non-null). This is detected when the condition
   * contains path['key'] != null or path.prop != null.
   *
   * In ucode, if obj['key'] != null, then obj must be a non-null object
   * (null[anything] returns null).
   */
  private hasPropertyAccessGuard(node: AstNode, memberPath: string, position: number): boolean {
    if (node.type === 'IfStatement') {
      const ifNode = node as IfStatementNode;

      // Check if position is inside the consequent (then-block)
      if (ifNode.consequent &&
          position >= ifNode.consequent.start &&
          position <= ifNode.consequent.end) {
        // Check if the condition is a property-access null check on memberPath
        if (this.conditionImpliesObjectType(ifNode.test, memberPath)) {
          return true;
        }
      }
    }

    // Recurse into child nodes
    const childProps = ['body', 'consequent', 'alternate'];
    for (const prop of childProps) {
      const child = (node as any)[prop];
      if (child) {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type &&
                position >= item.start && position <= item.end) {
              if (this.hasPropertyAccessGuard(item, memberPath, position)) {
                return true;
              }
            }
          }
        } else if (typeof child === 'object' && child.type &&
                   position >= child.start && position <= child.end) {
          if (this.hasPropertyAccessGuard(child, memberPath, position)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if a condition expression implies that memberPath is an object.
   * Patterns detected:
   *   - memberPath.prop != null
   *   - memberPath['key'] != null
   *   - null != memberPath.prop
   *   - null != memberPath['key']
   *   - memberPath != null (direct null check)
   * Also handles && combinations.
   */
  private conditionImpliesObjectType(condition: AstNode, memberPath: string): boolean {
    if (!condition) return false;

    if (condition.type === 'BinaryExpression') {
      const expr = condition as BinaryExpressionNode;

      // Handle && — check both sides
      if (expr.operator === '&&') {
        return this.conditionImpliesObjectType(expr.left, memberPath) ||
               this.conditionImpliesObjectType(expr.right, memberPath);
      }

      // Handle != null / !== null
      if (expr.operator === '!=' || expr.operator === '!==') {
        const nullSide = this.isNullLiteral(expr.right) ? expr.left :
                         this.isNullLiteral(expr.left) ? expr.right : null;
        if (!nullSide) return false;

        // Direct null check: memberPath != null
        const directPath = this.getMemberExpressionPath(nullSide);
        if (directPath === memberPath) return true;

        // Property access null check: memberPath.X != null or memberPath['X'] != null
        if (nullSide.type === 'MemberExpression') {
          const parentPath = this.getMemberExpressionPath((nullSide as MemberExpressionNode).object);
          if (parentPath === memberPath) return true;
        }
      }
    }

    // Handle LogicalExpression (&&, ||)
    if (condition.type === 'LogicalExpression') {
      const logical = condition as LogicalExpressionNode;
      if (logical.operator === '&&') {
        return this.conditionImpliesObjectType(logical.left, memberPath) ||
               this.conditionImpliesObjectType(logical.right, memberPath);
      }
    }

    return false;
  }

  private isNullLiteral(node: AstNode): boolean {
    return node.type === 'Literal' && (node as LiteralNode).value === null;
  }

  /**
   * Find a CallExpression AST node at the given offset.
   */
  private findCallExpressionAt(node: AstNode, offset: number): AstNode | null {
    if (!node || typeof node !== 'object') return null;
    if (node.start > offset || node.end < offset) return null;

    // Check if this node is a CallExpression starting at the offset
    if (node.type === 'CallExpression' && node.start === offset) {
      return node;
    }

    // Recurse into children
    const childProps = ['body', 'consequent', 'alternate', 'test', 'left', 'right',
      'argument', 'callee', 'arguments', 'init', 'update', 'declarations',
      'expression', 'elements', 'properties', 'value', 'object', 'property'];
    for (const prop of childProps) {
      const child = (node as any)[prop];
      if (child) {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type) {
              const found = this.findCallExpressionAt(item, offset);
              if (found) return found;
            }
          }
        } else if (typeof child === 'object' && child.type) {
          const found = this.findCallExpressionAt(child, offset);
          if (found) return found;
        }
      }
    }

    return null;
  }

  private findNullGuardAtPosition(node: AstNode, position: number): boolean {
    // Look for 'in' operators at this position
    if (node.type === 'BinaryExpression') {
      const binaryNode = node as BinaryExpressionNode;
      if (binaryNode.operator === 'in' && 
          position >= binaryNode.start && 
          position <= binaryNode.end &&
          binaryNode.right && 
          binaryNode.right.type === 'Identifier') {
        
        const variableName = (binaryNode.right as IdentifierNode).name;
        return this.findContainingNullGuard(this.currentASTRoot!, variableName, position);
      }
    }
    
    // Recursively check children
    const childProps = ['body', 'consequent', 'alternate', 'test', 'left', 'right', 'argument', 'callee', 'arguments'];
    for (const prop of childProps) {
      const child = (node as any)[prop];
      if (child) {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === 'object' && item.type) {
              if (this.findNullGuardAtPosition(item, position)) {
                return true;
              }
            }
          }
        } else if (typeof child === 'object' && child.type) {
          if (this.findNullGuardAtPosition(child, position)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
}
