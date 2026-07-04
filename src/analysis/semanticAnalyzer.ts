/**
 * Semantic Analyzer for ucode
 * Combines symbol table, type checking, and other semantic analyses
 */

import { type AstNode, type ProgramNode, type VariableDeclarationNode, type VariableDeclaratorNode, 
         type FunctionDeclarationNode, type FunctionExpressionNode, type IdentifierNode, type CallExpressionNode,
         type BlockStatementNode, type ReturnStatementNode, type BreakStatementNode, 
         type ContinueStatementNode, type AssignmentExpressionNode, type BinaryExpressionNode, type UnaryExpressionNode, type LogicalExpressionNode, type ImportDeclarationNode,
         type ImportSpecifierNode, type ImportDefaultSpecifierNode, type ImportNamespaceSpecifierNode,
         type PropertyNode, type MemberExpressionNode, type TryStatementNode, type CatchClauseNode,
         type ExportNamedDeclarationNode, type ExportDefaultDeclarationNode, type ArrowFunctionExpressionNode,
         type SpreadElementNode, type TemplateLiteralNode, type SwitchStatementNode, type LiteralNode, type IfStatementNode, type ObjectExpressionNode, type ConditionalExpressionNode, type ExpressionStatementNode, type DeleteExpressionNode,
         type ForInStatementNode, type ForStatementNode, type WhileStatementNode,
         type AstNodeKind } from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, type UcodeDataType, isArrayType, getArrayElementType, getUnionTypes, extractModuleType, singleTypeToBase, dataTypeToBase, createUnionType, widenWithNull, type SingleType, type ParamInfo, type Symbol as SymbolEntry } from './symbolTable';
import { TypeChecker, type TypeCheckResult } from './types';
import { detectTemplateMode } from '../lexer/templateMode';
import { BaseVisitor, AnalysisDepthExceeded, MAX_ANALYSIS_DEPTH } from './visitor';
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, type DiagnosticRelatedInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { allBuiltinFunctions } from '../builtins';
import { FileResolver, type FactoryReturnInfo, type LoadfileGlobal, type LoadfileProgramReturn } from './fileResolver';
import { CFGBuilder } from './cfg/cfgBuilder';
import { CFGQueryEngine } from './cfg/queryEngine';
import { type ControlFlowGraph } from './cfg/types';
import { FsObjectType, createFsObjectDataType } from './fsTypes';
import { fsModuleTypeRegistry, fsConstants, getFsReturnObjectType, fsReturnIsNullable } from './fsModuleTypes';
import { uloopObjectRegistry } from './uloopTypes';
import { createExceptionObjectDataType } from './exceptionTypes';
import { UcodeErrorCode } from './errorConstants';
import { type UcodeTargetVersion, type VersionGatedFeature, VERSION_FEATURES, VERSION_MODULES, VERSION_MODULE_FUNCTIONS, VERSION_OBJECT_METHODS, VERSION_GLOBAL_BUILTINS, PLATFORM_GATED_SYMBOLS, targetLacksFeature, DEFAULT_TARGET_VERSION } from './ucodeVersions';
import { parseJsDocComment, resolveTypeExpression, parseImportTypeExpression, extractTypedef, type ParsedTypedef } from './jsdocParser';
import { KNOWN_HOST_GLOBALS, isHostEntryPointCallback } from './hostGlobals';
import { THROWING_BUILTINS } from './throwingBuiltins';
import { KNOWN_MODULES } from './moduleTypes';
import { type JsDocCommentNode } from '../ast/nodes';
import { Either, Option } from 'effect';
import { MODULE_REGISTRIES, OBJECT_REGISTRIES, isKnownModule, isKnownObjectType, resolveReturnObjectType, validateImport } from './moduleDispatch';

/** An AST node viewed as an open record, for dynamic traversal/field access. The base
 *  `AstNode` interface only enumerates `type`/`start`/`end`; the generic walkers read
 *  kind-specific fields after a `type`-string guard. */
type AnyNode = AstNode & Record<string, unknown>;

/** Narrow an arbitrary value to a traversable AST-like node (an object with a string `type`). */
function isAstNodeLike(n: unknown): n is AnyNode {
  return !!n && typeof n === 'object' && typeof (n as { type?: unknown }).type === 'string';
}

/** Any function-shaped AST node (declaration, expression, or arrow). */
type FunctionLikeNode = FunctionDeclarationNode | FunctionExpressionNode | ArrowFunctionExpressionNode;

export interface SemanticAnalysisOptions {
  enableScopeAnalysis?: boolean;
  enableTypeChecking?: boolean;
  enableControlFlowAnalysis?: boolean;
  enableUnusedVariableDetection?: boolean;
  enableShadowingWarnings?: boolean;
  workspaceRoot?: string | undefined;
  /** Which OpenWrt release's ucode to target for version-divergent diagnostics
   *  (e.g. `export function` without a trailing `;`). Defaults to 'main' (newest). */
  targetVersion?: UcodeTargetVersion;
  /** When true (default), a pure-UNKNOWN builtin argument under 'use strict' is an
   *  error (TypeScript noImplicitAny style); when false it stays a warning. Proven
   *  mismatches / possibly-null args always error. `ucode.strictUnknownArguments`. */
  strictUnknownArguments?: boolean;
  /** When true, calls to builtins that throw on bad input (json/loadfile/loadstring/
   *  require/render) outside a try/catch are flagged (UC8001) with a "wrap in try/catch" fix.
   *  The PRODUCT default (server / `ucode.warnUnguardedThrowingCalls`) is ON; this option
   *  itself defaults off when omitted, so programmatic/library callers opt in explicitly. */
  warnUnguardedThrowingCalls?: boolean;
  /** When true, `require()`/`loadfile()` are flagged even when their argument provably resolves
   *  (a resolved module/path can still throw on a compile/runtime error). Default off — a
   *  resolvable require/loadfile is normally silent. `ucode.warnResolvableThrowingCalls`. */
  warnResolvableThrowingCalls?: boolean;
  /** When true, ALL unguarded throwing-builtin calls escalate to an Error under 'use strict'.
   *  Default off — only `json()` escalates by default; the rest stay warnings even under strict.
   *  `ucode.strictThrowingCalls`. */
  strictThrowingCalls?: boolean;
  /** When true, a read of a name with no visible declaration is treated as an implicit
   *  global instead of UC1001 (matches non-strict runtime null-safety). Default off —
   *  hides typos. `ucode.assumeUndefinedGlobalsDefined`. (Case 3 blanket suppress.) */
  assumeUndefinedGlobalsDefined?: boolean;
  /** Case-2 (global-scope soundness): flag a top-level read of a global that lexically
   *  precedes every assignment/loadfile that defines it (in-file or cross-file) — the
   *  strict Reference-error / non-strict-null case (UC8002).
   *   - 'errorInStrict' (default): Warning, escalated to Error under 'use strict'.
   *   - 'warn': always Warning.
   *   - 'off': disabled.
   *  Conservative: never fires when the global is assigned inside any function (call timing
   *  unknown) or for reads inside functions. `ucode.uncertainGlobalScope`. */
  uncertainGlobalScope?: 'off' | 'warn' | 'errorInStrict';
}

export interface SemanticAnalysisResult {
  diagnostics: Diagnostic[];
  symbolTable: SymbolTable;
  typeResults: Map<AstNode, TypeCheckResult>;
  typeChecker?: TypeChecker;
  ast?: ProgramNode;
  cfg?: ControlFlowGraph;
  cfgQueryEngine?: CFGQueryEngine;
  /** Set of file:// URIs this file imports (excludes builtin:// modules).
   *  Used by the server to invalidate this file's cache when a dependency
   *  changes — see analysisCache reverse-deps tracking in server.ts. */
  resolvedImports?: Set<string>;
  /** Globals injected by `loadfile("x.uc")()` in this file, keyed by name → the loaded
   *  file's URI + the definition's offset range there + a coarse type. Powers go-to-definition
   *  and hover for those names (which have no in-file symbol). */
  loadfileGlobals?: Map<string, LoadfileGlobal>;
  /** In-file global definition sites, keyed by name: every `global.X = …` property span,
   *  every bare implicit-global assignment target, and every JSDoc `@global X` tag name.
   *  Powers go-to-definition for globals that have no declared symbol (scalars, @global). */
  globalDefSites?: Map<string, Array<{ start: number; end: number }>>;
  /** True when this file is a uhttpd ucode handler: a `{% … %}` template that assigns
   *  `global.handle_request` (uhttpd's per-request entry point). Gates handler-specific
   *  diagnostics (the uhttpd runtime contract) — see docs/uhttpd-false-negatives.md. */
  isUhttpdHandler?: boolean;
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
  private resolvedImports: Set<string> = new Set();
  private currentFunctionNode: FunctionDeclarationNode | null = null;
  private functionReturnTypes = new Map<FunctionDeclarationNode, { node: ReturnStatementNode, type: UcodeDataType }[]>();
  private functionReturnPropertyTypes = new Map<FunctionDeclarationNode, Map<string, UcodeDataType>[]>();
  // Per return branch: source location of each function-valued property in a returned
  // object literal, so signature help / goto-def works on a SAME-FILE factory's methods
  // (the cross-file path gets these from FileResolver; this is the local equivalent).
  private functionReturnPropertyLocations = new Map<FunctionDeclarationNode, Map<string, { uri: string; start: number; end: number }>[]>();
  private processingFunctionCallCallee = false; // Track when processing function call callee
  private visitingMemberBase = false; // Track when visiting the receiver of `obj.x` (suppresses the generic Undefined-variable for a known-module base, which validateModuleMember reports more specifically)
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
  private thisObjectNodeStack: ObjectExpressionNode[] = []; // Parallel to thisPropertyStack: the object node, so `this.method()` return types resolve from sibling function properties (define-before-use)

  // ── Function-level incremental analysis ──────────────────────────────────────────────
  // Bodies the caller determined are UNCHANGED and whose environment fingerprint is unchanged.
  // Keyed by the body BlockStatement's start offset. The SCOPE visit of these bodies still
  // runs fully (so declarations, usage, and cross-sibling shadowing stay correct), but the
  // TypeChecker short-circuits inside them (see typeChecker.setCleanRanges), skipping the
  // expensive type computation. The cached type-checker diagnostics are replayed and the
  // cached return type restored. See docs/incremental-analysis.md + the harness.
  // Per clean body: its end offset, cached return type, and the FULL set of diagnostics that
  // fell inside it last time (re-anchored to current positions by the caller). The scope
  // visit re-emits scope diagnostics fresh; we add back only the cached ones it didn't
  // re-emit (the type-checker diagnostics, which were short-circuited).
  private cleanBodies: Map<number, { bodyEnd: number; returnType: unknown; diagnostics: Diagnostic[]; thisWrites: Array<[string, unknown]> }> = new Map();

  /** Provide the set of unchanged function/method bodies whose type checking can be skipped.
   *  The type checker short-circuits inside their ranges; the analyzer restores the cached
   *  return type and dedup-merges the cached diagnostics with the fresh scope ones. Hover/
   *  completion inside a skipped body are served by the server from a lazily-computed full
   *  analysis, not from this fast pass. */
  setCleanBodies(m: Map<number, { bodyEnd: number; returnType: unknown; diagnostics: Diagnostic[]; thisWrites: Array<[string, unknown]> }>): void {
    this.cleanBodies = m;
    const ranges = [...m.entries()].map(([start, v]) => ({ start, end: v.bodyEnd }));
    this.typeChecker.setCleanRanges(ranges);
  }

  /** After a clean body's scope visit, add back the cached diagnostics the fresh visit did NOT
   *  re-emit (the type-checker ones, suppressed by the short-circuit). Dedup by position+code+
   *  message so the fresh scope diagnostics aren't duplicated. `before` = diagnostics length
   *  captured just before visiting this body. */
  private replayCleanBodyTypeDiagnostics(clean: { diagnostics: Diagnostic[] }, before: number): void {
    const fresh = new Set<string>();
    for (let i = before; i < this.diagnostics.length; i++) {
      const d = this.diagnostics[i]!;
      fresh.add(`${d.range.start.line}:${d.range.start.character}:${d.code}:${d.message}`);
    }
    for (const d of clean.diagnostics) {
      const key = `${d.range.start.line}:${d.range.start.character}:${d.code}:${d.message}`;
      if (!fresh.has(key)) this.diagnostics.push(d);
    }
  }
  private truthinessDepth = 0; // Track when we're inside a truthiness context (if test, !, ternary test)
  private callbackElementType: UcodeDataType | null = null; // Element type to pass to callback parameters (filter/map/sort)
  private typedefRegistry: Map<string, ParsedTypedef> = new Map(); // File-level @typedef definitions
  // File-level `@global [{type}] name` declarations: name → type string ('' if untyped).
  // Plus the built-in host-globals registry — both "explain" a name so a read isn't UC1001.
  private declaredGlobalNames: Map<string, string> = new Map();
  private strictMode = false; // Whether 'use strict'; is present
  // Function symbols whose REAL declaration has been visited. The hoist pre-pass
  // pre-declares every top-level function, so the symbol table alone can't tell a
  // first declaration from a redeclaration; this set records the first real visit
  // so a second `function NAME` in the same scope can be flagged (UC1007).
  private realizedFunctions = new Set<SymbolEntry>();
  // Names that are bare-assignment targets (`x = …`, not `let`/`const`) somewhere in the
  // module. In non-strict ucode that auto-creates an implicit GLOBAL, so reading such a
  // name anywhere is valid (returns null until assigned, never a runtime error). Used to
  // suppress UC1001 for provable implicit globals. Empty under 'use strict'.
  private implicitGlobalNames = new Set<string>();
  // Names injected into THIS file by an `include(path, { … })` somewhere in the workspace
  // (ucode template render-scope). Verified vs the oracle: the scope keys become globals in
  // the included file — in strict mode too — so reading them is never "undefined". Set by the
  // server from the cross-file include index (includeScope.ts); empty when not included.
  private injectedScopeNames = new Set<string>();
  // Per-name inferred type (parseable type string) for injected names, from the include
  // site's scope value expressions. Parsed + handed to the type checker in visitProgram.
  private injectedScopeTypeStrings: Map<string, string> | undefined;
  // Identifier reads that resolved to nothing during the pass. Deferred to a finalize
  // step (resolvePendingUndefinedRefs) so each can be classified — once ALL declarations
  // (incl. later let/const) are known — as either "used before its declaration" (UC1011)
  // or a plain "Undefined variable" (UC1001). Single-pass ordering makes this impossible
  // inline: a `const C` below the use isn't in the table yet when the use is visited.
  private pendingUndefinedRefs: Array<{ name: string; start: number; end: number }> = [];
  // Names installed on the builtin `global` object via `global.X = …` anywhere in the
  // module. Shared with the type checker so a bare call `X(...)` isn't a false "Undefined
  // function" — `global.X` is a real global binding in BOTH strict and non-strict mode.
  private globalPropertyNames = new Set<string>();
  private loadfileGlobals = new Map<string, LoadfileGlobal>();
  private globalDefSites = new Map<string, Array<{ start: number; end: number }>>();
  /** This file is a uhttpd handler — a `{%` template that assigns `global.handle_request`.
   *  Gates the handler-specific diagnostics (FN-1/2/4/5). See docs/uhttpd-false-negatives.md. */
  private isUhttpdHandler = false;
  /** This file is ucode template mode (`{% … %}`). Used with the `handle_request` signal to
   *  classify handler-form errors (FN-1 non-template vs FN-2 wrong entry-point form). */
  private isTemplateFile = false;
  /** Globals whose EVERY assignment is a straight-line top-level scalar (`global.X = 1; …
   *  global.X = "s";`) — execution order is statically known, so reads can be SSA-typed
   *  positionally (declare a symbol, update dataType per assignment in source order). */
  private scalarSSAEligible = new Set<string>();
  /** Globals bound to an object LITERAL (`global.X = {…}`) — candidates for the
   *  never-assigned-property check (UC8006) when their shape is fully visible. */
  private globalObjectBindings = new Set<string>();
  // Name to attribute to the next function-expression we visit, set by the
  // enclosing assignment/declaration (e.g. `nft_file.init = function(){}`), so a
  // method-style function expression can get the same UC7003 "add @param" hint as
  // a named declaration. Anonymous callbacks (map/filter) leave this null → no hint.
  private pendingFunctionExprName: string | null = null;

  constructor(textDocument: TextDocument, options: SemanticAnalysisOptions = {}) {
    super();
    this.textDocument = textDocument;
    this.symbolTable = new SymbolTable();
    this.typeChecker = new TypeChecker(this.symbolTable);
    this.fileResolver = new FileResolver(options.workspaceRoot);
    this.typeChecker.setFileResolver(this.fileResolver);
    this.options = {
      enableScopeAnalysis: true,
      enableTypeChecking: true,
      enableControlFlowAnalysis: true,
      enableUnusedVariableDetection: true,
      enableShadowingWarnings: true,
      ...options
    };

  }

  private get targetVersion(): UcodeTargetVersion {
    return this.options.targetVersion ?? DEFAULT_TARGET_VERSION;
  }

  /**
   * Emit a portability diagnostic for a version-gated feature when the configured
   * target release predates the feature. Centralizes the gating + messaging so a
   * new divergence is just a `VERSION_FEATURES` entry plus a call here.
   */
  private flagVersionFeature(feature: VersionGatedFeature, start: number, end: number): void {
    if (!targetLacksFeature(this.targetVersion, feature.introducedIn)) return;
    this.flagVersionMin(feature.introducedIn,
      `${feature.label} requires {INTRO}'s ucode`, `To stay compatible, ${feature.remedy}`, start, end);
  }

  /** Emit UC6006 (Information) when `module.symbol` is compiled only on a specific
   *  platform — e.g. io's `IOC_DIR_*` constants are `#if defined(__linux__)` in lib/io.c.
   *  It's a portability note, not an error: they exist on OpenWrt (Linux) but are absent
   *  from a non-Linux ucode build (macOS/BSD). */
  private flagPlatformGated(moduleName: string, symbol: string, start: number, end: number): void {
    const platform = PLATFORM_GATED_SYMBOLS[`${moduleName}.${symbol}`];
    if (!platform) return;
    this.addDiagnosticErrorCode(
      UcodeErrorCode.PLATFORM_GATED_SYMBOL,
      `\`${moduleName}.${symbol}\` is ${platform}-only — it is compiled into ucode's ${moduleName} module only on ${platform} (e.g. OpenWrt), and is absent from a non-${platform} build (macOS/BSD). Safe for ${platform} targets; guard or avoid for portable code.`,
      start, end, DiagnosticSeverity.Information,
    );
  }

  /** True when the whole module is itself gated out at the current target (so a
   *  per-function/method gate on it would be a redundant second diagnostic). */
  private moduleGatedOutAtTarget(moduleName: string): boolean {
    const v = VERSION_MODULES[moduleName];
    return !!v && targetLacksFeature(this.targetVersion, v);
  }

  /** Emit UC6005 if the target predates `introducedIn`. `{INTRO}` in `what` is
   *  replaced with the introducing release; `remedy` ends with the how-to-fix hint.
   *
   *  Severity escalates to ERROR under `'use strict'`, Warning otherwise: using a
   *  module/function/syntax that doesn't exist on the target is a guaranteed
   *  compile-time failure there (named imports + module paths resolve at compile
   *  time), so under strict it's a hard error like the other strict escalations.
   *  Non-strict keeps it a warning since the gate is keyed on the configured
   *  `ucode.targetVersion` assumption rather than a defect in the source. */
  private flagVersionMin(introducedIn: UcodeTargetVersion, what: string, remedy: string, start: number, end: number): void {
    if (!targetLacksFeature(this.targetVersion, introducedIn)) return;
    const intro = introducedIn === 'main' ? 'OpenWrt main/snapshot' : `OpenWrt ${introducedIn}`;
    this.addDiagnosticErrorCode(
      UcodeErrorCode.TARGET_VERSION_UNSUPPORTED,
      `${what.replace('{INTRO}', intro)}, but the configured target is OpenWrt ${this.targetVersion}. ${remedy} — or change \`ucode.targetVersion\`.`,
      start, end, this.strictMode ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    );
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
    this.functionReturnPropertyLocations.clear();
    this.disabledLines.clear();
    this.disabledRanges = [];
    this.linesWithSuppressedDiagnostics.clear();
    this.resolvedImports = new Set();
    this.pendingUndefinedRefs = [];

    // Store the AST root for later reference
    if (ast.type === 'Program') {
      this.currentASTRoot = ast as ProgramNode;
      // Pass the AST to TypeChecker for direct analysis
      this.typeChecker.setAST(this.currentASTRoot);
      // Source text lets builtin validators read the RAW slice of a node (e.g. a string
      // literal's exact characters), which the decoded `.value` can't reproduce (#32 message).
      this.typeChecker.setSource(this.textDocument.getText());
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

      // Now that every declaration is known, classify the deferred unresolved reads as
      // either "used before its declaration" or "Undefined variable". Must run BEFORE
      // checkUnusedVariables so a use-before-decl marks its declaration used (no UC1006).
      this.resolvePendingUndefinedRefs();

      // CFG-based reachability analysis (if enabled)
      if (this.options.enableControlFlowAnalysis && this.currentASTRoot) {
        try {
          // Build the Control Flow Graph
          const cfgBuilder = new CFGBuilder('top-level');
          this.cfg = cfgBuilder.build(this.currentASTRoot);

          // Create query engine for reachability (unreachable-code) queries
          this.cfgQueryEngine = new CFGQueryEngine(this.cfg);

          // Filter out false "Undefined function" errors for variables with unknown type
          this.filterUndefinedFunctionErrorsWithCFG();

          // Detect unreachable code
          this.detectUnreachableCode();
        } catch (cfgError) {
          // CFG analysis is best-effort; don't fail the whole analysis if it errors
          console.error('CFG analysis error:', cfgError);
          this.cfg = null;
          this.cfgQueryEngine = null;
        }
      }

      // Post-analysis checks
      if (this.options.enableUnusedVariableDetection) {
        this.checkUnusedVariables();
      }

      // Check for unnecessary disable comments
      this.checkUnnecessaryDisableComments();

    } catch (error) {
      // A deep-nesting overflow degrades to one honest "too deeply nested" warning; any other
      // error keeps the generic "Semantic analysis error" report. (#117)
      if (!this.reportTraversalOverflow(error, ast)) {
        this.addDiagnostic(
          `Semantic analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ast.start,
          ast.end,
          DiagnosticSeverity.Error
        );
      }
    }

    // Phase B (B5): build the per-function flow engines now that the main pass
    // is complete — the checked-type cache (getTypeOf) and function signatures
    // are fully populated, so the engine's fixpoint is sound. This MUST run
    // before the flow-sensitive diagnostic filter below: that filter's
    // re-narrowing (recheckExpressionWithCFG → getNarrowedTypeAtPosition) is now
    // the engine's first diagnostic consumer, so it needs the engine populated.
    // Diagnostics emitted DURING the main pass are still computed without the
    // engine (it didn't exist yet) — the filter only ever SUPPRESSES false
    // positives, so the engine can refine but never invent a diagnostic.
    // These two traversals run OUTSIDE the main try/catch above and each recurse on the AST,
    // so on a deeply-nested expression they were the path by which a RangeError escaped and
    // killed the server. Contain them too. (#117)
    try {
      if (this.currentASTRoot) {
        this.typeChecker.buildFlowEngines(this.currentASTRoot);
      }
      // Post-process diagnostics to apply flow-sensitive narrowing
      this.diagnostics = this.filterDiagnosticsWithFlowSensitiveAnalysis(this.diagnostics);
    } catch (error) {
      if (!this.reportTraversalOverflow(error, ast)) throw error;
    }

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

    if (this.loadfileGlobals.size > 0) {
      result.loadfileGlobals = this.loadfileGlobals;
    }

    if (this.globalDefSites.size > 0) {
      result.globalDefSites = this.globalDefSites;
    }

    if (this.isUhttpdHandler) {
      result.isUhttpdHandler = true;
    }

    if (this.cfgQueryEngine) {
      result.cfgQueryEngine = this.cfgQueryEngine;
    }

    result.resolvedImports = new Set(this.resolvedImports);

    return result;
  }

  /**
   * Provide the render-scope a template receives from its includers (from the cross-file
   * include index). Names become valid globals in this file — UC1001 is suppressed for them
   * and they take their injected type (if known). Call before `analyze`.
   */
  setInjectedScope(names: Set<string>, types?: Map<string, string>): void {
    this.injectedScopeNames = names;
    this.injectedScopeTypeStrings = types;
  }

  override visitProgram(node: ProgramNode): void {
    // Hoist top-level function declarations so forward references resolve
    this.hoistFunctionDeclarations(node);
    // Bare `name = require("mod")` (no let) → declare name as a module handle, so
    // `name.member` resolves and isn't flagged "use module without importing".
    this.hoistBareRequireModules(node);
    // Collect implicit globals (non-strict bare assignments) so reads of them aren't
    // flagged "Undefined variable", and share the set with the type checker so a call
    // to an implicit global isn't flagged "Undefined function".
    this.collectImplicitGlobalNames(node);
    this.typeChecker.setImplicitGlobalNames(this.implicitGlobalNames);
    // Whether an unverifiable (UNKNOWN) builtin argument errors under 'use strict'
    // (default true, TypeScript-style). Off → such args stay warnings even under strict.
    this.typeChecker.setStrictUnknownArguments(this.options.strictUnknownArguments ?? true);
    // Collect `global.X = …` property names so a bare call `X(...)` isn't flagged
    // "Undefined function" (the variable check already honors these via isGlobalProperty;
    // the call check did not). Legal in strict mode too, so not strict-gated.
    this.collectGlobalPropertyNames(node);
    // Handler-file detection (Phase B): a uhttpd ucode handler is a `{%` template that
    // registers its per-request entry point via `global.handle_request = <callable>` (uhttpd
    // looks it up on the VM scope object — a local/export/return form is invisible to it).
    // Both conditions together are a strong, low-false-positive signal (nobody assigns
    // `global.handle_request` by accident). Runs after collectGlobalPropertyNames so the
    // property set is populated. Consumed by the handler-specific phases (C/D/E).
    this.isTemplateFile = detectTemplateMode(this.textDocument.getText());
    this.isUhttpdHandler = this.globalPropertyNames.has('handle_request') && this.isTemplateFile;
    // `loadfile("file.uc")()` runs file.uc's top-level code in the shared global scope —
    // a poor-man's import. Harvest the globals that file injects (its top-level
    // `global.X = …` + bare implicit-global assignments) so bare `X(...)`/`X` here isn't a
    // false UC1002/UC1001. (Verified vs the interpreter: those leak; fn-decls/let/const don't.)
    this.collectLoadfileGlobals(node);
    // Known/declared host globals (built-in registry + JSDoc `@global`). Runs AFTER
    // collectGlobalPropertyNames (which clears the set) so the names survive; merges into
    // the same globalPropertyNames set the type checker shares below.
    if (this.options.enableScopeAnalysis) this.scanGlobalDeclarations();
    this.typeChecker.setGlobalPropertyNames(this.globalPropertyNames);
    // Render-scope names injected into this file by an `include(path, {…})` elsewhere in
    // the workspace — share with the type checker so a bare call to one isn't flagged
    // "Undefined function". (Set externally via setInjectedScope before analyze.)
    this.typeChecker.setInjectedScopeNames(this.injectedScopeNames);
    // Parse the injected names' inferred type strings into data types so a bare read of an
    // injected name resolves to its type (member access / type()). (phase 4b typing)
    if (this.injectedScopeTypeStrings && this.injectedScopeTypeStrings.size > 0) {
      const parsed = new Map<string, UcodeDataType>();
      for (const [name, typeStr] of this.injectedScopeTypeStrings) {
        if (typeStr && typeStr !== 'unknown') parsed.set(name, this.typeChecker.parseReturnTypePublic(typeStr));
      }
      this.typeChecker.setInjectedScopeTypes(parsed);
    }
    // Global scope analysis
    super.visitProgram(node);
    // Flag forward declarations that are never completed by a real definition
    if (this.options.enableScopeAnalysis) {
      this.checkForwardDeclarations(node);
      // Flag `export { name }` of a name that isn't a module-local binding.
      this.checkExportedNames(node);
    }
    // Opt-in: flag calls to throwing builtins (json/loadfile/…) outside try/catch.
    if (this.options.warnUnguardedThrowingCalls) {
      this.checkUnguardedThrowingCalls(node);
    }
    // Blocking recv() on a socket.pair() socket that will hang forever. Runs here (not
    // during traversal) so the symbol table is complete — the send-suppression walk and
    // the initNode traces can see forward-declared sockets.
    if (this.options.enableScopeAnalysis) {
      this.checkBlockingSocketpairRecvs(node);
    }
    // uhttpd handler (Phase C / FN-4): loadfile()/loadfile()()/include() abort the request
    // VM uncatchably. Runs only for a detected handler file.
    if (this.isUhttpdHandler) {
      this.checkHandlerVmAbortingCalls(node);
    }
    // uhttpd handler authoring help (Phase D / FN-1 + FN-2): a `handle_request` registered
    // outside a `{%` template, or defined in a form uhttpd's scope lookup can't see.
    if (this.options.enableScopeAnalysis) {
      this.checkUhttpdHandlerForm(node);
    }
    // Case-2 global-scope soundness: a top-level read before any defining assignment/loadfile.
    if (this.options.enableScopeAnalysis && (this.options.uncertainGlobalScope ?? 'errorInStrict') !== 'off') {
      this.checkGlobalScopeOrder(node);
      this.checkGlobalTypeReassignment(node);
      this.checkNonDeterministicGlobalDefs(node);
      this.checkNeverAssignedGlobalProperties(node);
    }
    // UC8007: never-assigned property reads on fully-visible LOCAL object literals — not a
    // global-soup concern, so not gated by uncertainGlobalScope. Needs type checking for
    // the propertyTypes shape data.
    if (this.options.enableScopeAnalysis && this.options.enableTypeChecking) {
      this.checkNeverAssignedLocalProperties(node);
    }
  }

  /**
   * UC8006: a read of a property that is NEVER assigned on a global bound to an object
   * LITERAL (`global.CACHE = {}` … `CACHE.hot`) — provably always null at runtime, in this
   * file: the literal doesn't define it and no visible write creates it. Only fires when the
   * shape is FULLY VISIBLE — the global is tainted (silent) if it ever escapes or takes an
   * unanalyzable write:
   *   • the bare name (or `global.X`) used as a VALUE — call argument, RHS of another
   *     variable, array/object element, return value, … (an alias/callee could add props);
   *   • a COMPUTED write `X[k] = …` (unknown key);
   *   • reassigned to anything but another object literal.
   * Property WRITES anywhere (incl. `global.X.p = …` inside functions) count as defining the
   * property — this check is about "never", not "maybe not yet" (that's UC8004/8005's job).
   * Warning severity; `@global`-declared names are exempt; `uncertainGlobalScope: off` disables.
   */
  private checkNeverAssignedGlobalProperties(node: ProgramNode): void {
    if (this.globalObjectBindings.size === 0) return;

    // The bare identifier form only maps to the global when no local shadows it; keep this
    // simple and sound: skip any candidate name that is ALSO a top-level local or param
    // anywhere (rare for globals; avoids shadow bookkeeping).
    const candidates = new Set<string>();
    for (const name of this.globalObjectBindings) {
      if (!this.declaredGlobalNames.has(name)) candidates.add(name);
    }
    if (candidates.size === 0) return;

    // Is this node the identifier X or the member `global.X` (the two spellings of the
    // global's value)?
    const globalRefName = (n: AstNode): string | null => {
      if (n.type === 'Identifier') {
        const nm = (n as IdentifierNode).name;
        return candidates.has(nm) ? nm : null;
      }
      if (n.type === 'MemberExpression') {
        const m = n as MemberExpressionNode;
        if (!m.computed && m.object.type === 'Identifier' && (m.object as IdentifierNode).name === 'global'
            && m.property.type === 'Identifier' && candidates.has((m.property as IdentifierNode).name)) {
          return (m.property as IdentifierNode).name;
        }
      }
      return null;
    };

    const tainted = new Set<string>();
    const reads: Array<{ name: string; prop: string; start: number; end: number }> = [];
    // Locals that shadow a candidate name make bare references ambiguous → taint.
    const walk = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      const t = n.type;
      if (t === 'VariableDeclarator' || t === 'FunctionDeclaration') {
        const id = (n as unknown as { id?: AstNode }).id;
        if (id?.type === 'Identifier' && candidates.has((id as IdentifierNode).name)) tainted.add((id as IdentifierNode).name);
      }
      if ((t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression')) {
        for (const p of ((n as unknown as { params?: AstNode[] }).params || [])) {
          if (p?.type === 'Identifier' && candidates.has((p as IdentifierNode).name)) tainted.add((p as IdentifierNode).name);
        }
      }
      if (t === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        const left = a.left;
        // `global.X = <expr>`: an object literal refreshes the shape; anything else taints.
        const reName = left ? globalRefName(left) : null;
        if (reName && left!.type === 'MemberExpression') {
          if (a.right?.type !== 'ObjectExpression') tainted.add(reName);
          walk(a.right);
          return;
        }
        // `X.p = …` / `global.X.p = …`: a WRITE — the property exists; not a read of p.
        // `X[k] = …`: computed write → unknown key → taint.
        if (left?.type === 'MemberExpression') {
          const m = left as MemberExpressionNode;
          const baseName = globalRefName(m.object as AstNode);
          if (baseName) {
            if (m.computed) tainted.add(baseName);
            walk(a.right);
            return;
          }
        }
        walk(a.left);
        walk(a.right);
        return;
      }
      if (t === 'MemberExpression') {
        const m = n as unknown as MemberExpressionNode;
        const baseName = globalRefName(m.object as AstNode);
        if (baseName) {
          if (!m.computed && m.property.type === 'Identifier') {
            const p = m.property as IdentifierNode;
            reads.push({ name: baseName, prop: p.name, start: p.start, end: p.end });
          }
          // computed READ `X[k]` is fine (can't add props); don't descend into the base
          // (it would look like a bare value use), do descend into a computed key.
          if (m.computed) walk(m.property);
          return;
        }
        walk(m.object);
        if (m.computed) walk(m.property);
        return;
      }
      if (t === 'ForInStatement') {
        // `for (k in X)` reads keys — safe; don't treat the RHS as a value escape.
        const s = n as unknown as { left?: unknown; right?: AstNode; body?: unknown };
        if (!(s.right && globalRefName(s.right))) walk(s.right);
        walk(s.left);
        walk(s.body);
        return;
      }
      if (t === 'DeleteExpression') {
        // delete removes — it can't create a property; skip the member inside.
        const arg = (n as unknown as { argument?: AstNode }).argument;
        if (arg?.type === 'MemberExpression' && globalRefName((arg as MemberExpressionNode).object as AstNode)) return;
        walk(arg);
        return;
      }
      if (t === 'Identifier') {
        // A bare candidate identifier reached OUTSIDE the handled member/for-in contexts is
        // a VALUE use (call arg, alias, return, element, …) → the object escapes → taint.
        const nm = (n as unknown as IdentifierNode).name;
        if (candidates.has(nm)) tainted.add(nm); // value use — the object escapes
        return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else walk(v);
      }
    };
    walk(node);

    // `global.X` value-uses: `let y = global.X;` — the member walk above treats `global.X`
    // itself via globalRefName only when it's a BASE of a further member or an assignment
    // target; a bare `global.X` value read reaches the MemberExpression case with base
    // 'global' (not a candidate) → walk(m.object) → Identifier 'global' (not a candidate) —
    // and the X property name is never visited (non-computed property). So it is NOT
    // tainted by that path. Catch it here: any non-computed member read `global.X` that we
    // recorded as a "read" of X on the pseudo-candidate 'global'… simpler: 'global' itself
    // can't be a candidate, so scan reads of the form name==='global'—not recorded either.
    // Handle it directly: treat `global.X` appearing OUTSIDE assignment-target/member-base
    // positions as an escape. The walk above already recursed into MemberExpression with
    // base 'global' via the non-candidate path, recording nothing — so re-scan cheaply:
    const escapeScan = (n: unknown, safe: boolean): void => {
      if (!isAstNodeLike(n)) return;
      const ref = globalRefName(n as AstNode);
      if (ref && n.type === 'MemberExpression' && !safe) { tainted.add(ref); return; }
      if (n.type === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        escapeScan(a.left, true);   // `global.X = …` target — not an escape
        escapeScan(a.right, false);
        return;
      }
      if (n.type === 'MemberExpression') {
        const m = n as unknown as MemberExpressionNode;
        escapeScan(m.object, true); // base position — `global.X.p` — not an escape
        if (m.computed) escapeScan(m.property, false);
        return;
      }
      if (n.type === 'ForInStatement') {
        const s = n as unknown as { left?: unknown; right?: unknown; body?: unknown };
        escapeScan(s.right, true); escapeScan(s.left, false); escapeScan(s.body, false);
        return;
      }
      if (n.type === 'DeleteExpression') { escapeScan((n as unknown as { argument?: unknown }).argument, true); return; }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) escapeScan(it, false); }
        else escapeScan(v, false);
      }
    };
    escapeScan(node, false);

    // A never-assigned read is provably meaningless in EVERY execution (always null) — a
    // definite authoring bug, so strict files escalate to Error (the family's `warn` mode
    // still pins it at Warning).
    const mode = this.options.uncertainGlobalScope ?? 'errorInStrict';
    const severity = (mode === 'errorInStrict' && this.strictMode) ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
    for (const r of reads) {
      if (tainted.has(r.name)) continue;
      const sym = this.symbolTable.lookup(r.name);
      if (!sym || sym.propertyTypes?.has(r.prop)) continue; // assigned somewhere → fine
      this.addDiagnostic(
        `Property '${r.prop}' is never assigned on global '${r.name}' in this file — its object ` +
        `literal doesn't define it and nothing else writes it, so this read is always null. ` +
        `Add it to the literal, assign it somewhere, or check the spelling.`,
        r.start, r.end, severity, UcodeErrorCode.GLOBAL_PROPERTY_NEVER_ASSIGNED,
      );
    }
  }

  /**
   * UC8007: the local-variable counterpart of UC8006 — a read of a property NEVER assigned
   * on a `let/const x = { … }` object literal whose shape is fully visible. Same proof
   * discipline: the literal must be fully static (no spread / computed key), and the
   * variable is tainted (silent) if it escapes as a value, takes a computed write, or is
   * reassigned. Unlike the global check, occurrences resolve through the SYMBOL TABLE
   * (lookupAtPosition + declaredAt identity), so shadowing (`let cache` in two scopes) is
   * handled precisely, and closure writes (`function warm() { cache.hot = 1; }`) count as
   * defining the property via the existing propertyTypes tracking.
   */
  private checkNeverAssignedLocalProperties(node: ProgramNode): void {
    // Candidates: every `let/const <Identifier> = <fully-static ObjectExpression>` in the
    // file, keyed by name → set of declaredAt (symbol identity).
    const candidates = new Map<string, Set<number>>();
    const collect = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'VariableDeclarator') {
        const d = n as unknown as { id?: AstNode; init?: AstNode };
        if (d.id?.type === 'Identifier' && d.init?.type === 'ObjectExpression'
            && this.isFullyStaticObjectLiteral(d.init as ObjectExpressionNode)) {
          const name = (d.id as IdentifierNode).name;
          const sym = this.symbolTable.lookupAtPosition(name, d.id.start) ?? this.symbolTable.lookup(name);
          // declaredAt identity ties the occurrence to THIS declarator; names that are also
          // object-literal GLOBALS are UC8006's turf (top-level `let` is fine — it's a local).
          if (sym && sym.declaredAt === d.id.start && !this.globalObjectBindings.has(name)) {
            let set = candidates.get(name);
            if (!set) { set = new Set(); candidates.set(name, set); }
            set.add(sym.declaredAt);
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) collect(it); }
        else collect(v);
      }
    };
    collect(node);
    if (candidates.size === 0) return;

    // Resolve an identifier occurrence to a candidate's declaredAt, or null. On resolution
    // ambiguity (no symbol found), returns 'ambiguous' so escapes taint every same-named
    // candidate (conservative in the silence direction).
    const resolveCandidate = (name: string, pos: number): number | 'ambiguous' | null => {
      const set = candidates.get(name);
      if (!set) return null;
      const sym = this.symbolTable.lookupAtPosition(name, pos) ?? this.symbolTable.lookup(name);
      if (!sym) return 'ambiguous';
      return set.has(sym.declaredAt) ? sym.declaredAt : null; // resolved to a different (shadowing) binding
    };

    const tainted = new Set<number>();
    const taint = (name: string, pos: number): void => {
      const r = resolveCandidate(name, pos);
      if (r === null) return;
      if (r === 'ambiguous') { for (const at of candidates.get(name) ?? []) tainted.add(at); }
      else tainted.add(r);
    };
    const reads: Array<{ key: number; name: string; prop: string; start: number; end: number }> = [];
    // `delete x.prop` sites — same proof discipline as reads, but the verdict differs:
    // deleting a never-assigned property is a provable runtime NO-OP (returns false),
    // almost certainly a typo, not an always-null read.
    const deletes: Array<{ key: number; name: string; prop: string; start: number; end: number }> = [];

    // EXHAUSTIVE per-node-kind dispatch: `satisfies Record<AstNodeKind, …>` makes tsc reject
    // a missing (or misspelled) kind, so adding a node type to the AST forces a conscious
    // decision here. Two invariants the handlers preserve:
    //   • an unhandled VALUE position must fall through to the Identifier handler (taint) —
    //     that's the conservative default (escape → silent), so `walkChildren` is safe for
    //     every kind that merely CONTAINS expressions;
    //   • positions where an identifier is NOT a value (declarator ids, property keys,
    //     non-computed member names, import/export specifiers) must NOT reach it.
    const walkChildren = (n: AnyNode): void => {
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else walk(v);
      }
    };
    const skip = (_n: AnyNode): void => {};
    const handlers = {
      // ── the contexts this check actually reasons about ────────────────────────────────
      AssignmentExpression: (n: AnyNode) => {
        const a = n as unknown as AssignmentExpressionNode;
        if (a.left?.type === 'Identifier') {
          // Reassignment of the variable itself — shape no longer the literal's → taint.
          taint((a.left as IdentifierNode).name, a.left.start);
          walk(a.right);
          return;
        }
        if (a.left?.type === 'MemberExpression') {
          const m = a.left as MemberExpressionNode;
          if (m.object.type === 'Identifier') {
            const baseName = (m.object as IdentifierNode).name;
            if (resolveCandidate(baseName, m.object.start) !== null) {
              if (m.computed) { taint(baseName, m.object.start); walk(m.property); } // unknown key written
              // non-computed write: recordPropertyWrite already added it to propertyTypes
              walk(a.right);
              return;
            }
          }
          walk(a.left);
          walk(a.right);
          return;
        }
        walk(a.left); walk(a.right);
      },
      MemberExpression: (n: AnyNode) => {
        const m = n as unknown as MemberExpressionNode;
        if (m.object.type === 'Identifier') {
          const baseName = (m.object as IdentifierNode).name;
          const r = resolveCandidate(baseName, m.object.start);
          if (r !== null && r !== 'ambiguous') {
            if (!m.computed && m.property.type === 'Identifier') {
              const p = m.property as IdentifierNode;
              reads.push({ key: r, name: baseName, prop: p.name, start: p.start, end: p.end });
            }
            if (m.computed) walk(m.property); // computed READ can't add props — safe
            return;
          }
        }
        walk(m.object);
        if (m.computed) walk(m.property);
      },
      ForInStatement: (n: AnyNode) => {
        const s = n as unknown as { left?: unknown; right?: AstNode; body?: unknown };
        // `for (k in x)` reads keys — safe, not an escape.
        if (!(s.right?.type === 'Identifier' && resolveCandidate((s.right as IdentifierNode).name, s.right.start) !== null)) walk(s.right);
        walk(s.left); walk(s.body);
      },
      DeleteExpression: (n: AnyNode) => {
        const arg = (n as unknown as { argument?: AstNode }).argument;
        if (arg?.type === 'MemberExpression' && (arg as MemberExpressionNode).object.type === 'Identifier') {
          const m = arg as MemberExpressionNode;
          const baseName = (m.object as IdentifierNode).name;
          const r = resolveCandidate(baseName, m.object.start);
          if (r !== null && r !== 'ambiguous') {
            // delete removes, never adds — the base stays untainted. A non-computed
            // target on an untainted candidate is checkable: deleting a never-assigned
            // property is a provable no-op (likely typo), recorded for UC8008 below.
            if (!m.computed && m.property.type === 'Identifier') {
              const p = m.property as IdentifierNode;
              deletes.push({ key: r, name: baseName, prop: p.name, start: p.start, end: p.end });
            }
            if (m.computed) walk(m.property); // the KEY expression is still a value use
            return;
          }
        }
        walk(arg);
      },
      VariableDeclarator: (n: AnyNode) => walk((n as unknown as { init?: unknown }).init), // id is a declaration, not a use
      Property: (n: AnyNode) => {
        const p = n as unknown as { computed?: boolean; key?: unknown; value?: unknown };
        if (p.computed) walk(p.key); // computed key IS a value use
        walk(p.value);               // a non-computed key is not
      },
      Identifier: (n: AnyNode) => {
        // A candidate reached OUTSIDE the handled contexts is a VALUE use → escapes → taint.
        taint((n as unknown as IdentifierNode).name, n.start);
      },
      // ── kinds where an identifier child is a NAME, not a value — must not taint ───────
      ImportDeclaration: skip, ImportSpecifier: skip, ImportDefaultSpecifier: skip,
      ImportNamespaceSpecifier: skip, ExportAllDeclaration: skip,
      ExportSpecifier: (n: AnyNode) => {
        // `export { cache }` hands the object to other modules — an escape → taint.
        const local = (n as unknown as { local?: AstNode }).local;
        if (local?.type === 'Identifier') taint((local as IdentifierNode).name, local.start);
      },
      LabeledStatement: (n: AnyNode) => walk((n as unknown as { body?: unknown }).body), // the label is a name, not a value
      // ── leaves: nothing to do ──────────────────────────────────────────────────────────
      Literal: skip, ThisExpression: skip, TemplateElement: skip, JsDocComment: skip,
      EmptyStatement: skip, BreakStatement: skip, ContinueStatement: skip,
      // ── everything else just contains expressions/statements → generic recursion ──────
      Program: walkChildren, BlockStatement: walkChildren, ExpressionStatement: walkChildren,
      VariableDeclaration: walkChildren, IfStatement: walkChildren, ForStatement: walkChildren,
      WhileStatement: walkChildren, DoWhileStatement: walkChildren, SwitchStatement: walkChildren,
      SwitchCase: walkChildren, TryStatement: walkChildren, CatchClause: walkChildren,
      ReturnStatement: walkChildren, ThrowStatement: walkChildren,
      FunctionDeclaration: walkChildren, FunctionExpression: walkChildren, ArrowFunctionExpression: walkChildren,
      BinaryExpression: walkChildren, LogicalExpression: walkChildren, UnaryExpression: walkChildren,
      ConditionalExpression: walkChildren, CallExpression: walkChildren, SpreadElement: walkChildren,
      ArrayExpression: walkChildren, ObjectExpression: walkChildren, TemplateLiteral: walkChildren,
      ExportDefaultDeclaration: walkChildren, ExportNamedDeclaration: walkChildren,
    } satisfies Record<AstNodeKind, (n: AnyNode) => void>;
    const walk = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      // `satisfies` guarantees compile-time exhaustiveness over AstNodeKind, but
      // isAstNodeLike is structural — nodes can carry NON-AST objects that happen to have a
      // string `type` (parsed JSDoc tags, stashed inference data). Fall back to generic
      // recursion for those instead of crashing the analysis.
      (handlers[n.type as keyof typeof handlers] ?? walkChildren)(n);
    };
    walk(node);

    // Provably-always-null read = a definite authoring bug → Error under 'use strict',
    // Warning otherwise (matches UC8006; this check isn't behind uncertainGlobalScope, so
    // strictMode alone decides).
    const severity = this.strictMode ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
    for (const r of reads) {
      if (tainted.has(r.key)) continue;
      const sym = this.symbolTable.lookupAtPosition(r.name, r.start) ?? this.symbolTable.lookup(r.name);
      if (!sym || sym.declaredAt !== r.key) continue;
      if (sym.propertyTypes?.has(r.prop)) continue; // assigned somewhere (incl. closures) → fine
      this.addDiagnostic(
        `Property '${r.prop}' is never assigned on '${r.name}' — its object literal doesn't ` +
        `define it and nothing else writes it, so this read is always null. Add it to the ` +
        `literal, assign it somewhere, or check the spelling.`,
        r.start, r.end, severity, UcodeErrorCode.LOCAL_PROPERTY_NEVER_ASSIGNED,
      );
    }

    // UC8008: `delete x.prop` where prop is provably never assigned — a runtime no-op
    // returning false, almost certainly a typo. Always a Warning (it executes fine, even
    // under 'use strict'; nothing crashes or reads null — the code just does nothing).
    for (const d of deletes) {
      if (tainted.has(d.key)) continue;
      const sym = this.symbolTable.lookupAtPosition(d.name, d.start) ?? this.symbolTable.lookup(d.name);
      if (!sym || sym.declaredAt !== d.key) continue;
      if (sym.propertyTypes?.has(d.prop)) continue; // assigned somewhere (incl. closures) → real delete
      this.addDiagnostic(
        `'delete' has no effect: property '${d.prop}' is never assigned on '${d.name}' — its ` +
        `object literal doesn't define it and nothing else writes it, so this always returns ` +
        `false. Check the spelling.`,
        d.start, d.end, DiagnosticSeverity.Warning, UcodeErrorCode.DELETE_NEVER_ASSIGNED_PROPERTY,
      );
    }
  }

  /**
   * UC8004: a global (`global.X = …` or a bare implicit-global `X = …`) whose existence at a
   * later read CANNOT BE STATICALLY DETERMINED — every assignment to it sits in a spot whose
   * execution isn't guaranteed (a function body, an `if`/`else` branch, a `switch` case, a
   * loop, a `try`/`catch`, a ternary arm, a short-circuit RHS). On any path where no
   * assignment runs, the global never exists: a read is `null` (non-strict) / a Reference
   * error (strict). The message asks for a deterministic definition (seed a default at top
   * level) or an explicit `@global` declaration (the sanctioned "I meant this" escape).
   *
   * The check only claims "cannot be statically determined" where that is TRUE — cases it CAN
   * determine are silent (a definite-assignment "must-assign" analysis, `definitelyAssigns`):
   *   • an unconditional top-level assignment, incl. under `if (true)`-style static guards;
   *   • an `if`/`else` (or ternary) where BOTH arms assign it — exhaustive, definite;
   *   • a `switch` WITH a `default` where every entry point assigns it before `break`
   *     (fallthrough followed);
   *   • a `try`/`catch` where both the block and the handler assign it;
   *   • tier-1-lite call graph: a top-level unconditional CALL to an in-file function whose
   *     body unconditionally assigns it (`function boot(){global.CFG={};} boot();`) — the
   *     common init() idiom (transitive through direct calls, cycle-safe);
   *   • a name declared `/** @global X *​/` or in the host-globals registry is exempt.
   * Must-assign UNDER-approximates (anything unproven stays flagged), so precision misses
   * only add flags, never hide real ones. Exceptions (e.g. `json()` throwing mid-statement)
   * are ignored, matching every other check here; explicit `return`/`break`/`continue` stop
   * the straight-line accumulation. Severity follows `ucode.uncertainGlobalScope`.
   * Multiple shaky sites for the same global are cross-linked via relatedInformation.
   */
  private checkNonDeterministicGlobalDefs(node: ProgramNode): void {
    const mode = this.options.uncertainGlobalScope ?? 'errorInStrict';
    const severity = (mode === 'errorInStrict' && this.strictMode) ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;

    // Top-level let/const/function names are locals, not globals.
    const localNames = new Set<string>();
    for (const stmt of node.body) {
      if (stmt.type === 'FunctionDeclaration' && (stmt as unknown as FunctionDeclarationNode).id?.name) localNames.add((stmt as unknown as FunctionDeclarationNode).id!.name);
      if (stmt.type === 'VariableDeclaration') for (const d of ((stmt as unknown as VariableDeclarationNode).declarations || [])) if (d?.id?.type === 'Identifier') localNames.add((d.id as IdentifierNode).name);
    }

    const globalTargetName = (left: AstNode | undefined): string | null => {
      if (!left) return null;
      if (left.type === 'Identifier') {
        const nm = (left as IdentifierNode).name;
        return (nm && this.implicitGlobalNames.has(nm)) ? nm : null; // bare X → only if implicit global
      }
      if (left.type === 'MemberExpression') {
        const m = left as MemberExpressionNode;
        if (!m.computed && m.object.type === 'Identifier' && (m.object as IdentifierNode).name === 'global' && m.property.type === 'Identifier') return (m.property as IdentifierNode).name;
      }
      return null;
    };
    const isStaticTruthy = (test: AstNode | undefined): boolean => {
      if (!test || test.type !== 'Literal') return false;
      const v = (test as LiteralNode).value;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') return v.length > 0;
      return false;
    };
    const isStaticFalsy = (test: AstNode | undefined): boolean => {
      if (!test || test.type !== 'Literal') return false;
      const v = (test as LiteralNode).value;
      return v === false || v === 0 || v === '' || v === null;
    };

    // ── must-assign (definite assignment) ─────────────────────────────────────────────────
    // definitelyAssigns(n) = the set of globals PROVABLY assigned whenever n executes to
    // completion. Under-approximates: unknown node shapes yield ∅ (stay flagged). Explicit
    // return/break/continue stop straight-line accumulation (statements after them may be
    // skipped); exceptions are ignored (same assumption as the rest of this analyzer).

    // Does this subtree contain control flow that could skip FOLLOWING statements —
    // a return anywhere, or a break/continue not consumed by a loop/switch inside `n`?
    // (Nested functions don't count; their control flow is theirs.)
    const mayDivert = (n: unknown, loopDepth: number): boolean => {
      if (!isAstNodeLike(n)) return false;
      const t = n.type;
      if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') return false;
      if (t === 'ReturnStatement' || t === 'ThrowStatement') return true;
      if ((t === 'BreakStatement' || t === 'ContinueStatement') && loopDepth === 0) return true;
      const nested = (t === 'WhileStatement' || t === 'ForStatement'
        || t === 'ForInStatement' || t === 'SwitchStatement') ? loopDepth + 1 : loopDepth;
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) if (mayDivert(it, nested)) return true; }
        else if (mayDivert(v, nested)) return true;
      }
      return false;
    };

    // Straight-line sequence: accumulate must-assigns; stop after a statement that may
    // divert control (its own must-assign still counts — it executed up to the divert).
    const seqAssigns = (stmts: unknown[]): Set<string> => {
      const acc = new Set<string>();
      for (const stmt of stmts) {
        for (const nm of definitelyAssigns(stmt)) acc.add(nm);
        if (mayDivert(stmt, 0)) break;
      }
      return acc;
    };
    const intersect = (a: Set<string>, b: Set<string>): Set<string> => {
      const out = new Set<string>();
      for (const x of a) if (b.has(x)) out.add(x);
      return out;
    };

    // Tier-1-lite call graph: top-level `function f() { … }` AND top-level `let/const f =
    // function/arrow` → the globals f's body unconditionally assigns. A `let`-bound name
    // that is REASSIGNED anywhere is excluded (the call site's target is then unknowable);
    // `const` can't be reassigned. Memoized; cycles yield ∅ (sound).
    const reassignedNames = new Set<string>();
    const scanReassigns = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        if (a.left?.type === 'Identifier' && (a.left as IdentifierNode).name) reassignedNames.add((a.left as IdentifierNode).name);
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) scanReassigns(it); }
        else scanReassigns(v);
      }
    };
    scanReassigns(node);
    const fnBodies = new Map<string, AstNode>();
    for (const stmt of node.body) {
      if (stmt.type === 'FunctionDeclaration') {
        const fd = stmt as unknown as FunctionDeclarationNode;
        if (fd.id?.name && !fd.forwardDeclaration) fnBodies.set(fd.id.name, fd.body);
      }
      if (stmt.type === 'VariableDeclaration') {
        for (const d of ((stmt as unknown as VariableDeclarationNode).declarations || [])) {
          const init = (d as unknown as { init?: AstNode }).init;
          if (d?.id?.type === 'Identifier' && (d.id as IdentifierNode).name
              && (init?.type === 'FunctionExpression' || init?.type === 'ArrowFunctionExpression')
              && !reassignedNames.has((d.id as IdentifierNode).name)) {
            fnBodies.set((d.id as IdentifierNode).name, (init as unknown as { body: AstNode }).body);
          }
        }
      }
    }
    const fnMustAssign = new Map<string, Set<string>>();
    const fnInProgress = new Set<string>();
    const callMustAssign = (calleeName: string): Set<string> => {
      const memo = fnMustAssign.get(calleeName);
      if (memo) return memo;
      const body = fnBodies.get(calleeName);
      if (!body || fnInProgress.has(calleeName)) return new Set();
      fnInProgress.add(calleeName);
      const result = definitelyAssigns(body);
      fnInProgress.delete(calleeName);
      fnMustAssign.set(calleeName, result);
      return result;
    };

    const definitelyAssigns = (n: unknown): Set<string> => {
      if (!isAstNodeLike(n)) return new Set();
      switch (n.type) {
        case 'ExpressionStatement':
          return definitelyAssigns((n as Record<string, unknown>)['expression']);
        case 'AssignmentExpression': {
          const a = n as unknown as AssignmentExpressionNode;
          const out = definitelyAssigns(a.right); // RHS evaluates before the store
          if (a.operator === '=') {
            const name = globalTargetName(a.left);
            if (name && !localNames.has(name)) out.add(name);
          }
          return out;
        }
        case 'CallExpression': {
          const c = n as unknown as CallExpressionNode;
          const out = new Set<string>();
          for (const arg of (c.arguments || [])) for (const nm of definitelyAssigns(arg)) out.add(nm);
          if (c.callee?.type === 'Identifier') {
            for (const nm of callMustAssign((c.callee as IdentifierNode).name)) out.add(nm);
          } else {
            for (const nm of definitelyAssigns(c.callee)) out.add(nm);
          }
          return out;
        }
        case 'BlockStatement':
          return seqAssigns((n as unknown as BlockStatementNode).body || []);
        case 'IfStatement': {
          const s = n as unknown as { test?: AstNode; consequent?: unknown; alternate?: unknown };
          const out = definitelyAssigns(s.test);
          if (isStaticTruthy(s.test)) {
            for (const nm of definitelyAssigns(s.consequent)) out.add(nm);
          } else if (isStaticFalsy(s.test)) {
            if (s.alternate) for (const nm of definitelyAssigns(s.alternate)) out.add(nm);
          } else if (s.alternate) {
            for (const nm of intersect(definitelyAssigns(s.consequent), definitelyAssigns(s.alternate))) out.add(nm);
          }
          return out;
        }
        case 'ConditionalExpression': {
          const s = n as unknown as { test?: AstNode; consequent?: unknown; alternate?: unknown };
          const out = definitelyAssigns(s.test);
          // A statically-decided test takes exactly one arm (mirrors the `if (true)` rule).
          const arm = isStaticTruthy(s.test) ? definitelyAssigns(s.consequent)
            : isStaticFalsy(s.test) ? definitelyAssigns(s.alternate)
            : intersect(definitelyAssigns(s.consequent), definitelyAssigns(s.alternate));
          for (const nm of arm) out.add(nm);
          return out;
        }
        case 'SwitchStatement': {
          // Exhaustive only WITH a default; every entry point (fallthrough followed) must assign.
          const s = n as unknown as { discriminant?: unknown; cases?: SwitchCaseLike[] };
          const out = definitelyAssigns(s.discriminant);
          const cases = s.cases || [];
          if (!cases.some(c => !c.test)) return out; // no default → not exhaustive
          let meet: Set<string> | null = null;
          for (let i = 0; i < cases.length; i++) {
            const entry = new Set<string>();
            outer: for (let j = i; j < cases.length; j++) {
              for (const stmt of (cases[j]!.consequent || [])) {
                for (const nm of definitelyAssigns(stmt)) entry.add(nm);
                if (mayDivert(stmt, 0)) break outer; // break/return ends this entry's path
              }
            }
            meet = meet === null ? entry : intersect(meet, entry);
          }
          if (meet) for (const nm of meet) out.add(nm);
          return out;
        }
        case 'TryStatement': {
          // Normal path runs the block; exception path runs the handler (or unwinds out of
          // scope entirely, in which case no later read happens) → block ∩ handler, or the
          // block alone when there's no handler.
          const s = n as unknown as { block?: unknown; handler?: { body?: unknown } | null };
          const blockSet = definitelyAssigns(s.block);
          return s.handler ? intersect(blockSet, definitelyAssigns(s.handler.body)) : blockSet;
        }
        case 'WhileStatement': // test always evaluates once; body may not
          return definitelyAssigns((n as unknown as { test?: unknown }).test);
        case 'ForStatement': {
          const s = n as unknown as { init?: unknown; test?: unknown };
          const out = definitelyAssigns(s.init);
          for (const nm of definitelyAssigns(s.test)) out.add(nm);
          return out;
        }
        case 'ForInStatement': // the iterated expression always evaluates
          return definitelyAssigns((n as unknown as { right?: unknown }).right);
        case 'VariableDeclaration': {
          const out = new Set<string>();
          for (const d of ((n as unknown as VariableDeclarationNode).declarations || [])) {
            for (const nm of definitelyAssigns((d as unknown as Record<string, unknown>)['init'])) out.add(nm);
          }
          return out;
        }
        case 'ReturnStatement':
          return definitelyAssigns((n as unknown as { argument?: unknown }).argument);
        case 'UnaryExpression':
          return definitelyAssigns((n as unknown as { argument?: unknown }).argument);
        case 'BinaryExpression': case 'LogicalExpression': {
          const s = n as unknown as { operator?: string; left?: unknown; right?: unknown };
          const out = definitelyAssigns(s.left);
          if (s.operator !== '&&' && s.operator !== '||' && s.operator !== '??') {
            for (const nm of definitelyAssigns(s.right)) out.add(nm); // short-circuit RHS may not run
          }
          return out;
        }
        default:
          return new Set(); // unknown shape → prove nothing (stays flagged)
      }
    };
    type SwitchCaseLike = { test?: AstNode | null; consequent?: unknown[] };

    // ctx = the innermost non-deterministic context enclosing a node, or null (deterministic,
    // straight-line top level). Innermost wins for the message.
    type Ctx = { kind: 'function' | 'conditional' | 'switch' | 'loop' | 'try'; detail?: string | undefined } | null;
    // Everything the top level MUST assign (incl. exhaustive branches, unconditional calls)
    // definitely exists → all its sites are silent.
    const hasDeterministicDef = seqAssigns(node.body);
    const sites: { name: string; start: number; end: number; ctx: Exclude<Ctx, null> }[] = [];

    const record = (left: AstNode, right: AstNode | undefined, ctx: Ctx) => {
      const name = globalTargetName(left);
      if (!name || localNames.has(name)) return;
      if (ctx === null) hasDeterministicDef.add(name);
      else sites.push({ name, start: left.start, end: (right ?? left).end, ctx });
    };

    const recurseChildren = (n: AnyNode, ctx: Ctx): void => {
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) walk(it, ctx); }
        else walk(v, ctx);
      }
    };
    const walk = (n: unknown, ctx: Ctx): void => {
      if (!isAstNodeLike(n)) return;
      switch (n.type) {
        case 'AssignmentExpression': {
          const a = n as unknown as AssignmentExpressionNode;
          if (a.operator === '=') record(a.left, a.right, ctx);
          walk(a.right, ctx); // RHS may nest further assignments / functions
          if (a.left?.type === 'MemberExpression') walk((a.left as MemberExpressionNode).object, ctx);
          return;
        }
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
          const fn = n as unknown as { id?: IdentifierNode; params?: unknown[]; body?: unknown };
          const inner: Ctx = { kind: 'function', detail: fn.id?.name };
          for (const p of (fn.params || [])) walk(p, inner);
          walk(fn.body, inner);
          return;
        }
        case 'VariableDeclarator': {
          // `let lambda = () => …` — name the lambda in the message ("inside function 'lambda'").
          const d = n as unknown as { id?: AstNode; init?: AstNode };
          if (d.id?.type === 'Identifier' && (d.id as IdentifierNode).name
              && (d.init?.type === 'FunctionExpression' || d.init?.type === 'ArrowFunctionExpression')) {
            const fn = d.init as unknown as { params?: unknown[]; body?: unknown };
            const inner: Ctx = { kind: 'function', detail: (d.id as IdentifierNode).name };
            for (const p of (fn.params || [])) walk(p, inner);
            walk(fn.body, inner);
            return;
          }
          recurseChildren(n, ctx);
          return;
        }
        case 'IfStatement': {
          const s = n as unknown as { test?: AstNode; consequent?: unknown; alternate?: unknown };
          walk(s.test, ctx);
          // `if (true)`'s consequent / `if (false)`'s alternate stays deterministic; the
          // dead branch is conditional.
          const truthy = isStaticTruthy(s.test), falsy = isStaticFalsy(s.test);
          walk(s.consequent, truthy ? ctx : { kind: 'conditional' });
          if (s.alternate) walk(s.alternate, falsy ? ctx : { kind: 'conditional' });
          return;
        }
        case 'SwitchStatement': {
          const s = n as unknown as { discriminant?: unknown; cases?: unknown[] };
          walk(s.discriminant, ctx);
          for (const c of (s.cases || [])) walk(c, { kind: 'switch' });
          return;
        }
        case 'WhileStatement': {
          const s = n as unknown as { test?: unknown; body?: unknown };
          walk(s.test, ctx);
          walk(s.body, { kind: 'loop' });
          return;
        }
        case 'ForStatement': {
          const s = n as unknown as { init?: unknown; test?: unknown; update?: unknown; body?: unknown };
          walk(s.init, ctx); walk(s.test, ctx); walk(s.update, ctx);
          walk(s.body, { kind: 'loop' });
          return;
        }
        case 'ForInStatement': {
          const s = n as unknown as { left?: unknown; right?: unknown; body?: unknown };
          walk(s.right, ctx);
          walk(s.body, { kind: 'loop' });
          return;
        }
        case 'TryStatement': {
          const s = n as unknown as { block?: unknown; handler?: unknown; finalizer?: unknown };
          walk(s.block, { kind: 'try' });
          walk(s.handler, { kind: 'try' });
          if (s.finalizer) walk(s.finalizer, ctx); // finally always runs
          return;
        }
        case 'ConditionalExpression': {
          const s = n as unknown as { test?: AstNode; consequent?: unknown; alternate?: unknown };
          walk(s.test, ctx);
          // `(true) ? A : B` — the taken arm is deterministic (same as `if (true)`); the
          // dead arm stays conditional.
          const truthy = isStaticTruthy(s.test), falsy = isStaticFalsy(s.test);
          walk(s.consequent, truthy ? ctx : { kind: 'conditional' });
          walk(s.alternate, falsy ? ctx : { kind: 'conditional' });
          return;
        }
        case 'LogicalExpression': case 'BinaryExpression': {
          const s = n as unknown as { operator?: string; left?: unknown; right?: unknown };
          // Short-circuit operators only evaluate the RHS conditionally; other binaries don't.
          if (s.operator === '&&' || s.operator === '||' || s.operator === '??') {
            walk(s.left, ctx);
            walk(s.right, { kind: 'conditional' });
            return;
          }
          recurseChildren(n, ctx); // arithmetic/comparison: both sides always evaluate
          return;
        }
        default: recurseChildren(n, ctx);
      }
    };
    walk(node, null);

    const label = (c: Exclude<Ctx, null>): string => {
      switch (c.kind) {
        case 'function': return c.detail ? `inside function '${c.detail}'` : 'inside a function';
        case 'conditional': return 'inside a conditional (if/else) branch';
        case 'switch': return 'inside a switch case';
        case 'loop': return 'inside a loop body';
        case 'try': return 'inside a try/catch block';
      }
    };
    // Report. `@global`-declared / host-registry names are exempt (the sanctioned opt-out:
    // the developer has declared the global is environment-provided / intentional).
    const flagged = sites.filter(s => !hasDeterministicDef.has(s.name) && !this.declaredGlobalNames.has(s.name));
    const byName = new Map<string, typeof flagged>();
    for (const s of flagged) {
      let group = byName.get(s.name);
      if (!group) { group = []; byName.set(s.name, group); }
      group.push(s);
    }
    for (const s of flagged) {
      const fix = s.ctx.kind === 'function'
        ? `Call ${s.ctx.detail ? `'${s.ctx.detail}'` : 'the function'} unconditionally at top level, ` +
          `assign a default at top level (e.g. \`global.${s.name} = null;\`), or declare ` +
          `\`/** @global ${s.name} */\` if the environment guarantees it.`
        : `Make the definition deterministic — assign a default at top level (e.g. ` +
          `\`global.${s.name} = null;\`) before the conditional assignment — or declare ` +
          `\`/** @global ${s.name} */\` if the environment guarantees it.`;
      const siblings = byName.get(s.name)!.filter(o => o !== s);
      const related: DiagnosticRelatedInformation[] = siblings.map(o => ({
        location: {
          uri: this.textDocument.uri,
          range: { start: this.textDocument.positionAt(o.start), end: this.textDocument.positionAt(o.end) },
        },
        message: `'${o.name}' is also assigned non-deterministically here (${label(o.ctx)})`,
      }));
      this.addDiagnostic(
        `Global '${s.name}' is assigned only ${label(s.ctx)}, so whether it exists at any later ` +
        `read cannot be statically determined. A read of a missing global is null (non-strict) ` +
        `or throws a Reference error ('use strict'). ${fix}`,
        s.start, s.end, severity, UcodeErrorCode.GLOBAL_DEFINED_NONDETERMINISTICALLY,
        { globalName: s.name }, related,
      );
    }

    // ── UC8005: echo at the READ site — where the hazard actually materializes ──────────
    // A read of a global whose EVERY definition is non-deterministic — INCLUDING reads inside
    // functions: their call timing is unknown in both directions, so "a def might have run"
    // is exactly the unprovable claim the echo exists to surface. One severity step below the
    // UC8004 at the def (Information; Warning under strict). Suppressed when the global is
    // definitely assigned EARLIER IN THE SAME BODY (directly, or via a call whose must-assign
    // covers it — `function g() { load(); return CONF; }` is clean), and for reads of a
    // shadowing parameter/local of the same name.
    const shakyNames = new Set(flagged.map(s => s.name));
    if (shakyNames.size === 0) return;
    const readSeverity = (mode === 'errorInStrict' && this.strictMode)
      ? DiagnosticSeverity.Warning : DiagnosticSeverity.Information;
    const defSitesFor = (name: string): DiagnosticRelatedInformation[] =>
      byName.get(name)!.map(o => ({
        location: {
          uri: this.textDocument.uri,
          range: { start: this.textDocument.positionAt(o.start), end: this.textDocument.positionAt(o.end) },
        },
        message: `'${name}' is assigned non-deterministically here (${label(o.ctx)})`,
      }));
    const visitRead = (name: string, pos: number): void => {
      if (!shakyNames.has(name)) return;
      this.addDiagnostic(
        `The global variable '${name}' may not exist here: all of its definitions are ` +
        `non-deterministic, so whether it has been defined by the time this read executes ` +
        `cannot be statically determined. If it hasn't, this read is null (non-strict) or ` +
        `throws a Reference error ('use strict'). Make a definition deterministic (e.g. ` +
        `\`global.${name} = null;\` at top level), or declare \`/** @global ${name} */\` ` +
        `if the environment guarantees it.`,
        pos, pos + name.length, readSeverity, UcodeErrorCode.GLOBAL_READ_UNPROVEN,
        { globalName: name }, defSitesFor(name),
      );
    };
    // Names lexically bound within a function (params, let/const, nested fn decls, catch
    // params) — reads of those are locals, not globals. Doesn't descend into nested
    // functions (their locals are their own).
    const fnLocalNames = (fn: { params?: unknown[]; restParam?: unknown; body?: unknown }): Set<string> => {
      const out = new Set<string>();
      for (const p of (fn.params || [])) if (isAstNodeLike(p) && p.type === 'Identifier') out.add((p as unknown as IdentifierNode).name);
      if (isAstNodeLike(fn.restParam) && fn.restParam.type === 'Identifier') out.add((fn.restParam as unknown as IdentifierNode).name);
      const scan = (n: unknown): void => {
        if (!isAstNodeLike(n)) return;
        const t = n.type;
        if (t === 'FunctionExpression' || t === 'ArrowFunctionExpression') return;
        if (t === 'FunctionDeclaration') { const id = (n as unknown as FunctionDeclarationNode).id; if (id?.name) out.add(id.name); return; }
        if (t === 'VariableDeclaration') {
          for (const d of ((n as unknown as VariableDeclarationNode).declarations || [])) {
            if (d?.id?.type === 'Identifier') out.add((d.id as IdentifierNode).name);
            scan((d as unknown as Record<string, unknown>)['init']);
          }
          return;
        }
        if (t === 'CatchClause') { const p = (n as unknown as CatchClauseNode).param; if (p?.name) out.add(p.name); }
        for (const k of Object.keys(n)) {
          if (k === 'leadingJsDoc') continue;
          const v = (n as Record<string, unknown>)[k];
          if (Array.isArray(v)) { for (const it of v) scan(it); }
          else scan(v);
        }
      };
      scan(fn.body);
      return out;
    };
    // Walk a statement SEQUENCE tracking what's definitely assigned so far: reads in
    // statement N are suppressed by must-assigns of statements 1..N-1 (they provably ran
    // if N runs). Within one statement the pre-statement set applies (an RHS read happens
    // before its own store).
    const readSeq = (stmts: unknown[], locals: Set<string>, assigned: Set<string>): void => {
      let cur = assigned;
      for (const stmt of stmts) {
        collectReads(stmt, locals, cur);
        const next = new Set(cur);
        for (const nm of definitelyAssigns(stmt)) next.add(nm);
        cur = next;
      }
    };
    const enterFunction = (fn: { params?: unknown[]; restParam?: unknown; body?: unknown }, locals: Set<string>): void => {
      const inner = new Set([...locals, ...fnLocalNames(fn)]);
      // Call timing unknown → nothing carried in from the caller's straight line.
      if (isAstNodeLike(fn.body) && fn.body.type === 'BlockStatement') {
        readSeq(((fn.body as unknown as BlockStatementNode).body || []) as unknown[], inner, new Set());
      } else {
        collectReads(fn.body, inner, new Set()); // arrow expression body
      }
    };
    const collectReads = (n: unknown, locals: Set<string>, assigned: Set<string>): void => {
      if (!isAstNodeLike(n)) return;
      const t = n.type;
      if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
        enterFunction(n as unknown as { params?: unknown[]; body?: unknown }, locals);
        return;
      }
      if (t === 'BlockStatement') { readSeq(((n as unknown as BlockStatementNode).body || []) as unknown[], locals, assigned); return; }
      if (t === 'Identifier') {
        const name = (n as unknown as IdentifierNode).name;
        if (!locals.has(name) && !assigned.has(name)) visitRead(name, n.start);
        return;
      }
      if (t === 'MemberExpression') {
        const m = n as unknown as MemberExpressionNode;
        collectReads(m.object, locals, assigned);
        if (m.computed) collectReads(m.property, locals, assigned); // obj[x]: x is a read; obj.prop: prop is not
        return;
      }
      if (t === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        // A bare-identifier LHS is a write, not a read; a member LHS still reads its object.
        if (a.left?.type === 'MemberExpression') collectReads((a.left as MemberExpressionNode).object, locals, assigned);
        else if (a.left?.type !== 'Identifier') collectReads(a.left, locals, assigned);
        collectReads(a.right, locals, assigned);
        return;
      }
      if (t === 'VariableDeclarator') { collectReads((n as Record<string, unknown>)['init'], locals, assigned); return; } // id is not a read
      if (t === 'Property' && !(n as Record<string, unknown>)['computed']) { collectReads((n as Record<string, unknown>)['value'], locals, assigned); return; } // key is not a read
      if (t === 'CatchClause') {
        const c = n as unknown as CatchClauseNode;
        const inner = c.param?.name ? new Set([...locals, c.param.name]) : locals;
        collectReads(c.body, inner, assigned);
        return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) collectReads(it, locals, assigned); }
        else collectReads(v, locals, assigned);
      }
    };
    readSeq(node.body as unknown[], new Set(localNames), new Set());
  }

  /**
   * UC8003: a global whose TYPE cannot be statically determined — it is assigned two
   * different types AND at least one of the conflicting assignments sits inside a FUNCTION,
   * whose call timing (and re-invocation) is unknowable, so no read of the global has a
   * knowable type.
   *
   * Deliberately NOT flagged (statically determinable, per SSA):
   *   • all cross-type assignments at top level — straight-line order is known, so each
   *     read's type is positional (`global.M = 1; …reads integer…; global.M = "s";` — and
   *     the scalar-SSA binding actually types those reads);
   *   • top-level branches/loops — path-dependent, but the type at any read is a knowable
   *     union of the branch types (a phi), not an unknowable;
   *   • same-type reassignments, `let` locals, unknown-typed RHS (proves nothing).
   *
   * Always a WARNING (never an Error, even under 'use strict'): unlike UC8002/8004/8005
   * there is no runtime failure to mirror — cross-type reassignment is legal, deterministic
   * ucode. This is purely a type-trackability lint. `off` disables it.
   */
  private checkGlobalTypeReassignment(node: ProgramNode): void {
    // Top-level let/const/function names are locals — a `let X` reassignment is not a global.
    const localNames = new Set<string>();
    for (const stmt of node.body) {
      if (stmt.type === 'FunctionDeclaration' && (stmt as unknown as FunctionDeclarationNode).id?.name) localNames.add((stmt as unknown as FunctionDeclarationNode).id!.name);
      if (stmt.type === 'VariableDeclaration') for (const d of ((stmt as unknown as VariableDeclarationNode).declarations || [])) if (d?.id?.type === 'Identifier') localNames.add((d.id as IdentifierNode).name);
    }

    const coarse = (n: AstNode | undefined): string => {
      if (!n) return 'unknown';
      switch (n.type) {
        case 'ObjectExpression': return 'object';
        case 'ArrayExpression': return 'array';
        case 'FunctionExpression': case 'ArrowFunctionExpression': return 'function';
        case 'TemplateLiteral': return 'string';
        case 'Literal': {
          const v = (n as LiteralNode).value;
          if (typeof v === 'string') return 'string';
          if (typeof v === 'boolean') return 'boolean';
          if (v === null) return 'null';
          if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'double';
          return 'unknown';
        }
        default: return 'unknown';
      }
    };
    const targetName = (left: AstNode | undefined): string | null => {
      if (!left) return null;
      if (left.type === 'Identifier') return (left as IdentifierNode).name || null;
      if (left.type === 'MemberExpression') {
        const m = left as MemberExpressionNode;
        if (!m.computed && m.object.type === 'Identifier' && (m.object as IdentifierNode).name === 'global' && m.property.type === 'Identifier') return (m.property as IdentifierNode).name;
      }
      return null;
    };

    // Collect EVERY typed global assignment, noting whether it sits inside a function.
    const assigns = new Map<string, Array<{ type: string; inFunc: boolean; fnName: string | undefined; start: number; end: number }>>();
    const walk = (n: unknown, inFunc: boolean, fnName: string | undefined): void => {
      if (!isAstNodeLike(n)) return;
      const t = n.type;
      let nextFn = fnName;
      const entering = t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression';
      if (entering) nextFn = (n as unknown as { id?: IdentifierNode }).id?.name ?? undefined;
      if (t === 'AssignmentExpression' && (n as unknown as AssignmentExpressionNode).operator === '=') {
        const a = n as unknown as AssignmentExpressionNode;
        const name = targetName(a.left);
        // Bare `X =` counts only when X is an implicit global (non-strict); `global.X =` always.
        const isGlobalTarget = a.left?.type === 'MemberExpression'
          || (a.left?.type === 'Identifier' && this.implicitGlobalNames.has(name || ''));
        if (name && isGlobalTarget && !localNames.has(name)) {
          const ty = coarse(a.right);
          if (ty !== 'unknown') {
            let list = assigns.get(name);
            if (!list) { list = []; assigns.set(name, list); }
            list.push({ type: ty, inFunc, fnName: inFunc ? fnName : undefined, start: a.left!.start, end: (a.right ?? a.left!).end });
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) walk(it, inFunc || entering, nextFn); }
        else walk(v, inFunc || entering, nextFn);
      }
    };
    walk(node, false, undefined);

    for (const [name, list] of assigns) {
      const types = new Set(list.map(s => s.type));
      if (types.size < 2) continue;                       // type-stable → fine
      if (!list.some(s => s.inFunc)) continue;            // all top level → order known (SSA) → fine
      // Flag each FUNCTION-context site whose type conflicts with some other assignment —
      // that's the assignment whose timing makes the type unknowable.
      for (const s of list) {
        if (!s.inFunc) continue;
        const others = [...types].filter(ty => ty !== s.type);
        if (others.length === 0) continue;
        this.addDiagnostic(
          `Global '${name}' is assigned \`${s.type}\` here but \`${others.join('`/`')}\` elsewhere, and this ` +
          `assignment is inside ${s.fnName ? `function '${s.fnName}'` : 'a function'} whose call timing is unknown — ` +
          `the type of '${name}' at any read cannot be statically determined. Keep a global's type ` +
          `stable, or use distinct names.`,
          s.start, s.end, DiagnosticSeverity.Warning, UcodeErrorCode.GLOBAL_TYPE_REASSIGNED,
        );
      }
    }
  }

  /**
   * Case-2 global-scope soundness (UC8002): flag a TOP-LEVEL read of a global that lexically
   * precedes every statement that defines it — an in-file `global.X=`/bare `X=` assignment OR
   * a top-level `loadfile("f.uc")()` that injects it. On first execution such a read is `null`
   * (non-strict) or throws `Reference error` (strict).
   *
   * SOUND / conservative — only fires when we can prove the global isn't defined yet:
   *   • never for a global assigned inside ANY function (its `init()` could run first — we
   *     don't have a call graph, so we don't guess);
   *   • never for reads inside a function (call timing unknown);
   *   • never for host/`@global`/registry names (no in-file def → not our concern here).
   * Everything it can't prove, it leaves silent (no false positive). Escape hatch: declare
   * the name with a JSDoc @global tag if a caller or a previous run defines it.
   */
  private checkGlobalScopeOrder(node: ProgramNode): void {
    // Top-level let/const/function names are locals (or hoisted) — never "globals" here.
    const localNames = new Set<string>();
    for (const stmt of node.body) {
      if (stmt.type === 'FunctionDeclaration' && (stmt as unknown as FunctionDeclarationNode).id?.name) {
        localNames.add((stmt as unknown as FunctionDeclarationNode).id!.name);
      }
      if (stmt.type === 'VariableDeclaration') {
        for (const d of ((stmt as unknown as VariableDeclarationNode).declarations || [])) {
          if (d?.id?.type === 'Identifier' && (d.id as IdentifierNode).name) localNames.add((d.id as IdentifierNode).name);
        }
      }
    }

    const earliestDef = new Map<string, number>(); // global name → earliest top-level def offset
    const funcAssigned = new Set<string>();         // global assigned inside some function → skip
    const recordDef = (name: string, pos: number) => {
      if (localNames.has(name)) return;
      const cur = earliestDef.get(name);
      if (cur === undefined || pos < cur) earliestDef.set(name, pos);
    };
    const loadfileInjects = (call: CallExpressionNode): string[] => {
      const inner = call.callee;
      if (inner?.type === 'CallExpression') {
        const lf = inner as CallExpressionNode;
        if (lf.callee?.type === 'Identifier' && (lf.callee as IdentifierNode).name === 'loadfile'
            && lf.arguments?.[0]?.type === 'Literal' && typeof (lf.arguments[0] as LiteralNode).value === 'string') {
          return this.fileResolver.getLoadfileGlobals((lf.arguments[0] as LiteralNode).value as string, this.textDocument.uri).map(g => g.name);
        }
      }
      return [];
    };
    // A global assignment target (`global.X` or bare `X`), or null.
    const assignTargetName = (left: AstNode | undefined): string | null => {
      if (!left) return null;
      if (left.type === 'Identifier') return (left as IdentifierNode).name || null;
      if (left.type === 'MemberExpression') {
        const m = left as MemberExpressionNode;
        if (!m.computed && m.object.type === 'Identifier' && (m.object as IdentifierNode).name === 'global'
            && m.property.type === 'Identifier') return (m.property as IdentifierNode).name;
      }
      return null;
    };

    // Pass 1: collect def points. inFunc assignments/loadfiles → funcAssigned (skip name).
    const collectDefs = (n: unknown, inFunc: boolean): void => {
      if (!isAstNodeLike(n)) return;
      const t = n.type;
      const entering = t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression';
      if (t === 'AssignmentExpression' && (n as unknown as AssignmentExpressionNode).operator === '=') {
        const name = assignTargetName((n as unknown as AssignmentExpressionNode).left);
        if (name && !localNames.has(name)) { if (inFunc) funcAssigned.add(name); else recordDef(name, n.start); }
      }
      if (t === 'CallExpression') {
        for (const name of loadfileInjects(n as unknown as CallExpressionNode)) {
          if (!localNames.has(name)) { if (inFunc) funcAssigned.add(name); else recordDef(name, n.start); }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) collectDefs(it, inFunc || entering); }
        else collectDefs(v, inFunc || entering);
      }
    };
    collectDefs(node, false);
    if (earliestDef.size === 0) return;

    // Pass 2: top-level reads (skip function interiors, assignment LHS, non-computed member
    // property names). Flag a read of a global before its earliest def, unless funcAssigned.
    const mode = this.options.uncertainGlobalScope ?? 'errorInStrict';
    const severity = (mode === 'errorInStrict' && this.strictMode) ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
    const flagged = new Set<string>(); // one per name (the first/earliest offending read)

    const visitRead = (name: string, pos: number): void => {
      if (localNames.has(name) || funcAssigned.has(name) || flagged.has(name)) return;
      const def = earliestDef.get(name);
      if (def === undefined || pos >= def) return;
      flagged.add(name);
      this.addDiagnostic(
        `'${name}' is read before it is assigned in this file (its definition is below). On first ` +
        `execution it is null (non-strict) or throws a Reference error (strict). If a caller or a ` +
        `previous run defines it, declare it with \`/** @global ${name} */\`.`,
        pos, pos + name.length, severity, UcodeErrorCode.GLOBAL_USED_BEFORE_DEFINED,
      );
    };
    const collectReads = (n: unknown, inFunc: boolean): void => {
      if (!isAstNodeLike(n)) return;
      const t = n.type;
      if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') return; // call timing unknown
      if (inFunc) return;
      if (t === 'Identifier') { visitRead((n as unknown as IdentifierNode).name, n.start); return; }
      if (t === 'MemberExpression') {
        const m = n as unknown as MemberExpressionNode;
        collectReads(m.object, inFunc);
        if (m.computed) collectReads(m.property, inFunc); // obj[x]: x is a read; obj.prop: prop is not
        return;
      }
      if (t === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        // LHS bare identifier is a write, not a read; a member LHS still reads its object.
        if (a.left?.type === 'MemberExpression') collectReads((a.left as MemberExpressionNode).object, inFunc);
        else if (a.left?.type !== 'Identifier') collectReads(a.left, inFunc);
        collectReads(a.right, inFunc);
        return;
      }
      if (t === 'VariableDeclarator') { collectReads((n as Record<string, unknown>)['init'], inFunc); return; } // id is not a read
      if (t === 'Property' && !(n as Record<string, unknown>)['computed']) { collectReads((n as Record<string, unknown>)['value'], inFunc); return; } // key is not a read
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) collectReads(it, inFunc); }
        else collectReads(v, inFunc);
      }
    };
    collectReads(node, false);
  }

  // Throwing-builtin behavior lives in one data-driven table (src/analysis/throwingBuiltins.ts),
  // shared with the quick-fix generator — see THROWING_BUILTINS.

  /** Is `n` a function value — a literal function/arrow expression, or an identifier bound to
   *  a function? Used to spare `render(fn, …)` from the throwing-call warning (it only
   *  propagates the callee's exceptions, like `call()`). */
  private argIsFunction(n: AstNode | undefined): boolean {
    if (!n) return false;
    if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') return true;
    if (n.type === 'Identifier') {
      const sym = this.symbolTable.lookup((n as IdentifierNode).name);
      if (!sym) return false;
      return sym.type === SymbolType.FUNCTION
        || sym.dataType === (UcodeType.FUNCTION as UcodeDataType)
        || sym.returnType !== undefined;
    }
    return false;
  }

  /**
   * Opt-in robustness pass: when a throwing builtin is called outside any enclosing
   * try block, flag the FIRST such call in each statement-list (block) and offer a
   * quick fix that wraps from that statement through the END of the block — so the
   * whole downstream usage of the parsed/loaded value is guarded, not just the call.
   *
   * Scope boundaries (try blocks, nested `{}` blocks, function bodies) each form their
   * own statement-list: a throw inside a nested block wraps within that block; a call
   * already inside a try block (its `block`, not its catch/finally) is not flagged.
   */
  private checkUnguardedThrowingCalls(node: ProgramNode): void {
    // Does `stmt` contain a throwing-builtin call AT THIS block level — i.e. before any
    // nested block/try/function boundary (those are handled by their own walkBlock)?
    // Returns the first such CallExpression, or null.
    const firstThrowAtLevel = (n: unknown): CallExpressionNode | null => {
      if (!isAstNodeLike(n)) return null;
      const t = n.type;
      // Don't descend past boundaries that start a new statement-list.
      if (t === 'BlockStatement' || t === 'TryStatement'
          || t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
        return null;
      }
      if (t === 'CallExpression') {
        const call = n as unknown as CallExpressionNode;
        if (call.callee?.type === 'Identifier'
            && THROWING_BUILTINS.has((call.callee as IdentifierNode).name)) {
          // Only the actual builtin throws; if a user shadowed the name with their own
          // binding, it's not our throwing builtin, so skip it.
          const sym = this.symbolTable.lookup((call.callee as IdentifierNode).name);
          if (!sym || sym.type === SymbolType.BUILTIN) return call;
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) { const f = firstThrowAtLevel(it); if (f) return f; } }
        else { const f = firstThrowAtLevel(v); if (f) return f; }
      }
      return null;
    };

    // A statement that must NOT be pulled into a try block: function declarations (moving them
    // changes scope/hoisting) and imports/exports (illegal anywhere but top level). The wrap
    // stops BEFORE the first such statement after the throwing call — otherwise a top-level
    // `json()` followed by function declarations would swallow every following function.
    const isWrapBoundary = (s: AstNode | undefined): boolean => !!s && (
      s.type === 'FunctionDeclaration' || s.type === 'ImportDeclaration'
      || s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration'
      || s.type === 'ExportAllDeclaration'
    );

    // The names a statement PRODUCES: a `let/const X = …` declares X; a `X = …` / `global.X = …`
    // assigns X; a `loadfile("f.uc")()` immediate-invoke injects f.uc's globals. Drives the
    // dependency-based wrap extent below.
    const gTarget = (left: AstNode | undefined): string | null => {
      if (!left) return null;
      if (left.type === 'Identifier') return (left as IdentifierNode).name || null;
      if (left.type === 'MemberExpression') {
        const m = left as MemberExpressionNode;
        if (!m.computed && m.object.type === 'Identifier' && (m.object as IdentifierNode).name === 'global'
            && m.property.type === 'Identifier') return (m.property as IdentifierNode).name;
      }
      return null;
    };
    const producedNames = (stmt: AstNode): string[] => {
      const expr = stmt.type === 'ExpressionStatement' ? (stmt as ExpressionStatementNode).expression : stmt;
      if (expr?.type === 'CallExpression') {
        const inner = (expr as CallExpressionNode).callee;
        if (inner?.type === 'CallExpression') {
          const lf = inner as CallExpressionNode;
          if (lf.callee?.type === 'Identifier' && (lf.callee as IdentifierNode).name === 'loadfile'
              && lf.arguments?.[0]?.type === 'Literal' && typeof (lf.arguments[0] as LiteralNode).value === 'string') {
            return this.fileResolver.getLoadfileGlobals((lf.arguments[0] as LiteralNode).value as string, this.textDocument.uri).map(g => g.name);
          }
        }
      }
      if (stmt.type === 'VariableDeclaration') {
        const out: string[] = [];
        for (const d of ((stmt as VariableDeclarationNode).declarations || [])) if (d?.id?.type === 'Identifier') out.push((d.id as IdentifierNode).name);
        return out;
      }
      if (expr?.type === 'AssignmentExpression' && (expr as AssignmentExpressionNode).operator === '=') {
        const n = gTarget((expr as AssignmentExpressionNode).left); return n ? [n] : [];
      }
      return [];
    };
    // Does `stmt` read any of `names`? (skips non-computed member property positions).
    const stmtRefsAny = (n: unknown, names: Set<string>): boolean => {
      if (!isAstNodeLike(n)) return false;
      if (n.type === 'Identifier') return names.has((n as unknown as IdentifierNode).name);
      if (n.type === 'MemberExpression') {
        const m = n as unknown as MemberExpressionNode;
        if (stmtRefsAny(m.object, names)) return true;
        return m.computed ? stmtRefsAny(m.property, names) : false;
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) if (stmtRefsAny(it, names)) return true; }
        else if (stmtRefsAny(v, names)) return true;
      }
      return false;
    };

    const walkBlock = (stmts: AstNode[] | undefined, insideTry: boolean): void => {
      if (!Array.isArray(stmts) || stmts.length === 0) return;
      if (!insideTry) {
        let i = 0;
        while (i < stmts.length) {
          const call = firstThrowAtLevel(stmts[i]);
          if (!call) { i++; continue; }
          const throwName = (call.callee as IdentifierNode).name;
          // In a uhttpd handler, loadfile doesn't just "throw on bad input" — it aborts the
          // request VM uncatchably, so "guard it with try/catch" is WRONG advice.
          // checkHandlerVmAbortingCalls emits the correct fix (UC8011); skip UC8001 here.
          if (this.isUhttpdHandler && throwName === 'loadfile') { i++; continue; }
          const spec = THROWING_BUILTINS.get(throwName);
          // For a `resolvable` builtin, decide whether its string-literal argument provably
          // resolves. 'module' (require): a builtin available at the CONFIGURED target version
          // (`socket` needs 24.10, `zlib`/`io` 25.12 → `require("socket")` on 22.03 does NOT
          // resolve) — using the builtin NAME list, since isKnownModule is registry-based and
          // misses builtins like `socket`; a non-builtin resolves if a file is on the search
          // path. 'path' (loadfile): the path exists on disk. `argVal`/`resolvedArg` are also
          // used to build a specific "not found" message. Host-injected globals (e.g. `uhttpd`)
          // aren't modules → they don't resolve → require() of one correctly still warns.
          const arg0 = call.arguments?.[0];
          // A function first argument (e.g. `render(fn, …)`) only propagates the callee's
          // exceptions (like `call()`) → don't flag. Covers a literal fn expression or an
          // identifier that resolves to a function.
          if (spec?.functionArgSafe && this.argIsFunction(arg0)) { i++; continue; }
          let argVal: string | null = null;
          let resolvedArg: boolean | null = null; // null = not a resolvable-kind call
          if (spec?.resolvable) {
            if (arg0?.type === 'Literal' && typeof (arg0 as LiteralNode).value === 'string') {
              argVal = (arg0 as LiteralNode).value as string;
              // A path-shaped require() name can never resolve (template charset is
              // [A-Za-z0-9_.]) — that's the hard error UC3008 from the builtin
              // validator, and "guard it with try/catch" would be the wrong advice.
              // Skip the UC8001 framing entirely for that case.
              if (spec.resolvable === 'module' && /[^A-Za-z0-9_.]/.test(argVal)) { i++; continue; }
              resolvedArg = spec.resolvable === 'module'
                ? ((KNOWN_MODULES as readonly string[]).includes(argVal)
                    ? !this.moduleGatedOutAtTarget(argVal)
                    : this.fileResolver.requireResolvesFile(argVal, this.textDocument.uri))
                : this.fileResolver.filePathResolves(argVal, this.textDocument.uri);
            }
            // Resolvable and the "always warn resolvable" setting is off → don't flag at all.
            if (resolvedArg === true && !this.options.warnResolvableThrowingCalls) { i++; continue; }
          }
          // Wrap extent = the throwing statement through the LAST statement that (transitively)
          // depends on its result. Unrelated trailing code (e.g. an independent `require()`) is
          // left OUT of the try — and gets its own diagnostic on the next loop iteration. Stops
          // at a boundary (function/import/export) that can't be wrapped.
          const produced = new Set<string>(producedNames(stmts[i]!));
          let endIdx = i;
          for (let j = i + 1; j < stmts.length; j++) {
            if (isWrapBoundary(stmts[j])) break;
            if (produced.size > 0 && stmtRefsAny(stmts[j], produced)) {
              endIdx = j;
              for (const nm of producedNames(stmts[j]!)) produced.add(nm);
            }
          }
          // Warning by default. Escalates to Error under 'use strict' only for builtins that
          // aren't `warnOnly` (just `json` by default) — unless the `strictThrowingCalls` setting
          // escalates ALL of them under strict.
          const escalatesUnderStrict = this.options.strictThrowingCalls === true || !spec?.warnOnly;
          const severity = (escalatesUnderStrict && this.strictMode)
            ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
          // Message: specific when we know the arg didn't resolve (require/loadfile "not found"),
          // otherwise the generic "throws on invalid input" wording.
          let message: string;
          if (resolvedArg === false && argVal !== null) {
            message = spec?.resolvable === 'module'
              ? `Module '${argVal}' was not found on the require search path — \`require()\` throws at runtime when the module is missing. Guard it with try/catch, or fix the name.`
              : `File '${argVal}' was not found — \`${throwName}()\` throws at runtime when the path is missing. Guard it with try/catch, or fix the path.`;
          } else if (resolvedArg === true) {
            message = `\`${throwName}("${argVal}")\` resolves, but can still throw on a compile/runtime error. Guard it with try/catch.`;
          } else {
            message = `\`${throwName}()\` throws on invalid input and isn't inside a try/catch. ` +
              `Wrap it (and the code that uses its result) to handle failures gracefully.`;
          }
          this.addDiagnostic(
            message,
            call.start, call.end, severity,
            UcodeErrorCode.UNGUARDED_THROWING_CALL,
            { wrapTryCatch: { start: stmts[i]!.start, end: stmts[endIdx]!.end, fn: throwName } },
          );
          i = endIdx + 1; // continue AFTER this wrap — later independent throwers get flagged too
        }
      }
      // Descend into nested statement-lists regardless (each is its own scope).
      for (const stmt of stmts) descend(stmt, insideTry);
    };

    // Walk into nested blocks/try/functions, invoking walkBlock on each new list.
    const descend = (n: unknown, insideTry: boolean): void => {
      if (!isAstNodeLike(n)) return;
      const t = n.type;
      if (t === 'BlockStatement') { walkBlock((n as any).body, insideTry); return; }
      if (t === 'TryStatement') {
        const tryNode = n as any;
        walkBlock(tryNode.block?.body, true);                 // guarded
        if (tryNode.catch?.body) walkBlock(tryNode.catch.body.body, false); // catch isn't caught by this try
        if (tryNode.finalizer?.body) walkBlock(tryNode.finalizer.body.body, false);
        return;
      }
      if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
        const fn = n as any;
        const body = fn.body;
        if (body?.type === 'BlockStatement') walkBlock(body.body, false);
        else descend(body, false); // expression-bodied arrow
        return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) descend(it, insideTry); }
        else descend(v, insideTry);
      }
    };

    walkBlock(node.body as AstNode[], false);
  }

  /**
   * Every name in an `export { … }` specifier list must be a module-LOCAL binding
   * (a `let`/`const`/`function` declared in this file). ucode rejects exporting an
   * undeclared name, a builtin, an imported name, or any other non-local — all are
   * hard compile errors ("Attempt to export undeclared or non-local variable").
   * Run as a post-pass so a name declared later in the module still resolves.
   */
  private checkExportedNames(node: ProgramNode): void {
    for (const stmt of node.body) {
      // `export * from "…"` — ucode has no re-export grammar at all (finding #69).
      if (stmt.type === 'ExportAllDeclaration') {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.SYNTAX_ERROR,
          `ucode does not support \`export * from …\`. Import the names and re-export them as local bindings.`,
          stmt.start, stmt.end, DiagnosticSeverity.Error,
        );
        continue;
      }
      if (stmt.type !== 'ExportNamedDeclaration') continue;
      const exp = stmt as ExportNamedDeclarationNode;
      // `export { x } from "…"` — re-export syntax, also unsupported in ucode
      // (finding #69). Flag the whole statement; the specifier-local check below is
      // skipped (the names refer to the other module, not this one).
      if (exp.source) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.SYNTAX_ERROR,
          `ucode does not support \`export { … } from …\` re-exports. Import the names first, then export them.`,
          exp.start, exp.end, DiagnosticSeverity.Error,
        );
        continue;
      }
      // `export function f(){}` / `export const x = …` declare inline — always valid.
      if (exp.declaration) continue;
      for (const spec of (exp.specifiers || [])) {
        const name = spec.local?.name;
        if (!name) continue;
        const sym = this.symbolTable.lookup(name);
        const isLocal = sym && (sym.type === SymbolType.VARIABLE || sym.type === SymbolType.FUNCTION);
        if (isLocal) continue;
        const reason = !sym ? `it is not declared in this module`
          : sym.type === SymbolType.IMPORTED ? `it is imported, not declared here (re-exporting an import is not allowed)`
          : sym.type === SymbolType.BUILTIN ? `it is a builtin, not a module-local variable`
          : `it is not a module-local variable`;
        this.addDiagnosticErrorCode(
          UcodeErrorCode.INVALID_EXPORT,
          `Cannot export '${name}': ${reason}.`,
          spec.local.start,
          spec.local.end,
          DiagnosticSeverity.Error,
        );
      }
    }
  }

  /**
   * A forward declaration (`function f;`) makes `f` callable, which suppresses
   * the "undefined function" diagnostic. So a forward declaration that is never
   * completed by a real definition AND not exported is a silent bug (calling it
   * crashes at runtime). Flag those. Exported or later-defined names are fine.
   * Whole-file name matching, biased against false positives: if a real
   * definition of the name exists anywhere, we never warn.
   */
  private checkForwardDeclarations(node: ProgramNode): void {
    const forwardDecls: FunctionDeclarationNode[] = [];
    const definedNames = new Set<string>();
    const exportedNames = new Set<string>();

    const collect = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'FunctionDeclaration') {
        const fn = n as unknown as FunctionDeclarationNode;
        if (fn.id?.name) {
          if (fn.forwardDeclaration) forwardDecls.push(fn);
          else definedNames.add(fn.id.name);
        }
      } else if (n.type === 'ExportNamedDeclaration') {
        const exp = n as unknown as ExportNamedDeclarationNode;
        const decl = exp.declaration;
        if (decl?.type === 'FunctionDeclaration' && (decl as FunctionDeclarationNode).id?.name) {
          const fnDecl = decl as FunctionDeclarationNode;
          (fnDecl.forwardDeclaration ? exportedNames : definedNames).add(fnDecl.id.name);
        }
        for (const spec of (exp.specifiers || [])) {
          const nm = spec.local?.name ?? spec.exported?.name;
          if (nm) exportedNames.add(nm);
        }
      } else if (n.type === 'ExportDefaultDeclaration') {
        const exp = n as unknown as ExportDefaultDeclarationNode;
        if (exp.declaration?.type === 'Identifier') exportedNames.add((exp.declaration as IdentifierNode).name);
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) collect(it); }
        else if (isAstNodeLike(v)) collect(v);
      }
    };
    collect(node);

    for (const fwd of forwardDecls) {
      const name = fwd.id.name;
      if (!definedNames.has(name) && !exportedNames.has(name)) {
        this.addDiagnostic(
          `Function '${name}' is forward-declared but never defined. Add a definition (function ${name}(...) { ... }) or remove the forward declaration.`,
          fwd.start, fwd.end, DiagnosticSeverity.Warning, 'forward-declaration-never-defined'
        );
      }
    }
  }

  /**
   * Pre-register all top-level function declarations in the symbol table
   * so that forward references (calling a function before its declaration) work.
   */
  /**
   * Collect every name that is the target of a bare assignment (`name = …`, or `name++`),
   * i.e. NOT a `let`/`const` declaration. In non-strict ucode such an assignment
   * auto-creates an implicit global (verified vs the interpreter), so reading the name
   * anywhere is valid. We use this set to suppress UC1001 only where it's provably safe;
   * locals/params still resolve via normal scope lookup, and genuine typos (read-only,
   * never assigned) stay flagged. Empty under 'use strict' (there, bare assignment to an
   * undeclared name is itself a runtime error, so we keep flagging).
   */
  private collectImplicitGlobalNames(node: ProgramNode): void {
    this.implicitGlobalNames.clear();
    if (this.strictMode) return;
    const names = this.implicitGlobalNames;

    // A name declared with `let`/`const` in a loop HEADER (`for (let i…)`, `for (let x in…)`)
    // is block-scoped to that loop, never a global — even though its `i++` update looks like
    // a bare assignment. Collect those names so the heuristic below doesn't mark them implicit
    // globals (which would wrongly suppress the "out of scope" diagnostic when the loop var is
    // read after the loop). Finding #17.
    const loopHeaderLocals = new Set<string>();
    const collectLoopLocals = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      const header: unknown = (n.type === 'ForStatement') ? n.init
        : (n.type === 'ForInStatement') ? n.left : null;
      if (isAstNodeLike(header) && header.type === 'VariableDeclaration') {
        const decls = (header as unknown as VariableDeclarationNode).declarations ?? [];
        for (const d of decls) {
          if (d?.id?.type === 'Identifier' && (d.id as IdentifierNode).name) loopHeaderLocals.add((d.id as IdentifierNode).name);
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) collectLoopLocals(it); }
        else if (isAstNodeLike(v)) collectLoopLocals(v);
      }
    };
    collectLoopLocals(node);

    const walk = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        if (a.left?.type === 'Identifier' && (a.left as IdentifierNode).name) {
          const nm = (a.left as IdentifierNode).name;
          if (!loopHeaderLocals.has(nm)) names.add(nm);
        }
      } else if (n.type === 'UnaryExpression') {
        const u = n as unknown as UnaryExpressionNode;
        if ((u.operator === '++' || u.operator === '--')
            && u.argument?.type === 'Identifier' && (u.argument as IdentifierNode).name) {
          // `x++` / `--x` on an undeclared name also auto-creates the implicit global.
          const nm = (u.argument as IdentifierNode).name;
          if (!loopHeaderLocals.has(nm)) names.add(nm);
        }
      } else if (n.type === 'ForInStatement') {
        const f = n as unknown as ForInStatementNode;
        if (f.left?.type === 'Identifier' && (f.left as IdentifierNode).name) {
          // A bare `for (x in …)` loop variable (no `let`) is an implicit global that
          // persists after the loop (verified vs the interpreter). Strict mode flags it
          // separately (visitForInStatement).
          names.add((f.left as IdentifierNode).name);
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    walk(node);
  }

  /**
   * Collect every name installed on the builtin `global` object via `global.X = …`
   * (dot form) or `global["X"] = …` (string-literal computed form) anywhere in the
   * module. Mirrors collectImplicitGlobalNames so the shared set is robust to traversal
   * order. Unlike implicit globals this is NOT strict-gated — `global.X = fn` is a real
   * global binding under `'use strict'` too (verified vs the interpreter).
   */
  /** Find `loadfile(<stringLiteral>)()` immediate-invoke sites and merge the globals the
   *  loaded file injects into the caller's global-property name set (suppresses false
   *  UC1002/UC1001 for those names). Only literal paths resolve; a template/non-literal
   *  path (e.g. `loadfile(`${BASE}/x.uc`)()`) is skipped — but a sibling literal-path
   *  loadfile of the same file still covers it. */
  private collectLoadfileGlobals(node: ProgramNode): void {
    this.loadfileGlobals.clear();
    const merge = (rawPath: string) => {
      for (const g of this.fileResolver.getLoadfileGlobals(rawPath, this.textDocument.uri)) {
        this.globalPropertyNames.add(g.name);       // suppress UC1001/UC1002 for the name
        if (!this.loadfileGlobals.has(g.name)) this.loadfileGlobals.set(g.name, g); // def + hover
        // An object-valued injected global carries its member shape — declare it as a
        // real global object symbol so member access resolves cross-file (the in-file
        // `global.X = { … }` equivalent of declareGlobalObjectBinding).
        if (g.propertyTypes && g.propertyTypes.size > 0) {
          this.symbolTable.forceGlobalDeclaration(g.name, SymbolType.VARIABLE, UcodeType.OBJECT as UcodeDataType);
          const sym = this.symbolTable.lookup(g.name);
          if (sym) {
            sym.dataType = UcodeType.OBJECT as UcodeDataType;
            sym.propertyTypes = g.propertyTypes;
            if (g.propertyReturnTypes) sym.propertyFunctionReturnTypes = g.propertyReturnTypes;
            sym.used = true; // ambient injected global — never "unused"
          }
        } else {
          // Non-object injected global: carry a true SCALAR's type across the loadfile
          // boundary — previously only objects crossed, so `let y = S` for a cross-file
          // `global.S = 42` resolved to `unknown` instead of `integer` (09). Deliberately
          // NOT function/array — those stay name-only so cross-file go-to-definition/hover
          // keep resolving through the loadfileGlobals map (a declared symbol would shadow it).
          const scalar: Record<string, UcodeType> = {
            integer: UcodeType.INTEGER, double: UcodeType.DOUBLE, string: UcodeType.STRING,
            bool: UcodeType.BOOLEAN, null: UcodeType.NULL,
          };
          const dt = scalar[g.typeStr];
          if (dt) {
            this.symbolTable.forceGlobalDeclaration(g.name, SymbolType.VARIABLE, dt as UcodeDataType);
            const sym = this.symbolTable.lookup(g.name);
            if (sym) { sym.dataType = dt as UcodeDataType; sym.used = true; }
          }
        }
      }
    };
    const walk = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      // immediate-invoke: outer CallExpression whose callee is `loadfile(<literal>)`
      if (n.type === 'CallExpression') {
        const inner = (n as unknown as CallExpressionNode).callee;
        if (isAstNodeLike(inner) && inner.type === 'CallExpression') {
          const lf = inner as unknown as CallExpressionNode;
          if (lf.callee?.type === 'Identifier' && (lf.callee as IdentifierNode).name === 'loadfile'
              && lf.arguments?.length >= 1
              && lf.arguments[0]?.type === 'Literal'
              && typeof (lf.arguments[0] as LiteralNode).value === 'string') {
            merge((lf.arguments[0] as LiteralNode).value as string);
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    walk(node);
  }

  /** The coarse scalar type of a literal RHS, or null when it isn't a statically-typed
   *  scalar (calls, identifiers, objects, …). Used by the scalar-global SSA gate. */
  private scalarCoarseType(n: AstNode | undefined): UcodeType | null {
    if (!n) return null;
    if (n.type === 'TemplateLiteral') return UcodeType.STRING;
    if (n.type === 'Literal') {
      const v = (n as LiteralNode).value;
      if (typeof v === 'string') return UcodeType.STRING;
      if (typeof v === 'boolean') return UcodeType.BOOLEAN;
      if (v === null) return UcodeType.NULL;
      if (typeof v === 'number') return Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE;
      return null;
    }
    if (n.type === 'UnaryExpression') {
      const u = n as unknown as { operator?: string; argument?: AstNode };
      if ((u.operator === '-' || u.operator === '+') && u.argument?.type === 'Literal') {
        const inner = this.scalarCoarseType(u.argument);
        return (inner === UcodeType.INTEGER || inner === UcodeType.DOUBLE) ? inner : null;
      }
    }
    return null;
  }

  private collectGlobalPropertyNames(node: ProgramNode): void {
    this.globalPropertyNames.clear();
    this.globalDefSites.clear();
    this.scalarSSAEligible.clear();
    this.globalObjectBindings.clear();
    const names = this.globalPropertyNames;
    const recordSite = (name: string, start: number, end: number): void => {
      let list = this.globalDefSites.get(name);
      if (!list) { list = []; this.globalDefSites.set(name, list); }
      list.push({ start, end });
    };
    // SSA gate: a global is eligible only if EVERY assignment to it is a straight-line
    // top-level statement (Program → ExpressionStatement → AssignmentExpression chains —
    // order statically known) with a scalar-literal RHS. One assignment anywhere else
    // (branch/function/loop, or a non-literal RHS) taints the name.
    const sawScalar = new Set<string>();
    const tainted = new Set<string>();
    const noteAssign = (name: string, rhs: AstNode | undefined, straight: boolean): void => {
      if (straight && this.scalarCoarseType(rhs) !== null) sawScalar.add(name);
      else tainted.add(name);
    };
    const walk = (n: unknown, straight: boolean): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        if (a.operator === '=' && a.left?.type === 'MemberExpression') {
          const mem = a.left as MemberExpressionNode;
          if (mem.object?.type === 'Identifier' && (mem.object as IdentifierNode).name === 'global') {
            const prop = mem.property;
            if (!mem.computed && prop?.type === 'Identifier' && (prop as IdentifierNode).name) {
              names.add((prop as IdentifierNode).name);
              recordSite((prop as IdentifierNode).name, prop.start, prop.end);
              noteAssign((prop as IdentifierNode).name, a.right, straight);
            } else if (mem.computed && prop?.type === 'Literal' && typeof (prop as LiteralNode).value === 'string') {
              names.add((prop as LiteralNode).value as string);
              recordSite((prop as LiteralNode).value as string, prop.start, prop.end);
              noteAssign((prop as LiteralNode).value as string, a.right, straight);
            }
          }
        } else if (a.operator === '=' && a.left?.type === 'Identifier') {
          // Bare `X = …` where X is an implicit global (non-strict) — a def site too, so
          // go-to-definition on a later read of X can land here. (collectImplicitGlobalNames
          // has already run; the name-only suppression set is unaffected.)
          const nm = (a.left as IdentifierNode).name;
          if (nm && this.implicitGlobalNames.has(nm)) {
            recordSite(nm, a.left.start, a.left.end);
            noteAssign(nm, a.right, straight);
          }
        }
      }
      // Straight-line only survives Program-body statement → expression → nested-assignment
      // chains; descending into anything else (functions, branches, calls, …) breaks it.
      const keepsStraight = n.type === 'Program' || n.type === 'ExpressionStatement'
        || n.type === 'AssignmentExpression';
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) walk(it, straight && keepsStraight); }
        else if (isAstNodeLike(v)) walk(v, straight && keepsStraight);
      }
    };
    walk(node, true);
    for (const nm of sawScalar) if (!tainted.has(nm)) this.scalarSSAEligible.add(nm);
  }

  /**
   * Bare `name = require("mod")` (no `let`/`const`) is the non-strict CommonJS-import
   * pattern — it loads the module into an implicit global. `let name = require(...)` is
   * already handled in visitVariableDeclarator; this covers the bare form so `name.member`
   * (e.g. `math.rand()`) resolves through the module registry instead of being flagged
   * "Cannot use 'math' module without importing". Only known builtin modules are handled
   * here (file-path requires remain a TODO). Declared at module scope so position doesn't
   * matter.
   */
  private hoistBareRequireModules(node: ProgramNode): void {
    if (!this.options.enableScopeAnalysis) return;
    const walk = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'AssignmentExpression') {
        const a = n as unknown as AssignmentExpressionNode;
        const left = a.left;
        const right = a.right;
        if (a.operator === '=' && left?.type === 'Identifier' && (left as IdentifierNode).name
            && right?.type === 'CallExpression') {
          const call = right as CallExpressionNode;
          if (call.callee?.type === 'Identifier' && (call.callee as IdentifierNode).name === 'require'
              && call.arguments?.length === 1
              && call.arguments[0]?.type === 'Literal' && typeof (call.arguments[0] as LiteralNode).value === 'string'
              && isKnownModule((call.arguments[0] as LiteralNode).value as string)) {
            const moduleName = (call.arguments[0] as LiteralNode).value as string;
            const dataType = { type: UcodeType.OBJECT, moduleName } as UcodeDataType;
            this.symbolTable.declare((left as IdentifierNode).name, SymbolType.MODULE, dataType, left);
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    walk(node);
  }

  private hoistFunctionDeclarations(node: ProgramNode): void {
    if (!this.options.enableScopeAnalysis) return;
    for (const stmt of node.body) {
      // A top-level function declaration — bare or wrapped in `export` (named or
      // default). `export function reload()` parses as an ExportNamedDeclaration
      // whose `.declaration` is the FunctionDeclaration; without unwrapping it, a
      // forward reference to an exported function (`config_set` calling `reload`
      // defined later in the module) was wrongly flagged "Undefined function".
      let funcNode: FunctionDeclarationNode | null = null;
      if (stmt.type === 'FunctionDeclaration') {
        funcNode = stmt as FunctionDeclarationNode;
      } else if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration')
          && (stmt as any).declaration?.type === 'FunctionDeclaration') {
        funcNode = (stmt as any).declaration as FunctionDeclarationNode;
      }
      if (funcNode?.id?.name) {
        // Pre-declare all top-level functions (so type/completion/signature features
        // see them) at their REAL declaration position. ucode does NOT hoist function
        // values — a reference to a function declared later is a runtime "undeclared
        // variable" error. Declaring at the real position lets position-aware lookup
        // (lookupAtPosition, declaredAt <= position) resolve backward references and
        // recursion while leaving a forward reference unresolved → flagged. An
        // explicit `function f;` forward declaration appears earlier in node.body, so
        // it's pre-declared first and makes later references resolve.
        this.symbolTable.declare(funcNode.id.name, SymbolType.FUNCTION, UcodeType.FUNCTION as UcodeDataType, funcNode.id);
      }
    }
  }

  override visitVariableDeclaration(node: VariableDeclarationNode): void {
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
      // NOTE: `@type {T}` on a variable is deliberately NOT supported. It's an unverified
      // assertion the checker would then trust; for an opaque variable the safe default is
      // `unknown` (which suppresses checks), so @type can only trade that safety away — a
      // footgun with no floor. (See docs/auto-docs/62-jsdoc-type-tag-unsupported.md.) `@returns`
      // survives the same test because it types a reusable function contract across call sites.
    } else {
      super.visitVariableDeclaration(node);
    }
  }

  override visitVariableDeclarator(node: VariableDeclaratorNode, kind: string = 'let'): void {
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
      } else if (node.id && node.id.type === 'Identifier') {
        // No initializer: in ucode an uninitialized binding is definitively `null`
        // (verified vs /usr/local/bin/ucode: `let x; type(x) == "null"`), not "unknown".
        // SSA flow still overrides this the moment the variable is assigned, so this only
        // governs the window before the first assignment (and bare `let x;` everywhere).
        // Guarded to plain identifiers so destructuring patterns are left to their own path.
        dataType = UcodeType.NULL as UcodeDataType;
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
                  if (resolvedUri.startsWith('file://')) this.resolvedImports.add(resolvedUri);
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
                  if (resolvedUri.startsWith('file://')) this.resolvedImports.add(resolvedUri);
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

      // `let a = loadfile("x.uc")()` — the call returns the loaded program's top-level
      // return value (explicit `return` first, else a trailing bare expression, else
      // null — verified vs the interpreter). Infer it from the target file so `a` gets
      // a real type instead of unknown; an object-literal return also carries its
      // member shape for hover/completion. (docs/ucode-module-resolution.md)
      const loadfileReturnShape: LoadfileProgramReturn | null = node.init
        ? this.loadfileCallReturnInfo(node.init) : null;
      if (loadfileReturnShape) {
        dataType = loadfileReturnShape.dataType;
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
      
      // Check if we have a real redeclaration (same scope, not builtin).
      if (existingSymbol && existingSymbol.type !== SymbolType.BUILTIN) {
        // ucode only rejects `let` redeclaration under 'use strict' (verified vs the
        // interpreter: non-strict allows it, last definition wins; strict is a syntax
        // error). So flag it only in strict mode; in non-strict it's permitted (and the
        // existing symbol is kept, matching the prior no-redeclare behavior).
        if (this.strictMode) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.VARIABLE_REDECLARATION,
            `Variable '${name}' is already declared in this scope`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Error,
          );
        }
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
        if (declaredSymbol && kind === 'const') {
          // Mark const bindings so a later assignment/increment is flagged (UC1010).
          declaredSymbol.isConstant = true;
        }
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

      // Stamp the member shape of a loadfile()()-returned object literal so
      // `a.member` / `a.method()` resolve like a local object literal would.
      if (loadfileReturnShape) {
        const sym = this.symbolTable.lookup(name);
        if (sym) {
          if (loadfileReturnShape.propertyTypes) sym.propertyTypes = loadfileReturnShape.propertyTypes;
          if (loadfileReturnShape.propertyFunctionReturnTypes) {
            sym.propertyFunctionReturnTypes = loadfileReturnShape.propertyFunctionReturnTypes;
          }
        }
      }


      // Process initializer
      if (node.init) {
        this.visit(node.init);

        // Type inference if type checking is enabled
        if (this.options.enableTypeChecking) {
          this.processInitializerTypeInference(node, name);
        }

        // Function-valued variable: `let f = () => {…}` / `let f = function(){…}`. The
        // arrow/expression visitor stashed the inferred return type on the init node;
        // stamp the symbol as a FUNCTION carrying that returnType so call sites
        // (inferFunctionCallReturnType) resolve `f(...)`'s type like a named function.
        if (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') {
          const fnSym = this.symbolTable.lookup(name);
          if (fnSym) {
            fnSym.dataType = UcodeType.FUNCTION as UcodeDataType;
            const rt = (node.init as any)._inferredReturnType;
            if (rt !== undefined && rt !== null) fnSym.returnType = rt;
            // Stamp the param signature so call sites argument-check `f(...)` like a
            // named function (JSDoc `@param {T}` types flow through the param symbols).
            const params = (node.init as any)._inferredParams as ParamInfo[] | undefined;
            if (params) fnSym.parameters = params;
          }
        }

        // Upgrade array literal type to ArrayType if element type can be inferred
        if (node.init.type === 'ArrayExpression') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            // checkNode returns the rich type (e.g. array<string>) directly.
            const fullType = this.typeChecker.checkNode(node.init);
            if (fullType && isArrayType(fullType)) {
              sym.dataType = fullType;
              sym.initialLiteralType = fullType;
            }
          }
        }

        // Upgrade symbol type from function call results that have a rich type
        // (e.g., split() → array<string>, reverse([1,2]) → array<integer>, pop(arr) → element type,
        //  glob("/path") → array<string> (narrowed from array<string> | null),
        //  io.open() → io.handle | null, cursor() → uci.cursor | null)
        if (node.init.type === 'CallExpression' || node.init.type === 'MemberExpression') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            // checkNode returns the call/member result's rich type directly.
            // Only upgrade when we actually resolved something (non-UNKNOWN) so
            // we never clobber an existing dataType with UNKNOWN.
            const fullType = this.typeChecker.checkNode(node.init);
            if (fullType !== undefined && fullType !== null && fullType !== UcodeType.UNKNOWN) {
              sym.dataType = fullType;
              // For module object types (fs.file, io.handle, uci.cursor, etc.),
              // force global declaration so method resolution works across scopes
              const mt = extractModuleType(fullType);
              if (mt && isKnownObjectType(mt.moduleName)) {
                this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, fullType);
              }
            }
            // keys-of provenance: propagate from the init expression. Covers
            //   let ks = keys(obj);            // init is a tagged CallExpression
            //   let k  = ks[i];                // init is a tagged MemberExpression
            // Set at declaration site only; we don't track reassignments, so
            // `let k = keys(o); k = "x"; o[k]` keeps the tag (accepted leak).
            const initKeysOf = (node.init as any)._keysOfSymbol as string | undefined;
            if (initKeysOf) sym.keysOfSymbol = initKeysOf;
          }
        }

        // Plain alias: `let alias = ks;` where ks already has keysOfSymbol →
        // copy the tag. Without this, the chain breaks at any rebinding.
        if (node.init.type === 'Identifier') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            const srcSym = this.symbolTable.lookup((node.init as IdentifierNode).name);
            if (srcSym?.keysOfSymbol) sym.keysOfSymbol = srcSym.keysOfSymbol;
            // Function-value aliasing: `let f = greet` (and chains `let g = f`)
            // carry the callee's signature so `f(args)` is argument-checked like a
            // direct call. Covers in-file and imported function references.
            if (srcSym?.parameters) {
              sym.parameters = srcSym.parameters;
              if (srcSym.returnType !== undefined) sym.returnType = srcSym.returnType;
              if (sym.dataType === UcodeType.UNKNOWN) sym.dataType = UcodeType.FUNCTION as UcodeDataType;
            }
          }
        }

        // Module member function bound to a variable: `let readfile = fs_mod.readfile`
        // where fs_mod is a module type (e.g. from `@param {module:fs}`). Stamp the
        // variable like a named import so hover/completion resolve the function's
        // signature. Kept as a VARIABLE (not IMPORTED) so go-to-definition still
        // lands on the local `let` and completion doesn't treat it as a namespace.
        if (node.init.type === 'MemberExpression') {
          const mem = node.init as MemberExpressionNode;
          if (mem.object.type === 'Identifier' && !mem.computed && mem.property.type === 'Identifier') {
            const objSym = this.symbolTable.lookup((mem.object as IdentifierNode).name);
            const modName = objSym ? extractModuleType(objSym.dataType)?.moduleName : undefined;
            if (modName && isKnownModule(modName)) {
              const memberName = (mem.property as IdentifierNode).name;
              if (MODULE_REGISTRIES[modName].getFunctionNames().includes(memberName)) {
                const sym = this.symbolTable.lookup(name);
                if (sym) {
                  sym.dataType = UcodeType.FUNCTION;
                  sym.importedFrom = modName;
                  sym.importSpecifier = memberName;
                }
              }
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

        // Dictionary value-shape binding: `let v = O[expr]` where O is a map with
        // an inferred value shape → v gets that shape (so `v.foo` resolves). Runs
        // after the rich-type upgrade above so it isn't clobbered.
        if (node.init.type === 'MemberExpression') {
          const mem = node.init as MemberExpressionNode;
          if (mem.computed && mem.object.type === 'Identifier') {
            const objSym = this.symbolTable.lookupAtPosition((mem.object as IdentifierNode).name, mem.object.start)
                        ?? this.symbolTable.lookup((mem.object as IdentifierNode).name);
            const sym = this.symbolTable.lookup(name);
            if (objSym?.valuePropertyTypes && objSym.valuePropertyTypes.size > 0 && sym) {
              sym.dataType = UcodeType.OBJECT as UcodeDataType;
              sym.propertyTypes = objSym.valuePropertyTypes;
            }
          }
        }

        // Case 1: Populate propertyTypes from object literal at declaration
        if (node.init.type === 'ObjectExpression') {
          const sym = this.symbolTable.lookup(name);
          if (sym) {
            const propTypes = this.inferObjectLiteralPropertyTypes(node.init as ObjectExpressionNode);
            if (propTypes) sym.propertyTypes = propTypes;
            // Dictionary value-shape inference for an EMPTY object literal used as
            // a string-keyed map (`let m = {}; … m[k] = {…}`). Populates
            // sym.valuePropertyTypes so `m[k]` / `let v = m[k]` resolve to the
            // value shape. Gated on empty (a non-empty literal is a struct, not a
            // map) to bound the cost.
            else {
              const scopeRoot = this.currentFunctionNode ?? this.currentASTRoot;
              if (scopeRoot) this.inferMapValueShape(sym, scopeRoot as AstNode);
            }
            // The whole init was visited above (line ~877), so every function property's
            // return type is stamped — record them so `obj.method()` resolves.
            const fnReturns = this.inferObjectLiteralFunctionReturnTypes(node.init as ObjectExpressionNode);
            if (fnReturns) sym.propertyReturnTypes = fnReturns;
            // Property locations so go-to-definition on `obj.member` lands on the property.
            if (!sym.propertyDefinitionLocations) {
              const locs = this.inferObjectLiteralPropertyLocations(node.init as ObjectExpressionNode);
              if (locs) sym.propertyDefinitionLocations = locs;
            }
          }
        }
      }
    } else {
      super.visitVariableDeclarator(node);
    }
  }
       
  override visitImportDeclaration(node: ImportDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      // Imports must appear at module (top-level) scope. getCurrentScope() is 0 at
      // the module level and >0 inside any function body or block (e.g. an `if {}`),
      // since visitBlockStatement/visitFunctionDeclaration each enterScope(). An import
      // at a non-module scope is invalid, so we flag it AND do NOT declare its bindings:
      // the names must not enter scope, so there's no module hover/completion for them
      // and downstream uses correctly resolve as undefined.
      if (this.symbolTable.getCurrentScope() > 0) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.IMPORT_NOT_TOP_LEVEL,
          "Import declarations may only appear at the top level of a module, not inside a function or block",
          node.start,
          node.end,
          DiagnosticSeverity.Error
        );
        return;
      }

      const modulePath = node.source.value as string;

      // Version-gated: a builtin module that doesn't exist on the configured target
      // (e.g. `io` predates OpenWrt 25.12) → UC6005 on the module path.
      const moduleIntro = VERSION_MODULES[modulePath];
      if (moduleIntro) {
        this.flagVersionMin(moduleIntro, `The \`${modulePath}\` module requires {INTRO}'s ucode`,
          `it isn't available on the target`, node.source.start, node.source.end);
      }

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

  override visitImportSpecifier(_node: ImportSpecifierNode): void {
    // Don't visit the local identifier here - it's already declared in the symbol table
    // by processImportSpecifier. Visiting it would mark it as "used" immediately,
    // preventing unused import warnings.
    // We also don't visit the imported identifier to prevent "undefined variable" errors
    // for the original name in aliased imports (e.g., import { foo as bar })
  }

  override visitProperty(node: PropertyNode): void {
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
    }
    
    // Special case: importing 'const' from rtnl creates a constants object
    if (source === 'rtnl' && importedName === 'const') {
      dataType = {
        type: UcodeType.OBJECT,
        moduleName: 'rtnl-const'
      };
    }
    
    // Set function data type for all known module imported functions
    if (isKnownModule(source) && specifier.type === 'ImportSpecifier') {
      const reg = MODULE_REGISTRIES[source];
      // Platform-gated symbol (e.g. io's Linux-only IOC_DIR_* constants) → UC6006 INFO.
      // Applies to functions AND constants, so it's checked before the function branch.
      this.flagPlatformGated(source, importedName, specifier.imported.start, specifier.imported.end);
      const isModuleFunction = !!reg && reg.getFunctionNames().includes(importedName);
      if (isModuleFunction) {
        dataType = UcodeType.FUNCTION as UcodeDataType;
      }
      // Version-gated: the symbol exists on the LSP's (newest) model but was added after
      // the configured target's ucode → UC6005 on the specifier. Fires for functions AND
      // constants (e.g. fs's `ST_*` mount flags, modeled as main-only).
      const symIntro = VERSION_MODULE_FUNCTIONS[`${source}.${importedName}`];
      if (symIntro && !this.moduleGatedOutAtTarget(source)) {
        this.flagVersionMin(symIntro, `\`${source}.${importedName}\` requires {INTRO}'s ucode`,
          `it isn't available on the target`, specifier.imported.start, specifier.imported.end);
      }
      // Object-handle exports (e.g. fs `stdin`/`stdout`/`stderr` → `fs.file`) are typed
      // as their object type — using the same ModuleType wrapper form as a local
      // fs.open() handle ({ type: object, moduleName: 'fs.file' }) — so member access
      // (`stdin.read(...)`) dispatches through the existing object-type machinery
      // (hover/signature-help/completion/methods).
      const objType = reg?.getObjectExportType(importedName);
      if (objType) {
        dataType = { type: UcodeType.OBJECT, moduleName: objType } as UcodeDataType;
      }
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
        const effectiveUri = resolvedUri || this.resolveModuleSource(source);
        // Object-handle exports (fs stdin/stdout/stderr → fs.file) behave like a local
        // fs.file handle, NOT a module namespace — so don't stamp importedFrom, which
        // would make member access/hover/type-resolution treat them as the module. The
        // dataType is already the object type, so all object-type machinery applies.
        // An object-handle export (fs stdin/stdout/stderr → fs.file) only ever arrives via
        // a NAMED import. A namespace import (`import * as socket`) is always a module
        // namespace — even when the module's name doubles as an object type (`socket` is
        // both), so it must keep importedFrom/importSpecifier='*' and be resolved as the
        // module, not an object handle. Without this exclusion `import * as socket` looks
        // identical to a local socket object and every module fn/constant false-errors.
        const dataTypeHandle = extractModuleType(dataType);
        const isObjectHandleExport = specifier.type !== 'ImportNamespaceSpecifier'
          && dataTypeHandle != null && isKnownObjectType(dataTypeHandle.moduleName);
        if (!isObjectHandleExport) {
          symbol.importedFrom = this.normalizeImportedFrom(source, effectiveUri);
          symbol.importSpecifier = importedName;

          // Track file:// imports for the server's cross-file cache invalidation.
          // builtin:// modules don't have on-disk content to change, so they're
          // skipped — only user modules need dependent re-analysis.
          if (effectiveUri && effectiveUri.startsWith('file://')) {
            this.resolvedImports.add(effectiveUri);
          }
        }

        // Namespace imports (`import * as ns from './file.uc'`): the LSP already
        // knows the file's exports for completion — propagate them as
        // propertyTypes on the symbol so `ns.X` member access resolves through
        // the existing propertyTypes branch instead of falling through to
        // `unknown`. Also propagate one-level nestedPropertyTypes so chained
        // access like `ns.ALFRED_TYPES.HOSTINFO` can resolve. Skips builtin
        // modules (they have their own dispatch).
        if (specifier.type === 'ImportNamespaceSpecifier'
            && effectiveUri && effectiveUri.startsWith('file://')) {
          const nsInfo = this.fileResolver.getNamespaceExportInfo(effectiveUri);
          if (nsInfo && nsInfo.types.size > 0) {
            symbol.propertyTypes = nsInfo.types;
            if (nsInfo.nested.size > 0) {
              symbol.nestedPropertyTypes = nsInfo.nested;
            }
            // Carry exported-function return types so `ns.fn()` call sites resolve
            // a real type (JSDoc @returns or body-inferred) instead of `unknown`.
            if (nsInfo.functionReturnTypes.size > 0) {
              symbol.propertyFunctionReturnTypes = nsInfo.functionReturnTypes;
            }
          }
        }

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

        // Populate returnType and returnPropertyTypes for function default imports.
        // Skip the returnType assignment when we couldn't infer anything useful —
        // letting the typeChecker's own fallback take over rather than locking in
        // UNKNOWN — but the dataType upgrade to FUNCTION has already happened
        // upstream (defaultIsFunction).
        if (specifier.type === 'ImportDefaultSpecifier' && defaultIsFunction && effectiveUri && effectiveUri.startsWith('file://')) {
          const returnInfo = this.fileResolver.getDefaultExportFunctionReturnInfo(effectiveUri);
          if (returnInfo) this.applyFactoryReturnInfo(symbol, returnInfo, effectiveUri);
          // Capture the cross-file parameter signature for call-site arg checking.
          const params = this.fileResolver.getDefaultExportFunctionParameters(effectiveUri);
          if (params) symbol.parameters = params;
        }

        // Populate returnType/returnPropertyTypes for named function imports.
        // Factory functions returning object literals get the rich shape info;
        // other functions (returning string, integer, union, etc.) get a simple
        // returnType so call sites can narrow correctly. Whenever we get info
        // back, the imported symbol is by construction a function — upgrade
        // its dataType so hover shows "function" instead of "unknown" even
        // when the body's return type couldn't be inferred (a non-null result
        // with returnType === UNKNOWN signals "is a function, unknown return").
        if (specifier.type === 'ImportSpecifier' && effectiveUri && effectiveUri.startsWith('file://')) {
          const returnInfo = this.fileResolver.getNamedExportFunctionReturnInfo(effectiveUri, importedName);
          if (returnInfo) {
            this.applyFactoryReturnInfo(symbol, returnInfo, effectiveUri);
            if (symbol.dataType === UcodeType.UNKNOWN) {
              symbol.dataType = UcodeType.FUNCTION as UcodeDataType;
            }
          } else if (symbol.dataType === UcodeType.UNKNOWN) {
            // Not a function — resolve a named-exported VARIABLE's type so e.g.
            // `let AllHostInfo = {}; export { AllHostInfo }` is `object` at the
            // import site, not `unknown`. Carry object property shape too.
            const typeInfo = this.fileResolver.getNamedExportTypeInfo(effectiveUri, importedName);
            if (typeInfo && typeInfo.type !== UcodeType.UNKNOWN) {
              symbol.dataType = typeInfo.type;
              if (typeInfo.propertyTypes) symbol.propertyTypes = typeInfo.propertyTypes;
              if (typeInfo.nestedPropertyTypes) symbol.nestedPropertyTypes = typeInfo.nestedPropertyTypes;
              if (typeInfo.propertyFunctionReturnTypes) symbol.propertyFunctionReturnTypes = typeInfo.propertyFunctionReturnTypes;
            }
          }
          // Capture the cross-file parameter signature for call-site arg checking.
          // Resolved independently of the return-info above so it works even when
          // that resolver bailed — notably it FOLLOWS re-export chains
          // (`import { x }; export { x }`) to the module that really declares it.
          const params = this.fileResolver.getNamedExportFunctionParameters(effectiveUri, importedName);
          if (params) {
            symbol.parameters = params;
            if (symbol.dataType === UcodeType.UNKNOWN) symbol.dataType = UcodeType.FUNCTION as UcodeDataType;
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
          specifier.local.start + specifier.local.name.length,
          DiagnosticSeverity.Error
        );
        return;
      }
      this.processImportSpecifier(specifier, modulePath);
      return;
    }

    // Try to resolve the module and validate exports
    const resolvedUri = this.resolveModuleSource(modulePath);

    if (resolvedUri) {
      // Record the cross-file dependency edge as soon as the PATH resolves —
      // BEFORE validating the specific export. Even if the named/default export is
      // currently missing (error below), the importer still depends on this file:
      // if the file later adds the export, the server must re-analyze this importer
      // to clear the error. Recording the edge only on a valid export would strand
      // the importer's diagnostics when the export is added later.
      if (resolvedUri.startsWith('file://')) this.resolvedImports.add(resolvedUri);

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

  /** Resolve a `@returns`/`@type` type expression to a UcodeDataType, emitting UC7001 on
   *  the JSDoc when unrecognized (mirrors @param). Returns null if it can't be resolved. */
  private resolveJsDocDeclaredType(typeExpr: string, jsDocNode: JsDocCommentNode, tagLabel: string): UcodeDataType | null {
    const resolved = resolveTypeExpression(typeExpr);
    if (resolved !== null) return resolved;
    if (this.typedefRegistry.get(typeExpr)) return UcodeType.OBJECT as UcodeDataType;
    this.addDiagnosticErrorCode(
      UcodeErrorCode.JSDOC_UNKNOWN_TYPE,
      `Unknown type '${typeExpr}' in @${tagLabel} annotation`,
      jsDocNode.start, jsDocNode.end - 1,
      DiagnosticSeverity.Warning,
    );
    return null;
  }

  /** Readable base-type name(s) for a diagnostic message (e.g. "string", "integer|null"). */
  private jsdocTypeDisplay(t: UcodeDataType): string {
    return getUnionTypes(t).map(s => String(singleTypeToBase(s))).join('|');
  }

  /** Absolute source range of the `{…}` type expression in a JSDoc `@returns`/`@return` tag,
   *  so a quick fix can replace it. Returns null if no braced type is present. */
  private jsdocReturnTypeExprRange(jsDocNode: JsDocCommentNode): { start: number; end: number } | null {
    const src = this.textDocument.getText().substring(jsDocNode.start, jsDocNode.end);
    const m = /@returns?\b/.exec(src);
    if (!m) return null;
    const open = src.indexOf('{', m.index);
    if (open < 0) return null;
    const close = src.indexOf('}', open);
    if (close < 0) return null;
    return { start: jsDocNode.start + open, end: jsDocNode.start + close + 1 };
  }

  /** Quick-fix payload for a UC7005 `@returns` mismatch: where the `{…}` is and what to set
   *  it to (the true inferred return type). The code-action provider reads `ucReturnsFix`. */
  private jsdocReturnFixData(jsDocNode: JsDocCommentNode, inferred: UcodeDataType): unknown {
    const range = this.jsdocReturnTypeExprRange(jsDocNode);
    if (!range) return undefined;
    return { ucReturnsFix: { exprStart: range.start, exprEnd: range.end, suggested: this.jsdocTypeDisplay(inferred) } };
  }

  /** Does the declared JSDoc type COVER every concrete possibility of the inferred type?
   *  This is the soundness gate: a JSDoc annotation isn't runtime-checked, so it may FILL an
   *  `unknown` or restate/widen an inferred type, but it must NOT be narrower than what the
   *  code provably produces (e.g. `@returns {string}` over a `string|null` body silently
   *  drops the null — unsound). `unknown` on the actual side is "fillable" (covered);
   *  integer/double are unified (ucode coerces); `null` is NOT special — the annotation must
   *  explicitly include it to cover a nullable value. Returns false = annotation too narrow. */
  private jsdocAnnotationCovers(declared: UcodeDataType, actual: UcodeDataType): boolean {
    const unify = (b: UcodeType): UcodeType => (b === UcodeType.DOUBLE ? UcodeType.INTEGER : b);
    const declaredBases = new Set(getUnionTypes(declared).map(s => unify(singleTypeToBase(s))));
    const actualBases = getUnionTypes(actual).map(s => unify(singleTypeToBase(s)));
    return actualBases.every(b => b === UcodeType.UNKNOWN || declaredBases.has(b));
  }

  /**
   * Reconcile a function's `@returns {T}` against the body. Returns the type to assign to
   * the function symbol's `returnType`, emitting per-return diagnostics on contradiction.
   *
   *  - no `@returns`            → keep the body-inferred type.
   *  - body opaque / compatible → apply T (fill an unknown / narrow a union). Finding #61 cases 1-2.
   *  - a `return` provably disjoint from T → flag THAT return statement; keep the body type.
   *  - zero returns (body is null) and T is concrete & non-null → flag the `@returns` tag
   *    (there's no return statement to point at) — "no return; returns null".
   */
  private reconcileJsDocReturn(
    jsDocNode: JsDocCommentNode | undefined,
    returnEntries: { node: ReturnStatementNode; type: UcodeDataType }[],
    inferredReturnType: UcodeDataType,
  ): UcodeDataType {
    if (!jsDocNode) return inferredReturnType;
    const parsed = parseJsDocComment(jsDocNode.value);
    const tag = parsed.tags.find(t => t.tag === 'returns');
    if (!tag) return inferredReturnType;
    const declared = this.resolveJsDocDeclaredType(tag.typeExpression, jsDocNode, 'returns');
    if (declared === null) return inferredReturnType;

    if (returnEntries.length === 0) {
      // No return statement → the function returns null. The annotation is honoured only if
      // it actually covers null (e.g. `@returns {string|null}`); otherwise it's too narrow.
      if (this.jsdocAnnotationCovers(declared, UcodeType.NULL as UcodeDataType)) return declared;
      this.addDiagnosticErrorCode(
        UcodeErrorCode.JSDOC_TYPE_CONTRADICTS,
        `@returns {${this.jsdocTypeDisplay(declared)}} but the function has no return statement (returns null)`,
        jsDocNode.start, jsDocNode.end - 1,
        DiagnosticSeverity.Warning,
        this.jsdocReturnFixData(jsDocNode, inferredReturnType),
      );
      return inferredReturnType;
    }

    // A return is flagged when the annotation does NOT cover its type — i.e. the annotation
    // is narrower than (or disjoint from) what that return provably produces. No silent
    // narrowing: `@returns {string}` over a `return getenv(...)` (string|null) flags the null.
    const offending = returnEntries.filter(e => !this.jsdocAnnotationCovers(declared, e.type));
    if (offending.length === 0) return declared; // annotation covers the whole body → fill/restate/widen
    // Quick fix suggests the FULL inferred return type (the union of all returns), so
    // `@returns {string}` over `if(x) return "a"; return 5;` → `@returns {string|integer}`.
    const fixData = this.jsdocReturnFixData(jsDocNode, inferredReturnType);
    for (const e of offending) {
      this.addDiagnosticErrorCode(
        UcodeErrorCode.JSDOC_TYPE_CONTRADICTS,
        `This returns '${this.jsdocTypeDisplay(e.type)}', which @returns {${this.jsdocTypeDisplay(declared)}} does not cover`,
        e.node.start, e.node.end,
        DiagnosticSeverity.Warning,
        fixData,
      );
    }
    return inferredReturnType; // keep the body type; don't poison call sites with the unsound annotation
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
      propertyDefinitionLocations?: Map<string, { uri: string; start: number; end: number }> | undefined;
      closedPropertyShape?: boolean | undefined;
      optional?: boolean | undefined;
    }
    const jsdocParams = new Map<string, JsDocParamInfo>();
    for (const tag of paramTags) {
      if (!tag.name) continue;

      // Try import() type expression first: @param {import('pkg').property} name
      const importExpr = parseImportTypeExpression(tag.typeExpression);
      if (importExpr) {
        const importResolved = this.resolveImportTypeExpression(importExpr.modulePath, importExpr.propertyName);
        if (importResolved) {
          jsdocParams.set(tag.name, { ...importResolved, description: tag.description, optional: tag.optional });
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
            // A @typedef's @property list is the declared, complete shape.
            closedPropertyShape: propTypes.size > 0 ? true : undefined,
            optional: tag.optional,
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
      jsdocParams.set(tag.name, { type: resolved, description: tag.description, optional: tag.optional });
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
        // An optional param (`[name]`, `{T=}`, `{?T}`) receives null when the
        // caller omits it, so its declared type is really `T|null`.
        const declaredType = jsdocInfo.optional ? widenWithNull(jsdocInfo.type) : jsdocInfo.type;
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, declaredType, param);
        const sym = this.symbolTable.lookup(param.name);
        if (sym) {
          if (jsdocInfo.optional) sym.jsdocOptionalParam = true;
          if (jsdocInfo.description) sym.jsdocDescription = jsdocInfo.description;
          if (jsdocInfo.propertyTypes) sym.propertyTypes = jsdocInfo.propertyTypes;
          if (jsdocInfo.nestedPropertyTypes) sym.nestedPropertyTypes = jsdocInfo.nestedPropertyTypes;
          if (jsdocInfo.propertyFunctionReturnTypes) sym.propertyFunctionReturnTypes = jsdocInfo.propertyFunctionReturnTypes;
          if (jsdocInfo.propertyDefinitionLocations) sym.propertyDefinitionLocations = jsdocInfo.propertyDefinitionLocations;
          if (jsdocInfo.closedPropertyShape) sym.closedPropertyShape = true;
        }
      } else {
        this.symbolTable.declare(param.name, SymbolType.PARAMETER, UcodeType.UNKNOWN as UcodeDataType, param);
      }
    }
  }

  /**
   * Strict-mode UC7003 hint: a function whose parameters lack types (no @param)
   * should be annotated. Shared by function declarations and named function
   * expressions (e.g. `nft_file.init = function(target, reg)`). Call AFTER
   * applyJsDocToParams so parameter symbols reflect any JSDoc that was applied.
   */
  private emitMissingParamAnnotations(
    name: string,
    params: IdentifierNode[],
    rangeStart: number,
    rangeEnd: number
  ): void {
    if (!this.strictMode) return;
    const unknownParams = params.filter(p => {
      const sym = this.symbolTable.lookup(p.name);
      return !sym || sym.dataType === UcodeType.UNKNOWN;
    });
    if (unknownParams.length === 0) return;
    const names = unknownParams.map(p => p.name).join(', ');
    this.addDiagnosticErrorCode(
      UcodeErrorCode.JSDOC_MISSING_ANNOTATIONS,
      `Function '${name}' has ${unknownParams.length} parameter${unknownParams.length > 1 ? 's' : ''} with unknown type${unknownParams.length > 1 ? 's' : ''}: ${names}. Add /** @param */ annotations.`,
      rangeStart,
      rangeEnd,
      DiagnosticSeverity.Information
    );
  }

  /** Derive a display name for a function expression from its assignment target:
   *  `nft_file.init = fn` → "nft_file.init", `let f = fn` (Identifier) → "f". */
  private assignmentTargetName(target: AstNode): string | null {
    if (target.type === 'Identifier') return (target as IdentifierNode).name;
    if (target.type === 'MemberExpression') {
      const m = target as MemberExpressionNode;
      if (!m.computed) {
        const prop = this.getStaticPropertyName(m.property);
        if (prop) {
          if (m.object.type === 'Identifier') return `${(m.object as IdentifierNode).name}.${prop}`;
          if (m.object.type === 'ThisExpression') return `this.${prop}`;
          return prop;
        }
      }
    }
    return null;
  }

  /**
   * Resolve an import() type expression via fileResolver.
   * Handles: import('module') and import('module').property
   */
  private resolveImportTypeExpression(
    modulePath: string,
    propertyName?: string | undefined
  ): { type: UcodeDataType; propertyTypes?: Map<string, UcodeDataType> | undefined; nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>> | undefined; propertyFunctionReturnTypes?: Map<string, string> | undefined; propertyDefinitionLocations?: Map<string, { uri: string; start: number; end: number }> | undefined; closedPropertyShape?: boolean | undefined } | null {
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

    // Check named exports first when propertyName is provided
    if (propertyName) {
      const moduleExports = this.fileResolver.getModuleExports(resolvedUri);
      const namedExport = moduleExports?.find(e => e.type === 'named' && e.name === propertyName);
      if (namedExport) {
        const namedInfo = this.fileResolver.getNamedExportTypeInfo(resolvedUri, propertyName);
        if (namedInfo) return namedInfo;
      }
    }

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
      // import('config') → the factory function return type with all properties.
      // Stamp the factory file URI onto each member's (file-local) source offsets
      // so go-to-definition / hover can jump to the method's definition.
      let propertyDefinitionLocations: Map<string, { uri: string; start: number; end: number }> | undefined;
      if (returnInfo.propertyDefinitionLocations) {
        propertyDefinitionLocations = new Map();
        for (const [prop, loc] of returnInfo.propertyDefinitionLocations) {
          propertyDefinitionLocations.set(prop, { uri: resolvedUri, start: loc.start, end: loc.end });
        }
      }
      return {
        type: returnInfo.returnType ?? UcodeType.OBJECT as UcodeDataType,
        propertyTypes: returnInfo.returnPropertyTypes,
        propertyFunctionReturnTypes: returnInfo.propertyFunctionReturnTypes,
        propertyDefinitionLocations
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

    // import('pkg') → the default export itself with all properties. When the
    // default export is an inline object literal, its property set is complete
    // (closed) → a member not in it is provably absent (enables UC7004).
    return {
      type: { type: UcodeType.OBJECT, isDefaultImport: true },
      propertyTypes: exportInfo.propertyTypes,
      nestedPropertyTypes: exportInfo.nestedPropertyTypes,
      closedPropertyShape: exportInfo.closedShape === true
    };
  }

  override visitFunctionDeclaration(node: FunctionDeclarationNode): void {
    if (this.options.enableScopeAnalysis) {
      const name = node.id.name;

      // Same-scope function redeclaration. The hoist pre-pass already declared every
      // top-level function, so `declare()` can't detect a duplicate — instead check
      // whether THIS scope's function symbol of this name was already realized by an
      // earlier real declaration. ucode allows redeclaration in non-strict (last wins)
      // but it's a syntax error under 'use strict' — mirror UC1003 (let redeclaration).
      const scopeSym = this.symbolTable.lookupInCurrentScope(name);
      if (scopeSym && scopeSym.type === SymbolType.FUNCTION && this.realizedFunctions.has(scopeSym)) {
        if (this.strictMode) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.FUNCTION_REDECLARATION,
            `Function '${name}' is already declared in this scope`,
            node.id.start,
            node.id.end,
            DiagnosticSeverity.Error
          );
        }
      }

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

      // Mark this scope's function symbol as realized, so a later same-scope
      // declaration of the same name is recognised as a redeclaration.
      const realizedSym = this.symbolTable.lookupInCurrentScope(name);
      if (realizedSym && realizedSym.type === SymbolType.FUNCTION) {
        this.realizedFunctions.add(realizedSym);
      }

      // Set context for nested return statement analysis.
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node;
      this.functionReturnTypes.set(node, []);
      this.functionReturnPropertyTypes.set(node, []);
      this.functionReturnPropertyLocations.set(node, []);

      // Enter function scope
      this.symbolTable.enterScope(node.start);
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // Declare parameters (with JSDoc type annotations if present)
      this.applyJsDocToParams(node.leadingJsDoc, node.params);

      // Emit diagnostic for unknown-typed params (strict mode only)
      if (!node.leadingJsDoc && node.params.length > 0) {
        this.emitMissingParamAnnotations(name, node.params, node.id.start, node.id.end);
      }

      // Declare rest parameter if present (as array type)
      if (node.restParam) {
        this.symbolTable.declare(node.restParam.name, SymbolType.PARAMETER, UcodeType.ARRAY as UcodeDataType, node.restParam);
        const restSym = this.symbolTable.lookup(node.restParam.name);
        if (restSym) restSym.isRestParam = true;
      }

      // Visit the function body to find all return statements. For an unchanged incremental
      // unit, type checking inside the body is short-circuited (see typeChecker clean ranges),
      // but the SCOPE visit still runs so declarations/usage/shadowing stay correct.
      const fnClean = this.cleanBodies.get(node.body.start);
      const fnDiagBefore = fnClean ? this.diagnostics.length : 0;
      this.visit(node.body);

      // Infer the final return type — but if the body was type-skipped, the collected return
      // types are UNKNOWN (checkNode short-circuited), so use the cached return type.
      const returnEntries = this.functionReturnTypes.get(node) || [];
      const returnTypes = returnEntries.map(e => e.type);
      const inferredReturnType = fnClean ? (fnClean.returnType as UcodeDataType ?? this.typeChecker.getCommonReturnType(returnTypes)) : this.typeChecker.getCommonReturnType(returnTypes);
      if (fnClean) this.replayCleanBodyTypeDiagnostics(fnClean, fnDiagBefore);
      // Reconcile against a `@returns {T}` annotation: T fills/narrows an opaque body, but a
      // return that provably contradicts T is flagged per-statement (the body type wins). (#61)
      const reconciledReturnType = this.reconcileJsDocReturn(node.leadingJsDoc, returnEntries, inferredReturnType);

      // Update the function's symbol with the now-known return type.
      const symbol = this.symbolTable.lookup(name);
      if (symbol) {
        symbol.dataType = UcodeType.FUNCTION;  // Functions should always have type 'function'
        symbol.returnType = reconciledReturnType; // Store the actual return type separately

        // Capture the parameter signature for call-site argument checking — but
        // ONLY from a real definition, never a forward declaration (`function f;`
        // has no param list, so it must not impose a 0-arg signature on calls).
        // The param symbols are still in scope here (exitScope is below), so read
        // each declared type; the rest param (if any) is tracked separately.
        if (!node.forwardDeclaration) {
          const paramInfos: ParamInfo[] = node.params.map(p => {
            const psym = this.symbolTable.lookup(p.name);
            return {
              name: p.name,
              type: psym ? psym.dataType : (UcodeType.UNKNOWN as UcodeDataType),
              isRest: false,
              ...(psym?.jsdocOptionalParam ? { optional: true } : {})
            };
          });
          if (node.restParam) {
            paramInfos.push({ name: node.restParam.name, type: UcodeType.ARRAY as UcodeDataType, isRest: true });
          }
          symbol.parameters = paramInfos;
        }

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

        // Merge the parallel member definition locations the same way (intersection),
        // so a same-file factory's returned methods carry source offsets for signature
        // help / goto-def. copyFactoryReturnToBinding then propagates these to a
        // `let w = make()` binding's propertyDefinitionLocations.
        const returnLocEntries = this.functionReturnPropertyLocations.get(node) || [];
        if (returnLocEntries.length > 0) {
          const mergedLocs = new Map(returnLocEntries[0]);
          for (let i = 1; i < returnLocEntries.length; i++) {
            const entry = returnLocEntries[i]!;
            for (const key of [...mergedLocs.keys()]) {
              if (!entry.has(key)) mergedLocs.delete(key);
            }
          }
          if (mergedLocs.size > 0) symbol.returnPropertyDefinitionLocations = mergedLocs;
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

  /**
   * Build the parameter signature for an arrow / function-expression while its
   * params are still declared in the function scope (read each declared type so
   * JSDoc `@param {T}` annotations are reflected). Mirrors the named-function
   * `paramInfos` build; the binding site stamps it onto the variable symbol so
   * `let f = (x) => …` / `let f = function(x){…}` calls get argument-checked.
   */
  private buildFunctionExprParamInfos(node: { params: { name: string }[]; restParam?: { name: string } | null }): ParamInfo[] {
    const paramInfos: ParamInfo[] = node.params.map(p => {
      const psym = this.symbolTable.lookup(p.name);
      return {
        name: p.name,
        type: psym ? psym.dataType : (UcodeType.UNKNOWN as UcodeDataType),
        isRest: false,
        ...(psym?.jsdocOptionalParam ? { optional: true } : {})
      };
    });
    if (node.restParam) {
      paramInfos.push({ name: node.restParam.name, type: UcodeType.ARRAY as UcodeDataType, isRest: true });
    }
    return paramInfos;
  }

  override visitDeleteExpression(node: DeleteExpressionNode): void {
    // Validate the operand subtree (member-access checks, undefined vars, …).
    this.visit(node.argument);
    // `delete X.prop` removes the property → a later read of `X.prop` yields null at runtime,
    // not the stale declared type. Record a flow-write of null so reads AFTER the delete see
    // null instead of the pre-delete type (07). Non-computed member on a known symbol only.
    if (this.options.enableScopeAnalysis && node.argument.type === 'MemberExpression') {
      const mem = node.argument as MemberExpressionNode;
      if (!mem.computed && mem.object.type === 'Identifier' && mem.property.type === 'Identifier') {
        const sym = this.symbolTable.lookup((mem.object as IdentifierNode).name);
        const prop = (mem.property as IdentifierNode).name;
        if (sym?.propertyTypes?.has(prop)) {
          this.recordPropertyWrite(sym, prop, UcodeType.NULL as UcodeDataType, node.end);
        }
      }
    }
    // Then run the delete-specific check (e.g. `delete arr[i]` is a runtime error)
    // through the type checker and surface its diagnostics.
    if (this.options.enableTypeChecking) {
      this.typeChecker.checkNode(node);
      const result = this.typeChecker.getResult();
      for (const error of result.errors) {
        this.addDiagnostic(error.message, error.start, error.end, DiagnosticSeverity.Error, error.code, error.data);
      }
      for (const warning of result.warnings) {
        this.addDiagnostic(warning.message, warning.start, warning.end, DiagnosticSeverity.Warning, warning.code, warning.data);
      }
    }
  }

  override visitObjectExpression(node: ObjectExpressionNode): void {
    // Extract property types for `this` context inside method bodies
    const propTypes = this.inferObjectLiteralPropertyTypes(node);
    if (propTypes) {
      this.thisPropertyStack.push(propTypes);
      this.thisObjectNodeStack.push(node);
      // Pre-compute each method's return type BEFORE visiting any body, so a method can
      // resolve a sibling defined LATER in the object (`this.later()` from `early()`).
      // ucode supports this — `this` is resolved at call time, after the whole object is
      // built (verified vs the interpreter, strict and non-strict). The pre-pass is
      // best-effort (literal/object/array returns resolve; param/local/this-chain returns
      // stay unknown and are filled by the accurate per-method type once it's visited).
      (node as any)._precomputedMethodReturns = this.precomputeObjectMethodReturnTypes(node);
    }
    super.visitObjectExpression(node);
    if (propTypes) {
      this.thisPropertyStack.pop();
      this.thisObjectNodeStack.pop();
    }
  }

  /**
   * Rich return types of an object literal's function-valued properties, so calls like
   * `obj.method()` / `this.method()` resolve instead of going `unknown`. Reads each
   * function property's `_inferredReturnType` (stamped by visitFunctionExpression once its
   * body is visited), so a sibling method only resolves if it was defined BEFORE the use
   * site (define-before-use); a forward reference is left unresolved rather than guessed.
   */
  private inferObjectLiteralFunctionReturnTypes(node: ObjectExpressionNode): Map<string, UcodeDataType> | null {
    const out = new Map<string, UcodeDataType>();
    const pre: Map<string, UcodeDataType> | undefined = (node as any)._precomputedMethodReturns;
    for (const prop of node.properties) {
      if (prop.type === 'SpreadElement') continue;
      const key = this.resolveObjectLiteralKey(prop);
      if (!key) continue;
      const val = prop.value;
      if (val.type !== 'FunctionExpression' && val.type !== 'ArrowFunctionExpression') continue;
      // Prefer the accurate type stamped by the real visit (params/locals in scope); fall
      // back to the pre-pass type for siblings not yet visited (forward references).
      let rt = (val as any)._inferredReturnType;
      if (rt === undefined || rt === null || rt === UcodeType.UNKNOWN) rt = pre?.get(key);
      if (rt === undefined || rt === null || rt === UcodeType.UNKNOWN) continue;
      out.set(key, rt as UcodeDataType);
    }
    return out.size > 0 ? out : null;
  }

  /**
   * Source location of each property KEY in an object literal, so go-to-definition on
   * `obj.member` / `this.member` lands on the property. Recorded for every property (not
   * just functions) on the local symbol (and on `this`).
   */
  private inferObjectLiteralPropertyLocations(node: ObjectExpressionNode): Map<string, { uri: string; start: number; end: number }> | null {
    const out = new Map<string, { uri: string; start: number; end: number }>();
    const uri = this.textDocument.uri;
    for (const prop of node.properties) {
      if (prop.type === 'SpreadElement') continue;
      const key = this.resolveObjectLiteralKey(prop);
      if (!key) continue;
      const keyNode = (prop as any).key;
      const start = keyNode?.start ?? (prop as any).start;
      const end = keyNode?.end ?? start;
      if (typeof start !== 'number') continue;
      out.set(key, { uri, start, end: typeof end === 'number' ? end : start });
    }
    return out.size > 0 ? out : null;
  }

  /**
   * Best-effort return type of every function-valued property, computed WITHOUT visiting
   * bodies (params/locals/`this` are not in scope yet), so a method can resolve a sibling
   * defined later. Literal/object/array returns resolve here; param/local/this-chain
   * returns come back unknown and are filled in later by the accurate per-method type.
   */
  private precomputeObjectMethodReturnTypes(node: ObjectExpressionNode): Map<string, UcodeDataType> {
    const out = new Map<string, UcodeDataType>();
    for (const prop of node.properties) {
      if (prop.type === 'SpreadElement') continue;
      const key = this.resolveObjectLiteralKey(prop);
      if (!key) continue;
      const val = prop.value as any;
      if (val.type !== 'FunctionExpression' && val.type !== 'ArrowFunctionExpression') continue;
      const rt = this.collectReturnTypesQuiet(val);
      if (rt !== UcodeType.UNKNOWN) out.set(key, rt);
    }
    return out;
  }

  /** Return type of one function node via checkNodeQuietly over its `return` expressions
   *  (no diagnostics; nested functions are not descended into). */
  private collectReturnTypesQuiet(fnNode: FunctionExpressionNode | ArrowFunctionExpressionNode): UcodeDataType {
    // Expression-body arrow: the body IS the returned value.
    if (fnNode.type === 'ArrowFunctionExpression' && fnNode.body && fnNode.body.type !== 'BlockStatement') {
      return this.typeChecker.checkNodeQuietly(fnNode.body) as UcodeDataType;
    }
    const types: UcodeDataType[] = [];
    const walk = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      // Don't descend into nested functions — their returns aren't this function's.
      if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration') return;
      if (n.type === 'ReturnStatement') {
        const ret = n as unknown as ReturnStatementNode;
        types.push(ret.argument ? (this.typeChecker.checkNodeQuietly(ret.argument) as UcodeDataType) : (UcodeType.NULL as UcodeDataType));
        return;
      }
      for (const k in n) {
        if (k === 'parent') continue;
        const v = (n as AnyNode)[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    if (fnNode.body) walk(fnNode.body);
    if (types.length === 0) return UcodeType.UNKNOWN as UcodeDataType;
    return this.typeChecker.getCommonReturnType(types);
  }

  override visitFunctionExpression(node: FunctionExpressionNode): void {
    // Consume the pending name immediately so nested anonymous functions in the
    // body don't inherit it.
    const exprName = node.id?.name ?? this.pendingFunctionExprName;
    this.pendingFunctionExprName = null;
    if (this.options.enableScopeAnalysis) {
      // For function expressions, we don't declare them in the outer scope
      // since they're anonymous (even if they have a name, it's only available inside the function)

      // Set context for nested return statement analysis.
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node as any; // Type compatibility - both have id, params, body
      this.functionReturnTypes.set(node as any, []);
      this.functionReturnPropertyTypes.set(node as any, []);
      this.functionReturnPropertyLocations.set(node as any, []);

      // Enter function scope
      this.symbolTable.enterScope(node.start);
      this.functionScopes.push(this.symbolTable.getCurrentScope());

      // If the function has a name (named function expression), declare it in the function's own scope
      if (node.id) {
        this.symbolTable.declare(node.id.name, SymbolType.FUNCTION, UcodeType.UNKNOWN as UcodeDataType, node.id);
      }

      // Declare parameters in the function scope (with JSDoc type annotations if present)
      this.applyJsDocToParams(node.leadingJsDoc, node.params);

      // UC7003 for method-style function expressions (those with a derivable
      // name from their assignment target). Anonymous callbacks have no name and
      // are skipped, so `map(x => …)` etc. don't get noisy hints.
      if (exprName && !node.leadingJsDoc && node.params.length > 0) {
        this.emitMissingParamAnnotations(exprName, node.params, node.params[0]!.start, node.params[node.params.length - 1]!.end);
      }

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
          // Resolve `this.method()` return types from sibling function properties already
          // visited (define-before-use). The enclosing object node is on the parallel stack.
          const objNode = this.thisObjectNodeStack[this.thisObjectNodeStack.length - 1];
          if (objNode) {
            const fnReturns = this.inferObjectLiteralFunctionReturnTypes(objNode);
            if (fnReturns) thisSym.propertyReturnTypes = fnReturns;
            const locs = this.inferObjectLiteralPropertyLocations(objNode);
            if (locs) thisSym.propertyDefinitionLocations = locs;
          }
        }
      }

      // Visit the function body (scope always runs; type checking inside is short-circuited
      // for unchanged incremental units).
      const feClean = this.cleanBodies.get(node.body.start);
      const feDiagBefore = feClean ? this.diagnostics.length : 0;
      // Snapshot the enclosing object's property map so we can capture (and, for a skipped
      // body, restore) the `this.<prop> = …` types this method writes.
      const feThisMap = this.thisPropertyStack.length > 0 ? this.thisPropertyStack[this.thisPropertyStack.length - 1]! : null;
      const feThisBefore = feThisMap ? new Map(feThisMap) : null;
      this.visit(node.body);
      // A skipped thisSafe body recorded its `this.x=` with UNKNOWN (type checking was
      // short-circuited) — restore the cached real types so sibling methods see them.
      if (feClean && feThisMap && feClean.thisWrites.length > 0) {
        const thisSym = this.symbolTable.lookup('this');
        for (const [k, v] of feClean.thisWrites) {
          feThisMap.set(k, v as UcodeDataType);
          if (thisSym?.propertyTypes) thisSym.propertyTypes.set(k, v as UcodeDataType);
        }
      }
      // Capture this method's this-property writes (post-restore, so they're the real types)
      // for the incremental cache.
      if (feThisMap && feThisBefore) {
        const writes: Array<[string, unknown]> = [];
        for (const [k, v] of feThisMap) if (!feThisBefore.has(k) || feThisBefore.get(k) !== v) writes.push([k, v]);
        (node as any)._thisWrites = writes;
      }

      // Infer the return type (common type of all returns) and stash it on the node —
      // an anonymous function expression has no symbol of its own, so the binding site
      // (variable declarator / assignment) reads `_inferredReturnType` off the node.
      const fnReturnTypes = (this.functionReturnTypes.get(node as any) || []).map(e => e.type);
      (node as any)._inferredReturnType = feClean ? (feClean.returnType as UcodeDataType ?? this.typeChecker.getCommonReturnType(fnReturnTypes)) : this.typeChecker.getCommonReturnType(fnReturnTypes);
      if (feClean) this.replayCleanBodyTypeDiagnostics(feClean, feDiagBefore);

      // Stash the param signature (read while still in scope) for the binding site.
      (node as any)._inferredParams = this.buildFunctionExprParamInfos(node);

      // Exit function scope
      this.symbolTable.exitScope(node.end);
      this.functionScopes.pop();
      this.currentFunctionNode = previousFunction;
    } else {
      // Fallback: just visit the function body if scope analysis is disabled
      this.visit(node.body);
    }
  }

  override visitArrowFunctionExpression(node: ArrowFunctionExpressionNode): void {
    // Consume any pending assignment-target name now so nested callbacks in the
    // body don't inherit it.
    const exprName = this.pendingFunctionExprName;
    this.pendingFunctionExprName = null;
    if (this.options.enableScopeAnalysis) {
      // Arrow functions are always anonymous and don't get declared in outer scope

      // Set context for nested return statement analysis
      const previousFunction = this.currentFunctionNode;
      this.currentFunctionNode = node as any; // Type compatibility for analysis
      this.functionReturnTypes.set(node as any, []);
      this.functionReturnPropertyTypes.set(node as any, []);
      this.functionReturnPropertyLocations.set(node as any, []);

      // Enter function scope for parameters
      this.symbolTable.enterScope(node.start);
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

      // UC7003 only for arrows with a derivable name (assigned to a member/var),
      // never for bare callbacks.
      if (exprName && !node.leadingJsDoc && node.params.length > 0) {
        this.emitMissingParamAnnotations(exprName, node.params, node.params[0]!.start, node.params[node.params.length - 1]!.end);
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

      // Infer the return type and stash it on the node (arrows are anonymous, so the
      // binding site reads `_inferredReturnType`). Block body → common type of the
      // collected returns; expression body `(x) => expr` → the expression's type
      // (computed here while the params are still in scope, before exitScope).
      let arrowReturnType: UcodeDataType;
      if (node.body.type === 'BlockStatement') {
        const rts = (this.functionReturnTypes.get(node as any) || []).map(e => e.type);
        arrowReturnType = this.typeChecker.getCommonReturnType(rts);
      } else {
        // Inference-only: the body was already validated during the visit above, so query
        // its type without re-emitting diagnostics (checkNode would double-report).
        arrowReturnType = this.typeChecker.checkNodeQuietly(node.body) ?? (UcodeType.UNKNOWN as UcodeDataType);
      }
      (node as any)._inferredReturnType = arrowReturnType;

      // Stash the param signature (read while still in scope) for the binding site.
      (node as any)._inferredParams = this.buildFunctionExprParamInfos(node);

      // Exit function scope
      this.symbolTable.exitScope(node.end);
      this.functionScopes.pop();
      this.currentFunctionNode = previousFunction;
    } else {
      // Fallback: use default visitor behavior
      super.visitArrowFunctionExpression(node);
    }
  }

  override visitBlockStatement(node: BlockStatementNode): void {
    if (this.options.enableScopeAnalysis) {
      // Enter block scope
      this.symbolTable.enterScope(node.start);
      
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

  override visitTryStatement(node: TryStatementNode): void {
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

  override visitCatchClause(node: CatchClauseNode): void {
    if (this.options.enableScopeAnalysis) {
      // Enter catch scope
      this.symbolTable.enterScope(node.start);

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
            // Mark as an exception object so hover can surface the rich
            // property docs (e.g. the stacktrace frame structure).
            symbol.isExceptionParam = true;
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

  override visitIdentifier(node: IdentifierNode): void {
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

        // Check if it was set as a property on the global object (e.g., global.FOO = ...).
        // globalPropertyNames also carries cross-file `global.X` injected via `loadfile()()`,
        // so a bare *read* of such a name (e.g. `print(MAX_BODY)`, not just a call) isn't a
        // false UC1001 — matching how the call case is suppressed for UC1002.
        const globalSymbol = this.symbolTable.lookup('global');
        const isGlobalProperty = globalSymbol?.propertyTypes?.has(node.name)
          || this.globalPropertyNames.has(node.name);

        // Don't report "Undefined variable" if this identifier is a function call callee
        // The TypeChecker will handle "Undefined function" diagnostic for function calls
        // A known-module base used unimported (`fs.open()`) is reported more
        // specifically by validateModuleMember — skip the generic message there.
        const isUnimportedModuleBase = this.visitingMemberBase && this.isKnownModuleName(node.name);
        // A provable implicit global: bare-assigned somewhere in this (non-strict) module,
        // so it resolves to a real global at runtime — never an "undefined variable".
        const isImplicitGlobal = this.implicitGlobalNames.has(node.name);
        // A name injected by an include() render-scope is a real global here (strict too).
        const isInjectedScope = this.injectedScopeNames.has(node.name);
        // Case-3 blanket opt-in: treat any unexplained read as an implicit global (matches
        // non-strict runtime null-safety). Off by default — it hides typos.
        const assumeGlobal = this.options.assumeUndefinedGlobalsDefined === true;
        if (!isBuiltin && !isGlobalProperty && !this.processingFunctionCallCallee && !isUnimportedModuleBase && !isImplicitGlobal && !isInjectedScope && !assumeGlobal) {
          // Defer: a `let`/`const` declared later in this same/enclosing block isn't in
          // the table yet (single pass). resolvePendingUndefinedRefs decides UC1001 vs
          // UC1011 ("used before its declaration") once all declarations are known.
          this.pendingUndefinedRefs.push({ name: node.name, start: node.start, end: node.end });
        }
      } else {
        // Forward reference to a function used as a VALUE (assignment, callback
        // argument, etc.): ucode doesn't hoist, so the name is null here — and it
        // crashes if that null is later invoked (`map(arr, fnDefinedLater)`). The
        // call-callee case is reported by the type checker, so skip it here to avoid
        // a duplicate. Only top-level functions are hoisted (declaredAt = real pos),
        // so this fires precisely when the reference precedes the declaration.
        if (symbol.type === SymbolType.FUNCTION && symbol.declaredAt !== undefined
            && symbol.declaredAt > node.start && !this.processingFunctionCallCallee) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.FUNCTION_USED_BEFORE_DECLARATION,
            `Function '${node.name}' is used before its declaration. Move its declaration above this use.`,
            node.start,
            node.end,
            DiagnosticSeverity.Error,
          );
        }
        // Mark as used
        this.symbolTable.markUsed(node.name, node.start);
      }
    }
  }

  override visitMemberExpression(node: MemberExpressionNode): void {
    // // console.log('DEBUG: visitMemberExpression called for:', (node.object as any).name + '.' + (node.property as any).name);
    if (this.options.enableScopeAnalysis) {
      // Visit the object part (e.g., 'constants' in 'constants.DT_HOSTINFO_FINAL_PATH').
      // The receiver is a VALUE position, never the called function itself — so a
      // member-expression callee like `Object.keys(…)` must NOT inherit the
      // call-callee exemption for its base. Clearing the flag here makes an
      // undefined base (`Object`, `Math`, … — JS globals ucode lacks) get the
      // normal Undefined-variable diagnostic, just like the non-called `bar.baz`.
      const prevCallee = this.processingFunctionCallCallee;
      const prevMemberBase = this.visitingMemberBase;
      this.processingFunctionCallCallee = false;
      this.visitingMemberBase = true;
      this.visit(node.object);
      this.processingFunctionCallCallee = prevCallee;
      this.visitingMemberBase = prevMemberBase;

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

    // Unknown-member diagnostic (UC7004): accessing a property that a fully
    // resolved, CLOSED object shape provably doesn't have — e.g. a param typed
    // `@param {import('./pkg.uc')}` (the {pkg,sym,get_text} wrapper) accessed as
    // `pkg.rt_tables_file`. Only direct `ident.member` reads on a closed shape;
    // assignment targets define new members, so they're excluded.
    this.checkClosedShapeMember(node);
  }

  private checkClosedShapeMember(node: MemberExpressionNode): void {
    if (!this.options.enableScopeAnalysis) return;
    if (node.computed || node.property.type !== 'Identifier' || node.object.type !== 'Identifier') return;
    if (this.assignmentLeftDepth > 0) return; // defining the member, not reading it

    const objectName = (node.object as IdentifierNode).name;
    const symbol = this.symbolTable.lookupAtPosition(objectName, node.object.start)
                || this.symbolTable.lookup(objectName);
    if (!symbol || !symbol.closedPropertyShape || !symbol.propertyTypes) return;

    const member = (node.property as IdentifierNode).name;
    if (symbol.propertyTypes.has(member)) return;
    if (symbol.nestedPropertyTypes?.has(member)) return;

    const available = [...symbol.propertyTypes.keys()];
    const avail = available.length > 0 ? ` Available: ${available.join(', ')}.` : '';
    this.addDiagnosticErrorCode(
      UcodeErrorCode.JSDOC_UNKNOWN_MEMBER,
      `Property '${member}' does not exist on '${objectName}'.${avail}`,
      node.property.start,
      node.property.end,
      DiagnosticSeverity.Warning
    );
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
        this.addDiagnosticErrorCode(
          UcodeErrorCode.MODULE_NOT_IMPORTED,
          `Cannot use '${objectName}' module without importing it first. Add: import { ${methodName} } from '${objectName}'; or import * as ${objectName} from '${objectName}';`,
          node.object.start,
          node.object.end,
          DiagnosticSeverity.Error
        );
      }
      return;
    }

    // Platform-gated member (e.g. `io.IOC_DIR_NONE` via a namespace import) → UC6006 INFO.
    // Emitted BEFORE the method-call-only early-return below, since a constant member
    // access is not a call. getModuleNameFromSymbol resolves a namespace symbol to its
    // module (e.g. `io`); the lookup is a no-op for non-gated members.
    {
      const nsModule = this.getModuleNameFromSymbol(symbol);
      if (nsModule) {
        this.flagPlatformGated(nsModule, methodName, node.property.start, node.property.end);
        // Version-gate a CONSTANT/property member (e.g. `fs.ST_RDONLY`). Method CALLS are
        // gated by the version check after the call-only return below, so restrict this to
        // non-call access to avoid a double diagnostic.
        if (!this.processingFunctionCallCallee) {
          const cIntro = VERSION_MODULE_FUNCTIONS[`${nsModule}.${methodName}`];
          if (cIntro && !this.moduleGatedOutAtTarget(nsModule)) {
            this.flagVersionMin(cIntro, `\`${nsModule}.${methodName}\` requires {INTRO}'s ucode`,
              `it isn't available on the target`, node.property.start, node.property.end);
          }
        }
      }
    }

    // Only validate method calls
    if (!this.processingFunctionCallCallee) {
      return;
    }

    // An object-handle symbol (e.g. an imported fs `stdin` typed `fs.file`) is NOT a
    // module namespace — its member access is validated by the object-type machinery,
    // not module-member checks. Without this, `stdin.read()` would be wrongly flagged
    // "not available on the fs module" (since 'fs.file' normalizes to 'fs'). Guard on
    // `!isKnownModule` so a namespace import whose name doubles as an object type
    // (e.g. `socket` is both a module and an object type) is still validated.
    const handleType = extractModuleType(symbol.dataType);
    if (handleType && isKnownObjectType(handleType.moduleName) && !isKnownModule(handleType.moduleName)) {
      // Version-gated: a method on an object handle (e.g. `f.ioctl()` on an fs.file,
      // `c.list_append()` on a uci.cursor) that was added after the configured
      // target's ucode → UC6005. The handle-creating function (fs.open/cursor) may
      // predate the method, so this is the only place these get caught.
      const objIntro = VERSION_OBJECT_METHODS[`${handleType.moduleName}.${methodName}`];
      if (objIntro && !this.moduleGatedOutAtTarget(handleType.moduleName.split('.')[0] || handleType.moduleName)) {
        this.flagVersionMin(objIntro, `\`${handleType.moduleName}.${methodName}()\` requires {INTRO}'s ucode`,
          `it isn't available on the target`, node.property.start, node.property.end);
      }
      return;
    }

    const moduleName = this.getModuleNameFromSymbol(symbol);
    if (!moduleName) {
      // console.log('DEBUG: no module name found, returning');
      return;
    }

    // Version-gated: `module.method()` where the method was added after the
    // configured target's ucode (e.g. `fs.mkdtemp()` on a 24.10 target) → UC6005.
    const memberIntro = VERSION_MODULE_FUNCTIONS[`${moduleName}.${methodName}`];
    if (memberIntro && !this.moduleGatedOutAtTarget(moduleName)) {
      this.flagVersionMin(memberIntro, `\`${moduleName}.${methodName}\` requires {INTRO}'s ucode`,
        `it isn't available on the target`, node.property.start, node.property.end);
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

  /**
   * Resolve an ObjectExpression Property's key to its runtime string value.
   * For non-computed keys (`{foo: …}`) the syntactic identifier name IS the
   * key. For computed keys (`{[expr]: …}`) we need the *value* of `expr` —
   * the syntactic name `KEY_64` is not the key, `64` is. Returns null when
   * the key isn't statically resolvable (function calls, arithmetic, etc.).
   */
  private resolveObjectLiteralKey(prop: PropertyNode): string | null {
    if (!prop.computed) return this.getStaticPropertyName(prop.key);
    return this.resolveExpressionToLiteralKey(prop.key);
  }

  /**
   * Try to constant-fold an expression to its string property-key form.
   * Handles: literals, identifiers bound to a literal init, and member-access
   * chains rooted at a namespace import (e.g. `constants.ALFRED_TYPES.HOSTINFO`
   * → look up the inner key's literal value in the imported file). Coerces
   * to ucode's stringified key form: integer 64 → "64", string "hi" → "hi".
   */
  private resolveExpressionToLiteralKey(node: AstNode): string | null {
    if (node.type === 'Literal') {
      const lit = node as LiteralNode;
      if (lit.value === undefined || lit.value === null) return null;
      return String(lit.value);
    }
    // Negative literal — parsed as UnaryExpression in ucode
    if (node.type === 'UnaryExpression') {
      const u = node as any;
      if (u.operator === '-' && u.argument?.type === 'Literal' && typeof u.argument.value === 'number') {
        return String(-u.argument.value);
      }
      return null;
    }
    if (node.type === 'Identifier') {
      const sym = this.symbolTable.lookup((node as IdentifierNode).name);
      if (sym?.initNode) return this.resolveExpressionToLiteralKey(sym.initNode);
      return null;
    }
    if (node.type === 'MemberExpression') {
      const mem = node as MemberExpressionNode;
      if (mem.computed) return null;
      // Chained namespace access: base.A.B where base is `import * as base from 'file.uc'`
      if (mem.object.type === 'MemberExpression') {
        const inner = mem.object as MemberExpressionNode;
        if (!inner.computed && inner.object.type === 'Identifier') {
          const baseName = (inner.object as IdentifierNode).name;
          const baseSym = this.symbolTable.lookup(baseName);
          const aName = this.getStaticPropertyName(inner.property);
          const bName = this.getStaticPropertyName(mem.property);
          if (baseSym?.type === SymbolType.IMPORTED && baseSym.importSpecifier === '*'
              && baseSym.importedFrom && baseSym.importedFrom.startsWith('file://')
              && aName && bName) {
            return this.fileResolver.findExportedObjectPropertyLiteral(baseSym.importedFrom, aName, bName, /*display=*/false);
          }
        }
      }
      return null;
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
            return this.typeChecker.parseReturnTypePublic(fsFunction.returnType);
          }
        }
      }
    }
    
    return null;
  }

  // inferImportedRtnlFunctionReturnType removed — handled by type checker's MODULE_REGISTRIES path

  // parseReturnTypeString removed — consolidated into typeChecker.parseReturnTypePublic()

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

  override visitCallExpression(node: CallExpressionNode): void {
    // Always handle scope analysis for function calls
    if (this.options.enableScopeAnalysis) {
      // Mark function callee as used if it's an identifier
      if (node.callee.type === 'Identifier') {
        const functionName = (node.callee as IdentifierNode).name;
        this.symbolTable.markUsed(functionName, node.callee.start);
      }
    }

    // Version-gate calls to global builtins introduced after the configured target
    // (e.g. `signal()` is 23.05+; absent from 22.03's global scope). Fires in the
    // always-run scope pass. Only when the name resolves to the builtin — a user-defined
    // function/variable of the same name (a shadow) is exempt.
    if (node.callee.type === 'Identifier') {
      const calleeName = (node.callee as IdentifierNode).name;
      const builtinIntro = VERSION_GLOBAL_BUILTINS[calleeName];
      if (builtinIntro) {
        const sym = this.symbolTable.lookup(calleeName);
        if (!sym || sym.type === SymbolType.BUILTIN) {
          this.flagVersionMin(builtinIntro,
            `The \`${calleeName}()\` builtin requires {INTRO}'s ucode`,
            `guard for older targets or avoid it`,
            node.callee.start, node.callee.end);
        }
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

  override visitSpreadElement(node: SpreadElementNode): void {
    // Visit the spread argument to ensure it's properly analyzed
    this.visit(node.argument);
    // No additional analysis needed for spread elements themselves
  }

  override visitTemplateLiteral(node: TemplateLiteralNode): void {
    // Visit all embedded expressions in the template literal
    for (const expression of node.expressions) {
      this.visit(expression);
    }
    // Template quasis (the string parts) don't need visiting as they're just text
    // The template literal itself will be typed as string by the type checker
  }

  /** Flag assignment/increment of a `const` binding (UC1010) — a hard ucode error
   *  ("Invalid assignment to constant 'x'"). Only a bare identifier target is a
   *  violation; mutating a const object's property/element (`const o={}; o.x=1`,
   *  `const a=[]; a[0]=1`) is legal in ucode, so member targets are left alone. */
  private checkConstReassignment(target: AstNode, isUpdate: boolean): void {
    if (!target || target.type !== 'Identifier') return;
    const name = (target as IdentifierNode).name;
    const symbol = this.symbolTable.lookup(name);
    if (!symbol || !symbol.isConstant) return;
    const message = isUpdate
      ? `Invalid increment/decrement of constant '${name}'. A 'const' binding cannot be modified.`
      : `Invalid assignment to constant '${name}'. A 'const' binding cannot be reassigned.`;
    this.addDiagnosticErrorCode(
      UcodeErrorCode.CONST_REASSIGNMENT,
      message,
      target.start,
      target.end,
      DiagnosticSeverity.Error
    );
  }

  override visitAssignmentExpression(node: AssignmentExpressionNode): void {
    this.assignmentLeftDepth++;
    this.visit(node.left);
    this.assignmentLeftDepth--;
    // `const x = 1; x = 2;` (and every compound form `x += 1`, …) is a ucode error.
    this.checkConstReassignment(node.left, false);
    // Attribute a method-style function expression to its assignment target so it
    // gets the UC7003 hint (`nft_file.init = function(target){…}` → name "init").
    const rt = node.right.type;
    if ((rt === 'FunctionExpression' || rt === 'ArrowFunctionExpression') && node.operator === '=') {
      this.pendingFunctionExprName = this.assignmentTargetName(node.left);
    }
    this.visit(node.right);
    this.pendingFunctionExprName = null;
    if (this.options.enableTypeChecking) {
      // Property-type writes are DEFERRED until after the RHS is type-checked below, so a
      // self-referential reassignment `obj.p = f(obj.p)` type-checks `f(obj.p)` against the
      // OLD type of `obj.p`, not the new one. Without this, `rv.days = keys(rv.days)` saw
      // rv.days as keys()'s array result and falsely flagged "keys expects object, got array".
      const deferredPropertyWrites: Array<() => void> = [];
      // Track assignments to object properties (e.g., obj.foo = "bar", this.prop = val)
      if (node.left.type === 'MemberExpression') {
        const memberNode = node.left as MemberExpressionNode;
        if (!memberNode.computed) {
          const propertyName = this.getStaticPropertyName(memberNode.property);

          if (propertyName) {
            // obj.prop = val
            if (memberNode.object.type === 'Identifier') {
              const objectName = (memberNode.object as IdentifierNode).name;
              const targetSymbol = this.symbolTable.lookup(objectName);

              if (targetSymbol && (objectName === 'global' || (targetSymbol.type !== SymbolType.MODULE && targetSymbol.type !== SymbolType.IMPORTED))) {
                const propertyType = this.inferAssignmentDataType(node.right);

                if (!targetSymbol.propertyTypes) {
                  targetSymbol.propertyTypes = new Map<string, UcodeDataType>();
                }

                deferredPropertyWrites.push(() => this.recordPropertyWrite(targetSymbol, propertyName, propertyType, node.end));
              }

              // `global.X = { … }`: also expose X as a first-class global object symbol
              // carrying the literal's shape. Without this, X is a name-only global
              // property (suppresses UC1001 but has no type), so bare `X`, its literal
              // members (`X.docroot`), and later `X.prop = …` property-flow tracking all
              // resolved to `unknown` — there was no symbol to read or attach types to.
              if (objectName === 'global' && node.right.type === 'ObjectExpression') {
                this.declareGlobalObjectBinding(propertyName, node.right as ObjectExpressionNode);
              }
              // `global.fn = function(){…}` → bare `fn(...)` resolves its return type (12).
              if (objectName === 'global' && (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression')) {
                this.declareGlobalFunctionBinding(propertyName, node.right);
              }
              // `global.X = ['a','b']` → element type so `X[0]` resolves (05).
              if (objectName === 'global' && node.right.type === 'ArrayExpression') {
                this.declareGlobalArrayBinding(propertyName, node.right);
              }
              // `global.X = <scalar literal>` where every assignment to X is straight-line
              // top-level: SSA-type it — reads between assignments see the type in effect
              // (visitation is source-order), and hover is positional via typeHistory.
              if (objectName === 'global' && this.scalarSSAEligible.has(propertyName)) {
                const sc = this.scalarCoarseType(node.right);
                if (sc !== null) this.declareGlobalScalarBinding(propertyName, sc, node.end);
              }
            }

            // `global.X.prop = val` — the base is itself a member (`global.X`), so the
            // Identifier branch above misses it. Resolve X's global symbol and record the
            // property write there, exactly like the bare `X.prop = val` form (which works
            // because X resolves to the symbol declareGlobalObjectBinding created). Without
            // this, `function warm() { global.CACHE.hot = 1; }` left CACHE.hot unknown
            // while `CACHE.hot = 1` tracked — locals track both.
            if (memberNode.object.type === 'MemberExpression') {
              const base = memberNode.object as MemberExpressionNode;
              if (!base.computed && base.object.type === 'Identifier'
                  && (base.object as IdentifierNode).name === 'global'
                  && base.property.type === 'Identifier') {
                const globalName = (base.property as IdentifierNode).name;
                const targetSymbol = this.symbolTable.lookup(globalName);
                if (targetSymbol && targetSymbol.type !== SymbolType.MODULE && targetSymbol.type !== SymbolType.IMPORTED) {
                  const propertyType = this.inferAssignmentDataType(node.right);
                  deferredPropertyWrites.push(() => this.recordPropertyWrite(targetSymbol, propertyName, propertyType, node.end));
                }
              }
            }

            // this.prop = val — update the `this` symbol's propertyTypes
            // AND the enclosing object literal's property stack so sibling methods see it
            if (memberNode.object.type === 'ThisExpression') {
              const thisSym = this.symbolTable.lookup('this');
              if (thisSym) {
                const propertyType = this.inferAssignmentDataType(node.right);

                if (!thisSym.propertyTypes) {
                  thisSym.propertyTypes = new Map<string, UcodeDataType>();
                }
                deferredPropertyWrites.push(() => this.recordPropertyWrite(thisSym, propertyName, propertyType, node.end));

                // Also update the thisPropertyStack so sibling methods
                // in the same object literal can see the property
                if (this.thisPropertyStack.length > 0) {
                  const topProps = this.thisPropertyStack[this.thisPropertyStack.length - 1];
                  if (topProps) {
                    deferredPropertyWrites.push(() => topProps.set(propertyName, propertyType));
                  }
                }
              }
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
        
        // For undeclared variables assigned from module function calls,
        // use the type checker's resolved type to infer the type
        if (!symbol && (node.right.type === 'CallExpression' || node.right.type === 'MemberExpression')) {
          const fullType = this.typeChecker.checkNode(node.right);
          if (fullType && fullType !== UcodeType.UNKNOWN) {
            this.symbolTable.declare(variableName, SymbolType.VARIABLE, fullType, node.left as IdentifierNode);
            const mt = extractModuleType(fullType);
            if (mt && isKnownObjectType(mt.moduleName)) {
              this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, fullType);
            }
          }
        }

        // Bare implicit-global assignment `X = { … }` / `X = function(){}` (non-strict, X not a
        // local): mirror the `global.X = …` shape/return handling so `X.a`/`X()` resolve (08, 12).
        // Gated on implicitGlobalNames (non-strict only) so it never suppresses the strict
        // "assignment to undeclared" error.
        if (!symbol && this.implicitGlobalNames.has(variableName)) {
          if (node.right.type === 'ObjectExpression') {
            this.declareGlobalObjectBinding(variableName, node.right as ObjectExpressionNode);
          } else if (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression') {
            this.declareGlobalFunctionBinding(variableName, node.right);
          } else if (node.right.type === 'ArrayExpression') {
            this.declareGlobalArrayBinding(variableName, node.right);
          } else if (this.scalarSSAEligible.has(variableName)) {
            // Bare implicit scalar `X = 1` with all-straight-line assignments → SSA-type it.
            const sc = this.scalarCoarseType(node.right);
            if (sc !== null) this.declareGlobalScalarBinding(variableName, sc, node.end);
          }
        }
      }
      
      // Now check assignment type compatibility after symbols are created
      this.typeChecker.withAssignmentTarget(() => this.typeChecker.checkNode(node.left));
      // Capture the RHS type here — checkNode applies per-call builtin return narrowing
      // (e.g. max() -> null, uniq([1]) -> array<integer>) that the static return-type
      // inference below does not. Reused for the reassignment dataType so a builtin call's
      // narrowed return survives on reassignment, matching the declaration path. (Issue 2)
      const rhsCheckedType = this.typeChecker.checkNode(node.right);

      // RHS fully checked against the OLD property types — now record the new ones.
      for (const write of deferredPropertyWrites) write();

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
        
        // Skip require() calls - they're handled specially in visitVariableDeclarator
        const isRequireCall = node.right.type === 'CallExpression' &&
                             (node.right as CallExpressionNode).callee.type === 'Identifier' &&
                             ((node.right as CallExpressionNode).callee as IdentifierNode).name === 'require';

        if (!isRequireCall) {
          // Check for all types of function calls that return specific types
          const methodReturnType = this.inferMethodReturnType(node.right);
          const functionReturnType = this.inferFunctionCallReturnType(node.right);
          let dataType: UcodeDataType;

          // Bare builtin fs functions (open/popen/mkstemp/…) and imported fs functions
          // (readlink/realpath/…) return fs object/union types the type checker's builtins
          // don't model, so checkNode reports them UNKNOWN. The DECLARATION path resolves
          // them via inferFsType/inferImportedFsFunctionReturnType before falling back; the
          // reassignment path must too, or `let b; b = open(...)` drops the type to unknown
          // (a false-negative class — downstream nullability on `b` then goes unanalyzed).
          // See docs/done/flow-reassignment-union-call-gap.md. (Issue 2)
          const fsReturnType = this.inferFsType(node.right);
          const importedFsReturnType = !fsReturnType ? this.inferImportedFsFunctionReturnType(node.right) : null;

          // A builtin call carries a per-call narrowed return type (e.g. max() -> null,
          // uniq([1]) -> array<integer>) that inferFunctionCallReturnType discards in favor
          // of the builtin's STATIC return type (max -> integer). Prefer the narrowed
          // checkNode result when it resolved to a concrete type, mirroring how the
          // declaration path upgrades only on a non-UNKNOWN result. (Issue 2)
          const isBuiltinCall = node.right.type === 'CallExpression'
            && (node.right as CallExpressionNode).callee.type === 'Identifier'
            && allBuiltinFunctions.has(((node.right as CallExpressionNode).callee as IdentifierNode).name);

          if (fsReturnType) {
            dataType = fsReturnType;
          } else if (importedFsReturnType) {
            dataType = importedFsReturnType;
          } else if (isBuiltinCall && rhsCheckedType !== undefined && rhsCheckedType !== null && rhsCheckedType !== UcodeType.UNKNOWN) {
            dataType = rhsCheckedType;
          } else if (methodReturnType) {
            dataType = methodReturnType;
          } else if (functionReturnType) {
            dataType = functionReturnType;
          } else {
            // checkNode returns the rich type directly (preserves unions).
            dataType = rhsCheckedType;
          }
          
          if (symbol && symbol.type === SymbolType.VARIABLE) {
            // SSA: track the new type with position so hover shows the correct
            // type at each point in the file. Preserve the original declared type
            // (e.g., unknown from `let cpus;`) for positions before this assignment.
            symbol.currentType = dataType;
            symbol.currentTypeEffectiveFrom = node.end;
            this.recordTypeHistory(symbol, node.end, dataType);
            // Force global declaration for module object types (cross-scope visibility)
            const mt = extractModuleType(dataType);
            if (mt && isKnownObjectType(mt.moduleName)) {
              this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, dataType);
            }
          } else if (!symbol) {
            this.symbolTable.declare(variableName, SymbolType.VARIABLE, dataType, node.left as IdentifierNode);
            const mt = extractModuleType(dataType);
            if (mt && isKnownObjectType(mt.moduleName)) {
              this.symbolTable.forceGlobalDeclaration(variableName, SymbolType.VARIABLE, dataType);
            }
          } else if (symbol.type === SymbolType.PARAMETER) {
            // Parameters: preserve declared type (unknown), track reassigned type via SSA
            symbol.currentType = dataType;
            symbol.currentTypeEffectiveFrom = node.end;
            this.recordTypeHistory(symbol, node.end, dataType);
          } else {
            // SSA: If this is a literal type, preserve original but track current type
            const isLiteralVariable = symbol && symbol.initialLiteralType !== undefined;
            if (isLiteralVariable) {
              // Update current type but preserve original literal type
              symbol.currentType = dataType;
              symbol.currentTypeEffectiveFrom = node.end;
              this.recordTypeHistory(symbol, node.end, dataType);
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
              if (funcSym) this.copyFactoryReturnToBinding(symbol, funcSym);
            }
          }
        }
      }
    }

    // Base traversal already happened at the beginning of this method
  }

  /**
   * `global.X = { … }`: declare X as a first-class global-scoped object symbol carrying
   * the object literal's shape (property types, method return types, member locations),
   * reusing the same machinery as a local `let obj = { … }`. Makes bare reads of X, its
   * literal members, and later `X.prop = …` flow-tracking all resolve, instead of X being
   * a name-only global property whose members were always `unknown`.
   */
  /** forceGlobalDeclaration falls back to a zero-width fake node at offset 0 when the name
   *  had no prior symbol — go-to-definition would land on line 1, column 0. Stamp the first
   *  recorded `global.X = …` def site (the property span) instead. */
  private stampGlobalSymbolPosition(name: string, sym: SymbolEntry): void {
    if (sym.declaredAt !== 0 || sym.node?.start !== 0 || sym.node?.end !== 0) return; // real position — keep it
    const site = this.globalDefSites.get(name)?.[0];
    if (!site) return;
    sym.declaredAt = site.start;
    sym.node = { type: 'Identifier', start: site.start, end: site.end, name } as IdentifierNode;
  }

  /** Every top-level key of this literal is statically enumerable — no spread (`{...src}`
   *  copies properties we may not see) and no computed key (`{[k]: v}`). Required before
   *  claiming a property "never exists" on the object (UC8006/UC8007). */
  private isFullyStaticObjectLiteral(objNode: ObjectExpressionNode): boolean {
    for (const prop of (objNode.properties || [])) {
      if (!prop || prop.type !== 'Property') return false; // SpreadElement etc.
      if ((prop as unknown as { computed?: boolean }).computed) return false;
    }
    return true;
  }

  private declareGlobalObjectBinding(name: string, objNode: ObjectExpressionNode): void {
    this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, UcodeType.OBJECT as UcodeDataType);
    // UC8006 candidacy requires a fully-enumerable shape; a spread/computed key means the
    // literal itself can carry properties we can't list → never claim "never assigned".
    if (this.isFullyStaticObjectLiteral(objNode)) this.globalObjectBindings.add(name);
    const sym = this.symbolTable.lookup(name);
    if (!sym) return;
    this.stampGlobalSymbolPosition(name, sym);
    sym.dataType = UcodeType.OBJECT as UcodeDataType;
    const propTypes = this.inferObjectLiteralPropertyTypes(objNode);
    if (propTypes) sym.propertyTypes = propTypes;
    const fnReturns = this.inferObjectLiteralFunctionReturnTypes(objNode);
    if (fnReturns) sym.propertyReturnTypes = fnReturns;
    if (!sym.propertyDefinitionLocations) {
      const locs = this.inferObjectLiteralPropertyLocations(objNode);
      if (locs) sym.propertyDefinitionLocations = locs;
    }
  }

  /**
   * `global.fn = function(){…}` / bare implicit `fn = () => …`: expose fn as a first-class
   * global FUNCTION symbol carrying its inferred return type + params, so bare `fn(...)`
   * resolves its return type and argument-checks (the fn-value visitor stashed both on the node).
   */
  private declareGlobalFunctionBinding(name: string, fnNode: AstNode): void {
    this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, UcodeType.FUNCTION as UcodeDataType);
    const sym = this.symbolTable.lookup(name);
    if (!sym) return;
    this.stampGlobalSymbolPosition(name, sym);
    sym.dataType = UcodeType.FUNCTION as UcodeDataType;
    const rt = (fnNode as unknown as { _inferredReturnType?: UcodeDataType })._inferredReturnType;
    if (rt !== undefined && rt !== null) sym.returnType = rt;
    const params = (fnNode as unknown as { _inferredParams?: ParamInfo[] })._inferredParams;
    if (params) sym.parameters = params;
  }

  /** `global.X = […]` / bare implicit `X = […]`: expose X as a global with the array's
   *  element type (via checkNode → array<T>), so `X[i]` resolves instead of `unknown` (05). */
  private declareGlobalArrayBinding(name: string, arrNode: AstNode): void {
    const at = this.typeChecker.checkNode(arrNode);
    if (!isArrayType(at)) return;
    this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, at);
    const sym = this.symbolTable.lookup(name);
    if (sym) { this.stampGlobalSymbolPosition(name, sym); sym.dataType = at; sym.used = true; }
  }

  /** Append an entry to a variable's per-assignment type history (for position-aware hover). */
  private recordTypeHistory(symbol: SymbolEntry, from: number, type: UcodeDataType): void {
    (symbol.typeHistory ??= []).push({ from, type });
  }

  /**
   * `global.X = <scalar>` / bare implicit `X = <scalar>` where the SSA gate holds (every
   * assignment to X is straight-line top-level — see scalarSSAEligible): declare/refresh a
   * global VARIABLE symbol whose dataType is the CURRENT assignment's type. Because the
   * analyzer visits statements in source order, a read between two assignments resolves the
   * type in effect at that point (`global.M = 1; let a = M;` → integer, then `global.M =
   * "s"; let b = M;` → string) — the same most-recent mechanism local variables use.
   * typeHistory makes hover on M itself positional too.
   */
  private declareGlobalScalarBinding(name: string, type: UcodeType, from: number): void {
    let sym = this.symbolTable.lookup(name);
    if (!sym) {
      this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, type as UcodeDataType);
      sym = this.symbolTable.lookup(name);
      if (!sym) return;
      sym.used = true; // a global is externally observable — never "unused"
      this.stampGlobalSymbolPosition(name, sym);
    }
    sym.dataType = type as UcodeDataType;
    this.recordTypeHistory(sym, from, type as UcodeDataType);
  }

  override visitUnaryExpression(node: UnaryExpressionNode): void {
    // Track ! operator as truthiness context
    if (node.operator === '!') this.truthinessDepth++;
    super.visitUnaryExpression(node);
    if (node.operator === '!') this.truthinessDepth--;

    // `!x = y` parses as `!(x = y)` in ucode — the assignment binds *below* the prefix
    // unary operator. This is valid but easy to misread (looks like an attempt to assign
    // to `!x`), so warn and offer to make the order of operations explicit with parens.
    // Always-on (even under 'use strict'); a clarity lint, not a target-version gate.
    // Gate on `absorbedAssignment`: the parser sets it only for the UNPARENTHESIZED
    // form, so applying the paren quick fix (`!(x = y)`) clears the warning even though
    // the AST shape (unary→assignment) is unchanged.
    if (node.prefix && node.absorbedAssignment && node.argument.type === 'AssignmentExpression') {
      const assign = node.argument;
      this.addDiagnostic(
        `This parses as \`${node.operator}(…)\`: the assignment binds below the \`${node.operator}\` operator. ` +
        `Add parentheses to make the order of operations explicit.`,
        node.start, node.end, DiagnosticSeverity.Warning,
        UcodeErrorCode.CONFUSING_UNARY_ASSIGNMENT,
        { unaryAssign: { assignStart: assign.start, assignEnd: assign.end } }
      );
    }

    // `const x = 1; x++;` / `--x;` is a ucode error ("Invalid increment/decrement of constant").
    if (node.operator === '++' || node.operator === '--') {
      this.checkConstReassignment(node.argument, true);
    }

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

  override visitConditionalExpression(node: ConditionalExpressionNode): void {
    // Ternary test is a truthiness context
    this.truthinessDepth++;
    this.visit(node.test);
    this.truthinessDepth--;
    this.visit(node.consequent);
    this.visit(node.alternate);
  }

  override visitBinaryExpression(node: BinaryExpressionNode): void {
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

  override visitReturnStatement(node: ReturnStatementNode): void {
    // Continue with default traversal to ensure argument expression is visited first
    super.visitReturnStatement(node);

    if (this.options.enableControlFlowAnalysis) {
      if (this.currentFunctionNode) {
        // Determine the type of the returned value. checkNode returns the rich
        // type directly, so a union returned by the function (e.g.
        // `return c ? 1 : "s"`) reaches callers as a real UnionType, not a
        // display string — downstream consumers (union-aware arithmetic) can
        // destructure it.
        let returnType: UcodeDataType = UcodeType.NULL;
        if (node.argument) {
          returnType = this.typeChecker.checkNode(node.argument);
        }

        // Store it for later inference.
        this.functionReturnTypes.get(this.currentFunctionNode)?.push({ node, type: returnType });

        // Collect property types from returned object literals
        if (node.argument?.type === 'ObjectExpression') {
          const objNode = node.argument as ObjectExpressionNode;
          const propTypes = this.inferObjectLiteralPropertyTypes(objNode);
          if (propTypes) {
            this.functionReturnPropertyTypes.get(this.currentFunctionNode)?.push(propTypes);
            // Record each function-valued property's source location (file-local
            // offsets, stamped with this file's URI) so signature help / goto-def
            // works on a SAME-FILE factory's returned methods — the cross-file path
            // gets these from FileResolver; this is the local equivalent.
            const locs = new Map<string, { uri: string; start: number; end: number }>();
            for (const propEntry of (objNode.properties || [])) {
              if ((propEntry as any).type !== 'Property') continue; // skip spread elements
              const prop = propEntry as any;
              const key = prop.key?.name ?? prop.key?.value;
              const val = prop.value;
              if (key != null && val && (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression')
                  && typeof val.start === 'number' && typeof val.end === 'number') {
                locs.set(String(key), { uri: this.textDocument.uri, start: val.start, end: val.end });
              }
            }
            if (locs.size > 0) this.functionReturnPropertyLocations.get(this.currentFunctionNode)?.push(locs);
          }
        }
      }
    }
  }

  override visitBreakStatement(node: BreakStatementNode): void {
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

  override visitContinueStatement(node: ContinueStatementNode): void {
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

  override visitIfStatement(node: IfStatementNode): void {
    // Visit the test in truthiness context so builtins with unknown args don't warn
    // (e.g., if (!length(args)) is a valid type-check pattern)
    this.truthinessDepth++;
    this.visit(node.test);
    this.truthinessDepth--;

    // Visit consequent and alternate normally. (The indirect-type-guard push onto
    // the typeChecker's guardContextStack that used to wrap the consequent — for
    // `t = type(value); if (t == "object") { keys(value) }` — was proven redundant
    // and removed: that narrowing now flows through the per-query
    // getGuardsForPosition walk and the engine-backed post-visit filter. Phase C2.)
    if (node.consequent) this.visit(node.consequent);
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
  override visitWhileStatement(node: WhileStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }

    if (node.body) this.checkIterateeMutation(node.body, this.lengthBoundedArrayName(node.test));

    super.visitWhileStatement(node);

    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.pop();
    }
  }

  override visitForStatement(node: ForStatementNode): void {
    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }

    if (node.body) this.checkIterateeMutation(node.body, this.lengthBoundedArrayName(node.test));
    
    if (this.options.enableScopeAnalysis) {
      // Create a new scope for the for loop to properly handle loop variable declarations
      // This ensures that 'for (let i = 0; ...)' variables don't conflict between different loops
      this.symbolTable.enterScope(node.start);
      
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

  override visitForInStatement(node: ForInStatementNode): void {

    if (this.options.enableControlFlowAnalysis) {
      this.loopScopes.push(this.symbolTable.getCurrentScope());
    }

    // The iteree is the for-in collection (`for (x in C)` → C).
    if (node.body && node.right?.type === 'Identifier') {
      this.checkIterateeMutation(node.body, (node.right as IdentifierNode).name);
    }

    if (this.options.enableScopeAnalysis) {
      // Create a new scope for the for-in loop that will contain the iterator variables
      // This scope encompasses the entire loop body
      this.symbolTable.enterScope(node.start);
      
      // Handle iterator variables (left side) - for...in loops can have 1 or 2 variables
      // Single variable: for (let item in array) - item gets the value
      // Two variables: for (let i, item in array) - i gets the index, item gets the value
      
      if (node.left && node.left.type === 'Identifier') {
        // Bare-iterator case: `for (var_name in ...)` (no `let`). Same
        // type-inference + keys-of provenance treatment as the `let` case
        // below — otherwise `data_generator` here would hover as `unknown`
        // and `obj[data_generator]` wouldn't narrow through propertyTypes.
        const leftId = node.left as IdentifierNode;
        const iteratorName = leftId.name;
        const iteratorNode = leftId;

        // Under 'use strict', a bare `for (x in …)` loop variable is a runtime error
        // ("access to undeclared variable x") — it must be declared `for (let x in …)`.
        // In non-strict it's an implicit global (collected above), so no diagnostic.
        if (this.strictMode) {
          this.addDiagnosticErrorCode(
            UcodeErrorCode.UNDEFINED_VARIABLE,
            `Loop variable '${iteratorName}' is not declared — under 'use strict', declare it with 'let' (for (let ${iteratorName} in …)).`,
            iteratorNode.start,
            iteratorNode.end,
            DiagnosticSeverity.Error,
          );
        }

        // Run type-checking on the iterable FIRST so its rich type is cached
        // (e.g. `keys()` → array<string>). Otherwise getIterableFullType reads
        // an unset cache, falls through to the base ARRAY type, and the
        // iterator var ends up `unknown` instead of the element type.
        const rightBase = dataTypeToBase(this.typeChecker.checkNode(node.right));
        const rightFullType = this.getIterableFullType(node.right);
        const elemType = this.iterableElementType(rightFullType, true);
        let iterType: UcodeDataType;
        if (elemType !== null) {
          iterType = elemType; // union-aware: array<T>|null → T, etc.
        } else if (rightBase === UcodeType.OBJECT) {
          iterType = UcodeType.STRING as UcodeDataType;
        } else if (rightBase === UcodeType.STRING) {
          iterType = UcodeType.STRING as UcodeDataType;
        } else {
          iterType = UcodeType.UNKNOWN as UcodeDataType;
        }

        this.symbolTable.declare(iteratorName, SymbolType.VARIABLE, iterType, iteratorNode);
        this.symbolTable.markUsed(iteratorName, iteratorNode.start);

        // Iterator vars only become useful from the body onwards; hide them
        // from completion while the user is still typing the iterable.
        const iterSym = this.symbolTable.lookup(iteratorName);
        if (iterSym && node.body?.start !== undefined) {
          iterSym.visibleFrom = node.body.start;
        }
        // Keys-of provenance — same three sources as the `let` branch.
        if (iterSym) {
          let keysOf: string | undefined;
          if (node.right.type === 'Identifier') {
            const rightName = (node.right as IdentifierNode).name;
            const rightSym = this.symbolTable.lookup(rightName);
            if (rightSym?.keysOfSymbol) {
              keysOf = rightSym.keysOfSymbol;
            } else if (rightSym && (rightSym.dataType === UcodeType.OBJECT || (typeof rightSym.dataType === 'object' && (rightSym.dataType as any).type === UcodeType.OBJECT))) {
              keysOf = rightName;
            }
          } else if (node.right.type === 'CallExpression') {
            const k = (node.right as any)._keysOfSymbol as string | undefined;
            if (k) keysOf = k;
          }
          if (keysOf) iterSym.keysOfSymbol = keysOf;
        }
      } else if (node.left && node.left.type === 'VariableDeclaration' && (node.left as VariableDeclarationNode).declarations.length > 0) {
        // Declaration case: for (let var_name in ...) or for (let i, item in ...)
        const declarations = (node.left as VariableDeclarationNode).declarations;
        
        if (declarations.length === 1) {
          // Single variable: gets the value for arrays, the key for objects
          const declarator = declarations[0];
          if (declarator && declarator.id && declarator.id.type === 'Identifier') {
            const iteratorName = declarator.id.name;
            const iteratorNode = declarator.id;

            // Infer the iterator variable type from what's being iterated.
            // `array<T>` → T (works even when the declared type is a union the
            // loop narrows, e.g. `string | array<T> | null` → `array<T>`).
            // Run checkNode FIRST so the iterable's rich type is cached before
            // getIterableFullType reads it (matters for CallExpression iterables
            // like `keys(obj)` whose return type isn't known until the call is
            // type-checked).
            const rightBase = dataTypeToBase(this.typeChecker.checkNode(node.right));
            const rightFullType = this.getIterableFullType(node.right);
            const elemType = this.iterableElementType(rightFullType, true);
            let iterType: UcodeDataType;
            if (elemType !== null) {
              iterType = elemType; // union-aware: array<string>|null → string, etc.
            } else if (rightBase === UcodeType.OBJECT) {
              iterType = UcodeType.STRING as UcodeDataType; // object keys are strings
            } else if (rightBase === UcodeType.STRING) {
              iterType = UcodeType.STRING as UcodeDataType; // iterating string chars
            } else {
              iterType = UcodeType.UNKNOWN as UcodeDataType; // unknown → no element info
            }

            this.symbolTable.declare(iteratorName, SymbolType.VARIABLE, iterType, iteratorNode);
            this.symbolTable.markUsed(iteratorName, iteratorNode.start);

            // Hide from completion until the body starts — see the bare-iterator
            // branch above for rationale.
            const iterSymInit = this.symbolTable.lookup(iteratorName);
            if (iterSymInit && node.body?.start !== undefined) {
              iterSymInit.visibleFrom = node.body.start;
            }

            // Keys-of provenance for the iterator variable. Three sources:
            //   1) `for (let k in obj)` where obj is a known OBJECT symbol → k is one of obj's keys.
            //   2) `for (let k in keys(obj))` (CallExpression tagged by validateKeysFunction).
            //   3) `for (let k in tagged_arr)` where tagged_arr has keysOfSymbol set
            //      from a prior `let tagged_arr = keys(obj);`.
            const iterSym = this.symbolTable.lookup(iteratorName);
            if (iterSym) {
              let keysOf: string | undefined;
              if (node.right.type === 'Identifier') {
                const rightName = (node.right as IdentifierNode).name;
                const rightSym = this.symbolTable.lookup(rightName);
                if (rightSym?.keysOfSymbol) {
                  keysOf = rightSym.keysOfSymbol;
                } else if (rightSym && (rightSym.dataType === UcodeType.OBJECT || (typeof rightSym.dataType === 'object' && (rightSym.dataType as any).type === UcodeType.OBJECT))) {
                  keysOf = rightName;
                }
              } else if (node.right.type === 'CallExpression') {
                const k = (node.right as any)._keysOfSymbol as string | undefined;
                if (k) keysOf = k;
              }
              if (keysOf) iterSym.keysOfSymbol = keysOf;
            }
          }
        } else if (declarations.length === 2) {
          // Two variables: first gets the index (number), second gets the value
          const indexDeclarator = declarations[0];
          const valueDeclarator = declarations[1];
          
          if (indexDeclarator && indexDeclarator.id && indexDeclarator.id.type === 'Identifier') {
            const indexName = indexDeclarator.id.name;
            const indexNode = indexDeclarator.id;
            
            // Index variable type depends on what's being iterated over
            // For objects: key is string, for arrays: index is integer, for unknown: unknown.
            // checkNode returns a rich type (e.g. ArrayType object for array<T>);
            // collapse to base so `=== ARRAY` matches an array<T> result too.
            const rightBase = dataTypeToBase(this.typeChecker.checkNode(node.right));
            let keyType: UcodeDataType;

            if (rightBase === UcodeType.OBJECT) {
              keyType = UcodeType.STRING as UcodeDataType;  // Object keys are strings
            } else if (rightBase === UcodeType.ARRAY) {
              keyType = UcodeType.INTEGER as UcodeDataType; // Array indices are integers
            } else {
              keyType = UcodeType.UNKNOWN as UcodeDataType; // Unknown type being iterated
            }
            
            this.symbolTable.declare(indexName, SymbolType.VARIABLE, keyType, indexNode);
            this.symbolTable.markUsed(indexName, indexNode.start);
          }
          
          if (valueDeclarator && valueDeclarator.id && valueDeclarator.id.type === 'Identifier') {
            const valueName = valueDeclarator.id.name;
            const valueNode = valueDeclarator.id;
            
            // Value variable type depends on the array element type
            const rightFullType = this.getIterableFullType(node.right);
            // The value var of `for (k, v in …)` is the array element (union-aware:
            // array<T>|null → T); object values aren't strings, so object/string members
            // make this give up → value stays unknown (objectAndStringYieldString=false).
            const valueElem = this.iterableElementType(rightFullType, false);
            const valueType: UcodeDataType = valueElem !== null ? valueElem : (UcodeType.UNKNOWN as UcodeDataType);
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

  /** Get the full UcodeDataType for an iterable expression (identifier lookup or
   *  the type checker's cached rich type for the node). */
  /**
   * The element type produced by iterating `t` with `for-in`, union-aware. for-in
   * iterates array VALUES (→ the element type), object keys / string chars (→ string),
   * and is a no-op on `null` (verified vs the interpreter). For a union — the common
   * `array<T> | null` shape from `fs.lsdir`/`split`/`json`/… — each member contributes
   * its iterable element type and `null` members are dropped, so `array<string> | null`
   * → `string`. Returns null (caller falls back to UNKNOWN) if any non-null member is
   * uniterable/unknown, so we never invent a wrong element type.
   *
   * `objectAndStringYieldString` distinguishes the loop-variable contexts: the single
   * loop variable (and the bare iterator) binds keys/chars, so an object/string member
   * yields `string`; but the *value* variable of a two-variable `for (k, v in …)` is the
   * array element only — an object's values aren't strings — so that caller passes
   * `false` and object/string members make it give up (value stays unknown), preserving
   * prior behavior.
   */
  private iterableElementType(t: UcodeDataType | null, objectAndStringYieldString: boolean): UcodeDataType | null {
    if (!t) return null;
    const elems: SingleType[] = [];
    for (const member of getUnionTypes(t)) {
      const base = singleTypeToBase(member);
      if (base === UcodeType.NULL) continue; // for-in over null is a no-op
      if (isArrayType(member)) {
        for (const e of getUnionTypes(getArrayElementType(member))) elems.push(e);
      } else if (objectAndStringYieldString && (base === UcodeType.OBJECT || base === UcodeType.STRING)) {
        elems.push(UcodeType.STRING);
      } else {
        return null; // uniterable / unknown member → don't guess
      }
    }
    return elems.length ? createUnionType(elems) : null;
  }

  private getIterableFullType(node: AstNode): UcodeDataType | null {
    if (node.type === 'Identifier') {
      const id = node as IdentifierNode;
      // Prefer the narrowed type at this position (e.g. after `type(x) == 'array'`
      // the union `string | array<T> | null` narrows to `array<T>`), so for-in can
      // recover the element type. Fall back to the declared type.
      const narrowed = this.typeChecker.getNarrowedTypeAtPosition(id.name, id.start);
      if (narrowed) return narrowed;
      const sym = this.symbolTable.lookup(id.name);
      if (sym) return sym.dataType;
    }
    // Non-identifier iterables (e.g. `keys(obj)`): the caller checkNode'd the
    // node first, so its rich type is in the type checker's cache.
    return this.typeChecker.getTypeOf(node) ?? null;
  }

  override visitSwitchStatement(node: SwitchStatementNode): void {
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

  /**
   * Classify each deferred unresolved read (collected in visitIdentifier) now that every
   * declaration — including `let`/`const` declared after the use — is known.
   *
   * If a same-or-enclosing-block `let`/`const` is declared LATER in source, the read is a
   * forward reference that ucode never resolves (let/const aren't hoisted; even closures
   * capture by position) → UC1011 "used before its declaration", and we mark that
   * declaration used so it doesn't also draw a contradictory UC1006 "never used".
   * Otherwise the name is genuinely undefined here (out of scope / never declared) → UC1001.
   */
  private resolvePendingUndefinedRefs(): void {
    for (const ref of this.pendingUndefinedRefs) {
      const decl = this.symbolTable.findInScopeLaterDeclaration(ref.name, ref.start);
      if (decl) {
        this.addDiagnosticErrorCode(
          UcodeErrorCode.VARIABLE_USED_BEFORE_DECLARATION,
          `'${ref.name}' is used before its declaration. Move its declaration above this use.`,
          ref.start,
          ref.end,
          DiagnosticSeverity.Error,
        );
        decl.used = true;
        decl.usedAt = decl.usedAt || [];
        decl.usedAt.push(ref.start);
      } else {
        // A read of an undeclared variable is a hard `Reference error` ONLY under
        // 'use strict'; in non-strict ucode it silently evaluates to null (verified
        // vs the interpreter). So flag it as an Error under strict and a Warning
        // otherwise — the non-strict case is a typo/render-scope heuristic, not a
        // guaranteed crash.
        this.addDiagnosticErrorCode(
          UcodeErrorCode.UNDEFINED_VARIABLE,
          `Undefined variable: ${ref.name}`,
          ref.start,
          ref.end,
          this.strictMode ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        );
      }
    }
    this.pendingUndefinedRefs = [];
  }

  private checkUnusedVariables(): void {
    const unusedVariables = this.symbolTable.getUnusedVariables();

    // Global VM variables that should not trigger unused warnings
    const globalVMVariables = new Set(['ARGV', 'NaN', 'Infinity', 'REQUIRE_SEARCH_PATH', 'modules', 'global']);

    for (const symbol of unusedVariables) {
      // Don't warn about unused parameters, builtins, or global VM variables
      if (symbol.type === SymbolType.PARAMETER ||
          symbol.type === SymbolType.BUILTIN ||
          globalVMVariables.has(symbol.name) ||
          // Injected/host globals (built-in registry + JSDoc `@global`) are ambient — a
          // declared-but-unreferenced one is not a real "unused variable".
          this.declaredGlobalNames.has(symbol.name) ||
          // Host entry-point callbacks (e.g. uhttpd's `handle_request`) are INVOKED by the
          // host, not local dead code — no UC1006. Exempt when registered as `global.<name>`,
          // or when it appears in a template at all (entry-point intent; a wrong FORM there is
          // flagged as UC8013 instead of a misleading "unused").
          (isHostEntryPointCallback(symbol.name)
            && (this.globalPropertyNames.has(symbol.name) || this.isTemplateFile))) {
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

  /** The inferred data type of a call that returns an fs object handle (open/popen/…), or null
   *  if the node isn't such a call. The result preserves runtime nullability: a handle whose
   *  factory can fail at runtime (e.g. open() → "fs.file | null", no nullMeansWrongType) is
   *  typed `<handle> | null`, not a bare non-null handle — dropping that null is a false
   *  negative (an unguarded open(path).read() would go unflagged). See
   *  docs/done/flow-reassignment-union-call-gap.md. */
  private inferFsType(node: AstNode): UcodeDataType | null {
    // Check if this is a call expression that returns an fs object
    if (node.type !== 'CallExpression') return null;

    const callNode = node as CallExpressionNode;

    // Named import: open(), statvfs(), etc. (Bare `open()` without an import is
    // intentionally treated as the fs builtin — see test-io-module.)
    if (callNode.callee.type === 'Identifier') {
      const funcName = (callNode.callee as IdentifierNode).name;
      // Skip if imported from a non-fs module (e.g. io.open)
      const symbol = this.symbolTable.lookup(funcName);
      if (symbol && symbol.type === SymbolType.IMPORTED && symbol.importedFrom && symbol.importedFrom !== 'fs') {
        return null;
      }
      return this.fsObjectDataType(funcName);
    }

    // Member expression: fs.open(), fs.statvfs(), etc. — only when `fs` is the
    // genuinely-imported fs module. An unimported (or shadowed) `fs` makes
    // `fs.open()` invalid (UC3006), so it must not be typed as fs.file.
    if (callNode.callee.type === 'MemberExpression') {
      const memberNode = callNode.callee as MemberExpressionNode;
      if (memberNode.object.type === 'Identifier' &&
          (memberNode.object as IdentifierNode).name === 'fs' &&
          memberNode.property.type === 'Identifier') {
        const fsSym = this.symbolTable.lookup('fs');
        if (!fsSym || extractModuleType(fsSym.dataType)?.moduleName !== 'fs') return null;
        return this.fsObjectDataType((memberNode.property as IdentifierNode).name);
      }
    }

    return null;
  }

  /** Build the data type for an fs object-handle factory `funcName`, preserving runtime
   *  nullability (see inferFsType). Returns null when funcName doesn't return an fs handle. */
  private fsObjectDataType(funcName: string): UcodeDataType | null {
    const fsType = getFsReturnObjectType(funcName);
    if (!fsType) return null;
    const handle = createFsObjectDataType(fsType);
    return fsReturnIsNullable(funcName)
      ? createUnionType([handle as SingleType, UcodeType.NULL])
      : handle;
  }

  private inferMethodReturnType(node: AstNode): UcodeDataType | null {
    // Check if this is a call expression on a member expression (method call)
    if (node.type !== 'CallExpression') return null;

    const callNode = node as CallExpressionNode;
    if (callNode.callee.type !== 'MemberExpression') return null;

    const memberNode = callNode.callee as MemberExpressionNode;
    if (memberNode.property.type !== 'Identifier') return null;
    const methodName = (memberNode.property as IdentifierNode).name;

    // Case 0: local object-literal method — `obj.method()` / `this.method()` resolve to the
    // method's inferred return type (recorded on the receiver symbol's propertyReturnTypes;
    // define-before-use). Handles `this`, which the Identifier-only cases below miss.
    if (!memberNode.computed
        && (memberNode.object.type === 'Identifier' || memberNode.object.type === 'ThisExpression')) {
      const recvSym = memberNode.object.type === 'ThisExpression'
        ? this.symbolTable.lookup('this')
        : this.symbolTable.lookup((memberNode.object as IdentifierNode).name);
      const rt = recvSym?.propertyReturnTypes?.get(methodName);
      if (rt !== undefined && rt !== UcodeType.UNKNOWN) return rt;
    }

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
          return this.typeChecker.parseReturnTypePublic(returnTypeHint);
        }

        // Check known object type methods (fs.file, uci.cursor, io.handle, etc.)
        const mt = extractModuleType(symbol.dataType);
        if (mt) {
          const mn = mt.moduleName;
          if (isKnownObjectType(mn)) {
            const methodSig = OBJECT_REGISTRIES[mn].getMethod(methodName);
            if (Option.isSome(methodSig)) {
              return this.typeChecker.parseReturnTypePublic(methodSig.value.returnType);
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
          return this.typeChecker.parseReturnTypePublic(methodSig.value.returnType);
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
    // Rich type cached by the type checker (e.g. split() → ArrayType). Skip a
    // bare UNKNOWN so we still fall through to the symbol's declared type.
    const cached = this.typeChecker.getTypeOf(node);
    if (cached !== undefined && cached !== UcodeType.UNKNOWN) {
      return cached;
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
        return sourceSymbol.currentType || sourceSymbol.dataType;
      }
    }

    // Use the type checker — it handles all module functions, builtins, and
    // narrowing, and now returns the rich type (unions, arrays, object shapes)
    // directly. Use it when it resolved something concrete.
    const inferredType = this.typeChecker.checkNode(expression);
    if (inferredType !== UcodeType.UNKNOWN) return inferredType;

    // Fall back to method/function return type inference for non-module calls
    const methodReturnType = this.inferMethodReturnType(expression);
    if (methodReturnType) return methodReturnType;

    const functionReturnType = this.inferFunctionCallReturnType(expression);
    if (functionReturnType) return functionReturnType;

    return inferredType as UcodeDataType;
  }

  /**
   * Record a member-property write: updates the flat `propertyTypes` (most-recent) AND appends
   * to `propertyTypeHistory` keyed by source position, so later reads are flow-sensitive. `pos`
   * is the END of the assignment expression, so a read WITHIN the RHS (`rv.days = keys(rv.days)`)
   * still sees the prior type, and only reads after the statement see the new one.
   */
  private recordPropertyWrite(symbol: SymbolEntry, propName: string, type: UcodeDataType, pos: number): void {
    if (!symbol.propertyTypes) symbol.propertyTypes = new Map<string, UcodeDataType>();
    symbol.propertyTypes.set(propName, type);
    if (!symbol.propertyTypeHistory) symbol.propertyTypeHistory = new Map();
    let hist = symbol.propertyTypeHistory.get(propName);
    if (!hist) { hist = []; symbol.propertyTypeHistory.set(propName, hist); }
    hist.push({ pos, type });
  }

  private inferObjectLiteralPropertyTypes(node: ObjectExpressionNode): Map<string, UcodeDataType> | null {
    const propTypes = new Map<string, UcodeDataType>();
    for (const prop of node.properties) {
      // A spread (`{ ...src, y: 2 }`) copies src's properties into this object. Merge the
      // source's KNOWN property types here, in order, so a later explicit key still wins
      // (`{ ...src, x: "s" }` → x is string). Purely additive: only known props are added,
      // so it can never introduce a false "property does not exist". Finding #29 follow-up.
      if (prop.type === 'SpreadElement') {
        const arg = (prop as SpreadElementNode).argument;
        let sourceProps: Map<string, UcodeDataType> | null = null;
        if (arg.type === 'ObjectExpression') {
          sourceProps = this.inferObjectLiteralPropertyTypes(arg as ObjectExpressionNode);
        } else if (arg.type === 'Identifier') {
          const sym = this.symbolTable.lookup((arg as IdentifierNode).name);
          sourceProps = sym?.propertyTypes ?? null;
        }
        if (sourceProps) {
          for (const [k, t] of sourceProps) propTypes.set(k, t);
        }
        continue;
      }
      const key = this.resolveObjectLiteralKey(prop);
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

  /**
   * Dictionary value-shape inference. When a local object `symbol` (declared
   * `let m = {}`) is used as a string-keyed map — written via computed
   * assignments `m[k] = {…}` either directly OR through a one-hop setter
   * `function f(key, data) { m[key] = data; }` called with object literals —
   * infer the common shape of its VALUES and stash it on `symbol.valuePropertyTypes`.
   * The read path (`m[k]`) and the `let v = m[k]` binding then resolve to that
   * shape instead of `unknown`.
   *
   * Soundness: intersection across all writes (only always-present properties
   * survive); any non-object/non-param write, or a setter with no object-literal
   * call args, bails (no value shape claimed).
   */
  private inferMapValueShape(symbol: SymbolEntry, scopeRoot: AstNode): void {
    const mapName = symbol.name;
    const shapes: Map<string, UcodeDataType>[] = [];
    const setterHops: { fnName: string; paramIndex: number }[] = [];
    let bailed = false;

    const isFn = (n: unknown): n is FunctionLikeNode => isAstNodeLike(n) && (n.type === 'FunctionDeclaration'
      || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

    // Does function `fnNode` REDECLARE `nm` (a param, rest-param, or a local
    // let/const in its own body)? Such a function shadows the outer map, so its
    // `nm[…] = …` writes belong to a DIFFERENT symbol — we must not let them
    // pollute the outer map's value shape. Scans the body but stops at deeper
    // nested functions.
    const declaresLocally = (fnNode: FunctionLikeNode, nm: string): boolean => {
      const params = fnNode.params || [];
      if (params.some((p) => p?.name === nm)) return true;
      if (fnNode.restParam?.name === nm) return true;
      let found = false;
      const scan = (n: unknown): void => {
        if (found || !isAstNodeLike(n)) return;
        if (isFn(n) && n !== fnNode) return; // don't descend into deeper functions
        if (n.type === 'VariableDeclaration') {
          for (const d of (n as unknown as VariableDeclarationNode).declarations || []) if (d?.id?.name === nm) { found = true; return; }
        }
        for (const k of Object.keys(n)) {
          if (k === 'leadingJsDoc') continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const it of v) scan(it); }
          else if (isAstNodeLike(v)) scan(v);
        }
      };
      scan(fnNode.body);
      return found;
    };

    // Collect computed writes to `mapName`, tracking the nearest enclosing
    // function so `m[k] = param` can be resolved to (function, param index).
    const walk = (node: unknown, fn: FunctionLikeNode | null): void => {
      if (bailed || !isAstNodeLike(node)) return;
      // Scope safety: a nested function that redeclares `mapName` is a different
      // binding — skip it entirely so its writes don't pollute this map's shape.
      if (isFn(node) && node !== scopeRoot && declaresLocally(node, mapName)) return;
      const curFn: FunctionLikeNode | null = isFn(node) ? node : fn;
      if (node.type === 'AssignmentExpression') {
        const asn = node as unknown as AssignmentExpressionNode;
        const left = asn.left as MemberExpressionNode;
        if (asn.operator === '='
            && left?.type === 'MemberExpression' && left.computed
            && left.object?.type === 'Identifier' && (left.object as IdentifierNode).name === mapName) {
          const rhs = asn.right;
          if (rhs?.type === 'ObjectExpression') {
            const shape = this.inferObjectLiteralPropertyTypes(rhs as ObjectExpressionNode);
            if (shape) shapes.push(shape); // empty literal → ignore (no shape contribution)
          } else if (rhs?.type === 'Identifier' && curFn && Array.isArray(curFn.params)
                     && (curFn as FunctionDeclarationNode).id?.name) {
            const idx = curFn.params.findIndex((p) => p?.name === (rhs as IdentifierNode).name);
            if (idx >= 0) setterHops.push({ fnName: (curFn as FunctionDeclarationNode).id.name, paramIndex: idx });
            else bailed = true; // assigned an identifier of unknown shape
          } else {
            bailed = true; // non-object write → heterogeneous/opaque map
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingJsDoc') continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const it of v) walk(it, curFn); }
        else if (isAstNodeLike(v)) walk(v, curFn);
      }
    };
    walk(scopeRoot, null);
    if (bailed) return;

    // Stage 2: resolve each setter hop to the object-literal arguments at its
    // call sites within the same scope.
    for (const hop of setterHops) {
      let found = false;
      const callWalk = (node: unknown): void => {
        if (!isAstNodeLike(node)) return;
        if (node.type === 'CallExpression') {
          const call = node as unknown as CallExpressionNode;
          if (call.callee?.type === 'Identifier' && (call.callee as IdentifierNode).name === hop.fnName) {
            const arg = call.arguments?.[hop.paramIndex];
            if (arg?.type === 'ObjectExpression') {
              const shape = this.inferObjectLiteralPropertyTypes(arg as ObjectExpressionNode);
              if (shape) { shapes.push(shape); found = true; }
            }
          }
        }
        for (const k of Object.keys(node)) {
          if (k === 'leadingJsDoc') continue;
          const v = node[k];
          if (Array.isArray(v)) { for (const it of v) callWalk(it); }
          else if (isAstNodeLike(v)) callWalk(v);
        }
      };
      callWalk(scopeRoot);
      if (!found) return; // setter feeds the map but no literal call args → unshaped
    }

    if (shapes.length === 0) return;

    // Intersection of keys across all writes (only always-present properties
    // survive — sound). Per surviving key: drop unknown contributions; if the
    // remaining concrete types AGREE on a base, keep the (possibly rich) first;
    // if they DIFFER, union the distinct bases (honest `integer | string` rather
    // than silently picking one). All-unknown → unknown.
    const merged = new Map<string, UcodeDataType>();
    for (const key of shapes[0]!.keys()) {
      if (!shapes.every(s => s.has(key))) continue;
      const concrete: UcodeDataType[] = [];
      for (const s of shapes) {
        const t = s.get(key);
        if (t !== undefined && dataTypeToBase(t) !== UcodeType.UNKNOWN) concrete.push(t);
      }
      if (concrete.length === 0) { merged.set(key, UcodeType.UNKNOWN as UcodeDataType); continue; }
      const bases = [...new Set(concrete.map(t => dataTypeToBase(t)))];
      merged.set(key, bases.length === 1 ? concrete[0]! : (createUnionType(bases) as UcodeDataType));
    }
    if (merged.size > 0) symbol.valuePropertyTypes = merged;
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

    // Function-valued variable: `let f = () => {…}` / `let f = function(){…}` is a
    // VARIABLE whose dataType is FUNCTION and whose returnType was inferred at the
    // declaration. Resolve its call-site return type too (guarded on returnType being
    // set, so ordinary variables are unaffected).
    if (symbol && symbol.dataType === UcodeType.FUNCTION && symbol.returnType !== undefined) {
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

  /** Stamp file-local member offsets (from a FactoryReturnInfo) with their source
   *  file URI, producing the {uri,start,end} map go-to-definition consumes. */
  private stampLocations(
    locs: Map<string, { start: number; end: number }>,
    uri: string
  ): Map<string, { uri: string; start: number; end: number }> {
    const out = new Map<string, { uri: string; start: number; end: number }>();
    for (const [prop, loc] of locs) out.set(prop, { uri, start: loc.start, end: loc.end });
    return out;
  }

  /** Apply a factory's return info to the imported function symbol: return type,
   *  the returned object's property types + function-property return hints, and
   *  each member's source location (uri-stamped) for go-to-definition. Shared by
   *  the default- and named-import handlers. No-op when the return type is unknown. */
  private applyFactoryReturnInfo(symbol: SymbolEntry, returnInfo: FactoryReturnInfo, uri: string): void {
    if (returnInfo.returnType === UcodeType.UNKNOWN) return;
    symbol.returnType = returnInfo.returnType;
    symbol.returnPropertyTypes = returnInfo.returnPropertyTypes;
    if (returnInfo.propertyFunctionReturnTypes) symbol.propertyFunctionReturnTypes = returnInfo.propertyFunctionReturnTypes;
    if (returnInfo.propertyDefinitionLocations) symbol.returnPropertyDefinitionLocations = this.stampLocations(returnInfo.propertyDefinitionLocations, uri);
  }

  /** Copy a factory function's return shape onto a variable bound to its call
   *  result (`let v = factory()`): the returned object's property types,
   *  function-property return hints, and member source locations (so go-to-def on
   *  `v.member` lands in the factory source). Shared by the assignment and
   *  variable-declarator binding paths. */
  private copyFactoryReturnToBinding(symbol: SymbolEntry, funcSym: SymbolEntry): void {
    if (funcSym.returnPropertyTypes) symbol.propertyTypes = new Map(funcSym.returnPropertyTypes);
    if (funcSym.propertyFunctionReturnTypes) symbol.propertyFunctionReturnTypes = new Map(funcSym.propertyFunctionReturnTypes);
    if (funcSym.returnPropertyDefinitionLocations) symbol.propertyDefinitionLocations = new Map(funcSym.returnPropertyDefinitionLocations);
  }

  private isLiteralType(dataType: UcodeDataType, initNode: AstNode | null | undefined): boolean {
    // Check if the dataType corresponds to a literal type and if the init node is actually a literal
    if (!initNode) return false;

    switch (initNode.type) {
      case 'ArrayExpression':
        return dataType === UcodeType.ARRAY || isArrayType(dataType);
      case 'ObjectExpression':
        return dataType === UcodeType.OBJECT;
      case 'Literal': {
        const lit = initNode as LiteralNode;
        if (lit.literalType === 'regexp') {
          return dataType === UcodeType.REGEX;
        }
        if (typeof lit.value === 'string') return dataType === UcodeType.STRING;
        if (typeof lit.value === 'number') return dataType === UcodeType.INTEGER || dataType === UcodeType.DOUBLE;
        if (typeof lit.value === 'boolean') return dataType === UcodeType.BOOLEAN;
        if (lit.value === null) return dataType === UcodeType.NULL;
        break;
      }
    }
    return false;
  }

  /** When `init` is the immediate-invoke `loadfile(<stringLiteral>)(…)`, the cross-file
   *  inference of the loaded program's return value; null for any other shape. */
  private loadfileCallReturnInfo(init: AstNode): LoadfileProgramReturn | null {
    if (init.type !== 'CallExpression') return null;
    const outer = init as CallExpressionNode;
    if (outer.callee?.type !== 'CallExpression') return null;
    const lf = outer.callee as CallExpressionNode;
    if (lf.callee?.type !== 'Identifier' || (lf.callee as IdentifierNode).name !== 'loadfile') return null;
    const arg0 = lf.arguments?.[0];
    if (arg0?.type !== 'Literal' || typeof (arg0 as LiteralNode).value !== 'string') return null;
    return this.fileResolver.getLoadfileProgramReturn((arg0 as LiteralNode).value as string, this.textDocument.uri);
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
          // Honour SSA currentType when it's active at the init's position —
          // `let data = null; data = call(); let p = data;` should give p the
          // post-assignment type (whatever call() returned, typically UNKNOWN),
          // NOT the original `null` from data's declaration site.
          let effSourceType: UcodeDataType = sourceSymbol.dataType;
          if (sourceSymbol.currentType !== undefined && sourceSymbol.currentTypeEffectiveFrom !== undefined
              && node.init.start >= sourceSymbol.currentTypeEffectiveFrom) {
            effSourceType = sourceSymbol.currentType;
          }
          symbol.dataType = effSourceType;
          this.symbolTable.updateSymbolType(name, effSourceType);

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

      // Module object types (fs.file, io.handle, uci.cursor, etc.) are now handled
      // by the rich-type path in visitVariableDeclarator — no per-module cascade needed.
      // Exception: bare builtin fs functions (open, popen, mkstemp) that are available
      // without import still need inferFsType since they're not in the type checker's builtins.
      const fsType = this.inferFsType(node.init!);
      if (fsType) {
        symbol.dataType = fsType;
        this.symbolTable.forceGlobalDeclaration(name, SymbolType.VARIABLE, fsType);
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

        // `loadfile("x.uc")()` — keep the cross-file program-return inference from the
        // declaration pass; the generic checkNode fallback below would reset it to unknown.
        const loadfileInfo = this.loadfileCallReturnInfo(node.init!);
        if (loadfileInfo) {
          symbol.dataType = loadfileInfo.dataType;
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
              if (funcSym) this.copyFactoryReturnToBinding(symbol, funcSym);
            }
          }
          return;
        }
        // For non-function calls, fall back to type checker result.
        // Suppress validation warnings — this call is for type inference only;
        // validation was already done during the visit pass.
        this.typeChecker.setTruthinessDepth(1);
        // checkNode returns the rich type directly (preserves unions).
        const initType = this.typeChecker.checkNode(node.init);
        this.typeChecker.setTruthinessDepth(0);
        symbol.dataType = initType;
        this.setDeclarationTypeIfUnset(symbol, symbol.dataType);
        // Debug logging for arrow function variables
        if (node.init.type === 'ArrowFunctionExpression') {
          // Function type detected
        }
      }
    }
  }

  override visitExportNamedDeclaration(node: ExportNamedDeclarationNode): void {
    // For export function declarations like: export function foo() {}
    if (node.declaration) {
      // Version-gated: `export function NAME(){}` without a trailing `;` only
      // compiles on ucode newer than OpenWrt 24.10. Flag it when targeting older.
      if (node.declaration.type === 'FunctionDeclaration' && node.declarationHadSemicolon === false) {
        this.flagVersionFeature(VERSION_FEATURES.exportFunctionNoSemicolon, node.start, node.declaration.end);
      }

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

  override visitExportDefaultDeclaration(node: ExportDefaultDeclarationNode): void {
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
    severity: DiagnosticSeverity,
    data?: unknown
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
    // Parser node.end is exclusive (points past the last char) — same as LSP ranges
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
      if (data !== undefined) {
        (diagnostic as { data?: unknown }).data = data;
      }

      this.diagnostics.push(diagnostic);
    }
  }

  /**
   * If `error` is a depth-guard bail (AnalysisDepthExceeded) or a native stack overflow
   * (RangeError "Maximum call stack size exceeded"), emit ONE honest "too deeply nested"
   * warning and return true. Otherwise return false (the caller handles/rethrows it). This is
   * the containment net that turns the #117 server-crash into a graceful degradation: the code
   * is valid, only deep semantic analysis is skipped. */
  private reportTraversalOverflow(error: unknown, ast: AstNode): boolean {
    const isOverflow = error instanceof AnalysisDepthExceeded
      || (error instanceof RangeError && /call stack|Maximum call stack/i.test(error.message));
    if (!isOverflow) return false;
    // Anchor the warning on the actual deeply-nested top-level statement, not the whole
    // program range (which would mislead onto an innocent last line). (#117)
    const where = this.deepestTopLevelStatement(ast);
    this.addDiagnostic(
      `This statement is too deeply nested for full analysis (over ${MAX_ANALYSIS_DEPTH} levels of nesting). ` +
      `The code is valid; only deep semantic analysis is skipped here.`,
      where.start,
      where.end,
      DiagnosticSeverity.Warning,
    );
    return true;
  }

  /** Among the program's top-level statements, the one with the greatest nesting depth — so
   *  the "too deeply nested" warning lands on the offending statement. Measured ITERATIVELY
   *  (explicit stack) so finding it can't itself overflow. Falls back to `ast`. (#117) */
  private deepestTopLevelStatement(ast: AstNode): AstNode {
    const body = (ast as { body?: AstNode[] }).body;
    if (!Array.isArray(body) || body.length === 0) return ast;
    let worst = ast, worstDepth = -1;
    for (const stmt of body) {
      const d = this.iterativeMaxDepth(stmt);
      if (d > worstDepth) { worstDepth = d; worst = stmt; }
    }
    return worst;
  }

  private iterativeMaxDepth(root: AstNode): number {
    let max = 0, iterations = 0;
    const stack: Array<{ node: AstNode; depth: number }> = [{ node: root, depth: 1 }];
    while (stack.length > 0) {
      if (++iterations > 500000) break; // safety cap; we only need a rough "which is deepest"
      const { node, depth } = stack.pop()!;
      if (depth > max) max = depth;
      for (const key of Object.keys(node)) {
        if (key === 'leadingJsDoc') continue;
        const value = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && typeof (item as AstNode).type === 'string') {
              stack.push({ node: item as AstNode, depth: depth + 1 });
            }
          }
        } else if (value && typeof value === 'object' && typeof (value as AstNode).type === 'string') {
          stack.push({ node: value as AstNode, depth: depth + 1 });
        }
      }
    }
    return max;
  }

private addDiagnostic(
    message: string,
    start: number,
    end: number,
    severity?: DiagnosticSeverity,
    code?: string,
    data?: unknown,
    relatedInformation?: DiagnosticRelatedInformation[]
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
    // Parser node.end is exclusive (points past the last char) — same as LSP ranges
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
        source: 'ucode-semantic',
        ...(code && { code }),
        ...(data ? { data } : {}),
        ...(relatedInformation && relatedInformation.length > 0 ? { relatedInformation } : {})
      };

      if (data && typeof data === 'object' && (data as { unnecessary?: unknown }).unnecessary) {
        diagnostic.tags = [DiagnosticTag.Unnecessary];
      }

      this.diagnostics.push(diagnostic);
    }
  }

  private static readonly ARRAY_MUTATORS = new Set(['pop', 'shift', 'splice', 'push', 'unshift']);

  /** For a loop test comparing an INDEX VARIABLE to `length(C)` — `i < length(C)`
   *  / `length(C) > i` (or `<=`/`>=`) — the array `C`. Requires the non-length
   *  operand to be an identifier (the independently-advancing index): that's what
   *  makes mutating C a bug. A test like `length(C) > 0` (no index var) is the
   *  legitimate consume pattern (`while (length(C) > 0) shift(C)`), so it returns
   *  null and is NOT flagged. */
  private lengthBoundedArrayName(test: AstNode | null | undefined): string | null {
    if (!test || test.type !== 'BinaryExpression') return null;
    const b = test as BinaryExpressionNode;
    if (!['<', '<=', '>', '>='].includes(b.operator)) return null;
    const lenArg = (n: AstNode): string | null => {
      if (n?.type !== 'CallExpression') return null;
      const c = n as CallExpressionNode;
      return c.callee?.type === 'Identifier' && (c.callee as IdentifierNode).name === 'length'
        && c.arguments?.length === 1 && c.arguments[0]?.type === 'Identifier'
        ? (c.arguments[0] as IdentifierNode).name : null;
    };
    const leftLen = lenArg(b.left);
    const rightLen = lenArg(b.right);
    if (leftLen && b.right?.type === 'Identifier') return leftLen;  // length(C) <op> i
    if (rightLen && b.left?.type === 'Identifier') return rightLen; // i <op> length(C)
    return null;
  }

  /** A statement that unconditionally exits the loop / function / program:
   *  break, return, exit(), die(), or assert(<falsy literal>) (which always
   *  throws). NOTE: `continue` does NOT count — it stays in the loop.
   *  (`throw` is not a ucode construct.) */
  private isUnconditionalExitStatement(stmt: AstNode | null | undefined): boolean {
    if (!stmt) return false;
    if (stmt.type === 'ReturnStatement' || stmt.type === 'BreakStatement') return true;
    if (stmt.type === 'ExpressionStatement') {
      return this.isExitingCall((stmt as ExpressionStatementNode).expression);
    }
    return false;
  }

  /** A call that terminates: exit() / die() / assert(<falsy literal>). */
  private isExitingCall(e: AstNode | null | undefined): boolean {
    if (e?.type !== 'CallExpression') return false;
    const c = e as CallExpressionNode;
    if (c.callee?.type !== 'Identifier') return false;
    const n = (c.callee as IdentifierNode).name;
    if (n === 'exit' || n === 'die') return true;
    if (n === 'assert') {
      const a = c.arguments?.[0];
      if (a?.type === 'Literal') {
        const v = (a as LiteralNode).value;
        return v === false || v === 0 || v === null || v === '';
      }
    }
    return false;
  }

  /** Does this block (or single statement) exit the LOOP — its last statement is
   *  an unconditional exit, or a both-branches-exiting if? */
  private blockExitsLoop(node: AstNode | null | undefined): boolean {
    if (!node) return false;
    const stmts: AstNode[] = node.type === 'BlockStatement' ? (node as BlockStatementNode).body : [node];
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1]!;
    if (this.isUnconditionalExitStatement(last)) return true;
    if (last.type === 'IfStatement') {
      const i = last as IfStatementNode;
      return this.blockExitsLoop(i.consequent) && !!i.alternate && this.blockExitsLoop(i.alternate);
    }
    return false;
  }

  /** Does the loop body contain ANY construct that can exit the loop (break,
   *  return, exit(), die(), assert(falsy))? Used to decide whether an unconditional
   *  growth is a PROVABLE infinite loop. Maximally inclusive (scans nested
   *  functions/loops too) so it never under-reports an exit → never a false error. */
  private bodyContainsLoopExit(node: AstNode): boolean {
    let found = false;
    const scan = (n: unknown): void => {
      if (found || !isAstNodeLike(n)) return;
      if (n.type === 'BreakStatement' || n.type === 'ReturnStatement') { found = true; return; }
      if (n.type === 'CallExpression' && this.isExitingCall(n)) { found = true; return; }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) scan(it); }
        else if (isAstNodeLike(v)) scan(v);
      }
    };
    scan(node);
    return found;
  }

  // Conditional-execution containers: a mutation nested inside one is NOT
  // guaranteed to run every iteration, so it can't make the loop provably infinite.
  private static readonly CONDITIONAL_CONTAINERS = new Set([
    'IfStatement', 'ConditionalExpression', 'LogicalExpression', 'SwitchStatement',
    'TryStatement', 'ForStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement',
  ]);

  /** UC4005: flag a loop that mutates the very collection it iterates. ucode
   *  iterates arrays by a live index, so shrinking (pop/shift/splice) silently
   *  skips elements and growing (push/unshift) may never terminate. Suppressed
   *  when the mutation is immediately followed by a loop/function/program exit
   *  (the remove-and-break idiom). An UNCONDITIONAL growth in a loop with NO exit
   *  anywhere is a PROVABLE infinite loop → reported as an error, not a warning. */
  /** Collect points where the loop body REBINDS `name` to a fresh value
   *  (`name = …`, not a mutator call or compound op). Each rebind makes the name
   *  point at a different object, so a later mutator on that name no longer touches
   *  the iteratee captured at loop entry. `conditional` = nested in an if/loop/etc,
   *  so it may not run every iteration. (UC4005, finding #58.) */
  private collectIterateeRebinds(loopBody: AstNode, name: string): Array<{ start: number; conditional: boolean }> {
    const rebinds: Array<{ start: number; conditional: boolean }> = [];
    const walk = (node: unknown, conditional: boolean): void => {
      if (!isAstNodeLike(node)) return;
      if (node.type === 'AssignmentExpression') {
        const a = node as unknown as AssignmentExpressionNode;
        if (a.operator === '=' && a.left?.type === 'Identifier' && (a.left as IdentifierNode).name === name) {
          rebinds.push({ start: node.start, conditional });
        }
      }
      const childConditional = conditional || SemanticAnalyzer.CONDITIONAL_CONTAINERS.has(node.type);
      for (const k of Object.keys(node)) {
        if (k === 'leadingJsDoc') continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const it of v) walk(it, childConditional); }
        else if (isAstNodeLike(v)) walk(v, childConditional);
      }
    };
    walk(loopBody, false);
    return rebinds;
  }

  private checkIterateeMutation(loopBody: AstNode, itereeName: string | null): void {
    if (!itereeName || !loopBody) return;
    const bodyHasExit = this.bodyContainsLoopExit(loopBody);
    const rebinds = this.collectIterateeRebinds(loopBody, itereeName);
    const walk = (node: unknown, enclosingBlock: AstNode, conditional: boolean): void => {
      if (!isAstNodeLike(node)) return;
      const block: AstNode = node.type === 'BlockStatement' ? node : enclosingBlock;
      const childConditional = conditional || SemanticAnalyzer.CONDITIONAL_CONTAINERS.has(node.type);
      const call = node as unknown as CallExpressionNode;
      if (node.type === 'CallExpression' && call.callee?.type === 'Identifier'
          && SemanticAnalyzer.ARRAY_MUTATORS.has((call.callee as IdentifierNode).name)
          && call.arguments?.[0]?.type === 'Identifier' && (call.arguments[0] as IdentifierNode).name === itereeName) {
        if (!this.blockExitsLoop(enclosingBlock)) {
          // A rebind of the iteratee name BEFORE this call means the call operates
          // on a different array object than the one being iterated (finding #58).
          // Unconditional rebind → the iteratee is provably untouched, skip entirely.
          // Conditional rebind → can't prove same-object, so don't escalate to Error.
          const priorRebinds = rebinds.filter(r => r.start < node.start);
          if (priorRebinds.some(r => !r.conditional)) return;
          const conditionallyRebound = priorRebinds.length > 0;
          const fn = (call.callee as IdentifierNode).name;
          const grows = fn === 'push' || fn === 'unshift';
          const provablyInfinite = grows && !conditional && !bodyHasExit && !conditionallyRebound;
          const message = provablyInfinite
            ? `'${fn}()' grows '${itereeName}' every iteration and the loop has no exit — infinite loop.`
            : grows
              ? `'${fn}()' grows '${itereeName}' while iterating it — ucode iterates by live index, so this may not terminate.`
              : `'${fn}()' removes from '${itereeName}' while iterating it — ucode iterates by live index, so elements are skipped.`;
          this.addDiagnosticErrorCode(
            UcodeErrorCode.COLLECTION_MUTATED_DURING_ITERATION,
            message, node.start, node.end,
            provablyInfinite ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
          );
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingJsDoc') continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const it of v) walk(it, block, childConditional); }
        else if (isAstNodeLike(v)) walk(v, block, childConditional);
      }
    };
    walk(loopBody, loopBody, false);
  }

  private detectStrictMode(ast: ProgramNode): boolean {
    if (!ast.body || ast.body.length === 0) return false;
    // Skip leading empty statements — an empty `{% %}` block (bridged to `;`) emits no real
    // statement, so a following `{% 'use strict'; %}` still leads (oracle-verified).
    const first = ast.body.find((s) => s && s.type !== 'EmptyStatement');
    if (first?.type === 'ExpressionStatement') {
      const expr = (first as any).expression;
      if (expr?.type === 'Literal' && expr.value === 'use strict') {
        // In a TEMPLATE, `'use strict'` is only a directive when its `{% %}` block leads the
        // file — any preceding text or `{{ }}` compiles to a print() statement, making the
        // directive non-first and inert (verified vs the oracle). Our template bridge DROPS
        // leading text, so the directive can look first in the AST when it isn't; guard by
        // requiring the source to start (after shebang/whitespace) with the `{%` block. Raw
        // scripts are unaffected (the first-statement AST check already ignores leading comments).
        const src = this.textDocument.getText();
        if (detectTemplateMode(src)) {
          // The `{% %}` block carrying the directive must lead the file. Allowed before it:
          // a shebang line and `{# … #}` comment blocks ONLY (they emit no statement) — verified
          // vs the oracle. Anything else, INCLUDING whitespace, compiles to a print() statement
          // that precedes the directive and makes it inert. So: drop the shebang, consume
          // back-to-back leading comment blocks (no gaps), then require `{%` immediately.
          let lead = src.replace(/^#![^\n]*\n?/, '');
          while (lead.startsWith('{#')) {
            const end = lead.indexOf('#}');
            if (end < 0) break;
            lead = lead.slice(end + 2);
          }
          if (!lead.startsWith('{%')) return false;
        }
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
   * Scan document for JSDoc `@global` declarations (developer-extensible host globals) and,
   * together with the built-in host-globals registry, register them so a read isn't flagged
   * UC1001 and (when typed) resolves to its type. Mirrors scanTypedefs.
   */
  private scanGlobalDeclarations(): void {
    this.declaredGlobalNames.clear();
    // Built-in host globals first (a `@global` of the same name can re-type it below).
    for (const [name, typeStr] of KNOWN_HOST_GLOBALS) this.declaredGlobalNames.set(name, typeStr);

    const text = this.textDocument.getText();
    const jsdocRegex = /\/\*\*([\s\S]*?)\*\//g;
    let match: RegExpExecArray | null;
    while ((match = jsdocRegex.exec(text)) !== null) {
      const body = match[1]!;
      if (!body.includes('@global')) continue;
      for (const tag of parseJsDocComment(body).tags) {
        if (tag.tag === 'global' && tag.name) this.declaredGlobalNames.set(tag.name, tag.typeExpression || '');
      }
      // Record each tag's NAME span as a definition site, so go-to-definition on a read of
      // a @global-declared name lands on its declaration comment.
      const tagRe = /@global\s+(?:\{[^}]*\}\s+)?([A-Za-z_]\w*)/g;
      let tm: RegExpExecArray | null;
      while ((tm = tagRe.exec(match[0])) !== null) {
        const name = tm[1]!;
        const nameOfs = match.index + tm.index + tm[0].lastIndexOf(name);
        let list = this.globalDefSites.get(name);
        if (!list) { list = []; this.globalDefSites.set(name, list); }
        list.push({ start: nameOfs, end: nameOfs + name.length });
      }
    }

    // Register every known/declared global so all existing suppression paths honor it
    // (UC1001 read + UC1002 call, in the analyzer and via the shared globalPropertyNames
    // set in the type checker). Suppression only for Stage 1 — we deliberately do NOT
    // declare a symbol here: doing so unconditionally would surface the name in completion
    // in every file and could collide with a user's own `let <name>` (false redeclaration).
    // Typing a `@global {type}` is a fast-follow that needs reference-gated declaration.
    for (const name of this.declaredGlobalNames.keys()) {
      this.globalPropertyNames.add(name);
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
   * Resolve an import/require source string to a URI. A dotted name first tries the
   * namespace-prefix conversion (an importer-relative `./x.uc` for `pkg.sub` imported
   * from inside `pkg/sub/`'s own directory chain), then falls back to the RAW dotted
   * form so FileResolver's search-root resolution (workspace root + ancestor-directory
   * walk) applies — `cli.utils` imported from `…/usr/share/ucode/cli/modules/` lives at
   * `…/usr/share/ucode/cli/utils.uc`, a SIBLING subtree the importer-relative
   * conversion can never reach. (docs/dotted-module-search-root.md)
   */
  // ── UC8010: blocking recv() on a socket.pair() socket ──────────────────────
  // socket.pair() returns a connected socketpair in BLOCKING mode by default
  // (uc_socket_pair: SOCK_STREAM, no SOCK_NONBLOCK). recv()/recvmsg() on such a
  // socket with no MSG_DONTWAIT flag blocks in recvfrom() until the PEER end is
  // written to — and both ends are local to this process, so if nothing ever
  // send()s on the other socket the program hangs silently (no output, since
  // print() is buffered and never flushes). This exact footgun cost real debug
  // time. We only warn when we can PROVE the socket is a blocking pair() socket
  // and the file never send()s on a pair socket — otherwise stay quiet.
  private pairSocketSendCache: Set<CallExpressionNode> | undefined;

  /** Whole-AST pass (post-traversal, so the symbol table is complete): flag every
   *  blocking recv()/recvmsg() on a socket.pair() socket. */
  private checkBlockingSocketpairRecvs(root: ProgramNode): void {
    const visit = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'CallExpression') this.flagBlockingSocketpairRecv(n as unknown as CallExpressionNode);
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) visit(it); }
        else visit(v);
      }
    };
    visit(root);
  }

  private flagBlockingSocketpairRecv(node: CallExpressionNode): void {
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || (callee as MemberExpressionNode).computed) return;
    const method = this.staticMemberName((callee as MemberExpressionNode).property);
    if (method !== 'recv' && method !== 'recvmsg') return;

    // The socket must provably originate from a blocking socket.pair() call.
    const pairCall = this.findPairSocketForReceiver((callee as MemberExpressionNode).object, 0);
    if (!pairCall || !this.pairCallIsBlocking(pairCall)) return;

    // A non-blocking recv (MSG_DONTWAIT) returns immediately — never hangs.
    if (this.argsReferenceFlag(node.arguments, 'MSG_DONTWAIT', 64)) return;

    // If THIS socketpair is written to by a send()/sendmsg() somewhere, the developer
    // is doing real IPC on it — assume the peer produces data. Keyed by the originating
    // pair() call so a send on one pair doesn't silence a blocking recv on another.
    if (this.sentPairCalls().has(pairCall)) return;

    const anchor = (callee as MemberExpressionNode).property;
    this.addDiagnostic(
      `${method}() on a blocking socketpair waits until the peer sends — with nothing written to the other end this hangs forever (and buffered print() output never appears). Pass MSG_DONTWAIT (e.g. ${method}(len, MSG_DONTWAIT)), create the pair with SOCK_NONBLOCK, or send() on the other socket first.`,
      anchor.start, anchor.end, DiagnosticSeverity.Warning, UcodeErrorCode.BLOCKING_SOCKETPAIR_RECV,
      this.buildBlockingRecvFixData(node));
  }

  /** Quick-fix payload for UC8010: how to add MSG_DONTWAIT to this recv call, plus whether
   *  socket's MSG_DONTWAIT needs importing. The server turns this into TextEdits. */
  private buildBlockingRecvFixData(node: CallExpressionNode): { blockingRecv: {
    flagText: string; needsImport: boolean; mode: 'append' | 'or';
    insertOffset?: number; arg1Start?: number; arg1End?: number;
  } } | undefined {
    const ref = this.resolveMsgDontwaitRef();
    const args = node.arguments;
    if (args.length === 1 && args[0]) {
      // recv(len) → recv(len, MSG_DONTWAIT)
      return { blockingRecv: { ...ref, mode: 'append', insertOffset: args[0].end } };
    }
    if (args.length >= 2 && args[1]) {
      // recv(len, existingFlags) → recv(len, (existingFlags) | MSG_DONTWAIT)
      return { blockingRecv: { ...ref, mode: 'or', arg1Start: args[1].start, arg1End: args[1].end } };
    }
    return undefined; // 0-arg recvmsg(): no clean positional slot for the flag
  }

  /** How to reference socket.MSG_DONTWAIT from THIS file: prefer an existing namespace
   *  import (`socket.MSG_DONTWAIT`), then an existing named import, else a bare
   *  `MSG_DONTWAIT` that needs a new `import { MSG_DONTWAIT } from 'socket'`. */
  private resolveMsgDontwaitRef(): { flagText: string; needsImport: boolean } {
    let nsName: string | undefined;
    let hasNamed = false;
    const body = this.currentASTRoot?.body ?? [];
    for (const stmt of body) {
      if (stmt?.type !== 'ImportDeclaration') continue;
      const imp = stmt as ImportDeclarationNode;
      if (imp.source?.value !== 'socket') continue;
      for (const spec of imp.specifiers) {
        if (spec.type === 'ImportNamespaceSpecifier') nsName = spec.local.name;
        else if (spec.type === 'ImportSpecifier' && spec.imported.name === 'MSG_DONTWAIT') hasNamed = true;
      }
    }
    if (nsName) return { flagText: `${nsName}.MSG_DONTWAIT`, needsImport: false };
    if (hasNamed) return { flagText: 'MSG_DONTWAIT', needsImport: false };
    return { flagText: 'MSG_DONTWAIT', needsImport: true };
  }

  /** The pair() CallExpression backing a socket-valued receiver (`sox[0]`, `s0`,
   *  `pair()[0]`), traced through `let` initializers, or null. */
  private findPairSocketForReceiver(node: AstNode, depth: number): CallExpressionNode | null {
    if (depth > 8 || !node) return null;
    if (node.type === 'MemberExpression') {
      const m = node as MemberExpressionNode;
      if (m.computed) return this.findPairArray(m.object, depth + 1); // arr[idx]
      return null;
    }
    if (node.type === 'Identifier') {
      // Position-aware: the recv may sit in a nested block whose scope has exited by
      // the time this post-pass runs, so lookupAtPosition (not lookup) resolves it.
      const sym = this.symbolTable.lookupAtPosition((node as IdentifierNode).name, node.start);
      if (sym?.initNode) return this.findPairSocketForReceiver(sym.initNode, depth + 1);
    }
    return null;
  }

  /** The pair() CallExpression if `node` evaluates to a socket.pair() result array. */
  private findPairArray(node: AstNode, depth: number): CallExpressionNode | null {
    if (depth > 8 || !node) return null;
    if (node.type === 'CallExpression') {
      return this.isSocketPairCall(node as CallExpressionNode) ? (node as CallExpressionNode) : null;
    }
    if (node.type === 'Identifier') {
      const sym = this.symbolTable.lookupAtPosition((node as IdentifierNode).name, node.start);
      if (sym?.initNode) return this.findPairArray(sym.initNode, depth + 1);
    }
    return null;
  }

  /** Is this CallExpression a call to socket.pair() (named or namespace import)? */
  private isSocketPairCall(call: CallExpressionNode): boolean {
    const callee = call.callee;
    if (callee.type === 'Identifier') {
      const sym = this.symbolTable.lookupAtPosition((callee as IdentifierNode).name, callee.start);
      return sym?.importedFrom === 'socket' && sym.importSpecifier === 'pair';
    }
    if (callee.type === 'MemberExpression' && !(callee as MemberExpressionNode).computed) {
      const m = callee as MemberExpressionNode;
      if (this.staticMemberName(m.property) !== 'pair') return false;
      if (m.object.type === 'Identifier') {
        const sym = this.symbolTable.lookupAtPosition((m.object as IdentifierNode).name, m.object.start);
        return extractModuleType(sym?.dataType)?.moduleName === 'socket';
      }
    }
    return false;
  }

  /** A pair() call is blocking unless SOCK_NONBLOCK is passed in its arguments. */
  private pairCallIsBlocking(call: CallExpressionNode): boolean {
    return !this.argsReferenceFlag(call.arguments, 'SOCK_NONBLOCK', 2048);
  }

  /** Does any argument subtree reference the named flag constant (by identifier,
   *  namespace member, or its raw numeric value)? Covers `SOCK_NONBLOCK`,
   *  `SOCK_STREAM | SOCK_NONBLOCK`, `socket.SOCK_NONBLOCK`, and `2048`. */
  private argsReferenceFlag(args: AstNode[], flagName: string, flagValue: number): boolean {
    const walk = (n: AstNode | null | undefined): boolean => {
      if (!n || typeof n !== 'object') return false;
      if (n.type === 'Identifier' && (n as IdentifierNode).name === flagName) return true;
      if (n.type === 'Literal' && (n as LiteralNode).value === flagValue) return true;
      for (const key of ['left', 'right', 'argument', 'object', 'property', 'expression']) {
        if (walk((n as any)[key])) return true;
      }
      return false;
    };
    return (args || []).some(walk);
  }

  /** The set of pair() calls whose sockets are written to by a send()/sendmsg()
   *  somewhere in the file (→ real IPC, so a blocking recv on them is intentional).
   *  Keyed by pair() CallExpression node identity; memoized. */
  private sentPairCalls(): Set<CallExpressionNode> {
    if (this.pairSocketSendCache) return this.pairSocketSendCache;
    const found = new Set<CallExpressionNode>();
    const visit = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'CallExpression') {
        const c = n as unknown as CallExpressionNode;
        if (c.callee.type === 'MemberExpression' && !(c.callee as MemberExpressionNode).computed) {
          const mn = this.staticMemberName((c.callee as MemberExpressionNode).property);
          if (mn === 'send' || mn === 'sendmsg') {
            const p = this.findPairSocketForReceiver((c.callee as MemberExpressionNode).object, 0);
            if (p) found.add(p);
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) visit(it); }
        else visit(v);
      }
    };
    if (this.currentASTRoot) visit(this.currentASTRoot);
    this.pairSocketSendCache = found;
    return found;
  }

  private staticMemberName(prop: AstNode): string | null {
    if (prop.type === 'Identifier') return (prop as IdentifierNode).name;
    if (prop.type === 'Literal' && typeof (prop as LiteralNode).value === 'string') {
      return (prop as LiteralNode).value as string;
    }
    return null;
  }

  /** UC8011 — in a uhttpd handler, flag loadfile()/include() (incl. loadfile()()): they abort
   *  the request VM uncatchably (empty response, no stderr; try/catch does not help). Static
   *  `import` and loadstring() are safe. Whole-file: a top-level call (module load) and one
   *  inside handle_request both abort. Only the real builtins, not a user-shadowed name. */
  private checkHandlerVmAbortingCalls(root: ProgramNode): void {
    const visit = (n: unknown): void => {
      if (!isAstNodeLike(n)) return;
      if (n.type === 'CallExpression') {
        const c = n as unknown as CallExpressionNode;
        if (c.callee?.type === 'Identifier') {
          const name = (c.callee as IdentifierNode).name;
          if (name === 'loadfile' || name === 'include') {
            const sym = this.symbolTable.lookupAtPosition(name, c.callee.start) ?? this.symbolTable.lookup(name);
            if (!sym || sym.type === SymbolType.BUILTIN) {
              this.addDiagnostic(
                `${name}() in a uhttpd handler aborts the request VM uncatchably — the client gets an empty response, nothing is logged, and try/catch does not help. Use a static \`import\` instead (loadstring() is also safe).`,
                c.callee.start, c.callee.end, DiagnosticSeverity.Warning,
                UcodeErrorCode.HANDLER_VM_ABORTING_CALL);
            }
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'leadingJsDoc') continue;
        const v = (n as Record<string, unknown>)[k];
        if (Array.isArray(v)) { for (const it of v) visit(it); }
        else visit(v);
      }
    };
    visit(root);
  }

  /** Phase D — authoring help for uhttpd handlers.
   *  FN-1 (UC8012): registers `global.handle_request` but isn't a `{%` template → uhttpd emits
   *  the file as the response body and runs nothing. FN-2 (UC8013): a `{%` template that
   *  defines `handle_request` in a form uhttpd's scope lookup can't see (local function /
   *  export / let-const) and never does `global.handle_request = …`. Both carry a quick-fix. */
  private checkUhttpdHandlerForm(root: ProgramNode): void {
    const hasGlobalReg = this.globalPropertyNames.has('handle_request');

    // FN-1 — correct registration, missing template wrapper.
    if (hasGlobalReg && !this.isTemplateFile) {
      const site = this.globalDefSites.get('handle_request')?.[0];
      if (site) {
        this.addDiagnostic(
          `A uhttpd handler must be a \`{% … %}\` template — as written, uhttpd emits this file as the response body and runs no code. Wrap the handler in \`{% … %}\`.`,
          site.start, site.end, DiagnosticSeverity.Warning,
          UcodeErrorCode.HANDLER_NOT_A_TEMPLATE, { handlerFormFix: { mode: 'wrap' } });
      }
      return;
    }

    // FN-2 — template, but the entry point is defined in a form uhttpd can't see.
    if (this.isTemplateFile && !hasGlobalReg) {
      for (const stmt of root.body) {
        const found = this.wrongFormHandleRequest(stmt);
        if (found) {
          this.addDiagnostic(
            `uhttpd looks up \`handle_request\` on the global scope object; a ${found.formLabel} is never found (uhttpd: "declares no handle_request() callback"). Register it as \`global.handle_request = …\`.`,
            found.anchorStart, found.anchorEnd, DiagnosticSeverity.Warning,
            UcodeErrorCode.HANDLER_ENTRY_WRONG_FORM, { handlerFormFix: found.fix });
          return; // one report is enough
        }
      }
    }
  }

  /** If `stmt` defines `handle_request` in a form invisible to uhttpd's scope lookup, return
   *  its anchor + a quick-fix descriptor (convert to `global.handle_request = …`), else null. */
  private wrongFormHandleRequest(stmt: AstNode): {
    anchorStart: number; anchorEnd: number; formLabel: string;
    fix: { mode: 'toGlobalFunc'; replaceStart: number; replaceEnd: number; appendAt: number }
       | { mode: 'toGlobalVar'; replaceStart: number; replaceEnd: number };
  } | null {
    const fnNamed = (n: AstNode | null): n is FunctionDeclarationNode =>
      !!n && n.type === 'FunctionDeclaration' && (n as FunctionDeclarationNode).id?.name === 'handle_request';

    // export function handle_request(...) {}. Anchor the added `;` on the function BODY's
    // closing brace, not the declaration end — the parser folds the bridged `%}`→`;`
    // terminator into an exported function's end, which would place the `;` past `%}`.
    if (stmt.type === 'ExportNamedDeclaration') {
      const decl = (stmt as ExportNamedDeclarationNode).declaration;
      if (fnNamed(decl)) {
        return { anchorStart: decl.id.start, anchorEnd: decl.id.end, formLabel: 'exported function',
          fix: { mode: 'toGlobalFunc', replaceStart: stmt.start, replaceEnd: decl.id.end, appendAt: decl.body.end } };
      }
    }
    // function handle_request(...) {}
    if (fnNamed(stmt)) {
      const fn = stmt as FunctionDeclarationNode;
      return { anchorStart: fn.id.start, anchorEnd: fn.id.end, formLabel: 'local function declaration',
        fix: { mode: 'toGlobalFunc', replaceStart: fn.start, replaceEnd: fn.id.end, appendAt: fn.body.end } };
    }
    // let/const handle_request = <expr>   (single-declarator only, so the rewrite is clean)
    if (stmt.type === 'VariableDeclaration') {
      const vd = stmt as VariableDeclarationNode;
      const d = vd.declarations.length === 1 ? vd.declarations[0] : undefined;
      if (d?.id?.type === 'Identifier' && (d.id as IdentifierNode).name === 'handle_request' && d.init) {
        return { anchorStart: d.id.start, anchorEnd: d.id.end, formLabel: `\`${vd.kind}\` binding`,
          fix: { mode: 'toGlobalVar', replaceStart: vd.start, replaceEnd: d.id.end } };
      }
    }
    return null;
  }

  private resolveModuleSource(source: string): string | null {
    let actualModulePath = source;
    if (this.isDotNotationModule(source)) {
      actualModulePath = this.convertDotNotationToPath(source);
    }
    let uri = this.fileResolver.resolveImportPath(actualModulePath, this.textDocument.uri);
    if (!uri && actualModulePath !== source) {
      uri = this.fileResolver.resolveImportPath(source, this.textDocument.uri);
    }
    return uri;
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
      const funcNodes: FunctionLikeNode[] = [];
      this.collectFunctionNodes(this.currentASTRoot, funcNodes);

      // Phase 1: Initial pass with default terminators (die/exit)
      const terminators = new Set(['die', 'exit']);
      this.analyzeAllFunctions(funcNodes, terminators);

      // Phase 2: Fixpoint iteration — infer never-returns and re-analyze
      let changed = true;
      while (changed) {
        changed = false;
        for (const funcNode of funcNodes) {
          const name = (funcNode as FunctionDeclarationNode).id?.name;
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
  private collectFunctionNodes(node: AstNode, result: FunctionLikeNode[]): void {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      result.push(node as unknown as FunctionLikeNode);
    }
    for (const key of Object.keys(node)) {
      const val = (node as AnyNode)[key];
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          for (const child of val) {
            if (child && typeof child.type === 'string') {
              this.collectFunctionNodes(child, result);
            }
          }
        } else if (isAstNodeLike(val)) {
          this.collectFunctionNodes(val, result);
        }
      }
    }
  }

  /**
   * Build CFGs for all functions and emit unreachable diagnostics.
   */
  private analyzeAllFunctions(funcNodes: FunctionLikeNode[], terminators: Set<string>): void {
    for (const funcNode of funcNodes) {
      if (!funcNode.body) continue;
      try {
        const builder = new CFGBuilder((funcNode as FunctionDeclarationNode).id?.name || 'anonymous', terminators);
        const cfg = builder.build(funcNode.body);
        const engine = new CFGQueryEngine(cfg);
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

  private narrowFunctionReturnType(funcNode: FunctionLikeNode, engine: CFGQueryEngine, cfg: ControlFlowGraph): void {
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
    const name = (funcNode as FunctionDeclarationNode).id?.name;
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

    const expectedTypes = diagnosticData.expectedTypes as UcodeType[];
    const typeNarrowing = this.typeChecker.getTypeNarrowing();

    // Use the type checker's comprehensive AST-based guard detection, which
    // (Phase B / B5) is now backed by the flow-type engine: it handles null
    // checks, truthy guards, builtin call guards, type() guards, AND
    // reassignment narrowing in one place. The SemanticAnalyzer's own duplicate
    // type()-guard walk (findTypeGuardNarrowedTypes/searchTypeGuardForPosition/
    // collectTypeGuardTypes/…) that used to back-stop this was proven redundant
    // and deleted in B6 — every case it caught is subsumed here.
    const narrowedType = this.typeChecker.getNarrowedTypeAtPosition(varName, argumentOffset);
    if (narrowedType && typeNarrowing.isSubtypeOfUnion(narrowedType, expectedTypes)) {
      return true;
    }

    return false;
  }

  private filterDiagnosticsWithFlowSensitiveAnalysis(diagnostics: Diagnostic[]): Diagnostic[] {
    if (!this.currentASTRoot || !this.cfgQueryEngine) {
      return diagnostics;
    }

    return diagnostics.filter(diagnostic => {
      // UC2010 on a bare identifier call inside a closure that captures the variable:
      // false when any assignment gives the variable a callable value — the closure
      // body runs after assignments, not at its textual position, so the position-based
      // "still null here" flow state doesn't apply. Post-visit so mutually-recursive
      // partners assigned LATER in the file are already stamped.
      // (docs/forward-declared-function-valued-let-uc1002.md)
      if ((diagnostic as any).code === UcodeErrorCode.NOT_CALLABLE) {
        const calleeMatch = diagnostic.message.match(/^'(\w+)' is not a function/);
        if (calleeMatch && this.typeChecker.isDeferredCallableFalsePositive(
              calleeMatch[1]!, this.textDocument.offsetAt(diagnostic.range.start))) {
          return false;
        }
      }

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

      // Filter incompatible-function-argument diagnostics for globals whose final type
      // satisfies the constraint. During the walk, globals referenced in function bodies
      // may appear as 'unknown' because their assignment hasn't been processed yet.
      // At runtime, functions are typically called after global initialization.
      if ((diagnostic as any).code === 'incompatible-function-argument') {
        const diagnosticData = (diagnostic as any).data;
        if (diagnosticData?.variableName && diagnosticData.actualType === UcodeType.UNKNOWN) {
          const sym = this.symbolTable.lookup(diagnosticData.variableName);
          if (sym && sym.dataType !== UcodeType.UNKNOWN && sym.type === SymbolType.VARIABLE) {
            // Re-check: parse the expected type string and verify the final type is compatible
            const expectedTypes = (diagnosticData.expectedType as string).split(' | ');
            const finalTypes = getUnionTypes(sym.dataType);
            // Compare each member's BASE type: a member may be a refined form
            // (ArrayType `array<integer>`) while expectedType is the bare name.
            const allCompatible = finalTypes.every(ft => {
              const base = singleTypeToBase(ft);
              return base === UcodeType.NULL || expectedTypes.includes(base);
            });
            if (allCompatible) {
              return false;
            }
          }
        }
      }

      return true; // Keep all other diagnostics
    });
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
