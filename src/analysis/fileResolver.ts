import { UcodeLexer } from '../lexer';
import { detectTemplateModeForFile, bridgeTemplateTokens } from '../lexer/templateMode';
import { UcodeParser } from '../parser';
import { type FunctionDeclarationNode, type FunctionExpressionNode, type ArrowFunctionExpressionNode, type AstNode, type ExportNamedDeclarationNode, type IdentifierNode, type ObjectExpressionNode, type PropertyNode } from '../ast/nodes';
import { forEachAstChild, walkAst } from '../ast/astChildren';
import { discoverAvailableModules, getModuleMembers } from '../moduleDiscovery';
import { UcodeType, type UcodeDataType, type SingleType, createUnionType, isUnionType, isObjectType, isArrayType, typeToString, widenWithNull, type ParamInfo } from './symbolTable';
import { parseJsDocComment, resolveTypeExpression } from './jsdocParser';
import { inferNullGuardParams } from './nullGuardContract';
import { getOpenDocumentContent } from './openDocuments';
import { resolveLuciTemplatePath, resolveLuciModulePath } from './luciEnv';
import { MAX_ANALYSIS_DEPTH } from './visitor';
import * as path from 'path';
import * as fs from 'fs';

export interface FunctionDefinition {
    name: string;
    node: AstNode;
    start: number;
    end: number;
    /** Whether the located declaration is a function or a top-level variable.
     *  Go-to-definition wants either; hover signatures want only functions. */
    kind: 'function' | 'variable';
}

export interface ModuleExport {
    name: string;
    type: 'default' | 'named';
    isFunction: boolean;
    exportedName?: string; // Original identifier name for default exports (e.g., 'create_validators')
}

/** A global a file injects into its caller's scope via `loadfile(path)()` — its name,
 *  the loaded file's URI, the definition's offset range there (for go-to-definition),
 *  and a coarse RHS type (for hover). */
export interface LoadfileGlobal {
    name: string;
    uri: string;
    defStart: number;
    defEnd: number;
    typeStr: string;
    /** For an object-valued global (`global.X = { … }`), the literal's member types and
     *  each method's return-type string — so a member access on the injected global
     *  (`X.docroot`, `X.send()`) resolves cross-file, not just the bare name. */
    propertyTypes?: Map<string, UcodeDataType>;
    propertyReturnTypes?: Map<string, string>;
}

/** The inferred type of `loadfile(path)()` — the loaded program's top-level return
 *  value. For an object-literal return, carries the member shape like LoadfileGlobal. */
export interface LoadfileProgramReturn {
    dataType: UcodeDataType;
    propertyTypes?: Map<string, UcodeDataType>;
    propertyFunctionReturnTypes?: Map<string, string>;
}

/** Return-shape info for a factory function (one that returns an object literal).
 *  `propertyDefinitionLocations` carries each member's source offsets, which are
 *  file-LOCAL — the consumer stamps the factory file URI. */
export interface FactoryReturnInfo {
    returnType: UcodeDataType;
    returnPropertyTypes: Map<string, UcodeDataType>;
    propertyFunctionReturnTypes?: Map<string, string>;
    propertyDefinitionLocations?: Map<string, { start: number; end: number }>;
}

/** A property's key the way the object-shape walks read it: an Identifier key's
 *  name, a Literal key's value (string/number/boolean/null), undefined otherwise. */
function propertyKeyValue(prop: PropertyNode): string | number | boolean | null | undefined {
    if (prop.key.type === 'Identifier') return prop.key.name;
    if (prop.key.type === 'Literal') return prop.key.value;
    return undefined;
}

/** Function-like node kinds (the only ones carrying params/body/leadingJsDoc). */
type FunctionLikeNode = FunctionDeclarationNode | FunctionExpressionNode | ArrowFunctionExpressionNode;

function asFunctionLike(node: AstNode): FunctionLikeNode | null {
    return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'
        ? node : null;
}

export class FileResolver {
    private workspaceRoot: string;
    // Caches keyed by file URI, tagged with the file's content so a changed file
    // is re-parsed. Content (not mtime) is the validator: mtime can collide on
    // coarse-resolution filesystems or when a tool restores timestamps, which
    // would serve a stale parse. Reading the file is cheap; the win is skipping
    // the lex+parse when the content is unchanged.
    private fileCache = new Map<string, { content: string; defs: FunctionDefinition[] }>();
    private exportCache = new Map<string, { content: string; exports: ModuleExport[] }>();
    // Parsed-AST cache, content-keyed. The export/return-info resolvers below used
    // to re-lex+re-parse the file on EVERY call; cross-file reference search calls
    // several of them per function, so a CodeLens pass re-parsed the same file
    // O(functions × exports) times and stalled the single-threaded server. Caching
    // the parse collapses that to one parse per (file, content).
    private astCache = new Map<string, { content: string; ast: AstNode | null }>();

    /** Lex+parse `source` for `fileUri`, reusing a cached AST when the content is
     *  unchanged. Returns the Program AST or null on parse failure. */
    private getCachedAst(fileUri: string, source: string): AstNode | null {
        const cached = this.astCache.get(fileUri);
        if (cached && cached.content === source) return cached.ast;
        try {
            // Template files (`{% %}`, or any .ut — utpl may be pure HTML with no tag) must
            // lex in template mode with the framing tokens bridged — raw mode would misparse
            // every include()-able template (fw4's templates/, LuCI .ut files) as a
            // syntax-error soup.
            const isTemplate = detectTemplateModeForFile(fileUri, source);
            const lexer = new UcodeLexer(source, { rawMode: !isTemplate });
            const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            parser.setComments(lexer.comments);
            const ast = parser.parse().ast ?? null;
            this.astCache.set(fileUri, { content: source, ast });
            return ast;
        } catch {
            return null;
        }
    }

    /** Public buffer-or-disk read (prefers the open editor buffer) for callers
     *  that need the same content FileResolver parses — e.g. offset→position
     *  conversion in go-to-definition. */
    getFileContent(fileUri: string): string | null {
        return this.readFileContent(fileUri);
    }

    // Content-keyed cache of whether a module's PARSE produced syntax errors, so an
    // importer can distinguish "the dependency is broken" from "the dependency
    // genuinely lacks this export". Re-parses only when the file content changes.
    private parseErrorCache = new Map<string, { content: string; hadErrors: boolean }>();

    /** True when parsing `fileUri` yields syntax errors. The error-tolerant parser
     *  still returns a partial AST for a broken file, so its export list is
     *  unreliable — callers use this to report the parse failure instead of a
     *  misleading per-name "does not export" error. Builtin/unreadable files → false. */
    moduleHasParseErrors(fileUri: string): boolean {
        try {
            if (fileUri.startsWith('builtin://')) return false;
            const content = this.readFileContent(fileUri);
            if (content === null) return false;
            const cached = this.parseErrorCache.get(fileUri);
            if (cached && cached.content === content) return cached.hadErrors;
            // Same template-mode handling as getCachedAst — a healthy template is not
            // a pile of syntax errors.
            const isTemplate = detectTemplateModeForFile(fileUri, content);
            const lexer = new UcodeLexer(content, { rawMode: !isTemplate });
            const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const result = parser.parse();
            const hadErrors = Array.isArray(result.errors) && result.errors.length > 0;
            this.parseErrorCache.set(fileUri, { content, hadErrors });
            return hadErrors;
        } catch {
            return false;
        }
    }

    /** The file:// URIs this file imports from (resolved import edges). */
    private getFileImportEdges(fileUri: string): string[] {
        try {
            const content = this.readFileContent(fileUri);
            if (content === null) return [];
            const ast = this.getCachedAst(fileUri, content);
            if (ast?.type !== 'Program') return [];
            const edges: string[] = [];
            for (const stmt of ast.body) {
                if (stmt.type !== 'ImportDeclaration') continue;
                const rawSrc = stmt.source.value;
                if (typeof rawSrc !== 'string') continue;
                const src = rawSrc.replace(/^['"]|['"]$/g, '');
                const resolved = this.resolveImportPath(src, fileUri);
                if (resolved && resolved.startsWith('file://')) edges.push(resolved);
            }
            return edges;
        } catch {
            return [];
        }
    }

    /** If the import edge `fromUri` → `targetUri` participates in a cycle — i.e. the
     *  import graph reachable from `targetUri` leads back to `fromUri` — return the
     *  cycle as a URI path `[fromUri, targetUri, …, fromUri]`; otherwise null. The
     *  visited set makes the walk terminate on a DAG (a diamond re-converges but has
     *  no back-edge, so no cycle is reported) and guards against infinite recursion.
     *  Self-imports (`targetUri === fromUri`) are handled by the caller separately. */
    findImportCycle(fromUri: string, targetUri: string): string[] | null {
        if (targetUri === fromUri) return null; // self-import: caller's concern
        const visited = new Set<string>();
        const stack: string[] = [];
        const dfs = (uri: string): boolean => {
            if (uri === fromUri) return true; // closed the loop back to the importer
            if (visited.has(uri)) return false;
            visited.add(uri);
            stack.push(uri);
            for (const dep of this.getFileImportEdges(uri)) {
                if (dfs(dep)) return true;
            }
            stack.pop();
            return false;
        };
        return dfs(targetUri) ? [fromUri, ...stack, fromUri] : null;
    }

    /**
     * Names a file injects into its CALLER's global scope when run via `loadfile(path)()`
     * (the poor-man's-import idiom) — `rawPath` is resolved relative to `currentFileUri`'s
     * directory (how the corpus uses it). Returns the file's TOP-LEVEL `global.X = …`
     * property names plus top-level bare implicit-global assignments (`X = …`, non-strict).
     * Verified vs the interpreter: function declarations and let/const do NOT leak, and only
     * top-level code runs on `loadfile()()` — so nested-function assignments are excluded.
     * Empty when the path is unresolvable or the file can't be parsed (→ no suppression).
     *
     * Each entry carries the target file `uri`, the definition's offset range (the `X` in
     * `global.X` / the bare LHS identifier) for go-to-definition, and a coarse RHS type
     * (`function`/`integer`/`string`/…) for hover.
     */
    getLoadfileGlobals(rawPath: string, currentFileUri: string): LoadfileGlobal[] {
        const curPath = this.uriToFilePath(currentFileUri);
        if (!curPath) return [];
        const targetPath = rawPath.startsWith('/')
            ? path.normalize(rawPath)
            : path.normalize(path.join(path.dirname(curPath), rawPath));
        const targetUri = this.filePathToUri(targetPath);
        const content = this.readFileContent(targetUri);
        if (content === null) return [];
        const ast = this.getCachedAst(targetUri, content);
        if (ast?.type !== 'Program') return [];

        // Top-level declared names (let/const/function) — these are local to the loaded
        // program and must NOT count as injected implicit globals.
        const declared = new Set<string>();
        for (const stmt of ast.body) {
            if (stmt.type === 'FunctionDeclaration' && stmt.id.name) declared.add(stmt.id.name);
            if (stmt.type === 'VariableDeclaration') {
                for (const d of stmt.declarations) {
                    if (d.id.name) declared.add(d.id.name);
                }
            }
        }

        const coarseType = (rhs: AstNode): string => {
            switch (rhs.type) {
                case 'FunctionExpression':
                case 'ArrowFunctionExpression': return 'function';
                case 'ObjectExpression': return 'object';
                case 'ArrayExpression': return 'array';
                case 'Literal': {
                    const v = rhs.value;
                    if (typeof v === 'string') return 'string';
                    if (typeof v === 'boolean') return 'bool';
                    if (v === null) return 'null';
                    // Exponent notation (`1e5`) is a double literal (ticket 115).
                    if (typeof v === 'number') return (rhs.literalType === 'double' || !Number.isInteger(v)) ? 'double' : 'integer';
                    return 'unknown';
                }
                default: return 'unknown';
            }
        };

        const out: LoadfileGlobal[] = [];
        const seen = new Set<string>();
        const add = (name: string, defNode: AstNode, rhs: AstNode) => {
            if (!name || seen.has(name)) return;
            seen.add(name);
            const entry: LoadfileGlobal = {
                name, uri: targetUri,
                defStart: defNode.start,
                defEnd: defNode.end,
                typeStr: coarseType(rhs),
            };
            // Carry the object shape so a member access on the injected global resolves
            // cross-file (mirrors the in-file `global.X = { … }` property inference).
            if (rhs.type === 'ObjectExpression') {
                const propTypes = this.inferObjectLiteralPropertyTypesShallow(rhs);
                if (propTypes.size > 0) entry.propertyTypes = propTypes;
                const fnReturns = new Map<string, string>();
                for (const prop of rhs.properties) {
                    if (prop.type !== 'Property') continue;
                    const key = propertyKeyValue(prop);
                    const val = prop.value;
                    if (typeof key !== 'string' && typeof key !== 'number') continue;
                    if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                        const ret = this.functionReturnTypeString(val);
                        if (ret) fnReturns.set(String(key), ret);
                    }
                }
                if (fnReturns.size > 0) entry.propertyReturnTypes = fnReturns;
            }
            out.push(entry);
        };
        for (const stmt of ast.body) {
            const expr = stmt.type === 'ExpressionStatement' ? stmt.expression : null;
            if (!expr || expr.type !== 'AssignmentExpression' || expr.operator !== '=') continue;
            const left = expr.left;
            if (left.type === 'MemberExpression'
                && left.object.type === 'Identifier' && left.object.name === 'global') {
                // global.X = …  (explicit global property) — def range is the `X` property node
                if (!left.computed && left.property.type === 'Identifier' && left.property.name) {
                    add(left.property.name, left.property, expr.right);
                } else if (left.computed && left.property.type === 'Literal' && typeof left.property.value === 'string') {
                    add(left.property.value, left.property, expr.right);
                }
            } else if (left.type === 'Identifier' && left.name && !declared.has(left.name)) {
                // bare implicit-global assignment X = … (non-strict) — def range is the identifier
                add(left.name, left, expr.right);
            }
        }
        return out;
    }

    /**
     * Resolve an `include(<path>)` target to a file URI, or null if it can't be found.
     * Runtime `include()` resolves relative paths against the including file's directory and
     * uses absolute paths verbatim. On a dev box the corpus's absolute runtime paths
     * (`/usr/lib/uvol/uci.uc`) won't exist, so an absent absolute path falls back to a
     * caller-adjacent lookup (`dirname(includer)/basename(path)`), which resolves the corpus
     * layout where the includer sits beside the included file. See docs/include-scope-resolution.md.
     */
    private resolveIncludePath(rawPath: string, currentFileUri: string): string | null {
        const curPath = this.uriToFilePath(currentFileUri);
        if (!curPath) return null;
        // LuCI template/controller context: `include` there IS the runtime's render_any
        // (runtime.uc: `env.include = (...args) => render_any(...args)`), which resolves the
        // name against the merged template DIRECTORY with `.ut` appended — not against this
        // file. Checked first because in that context file-relative resolution never happens;
        // resolveLuciTemplatePath returns null for non-LuCI files, so nothing else changes.
        const luciTemplate = resolveLuciTemplatePath(curPath, rawPath);
        if (luciTemplate) return this.filePathToUri(luciTemplate);
        const dir = path.dirname(curPath);
        const candidates: string[] = [];
        if (rawPath.startsWith('/')) {
            candidates.push(path.normalize(rawPath));
            candidates.push(path.normalize(path.join(dir, path.basename(rawPath))));
        } else {
            candidates.push(path.normalize(path.join(dir, rawPath)));
        }
        for (const cand of candidates) {
            try {
                const uri = this.filePathToUri(cand);
                // Accept when a live buffer or the disk has it.
                if (getOpenDocumentContent(uri) !== undefined || fs.existsSync(cand)) return uri;
            } catch { /* try next candidate */ }
        }
        return null;
    }

    /**
     * Names that `include(rawPath)` leaks into the INCLUDING file's global scope. Verified vs
     * the interpreter (docs/include-scope-resolution.md): `include()` evaluates the target in a
     * shared scope, and ONLY the child's TOP-LEVEL implicit globals become visible in the caller
     * — a bare assignment `foo = …` (and an explicit `global.foo = …`). Child `let`/`const`/
     * `function` declarations stay child-locals and do NOT leak. The 2-arg `include(path, scope)`
     * form does NOT sandbox those leaks (the scope arg only feeds names TO the child). Follows a
     * child's own top-level `include()`s transitively, with a cycle/self-include guard and a
     * depth cap. Empty when the path is unresolvable or the file can't be parsed (→ no suppression,
     * no false diagnostics).
     */
    /** Resolvability/health of the DIRECT include() target (transitive children are
     *  best-effort and stay silent): 'not-found' when no candidate file exists in the
     *  workspace, 'parse-error' when it exists but has syntax errors (its leaked-global
     *  list is unreliable), 'ok' otherwise. */
    /** Public include-target resolution (file URI or null) — for document links /
     *  go-to-definition on the `include('…')` path argument. Same semantics as the
     *  internal resolver: LuCI template roots first, then file-relative. */
    resolveIncludeTarget(rawPath: string, currentFileUri: string): string | null {
        return this.resolveIncludePath(rawPath, currentFileUri);
    }

    /**
     * Offset span of `member`'s definition id in `fileUri`, AST-based: the first
     * object-literal property `member: …` / shorthand, or a `function member(...)`
     * declaration. Serves go-to-definition for runtime objects implemented in plain
     * ucode (LuCI's http.uc prototype methods, dispatcher.uc's helper functions).
     */
    findMemberDefinitionLocation(fileUri: string, member: string): { start: number; end: number } | null {
        const content = this.readFileContent(fileUri);
        if (content === null) return null;
        const ast = this.getCachedAst(fileUri, content);
        if (!ast) return null;
        let found: { start: number; end: number } | null = null;
        walkAst(ast, (node) => {
            if (found) return false;
            if (node.type === 'FunctionDeclaration') {
                const id = node.id;
                if (id.name === member) {
                    found = { start: id.start, end: id.end };
                    return false;
                }
            }
            if (node.type === 'Property' && !node.computed) {
                const key = node.key;
                const keyName = key.type === 'Identifier' ? key.name
                    : key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
                if (keyName === member) {
                    found = { start: key.start, end: key.end };
                    return false;
                }
            }
            return undefined;
        });
        return found;
    }

    getIncludeTargetStatus(rawPath: string, currentFileUri: string): 'ok' | 'not-found' | 'parse-error' {
        const targetUri = this.resolveIncludePath(rawPath, currentFileUri);
        if (!targetUri) return 'not-found';
        if (this.moduleHasParseErrors(targetUri)) return 'parse-error';
        return 'ok';
    }

    getIncludeGlobals(rawPath: string, currentFileUri: string): string[] {
        const out = new Set<string>();
        const visited = new Set<string>([currentFileUri]);
        const collect = (fromUri: string, includePath: string, depth: number): void => {
            if (depth > MAX_ANALYSIS_DEPTH) return;
            const targetUri = this.resolveIncludePath(includePath, fromUri);
            if (!targetUri || visited.has(targetUri)) return; // unresolvable or cycle → skip
            visited.add(targetUri);
            const content = this.readFileContent(targetUri);
            if (content === null) return;
            const ast = this.getCachedAst(targetUri, content);
            if (ast?.type !== 'Program') return;

            // Top-level declared names (let/const/function) are child-locals — they must NOT
            // count as leaked implicit globals.
            const declared = new Set<string>();
            for (const stmt of ast.body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) declared.add(stmt.id.name);
                if (stmt.type === 'VariableDeclaration') {
                    for (const d of stmt.declarations) {
                        if (d.id.name) declared.add(d.id.name);
                    }
                }
            }
            for (const stmt of ast.body) {
                const expr = stmt.type === 'ExpressionStatement' ? stmt.expression : null;
                if (expr?.type === 'AssignmentExpression' && expr.operator === '=') {
                    const left = expr.left;
                    if (left.type === 'Identifier' && left.name && !declared.has(left.name)) {
                        out.add(left.name); // bare implicit-global assignment X = …
                    } else if (left.type === 'MemberExpression' && !left.computed
                               && left.object.type === 'Identifier' && left.object.name === 'global'
                               && left.property.type === 'Identifier' && left.property.name) {
                        out.add(left.property.name); // explicit global.X = …
                    } else if (left.type === 'MemberExpression' && left.computed
                               && left.object.type === 'Identifier' && left.object.name === 'global'
                               && left.property.type === 'Literal' && typeof left.property.value === 'string') {
                        out.add(left.property.value);
                    }
                } else if (expr?.type === 'CallExpression'
                           && expr.callee.type === 'Identifier' && expr.callee.name === 'include') {
                    const arg0 = expr.arguments[0];
                    if (arg0?.type === 'Literal' && typeof arg0.value === 'string') {
                        // A child's own top-level include leaks into the child's scope, hence ours.
                        collect(targetUri, arg0.value, depth + 1);
                    }
                }
            }
        };
        collect(currentFileUri, rawPath, 0);
        return [...out];
    }

    /**
     * The type of `loadfile(rawPath)()` — the loaded program's return value. Verified vs
     * the interpreter: the first explicit top-level `return <expr>` wins; otherwise the
     * program's value is its LAST top-level statement when that is a bare expression
     * statement (REPL-style implicit result); otherwise null. A `return M` of a top-level
     * binding traces ONE hop to M's initializer (`let M = {…}; return M;` — the common
     * module pattern). `rawPath` resolves relative to the caller's directory (the shared
     * LSP convention from getLoadfileGlobals; the runtime actually resolves loadfile()
     * against the process CWD, which the LSP cannot know — the corpus loads by absolute
     * or caller-adjacent paths, where the two agree).
     * Returns null when the path/parse fails or the returned expression's type can't be
     * claimed confidently (→ caller stays `unknown`).
     */
    getLoadfileProgramReturn(rawPath: string, currentFileUri: string): LoadfileProgramReturn | null {
        const curPath = this.uriToFilePath(currentFileUri);
        if (!curPath) return null;
        const targetPath = rawPath.startsWith('/')
            ? path.normalize(rawPath)
            : path.normalize(path.join(path.dirname(curPath), rawPath));
        const targetUri = this.filePathToUri(targetPath);
        const content = this.readFileContent(targetUri);
        if (content === null) return null;
        const ast = this.getCachedAst(targetUri, content);
        if (ast?.type !== 'Program') return null;
        return this.topLevelReturnShape(ast.body);
    }

    /**
     * Shared with `getRequireModuleShape`: given a program's top-level statement
     * list, the value the runtime hands back when that program is run as a module
     * (loadfile()() result, or a `require()`d file with no `export` statements at
     * all — lib.c's uc_require_library runs the compiled program and returns
     * whatever it top-level `return`s; `export` syntax is sugar for building that
     * same value).
     */
    private topLevelReturnShape(body: AstNode[]): LoadfileProgramReturn | null {
        // The returned expression: first explicit top-level return, else a trailing bare
        // expression statement (undefined = "no explicit return found yet").
        let retNode: AstNode | null | undefined = undefined;
        for (const stmt of body) {
            if (stmt.type === 'ReturnStatement') { retNode = stmt.argument ?? null; break; }
        }
        if (retNode === undefined) {
            const last = body[body.length - 1];
            retNode = last?.type === 'ExpressionStatement' ? last.expression : null;
        }
        if (retNode === null) return { dataType: UcodeType.NULL as UcodeDataType };

        // `return M;` — one-hop trace to M's last top-level initializer/assignment.
        if (retNode.type === 'Identifier') {
            const target = retNode.name;
            let traced: AstNode | undefined;
            for (const stmt of body) {
                if (stmt.type === 'VariableDeclaration') {
                    for (const d of stmt.declarations) {
                        if (d.id.name === target && d.init) traced = d.init;
                    }
                } else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression'
                           && stmt.expression.operator === '='
                           && stmt.expression.left.type === 'Identifier' && stmt.expression.left.name === target) {
                    traced = stmt.expression.right;
                }
            }
            if (traced) retNode = traced;
        }

        switch (retNode.type) {
            case 'ObjectExpression': {
                const out: LoadfileProgramReturn = { dataType: UcodeType.OBJECT as UcodeDataType };
                const propTypes = this.inferObjectLiteralPropertyTypesShallow(retNode);
                if (propTypes.size > 0) out.propertyTypes = propTypes;
                const fnReturns = new Map<string, string>();
                for (const prop of retNode.properties) {
                    if (prop.type !== 'Property') continue;
                    const key = propertyKeyValue(prop);
                    const val = prop.value;
                    if (typeof key !== 'string' && typeof key !== 'number') continue;
                    if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                        const ret = this.functionReturnTypeString(val);
                        if (ret) fnReturns.set(String(key), ret);
                    }
                }
                if (fnReturns.size > 0) out.propertyFunctionReturnTypes = fnReturns;
                return out;
            }
            case 'ArrayExpression':
                return { dataType: UcodeType.ARRAY as UcodeDataType };
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                return { dataType: UcodeType.FUNCTION as UcodeDataType };
            case 'Literal': {
                if (retNode.literalType === 'regexp') return { dataType: UcodeType.REGEX as UcodeDataType };
                const v = retNode.value;
                if (typeof v === 'string') return { dataType: UcodeType.STRING as UcodeDataType };
                if (typeof v === 'boolean') return { dataType: UcodeType.BOOLEAN as UcodeDataType };
                if (v === null) return { dataType: UcodeType.NULL as UcodeDataType };
                if (typeof v === 'number') {
                    // Exponent notation (`1e5`) is a double literal (ticket 115).
                    return { dataType: ((retNode.literalType === 'double' || !Number.isInteger(v)) ? UcodeType.DOUBLE : UcodeType.INTEGER) as UcodeDataType };
                }
                return null;
            }
            default:
                return null; // can't claim a type — caller stays unknown
        }
    }

    /**
     * Whether `resolvedUri`'s default export (or, for a "legacy" no-`export`-statements
     * module, its implicit top-level-return value) is a FUNCTION — i.e. whether
     * `require("<module>")` itself yields something callable, so the caller should use
     * the factory-return machinery (`getDefaultExportFunctionReturnInfo` /
     * `getDefaultExportFunctionParameters`, exactly like an ES6 default-import of a
     * factory) rather than `getRequireModuleShape`'s object-shape info.
     * docs/tc-require-user-module-typing.md
     */
    requireModuleIsFunction(resolvedUri: string): boolean {
        try {
            const exports = this.getModuleExports(resolvedUri);
            if (exports && exports.length > 0) {
                return exports.find(e => e.type === 'default')?.isFunction === true;
            }
            const filePath = this.uriToFilePath(resolvedUri);
            if (!filePath || !fs.existsSync(filePath)) return false;
            const source = getOpenDocumentContent(resolvedUri) ?? fs.readFileSync(filePath, 'utf-8');
            const ast = this.getCachedAst(resolvedUri, source);
            if (ast?.type !== 'Program') return false;
            return this.topLevelReturnShape(ast.body)?.dataType === UcodeType.FUNCTION;
        } catch {
            return false;
        }
    }

    /**
     * The OBJECT shape `require("<workspace module>")` resolves to — mirrors `import x
     * from '<module>'`'s default-export-object semantics, but ALSO covers ucode's
     * legacy "no `export` statements at all, just a bare top-level `return {...}`"
     * module shape (verified in lib.c uc_require_library: require() runs the compiled
     * program and returns whatever it top-level `return`s — `export` syntax is sugar
     * for building that same value, so a file with zero export declarations and a bare
     * `return {...}` is exactly as "default export"-shaped as `export default {...}`;
     * firewall4's fw4.uc is exactly this shape). Callers must check
     * `requireModuleIsFunction` FIRST — when the default export is itself a factory
     * function, `require()`'s value is that function, not its (eventual) return shape,
     * and the factory machinery below is the wrong shape for it. `resolvedUri` must
     * already be resolved (via `resolveImportPath`) and is NOT a builtin — callers gate
     * that separately. Returns null when nothing can be claimed (caller keeps
     * `unknown`). docs/tc-require-user-module-typing.md
     */
    getRequireModuleShape(resolvedUri: string): LoadfileProgramReturn | null {
        try {
            const exports = this.getModuleExports(resolvedUri);
            if (exports && exports.length > 0) {
                const defaultExport = exports.find(e => e.type === 'default');
                if (!defaultExport || defaultExport.isFunction) return null; // handled by requireModuleIsFunction path
                const propInfo = this.getDefaultExportPropertyTypes(resolvedUri);
                if (propInfo) {
                    const out: LoadfileProgramReturn = { dataType: UcodeType.OBJECT as UcodeDataType, propertyTypes: propInfo.propertyTypes };
                    if (propInfo.functionReturnTypes && propInfo.functionReturnTypes.size > 0) {
                        const pfrt = new Map<string, string>();
                        for (const [k, v] of propInfo.functionReturnTypes) pfrt.set(k, typeof v === 'string' ? v : 'unknown');
                        if (pfrt.size > 0) out.propertyFunctionReturnTypes = pfrt;
                    }
                    return out;
                }
                return { dataType: UcodeType.OBJECT as UcodeDataType };
            }

            // No export syntax at all — legacy require()-only module: the value is
            // whatever the top-level program returns.
            const filePath = this.uriToFilePath(resolvedUri);
            if (!filePath || !fs.existsSync(filePath)) return null;
            const source = getOpenDocumentContent(resolvedUri) ?? fs.readFileSync(filePath, 'utf-8');
            const ast = this.getCachedAst(resolvedUri, source);
            if (ast?.type !== 'Program') return null;
            return this.topLevelReturnShape(ast.body);
        } catch {
            return null;
        }
    }

    /**
     * Content of the file behind a URI, or null if unavailable. Prefers the live
     * editor buffer (so unsaved cross-file edits are seen) and falls back to disk.
     */
    private readFileContent(fileUri: string): string | null {
        const open = getOpenDocumentContent(fileUri);
        if (open !== undefined) return open;
        try {
            const fp = this.uriToFilePath(fileUri);
            if (!fp || !fs.existsSync(fp)) return null;
            return fs.readFileSync(fp, 'utf8');
        } catch {
            return null;
        }
    }

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
    }

    /**
     * Check if a module is a builtin module
     */
    isBuiltinModule(modulePath: string): boolean {
        const availableModules = discoverAvailableModules();
        return availableModules.some(module => module.name === modulePath && module.source === 'builtin');
    }

    /**
     * Does `require("name")` resolve to a FILE on ucode's default REQUIRE_SEARCH_PATH — a
     * `name.uc`/`name.so` (dotted → `a/b.uc`) under `{/usr/local,/usr}/{lib,share}/ucode` or the
     * requiring file's own directory (the `./*` entries)? Builtin C modules are handled by the
     * caller (version-aware, via VERSION_MODULES) since their availability varies by OpenWrt
     * release; this method covers only on-disk modules.
     */
    requireResolvesFile(name: string, currentFileUri: string): boolean {
        // LuCI checkout mapping (same as resolveImportPath): luci.<rest> → package ucode/ dirs.
        const cur = this.uriToFilePath(currentFileUri);
        if (cur && resolveLuciModulePath(cur, name)) return true;
        const rel = name.replace(/\./g, '/'); // dotted module → subdirectory path
        // Per REQUIRE_SEARCH_PATH each install root pairs with ONE extension: `lib/ucode` is
        // `*.so`-only, `share/ucode` is `*.uc`-only (verified on-device). Only the requiring file's
        // own directory (the `./*` templates) resolves BOTH `.uc` and `.so`.
        const roots: Array<[string, string[]]> = [
            ['/usr/local/lib/ucode', ['.so']], ['/usr/local/share/ucode', ['.uc']],
            ['/usr/lib/ucode', ['.so']], ['/usr/share/ucode', ['.uc']],
        ];
        if (cur) roots.push([path.dirname(cur), ['.uc', '.so']]);
        for (const [d, exts] of roots) {
            for (const ext of exts) {
                try { if (this.isImportableFile(path.join(d, rel + ext))) return true; } catch { /* skip */ }
            }
        }
        return false;
    }

    /**
     * Does a `loadfile()`/`render()` PATH argument point at an existing file? Absolute paths are
     * checked directly; any relative path (`./x`, `../x`, or a bare `files/x.uc`) is resolved
     * against the current file's directory. Unlike resolveImportPath this doesn't require a `./`
     * prefix and doesn't consult builtins/search paths — it's purely "does this file exist".
     */
    filePathResolves(p: string, currentFileUri: string): boolean {
        let full: string;
        if (p.startsWith('/')) {
            full = p;
        } else {
            const cur = this.uriToFilePath(currentFileUri);
            if (!cur) return false;
            full = path.resolve(path.dirname(cur), p);
        }
        try { return fs.existsSync(full); } catch { return false; }
    }

    /**
     * A resolution target that exists AND is a regular file (statSync follows symlinks, so a
     * symlink to a file still counts). Guards every `resolveImportPath` candidate: a bare
     * `fs.existsSync` also accepts DIRECTORIES, so `import "/usr/share/foo"` where the mirrored
     * path is a directory would otherwise resolve to that directory — suppressing UC3002 and
     * handing an unreadable path to every downstream consumer. Import targets are always files.
     */
    private isImportableFile(p: string): boolean {
        try { return fs.statSync(p).isFile(); } catch { return false; }
    }

    /**
     * Resolve a relative import path to an absolute file path
     */
    resolveImportPath(importPath: string, currentFileUri: string): string | null {
        try {
            // Check if it's a builtin module first - this takes priority
            if (this.isBuiltinModule(importPath)) {
                // Return a special URI to indicate this is a builtin module
                return `builtin://${importPath}`;
            }

            // Convert URI to file path
            const currentFilePath = this.uriToFilePath(currentFileUri);
            if (!currentFilePath) return null;

            const currentDir = path.dirname(currentFilePath);
            
            // Handle relative imports. ucode resolves these STRICTLY against the
            // importing file's directory, with the extension exactly as written —
            // it does NOT auto-append `.uc` (finding #70) and there is NO
            // workspace-root fallback (finding #71). A path that doesn't exist there
            // is unresolved (→ UC3002), matching the interpreter ("Unable to resolve
            // path for module './x'").
            //
            // ANY source containing a `/` is a path, not a module name: ucode's
            // uc_compiler_resolve_module_path canonicalizes every name containing '/'
            // relative to the importing file (compiler.c:3625 → canonicalize_path),
            // so `./x`, `../x` AND a bare `foo/bar.uc` are all importer-relative.
            // (A leading '/' is absolute — handled just below.)
            if (importPath.startsWith('./') || importPath.startsWith('../') ||
                (importPath.includes('/') && !importPath.startsWith('/'))) {
                const resolvedPath = path.resolve(currentDir, importPath);
                if (this.isImportableFile(resolvedPath)) {
                    return this.filePathToUri(resolvedPath);
                }
                return null;
            }

            // Handle absolute paths. A leading `/` is a real filesystem path in
            // ucode (finding #72), so check it on disk FIRST. Only if that doesn't
            // exist do we fall back to interpreting it as workspace-root-relative —
            // a dev convenience for runtime paths (e.g. /usr/share/ucode/…) mirrored
            // into the workspace.
            if (importPath.startsWith('/')) {
                if (this.isImportableFile(importPath)) {
                    return this.filePathToUri(importPath);
                }
                const workspaceRel = path.resolve(this.workspaceRoot, importPath.substring(1));
                if (this.isImportableFile(workspaceRel)) {
                    return this.filePathToUri(workspaceRel);
                }
                // Package deploy-root mapping (tc-module-search-roots-deploy-layout.md
                // tier 1): an OpenWrt package's payload tree (`files/` or `root/`, the
                // convention both wifi-scripts and firewall4 use) mirrors the filesystem
                // root once installed, so an absolute import written against the DEPLOYED
                // path (`/usr/share/hostap/common.uc`) resolves inside the SAME package at
                // `<ancestor>/usr/share/hostap/common.uc` when `<ancestor>` is named `files`
                // or `root`. Same-package only (no cross-package guessing) and sound — it
                // only ever returns a path that exists on disk.
                let dir = currentDir;
                while (true) {
                    const base = path.basename(dir);
                    if (base === 'files' || base === 'root') {
                        const candidate = path.resolve(dir, importPath.substring(1));
                        if (this.isImportableFile(candidate)) {
                            return this.filePathToUri(candidate);
                        }
                    }
                    const parent = path.dirname(dir);
                    if (parent === dir) break;
                    if (dir === this.workspaceRoot) break;
                    dir = parent;
                }
                return null;
            }

            // Handle bare module names — resolve relative to importing file's directory
            // ucode runtime searches the importing file's directory for bare names
            if (!importPath.includes('/') && !importPath.startsWith('.') && !importPath.includes('.')) {
                const localPath = path.resolve(currentDir, importPath + '.uc');
                if (this.isImportableFile(localPath)) {
                    return this.filePathToUri(localPath);
                }
                // Also try exact name (no extension)
                const exactPath = path.resolve(currentDir, importPath);
                if (this.isImportableFile(exactPath)) {
                    return this.filePathToUri(exactPath);
                }
            }

            // Handle dotted module paths (e.g., 'cli.utils', 'u1905.u1905d.src.u1905.log')
            if (!importPath.includes('/') && !importPath.startsWith('.')) {
                // LuCI checkout mapping: `luci.<rest>` lives at /usr/share/ucode/luci/<rest>.uc
                // on-device, a directory assembled from every LuCI package's `ucode/` dir — so in
                // a checkout the import resolves against those dirs (luci-base first). Returns
                // null outside a LuCI tree, so nothing else changes.
                const luciModule = resolveLuciModulePath(currentFilePath, importPath);
                if (luciModule) return this.filePathToUri(luciModule);
                const dottedPath = importPath.replace(/\./g, '/') + '.uc';
                const resolvedPath = path.resolve(this.workspaceRoot, dottedPath);
                if (this.isImportableFile(resolvedPath)) {
                    return this.filePathToUri(resolvedPath);
                }
                // Importer-relative: faithful to ucode's default `./*.uc` search-path
                // template, which the compiler expands relative to the IMPORTING file's
                // directory (compiler.c uc_compiler_canonicalize_path; verified vs the
                // interpreter: `cli.utils` resolves to <importer-dir>/cli/utils.uc).
                const localDottedPath = path.resolve(currentDir, dottedPath);
                if (this.isImportableFile(localDottedPath)) {
                    return this.filePathToUri(localDottedPath);
                }
                // ucode's other default templates are absolute install roots
                // (<prefix>/share/ucode/*.uc, <prefix>/lib/ucode/*.so). A package
                // SOURCE tree mirrors that layout under the checkout
                // (…/files/usr/share/ucode/cli/modules/network.uc importing
                // "cli.utils" → …/files/usr/share/ucode/cli/utils.uc), so treat an
                // ANCESTOR directory ending in share/ucode or lib/ucode as the
                // mirrored install root — nearest first, never escaping the workspace
                // when the importer is inside it (for a file outside any workspace the
                // walk is bounded only by the filesystem root). Deliberately NOT any
                // ancestor: the runtime only searches configured roots, so a generic
                // ancestor walk could resolve imports that fail on-device.
                // (docs/dotted-module-search-root.md)
                // Only `share/ucode` mirrors a `.uc` search root. `lib/ucode` is `*.so`-ONLY on
                // ucode's REQUIRE_SEARCH_PATH (verified on-device: a `.uc` under /usr/lib/ucode is
                // NOT found by require/import), so a `.uc` dotted name must never resolve there.
                const isSearchRootMirror = (d: string): boolean =>
                    d.endsWith(`${path.sep}share${path.sep}ucode`);
                // docs/tc-module-root-mapping.md: a package deploy root (`root/` or `files/`,
                // same OpenWrt payload convention as the absolute-path branch above) mirrors
                // the filesystem root once installed, so a bare/dotted search-path name
                // (`require("fw4")` from `root/usr/share/firewall4/`) resolves under the
                // SAME package's `<deployRoot>/usr/share/ucode/` or `.../usr/lib/ucode/` even
                // though that directory is a SIBLING of the importer, not an ancestor — i.e.
                // treat the deploy root as `/` and expand ucode's default REQUIRE_SEARCH_PATH
                // templates under it. Same-package-only, deterministic, sound (existence-gated).
                const isPackageDeployRoot = (d: string): boolean => {
                    const base = path.basename(d);
                    return base === 'root' || base === 'files';
                };
                let dir = currentDir;
                const insideWorkspace = dir === this.workspaceRoot
                    || dir.startsWith(this.workspaceRoot + path.sep);
                while (true) {
                    if (isSearchRootMirror(dir)) {
                        const candidate = path.resolve(dir, dottedPath);
                        if (this.isImportableFile(candidate)) {
                            return this.filePathToUri(candidate);
                        }
                    }
                    if (isPackageDeployRoot(dir)) {
                        // `.uc` dotted names resolve ONLY under a `share/ucode` root; `lib/ucode`
                        // is `*.so`-only (verified on-device), so it is deliberately excluded here.
                        for (const sub of ['usr/share/ucode', 'usr/local/share/ucode']) {
                            const candidate = path.resolve(dir, sub, dottedPath);
                            if (this.isImportableFile(candidate)) {
                                return this.filePathToUri(candidate);
                            }
                        }
                    }
                    if (insideWorkspace && dir === this.workspaceRoot) break;
                    const parent = path.dirname(dir);
                    if (parent === dir) break;
                    dir = parent;
                }
            }

            return null;
        } catch (error) {
            console.error('Error resolving import path:', error);
            return null;
        }
    }

    /**
     * For an object-literal export like `export const NAME = { KEY: literal, ... }`,
     * return KEY's literal value. Two flavours:
     *  - `display=true` quotes strings as JSON (`"hello"`) — used by hover.
     *  - `display=false` returns the raw string (`hello`) — used as a property
     *    key when the value drives an object access (ucode coerces keys to
     *    strings, and `obj["hello"]` would store key `hello` not `"hello"`).
     * Returns null when the value isn't a simple literal we can render.
     */
    findExportedObjectPropertyLiteral(fileUri: string, exportName: string, propertyName: string, display: boolean = true): string | null {
        try {
            const content = this.readFileContent(fileUri);
            if (content === null) return null;
            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const ast = parser.parse().ast;
            if (ast?.type !== 'Program') return null;

            const renderLiteral = (v: AstNode): string | null => {
                if (v.type === 'Literal') {
                    if (typeof v.value === 'string') return display ? JSON.stringify(v.value) : v.value;
                    if (typeof v.value === 'number' || typeof v.value === 'boolean') return String(v.value);
                    if (v.value === null) return 'null';
                    return null;
                }
                // Negative-number literals are parsed as UnaryExpression in ucode
                if (v.type === 'UnaryExpression' && v.operator === '-' && v.argument.type === 'Literal' && typeof v.argument.value === 'number') {
                    return String(-v.argument.value);
                }
                return null;
            };

            const findInObject = (objNode: ObjectExpressionNode): string | null => {
                for (const prop of objNode.properties) {
                    if (prop.type !== 'Property') continue;
                    const key = propertyKeyValue(prop);
                    if (key !== propertyName) continue;
                    return renderLiteral(prop.value);
                }
                return null;
            };

            for (const stmt of ast.body) {
                if (stmt.type === 'ExportNamedDeclaration') {
                    const decl = stmt.declaration;
                    if (decl?.type === 'VariableDeclaration') {
                        for (const d of decl.declarations) {
                            if (d.id.name === exportName && d.init?.type === 'ObjectExpression') {
                                return findInObject(d.init);
                            }
                        }
                    }
                } else if (stmt.type === 'ExportDefaultDeclaration' && exportName === 'default') {
                    const decl = stmt.declaration;
                    if (decl.type === 'ObjectExpression') return findInObject(decl);
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * For an object-literal export like `export const NAME = { KEY: ..., ... }`,
     * locate the source offset of `KEY`'s identifier. Used by go-to-definition
     * for chained namespace access (`ns.NAME.KEY`). Returns null when NAME isn't
     * an object literal or doesn't contain KEY.
     */
    findExportedObjectPropertyLocation(fileUri: string, exportName: string, propertyName: string): { start: number; end: number } | null {
        try {
            const content = this.readFileContent(fileUri);
            if (content === null) return null;
            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const ast = parser.parse().ast;
            if (ast?.type !== 'Program') return null;

            const findInObject = (objNode: ObjectExpressionNode): { start: number; end: number } | null => {
                for (const prop of objNode.properties) {
                    if (prop.type !== 'Property') continue;
                    const key = propertyKeyValue(prop);
                    if (key === propertyName) {
                        return { start: prop.key.start, end: prop.key.end };
                    }
                }
                return null;
            };

            for (const stmt of ast.body) {
                if (stmt.type === 'ExportNamedDeclaration') {
                    const decl = stmt.declaration;
                    if (decl?.type === 'VariableDeclaration') {
                        for (const d of decl.declarations) {
                            if (d.id.name === exportName && d.init?.type === 'ObjectExpression') {
                                return findInObject(d.init);
                            }
                        }
                    }
                } else if (stmt.type === 'ExportDefaultDeclaration' && exportName === 'default') {
                    const decl = stmt.declaration;
                    if (decl.type === 'ObjectExpression') return findInObject(decl);
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * If `name` in `fileUri` is bound by `import * as name from '<module>'`, resolve
     * that module's URI. Returns null if `name` isn't a namespace import there. Used
     * to chase a barrel re-export through a namespace alias
     * (`import * as _mock from 'utest.mock'; export const mock = _mock;` —
     * docs/tc-barrel-reexport-typing.md).
     */
    private findNamespaceImportSource(fileUri: string, name: string): string | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;
            const content = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf8');
            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            const parseResult = parser.parse();
            const ast = parseResult.ast;
            if (ast?.type !== 'Program') return null;
            for (const stmt of ast.body) {
                if (stmt.type !== 'ImportDeclaration') continue;
                for (const spec of stmt.specifiers) {
                    if (spec.type === 'ImportNamespaceSpecifier' && spec.local.name === name) {
                        let src = stmt.source.value;
                        if (typeof src !== 'string') return null;
                        src = src.replace(/^['"]|['"]$/g, '');
                        return this.resolveImportPath(src, fileUri);
                    }
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * If `init` is `<ns>.<member>` where `<ns>` is a namespace import in `fileUri`,
     * return the target module's URI and the member name. Used to chase a barrel
     * re-export through a namespace member (`export const describe = dsl.describe`
     * where `dsl` is `import * as dsl from './leaf.uc'` — docs/tc-barrel-reexport-typing.md).
     */
    private resolveNamespaceMemberAlias(fileUri: string, init: AstNode | undefined): { uri: string; member: string } | null {
        if (!init || init.type !== 'MemberExpression') return null;
        if (init.computed || init.object.type !== 'Identifier' || init.property.type !== 'Identifier') return null;
        const nsUri = this.findNamespaceImportSource(fileUri, init.object.name);
        if (!nsUri || !nsUri.startsWith('file://')) return null;
        return { uri: nsUri, member: init.property.name };
    }

    /**
     * Find a function definition in a file
     */
    findFunctionDefinition(fileUri: string, functionName: string): FunctionDefinition | null {
        try {
            // Check cache first (re-parse only if the file's content changed)
            const content = this.readFileContent(fileUri);
            if (content === null) return null;
            const cached = this.fileCache.get(fileUri);
            if (cached && cached.content === content) {
                return cached.defs.find(def => def.name === functionName) || null;
            }

            // Load and parse file
            const definitions = this.loadFunctionDefinitions(fileUri);
            if (!definitions) return null;

            // Cache the results
            this.fileCache.set(fileUri, { content, defs: definitions });

            // Find the requested function
            return definitions.find(def => def.name === functionName) || null;
        } catch (error) {
            console.error('Error finding function definition:', error);
            return null;
        }
    }

    /**
     * If `localName` is imported into `fileUri` (and thus possibly re-exported,
     * e.g. `import { x } from './a'; export { x };`), return the resolved URI of
     * the module it ultimately comes from plus its original exported name.
     * Used to follow re-export chains for go-to-definition. Returns null if the
     * name isn't imported there.
     */
    findReexportedSource(fileUri: string, localName: string): { uri: string; importedName: string } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const content = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf8');
            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            const parseResult = parser.parse();
            const ast = parseResult.ast;
            if (ast?.type !== 'Program') return null;

            for (const stmt of ast.body) {
                if (stmt.type !== 'ImportDeclaration') continue;
                for (const spec of stmt.specifiers) {
                    if (spec.type === 'ImportSpecifier' && spec.local.name === localName) {
                        let src = stmt.source.value;
                        if (typeof src !== 'string') return null;
                        src = src.replace(/^['"]|['"]$/g, '');
                        const resolved = this.resolveImportPath(src, fileUri);
                        if (!resolved) return null;
                        return { uri: resolved, importedName: spec.imported.name || localName };
                    }
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Get all exports from a module
     */
    getModuleExports(fileUri: string): ModuleExport[] | null {
        try {
            // Handle builtin modules
            if (fileUri.startsWith('builtin://')) {
                const moduleName = fileUri.replace('builtin://', '');
                return this.getBuiltinModuleExports(moduleName);
            }

            // Check cache first (re-parse only if the file's content changed)
            const content = this.readFileContent(fileUri);
            if (content === null) return null;
            const cached = this.exportCache.get(fileUri);
            if (cached && cached.content === content) {
                return cached.exports;
            }

            // Load and parse exports
            const exports = this.loadModuleExports(fileUri);
            if (!exports) return null;

            // Cache the results
            this.exportCache.set(fileUri, { content, exports });
            return exports;
        } catch (error) {
            console.error('Error getting module exports:', error);
            return null;
        }
    }

    /**
     * Get exports for a builtin module
     */
    private getBuiltinModuleExports(moduleName: string): ModuleExport[] {
        // For builtin modules, we need to determine their export pattern
        // Most ucode builtin modules export all their functions and constants as named exports
        const members = getModuleMembers(moduleName);
        const exports: ModuleExport[] = [];

        // Convert module members to exports
        for (const member of members) {
            exports.push({
                name: member.name,
                type: 'named',
                isFunction: member.type === 'function'
            });
        }

        return exports;
    }

    /**
     * Load all function definitions from a file
     */
    private loadFunctionDefinitions(fileUri: string): FunctionDefinition[] | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) {
                return null;
            }

            const content = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf8');
            
            // Parse the file
            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const parseResult = parser.parse();

            if (!parseResult.ast) {
                return null;
            }

            // Find all function declarations, then top-level variable
            // declarations (so go-to-definition can locate imported non-function
            // exports like `export let X` / `export const f = () => ...`).
            const functions: FunctionDefinition[] = [];
            this.findFunctions(parseResult.ast, functions);
            this.findTopLevelVariables(parseResult.ast, functions);

            return functions;
        } catch (error) {
            console.error('Error loading function definitions:', error);
            return null;
        }
    }

    /**
     * Recursively find all function declarations in an AST
     */
    private findFunctions(node: AstNode, functions: FunctionDefinition[]): void {
        if (node.type === 'FunctionDeclaration') {
            const funcNode = node;
            functions.push({
                name: funcNode.id.name,
                node: funcNode,
                start: funcNode.start,
                end: funcNode.end,
                kind: 'function'
            });
        }

        // Recursively search child nodes
        this.visitChildren(node, (child) => {
            this.findFunctions(child, functions);
        });
    }

    /**
     * Capture TOP-LEVEL variable declarations (`let`/`const`, optionally wrapped
     * in `export`) so go-to-definition can resolve imported non-function exports
     * to their declaration. Only top-level — never descend into function bodies,
     * which would match same-named locals. A function of the same name (already
     * collected) wins.
     */
    private findTopLevelVariables(ast: AstNode, defs: FunctionDefinition[]): void {
        if (ast.type !== 'Program') return;
        for (const stmt of ast.body) {
            const varDecl =
                stmt.type === 'VariableDeclaration' ? stmt :
                (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration')
                    ? stmt.declaration : null;
            if (!varDecl) continue;
            for (const d of varDecl.declarations) {
                const id = d.id;
                if (!id.name) continue;
                if (defs.some(def => def.name === id.name)) continue; // function shadows
                defs.push({ name: id.name, node: d, start: id.start, end: id.end, kind: 'variable' });
            }
        }
    }

    /**
     * Visit all child nodes of an AST node
     */
    private visitChildren(node: AstNode, visitor: (child: AstNode) => void): void {
        forEachAstChild(node, visitor);
    }

    /**
     * Load all exports from a module file
     */
    private loadModuleExports(fileUri: string): ModuleExport[] | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) {
                return null;
            }

            // Read and parse the file
            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            parser.setComments(lexer.comments);
            const result = parser.parse();

            if (!result.ast) {
                return null;
            }

            // Build a set of top-level function names to detect `export default <identifier>`.
            // Include `export function foo` (an ExportNamedDeclaration wrapping a
            // FunctionDeclaration), so `export default foo` is flagged as a function.
            const topLevelFunctionNames = new Set<string>();
            const programBody = result.ast.type === 'Program' ? result.ast.body : [];
            for (const stmt of programBody) {
                const fnDecl = stmt.type === 'FunctionDeclaration' ? stmt
                    : (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'FunctionDeclaration') ? stmt.declaration
                    : null;
                if (fnDecl?.id.name) {
                    topLevelFunctionNames.add(fnDecl.id.name);
                }
            }

            const exports: ModuleExport[] = [];
            this.findExports(result.ast, exports, topLevelFunctionNames);
            return exports;
        } catch (error) {
            console.error('Error loading module exports:', error);
            return null;
        }
    }

    /**
     * Find all exports in an AST node
     */
    private findExports(node: AstNode, exports: ModuleExport[], topLevelFunctionNames?: Set<string>, depth = 0): void {
        // Exports are top-level, but this recurses into every child (incl. deep expression
        // subtrees). Cap the depth so a pathologically-nested module can't overflow the stack
        // here (the "Error loading module exports" RangeError). (#117)
        if (depth > MAX_ANALYSIS_DEPTH) return;
        if (node.type === 'ExportDefaultDeclaration') {
            const exportNode = node;
            const decl = exportNode.declaration;
            const isFuncDecl = decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression';
            // Check if default export is an identifier referencing a top-level function
            const isIdentifierFunc = decl.type === 'Identifier' && topLevelFunctionNames?.has(decl.name);
            // The default's source name: an `export default foo` identifier, OR the id
            // of an inline `export default function foo()` (so cross-file refs/rename
            // can resolve it — without this, exportedName was undefined for inline fns).
            const exportedName = decl.type === 'Identifier' ? decl.name
                : decl.type === 'FunctionDeclaration' ? decl.id.name
                : decl.type === 'FunctionExpression' ? decl.id?.name
                : undefined;
            exports.push({
                name: 'default',
                type: 'default',
                isFunction: isFuncDecl || !!isIdentifierFunc,
                ...(exportedName !== undefined ? { exportedName } : {})
            });
        } else if (node.type === 'ExportNamedDeclaration') {
            const exportNode = node as ExportNamedDeclarationNode;
            if (exportNode.declaration) {
                // export function foo() {} or export let x = 1
                if (exportNode.declaration.type === 'FunctionDeclaration') {
                    const funcDecl = exportNode.declaration as FunctionDeclarationNode;
                    exports.push({
                        name: funcDecl.id.name,
                        type: 'named',
                        isFunction: true
                    });
                } else if (exportNode.declaration.type === 'VariableDeclaration') {
                    const varDecl = exportNode.declaration;
                    for (const declarator of varDecl.declarations) {
                        exports.push({
                            name: declarator.id.name,
                            type: 'named',
                            isFunction: false
                        });
                    }
                }
            } else if (exportNode.specifiers && !exportNode.source) {
                // export { foo, bar } — only a LOCAL specifier list is a real export.
                // A re-export `export { foo } from "…"` (source present) is not valid
                // ucode syntax (finding #69), so it exports nothing — don't invent the
                // names, or downstream `import { foo } from <this module>` resolves a
                // phantom export.
                for (const specifier of exportNode.specifiers) {
                    exports.push({
                        name: specifier.exported.name,
                        type: 'named',
                        isFunction: false // We don't know without more analysis
                    });
                }
            }
        }

        // Recursively search child nodes
        this.visitChildren(node, (child) => {
            this.findExports(child, exports, topLevelFunctionNames, depth + 1);
        });
    }

    /**
     * Convert file URI to file path
     */
    private uriToFilePath(uri: string): string | null {
        try {
            if (uri.startsWith('file://')) {
                return decodeURIComponent(uri.substring(7));
            }
            // Handle relative paths
            if (!uri.startsWith('/')) {
                return path.resolve(this.workspaceRoot, uri);
            }
            return uri;
        } catch (error) {
            return null;
        }
    }

    /**
     * Convert file path to file URI
     */
    private filePathToUri(filePath: string): string {
        return 'file://' + filePath;
    }

    /**
     * For `import * as ns from './file.uc'`: produce a Map of each top-level
     * export's NAME → inferred type, so the namespace symbol's `propertyTypes`
     * resolves member access (`ns.SOME_EXPORT`) instead of falling through to
     * `unknown`. Returns null if the file can't be read or parsed. Includes a
     * `default` entry when the file has a default export.
     *
     * Inference is SHALLOW (literal kinds → primitive type; functions → FUNCTION;
     * arrays/objects → ARRAY/OBJECT; anything else → UNKNOWN). Specifier-only
     * exports (`export { foo }`) are skipped — they'd require resolving each
     * local's type and are a follow-up.
     */
    private namespaceTypesCache = new Map<string, {
        content: string;
        types: Map<string, UcodeDataType>;
        nested: Map<string, Map<string, UcodeDataType>>;
        functionReturnTypes: Map<string, string>;
        defLocations: Map<string, { start: number; end: number }>;
    }>();

    getNamespaceExportPropertyTypes(fileUri: string): Map<string, UcodeDataType> | null {
        return this.getNamespaceExportInfo(fileUri)?.types ?? null;
    }

    /**
     * Get both shallow and one-level-nested property types for a namespace-imported
     * file. Used when hovering `ns.A.B`: `nestedPropertyTypes['A']` lets us resolve
     * B without losing the link to the imported file. Without this, an export like
     * `export const ALFRED_TYPES = { HOSTINFO: 64, ... }` would stop at "ALFRED_TYPES
     * is object" and `.HOSTINFO` would have no hover or go-to-definition.
     */
    /**
     * Resolve a function node's declared return type from an `@returns` JSDoc tag,
     * if present and recognized. Authoritative across files — preferred over body
     * inference. Returns null when there's no usable `@returns`.
     */
    private functionReturnTypeFromJsDoc(funcNode: AstNode): UcodeDataType | null {
        const leadingJsDoc = asFunctionLike(funcNode)?.leadingJsDoc;
        if (!leadingJsDoc?.value) return null;
        const parsed = parseJsDocComment(leadingJsDoc.value);
        const ret = parsed.tags.find(t => t.tag === 'returns');
        if (!ret?.typeExpression) return null;
        return resolveTypeExpression(ret.typeExpression);
    }

    /**
     * Best-effort return type for a function as a parseable type string, preferring
     * an `@returns` JSDoc annotation over body inference. Returns null when neither
     * yields anything beyond `unknown` — callers then leave the return unresolved
     * rather than locking in `unknown`. Used to carry namespace-member function
     * return types (e.g. `import * as session; session.get()`).
     */
    private functionReturnTypeString(funcNode: AstNode): string | null {
        const fromJsDoc = this.functionReturnTypeFromJsDoc(funcNode);
        if (fromJsDoc !== null) return typeToString(fromJsDoc);
        const inferred = this.inferFunctionReturnType(funcNode);
        if (inferred !== null && inferred !== (UcodeType.UNKNOWN as UcodeDataType)) {
            const s = typeToString(inferred);
            if (s && s !== 'unknown') return s;
        }
        return null;
    }

    getNamespaceExportInfo(fileUri: string): {
        types: Map<string, UcodeDataType>;
        nested: Map<string, Map<string, UcodeDataType>>;
        functionReturnTypes: Map<string, string>;
        defLocations: Map<string, { start: number; end: number }>;
    } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;
            const content = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const cached = this.namespaceTypesCache.get(fileUri);
            if (cached && cached.content === content) return { types: cached.types, nested: cached.nested, functionReturnTypes: cached.functionReturnTypes, defLocations: cached.defLocations };

            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const ast = parser.parse().ast;
            const types = new Map<string, UcodeDataType>();
            const nested = new Map<string, Map<string, UcodeDataType>>();
            const functionReturnTypes = new Map<string, string>();
            // Def node start/end per exported function, so `ns.fn(` signature help can
            // resolve the function's params via the cross-file resolver. (#171)
            const defLocations = new Map<string, { start: number; end: number }>();

            const recordExport = (name: string, init: AstNode | null | undefined) => {
                // Barrel re-export: `export const mock = _mock;` where `_mock` is a
                // namespace import — chase into the namespace module and carry its full
                // shape as this export's ONE-level-deeper shape, so a two-hop access
                // (`ns.mock.member`) resolves. docs/tc-barrel-reexport-typing.md
                if (init?.type === 'Identifier') {
                    const nsUri = this.findNamespaceImportSource(fileUri, init.name);
                    if (nsUri && nsUri.startsWith('file://')) {
                        const nsInfo = this.getNamespaceExportInfo(nsUri);
                        if (nsInfo && nsInfo.types.size > 0) {
                            types.set(name, UcodeType.OBJECT as UcodeDataType);
                            nested.set(name, nsInfo.types);
                            return;
                        }
                    }
                }
                // `export const describe = dsl.describe;` — re-export through a
                // namespace member. docs/tc-barrel-reexport-typing.md
                if (init?.type === 'MemberExpression') {
                    if (!init.computed && init.object.type === 'Identifier' && init.property.type === 'Identifier') {
                        const nsUri = this.findNamespaceImportSource(fileUri, init.object.name);
                        if (nsUri && nsUri.startsWith('file://')) {
                            const memberName = init.property.name;
                            const nsInfo = this.getNamespaceExportInfo(nsUri);
                            const memberType = nsInfo?.types.get(memberName);
                            if (memberType !== undefined) {
                                types.set(name, memberType);
                                const memberNested = nsInfo?.nested.get(memberName);
                                if (memberNested) nested.set(name, memberNested);
                                const memberFnReturn = nsInfo?.functionReturnTypes.get(memberName);
                                if (memberFnReturn) functionReturnTypes.set(name, memberFnReturn);
                                return;
                            }
                        }
                    }
                }
                types.set(name, this.inferShallowType(init));
                // For object-literal exports, walk one level deeper so chained
                // access like `ns.NAME.PROP` can resolve. Deeper than one level
                // is out of scope — keep this cheap.
                if (init?.type === 'ObjectExpression') {
                    const inner = this.inferObjectLiteralPropertyTypesShallow(init);
                    if (inner.size > 0) nested.set(name, inner);
                }
                // Function-valued const export (`export const f = () => …`): carry
                // its return type too, like a FunctionDeclaration export.
                if (init?.type === 'FunctionExpression' || init?.type === 'ArrowFunctionExpression') {
                    const retStr = this.functionReturnTypeString(init);
                    if (retStr) functionReturnTypes.set(name, retStr);
                    // The function VALUE node's start is what findFunctionNodeAt matches (#171).
                    defLocations.set(name, { start: init.start, end: init.end });
                }
            };

            if (ast?.type === 'Program') {
                for (const stmt of ast.body) {
                    if (stmt.type === 'ExportNamedDeclaration') {
                        const decl = stmt.declaration;
                        if (decl?.type === 'FunctionDeclaration' && decl.id.name) {
                            types.set(decl.id.name, UcodeType.FUNCTION as UcodeDataType);
                            // Carry the function's return type (JSDoc @returns first, else
                            // body inference) so `ns.fn()` call sites resolve a real type
                            // instead of `unknown`.
                            const retStr = this.functionReturnTypeString(decl);
                            if (retStr) functionReturnTypes.set(decl.id.name, retStr);
                            defLocations.set(decl.id.name, { start: decl.start, end: decl.end });
                        } else if (decl?.type === 'VariableDeclaration') {
                            for (const d of decl.declarations) {
                                if (d.id.name) recordExport(d.id.name, d.init);
                            }
                        }
                    } else if (stmt.type === 'ExportDefaultDeclaration') {
                        recordExport('default', stmt.declaration);
                    }
                }
            }

            this.namespaceTypesCache.set(fileUri, { content, types, nested, functionReturnTypes, defLocations });
            return { types, nested, functionReturnTypes, defLocations };
        } catch (error) {
            console.error('Error loading namespace export property types:', error);
            return null;
        }
    }

    /** Type-only walk of an ObjectExpression's direct properties — one level. */
    private inferObjectLiteralPropertyTypesShallow(objNode: ObjectExpressionNode): Map<string, UcodeDataType> {
        const m = new Map<string, UcodeDataType>();
        for (const prop of objNode.properties) {
            if (prop.type !== 'Property') continue;
            const key = propertyKeyValue(prop);
            if (typeof key !== 'string' && typeof key !== 'number') continue;
            const keyStr = String(key);
            m.set(keyStr, this.inferShallowType(prop.value));
        }
        return m;
    }

    private inferShallowType(node: AstNode | null | undefined): UcodeDataType {
        if (!node) return UcodeType.UNKNOWN as UcodeDataType;
        switch (node.type) {
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                return UcodeType.FUNCTION as UcodeDataType;
            case 'ArrayExpression':
                return UcodeType.ARRAY as UcodeDataType;
            case 'ObjectExpression':
                return UcodeType.OBJECT as UcodeDataType;
            case 'Literal': {
                const lit = node;
                if (lit.literalType === 'string' || typeof lit.value === 'string') return UcodeType.STRING as UcodeDataType;
                if (lit.literalType === 'double' || (typeof lit.value === 'number' && !Number.isInteger(lit.value))) return UcodeType.DOUBLE as UcodeDataType;
                if (typeof lit.value === 'number') return UcodeType.INTEGER as UcodeDataType;
                if (lit.literalType === 'boolean' || typeof lit.value === 'boolean') return UcodeType.BOOLEAN as UcodeDataType;
                if (lit.literalType === 'null' || lit.value === null) return UcodeType.NULL as UcodeDataType;
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            default:
                return UcodeType.UNKNOWN as UcodeDataType;
        }
    }

    /**
     * Get property types for a default export that is an object.
     * Resolves identifiers to their declarations (ObjectExpression, etc.).
     */
    getDefaultExportPropertyTypes(fileUri: string): { propertyTypes: Map<string, UcodeDataType>; nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>; functionReturnTypes?: Map<string, UcodeDataType>; closedShape?: boolean } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const result = { ast: this.getCachedAst(fileUri, source) };
            if (!result.ast) return null;

            const body = result.ast.type === 'Program' ? result.ast.body : [];

            // Build maps of top-level variable initializers, function names, and function nodes
            const varInits = new Map<string, AstNode>();
            const funcNames = new Set<string>();
            const funcNodes = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) {
                    funcNames.add(stmt.id.name);
                    funcNodes.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations) {
                        if (decl.id.name && decl.init) {
                            varInits.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Find default export declaration
            let defaultDecl: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type === 'ExportDefaultDeclaration') {
                    defaultDecl = stmt.declaration;
                    break;
                }
            }
            if (!defaultDecl) return null;

            // Resolve identifier to its initializer. An INLINE object literal
            // (`export default { … }`) has no name to reference, so it can't be
            // mutated after the literal — its property set is provably complete
            // ("closed"). A `export default someVar` could be augmented later
            // (`someVar.x = …`), so it is NOT closed.
            const isInlineLiteral = defaultDecl.type === 'ObjectExpression';
            let objNode = defaultDecl;
            if (objNode.type === 'Identifier' && varInits.has(objNode.name)) {
                objNode = varInits.get(objNode.name)!;
            }

            // Must be an ObjectExpression
            if (objNode.type !== 'ObjectExpression') return null;

            const propertyTypes = new Map<string, UcodeDataType>();
            const nestedPropertyTypes = new Map<string, Map<string, UcodeDataType>>();
            const functionReturnTypes = new Map<string, UcodeDataType>();

            for (const prop of objNode.properties) {
                if (prop.type !== 'Property') continue;
                const rawKey = propertyKeyValue(prop);
                if (!rawKey) continue;
                const key = rawKey as string;

                const val = prop.value;

                if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                    propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                    // Infer return type of inline function
                    const retType = this.inferFunctionReturnType(val);
                    if (retType) functionReturnTypes.set(key, retType);
                } else if (val.type === 'Identifier' && funcNames.has(val.name)) {
                    propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                    // Infer return type of referenced top-level function
                    const funcNode = funcNodes.get(val.name);
                    if (funcNode) {
                        const retType = this.inferFunctionReturnType(funcNode);
                        if (retType) functionReturnTypes.set(key, retType);
                    }
                } else if (val.type === 'Literal') {
                    if (typeof val.value === 'number') {
                        propertyTypes.set(key, UcodeType.INTEGER as UcodeDataType);
                    } else if (typeof val.value === 'string') {
                        propertyTypes.set(key, UcodeType.STRING as UcodeDataType);
                    } else if (typeof val.value === 'boolean') {
                        propertyTypes.set(key, UcodeType.BOOLEAN as UcodeDataType);
                    } else {
                        propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                    }
                } else if (val.type === 'ObjectExpression') {
                    propertyTypes.set(key, UcodeType.OBJECT as UcodeDataType);
                    // Extract nested property types for object-valued properties
                    const nested = this.extractObjectPropertyTypes(val, funcNodes, varInits, new Map());
                    if (nested.size > 0) {
                        nestedPropertyTypes.set(key, nested);
                    }
                } else if (val.type === 'ArrayExpression') {
                    propertyTypes.set(key, UcodeType.ARRAY as UcodeDataType);
                } else if (val.type === 'Identifier') {
                    // Resolve variable identifier against known initializers
                    const init = varInits.get(val.name);
                    if (init) {
                        propertyTypes.set(key, this.inferNodeType(init));
                        // If the resolved initializer is an object, extract nested types
                        if (init.type === 'ObjectExpression') {
                            const nested = this.extractObjectPropertyTypes(init, funcNodes, varInits, new Map());
                            if (nested.size > 0) {
                                nestedPropertyTypes.set(key, nested);
                            }
                        }
                    } else {
                        propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                    }
                } else {
                    propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                }
            }

            // Post-hoc property assignments on the exported object AFTER its literal
            // declaration (`mwan4.get_iface_id = get_iface_id;` — mwan4.uc's dominant
            // idiom, ~80 properties attached this way instead of inline in the
            // literal). Only applies when the default export resolves through a named
            // variable — an inline `export default { … }` has no name to assign to
            // before the export statement (docs/tc-fn-reference-property-returns.md,
            // shape 3).
            if (!isInlineLiteral && defaultDecl.type === 'Identifier') {
                const exportedName = defaultDecl.name;
                for (const stmt of body) {
                    if (stmt.type !== 'ExpressionStatement') continue;
                    const expr = stmt.expression;
                    if (expr.type !== 'AssignmentExpression' || expr.operator !== '=') continue;
                    const left = expr.left;
                    if (left.type !== 'MemberExpression' || left.computed) continue;
                    if (left.object.type !== 'Identifier' || left.object.name !== exportedName) continue;
                    if (left.property.type !== 'Identifier') continue;
                    const key = left.property.name;
                    const val = expr.right;

                    if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                        propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                        const retType = this.inferFunctionReturnType(val);
                        if (retType) functionReturnTypes.set(key, retType);
                    } else if (val.type === 'Identifier' && funcNames.has(val.name)) {
                        propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                        const funcNode = funcNodes.get(val.name);
                        if (funcNode) {
                            const retType = this.inferFunctionReturnType(funcNode);
                            if (retType) functionReturnTypes.set(key, retType);
                        }
                    } else if (val.type === 'Identifier') {
                        const init = varInits.get(val.name);
                        if (init) {
                            propertyTypes.set(key, this.inferNodeType(init));
                            if (init.type === 'ObjectExpression') {
                                const nested = this.extractObjectPropertyTypes(init, funcNodes, varInits, new Map());
                                if (nested.size > 0) nestedPropertyTypes.set(key, nested);
                            }
                        } else {
                            propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                        }
                    } else if (val.type === 'Literal') {
                        if (typeof val.value === 'number') {
                            propertyTypes.set(key, UcodeType.INTEGER as UcodeDataType);
                        } else if (typeof val.value === 'string') {
                            propertyTypes.set(key, UcodeType.STRING as UcodeDataType);
                        } else if (typeof val.value === 'boolean') {
                            propertyTypes.set(key, UcodeType.BOOLEAN as UcodeDataType);
                        } else {
                            propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                        }
                    } else if (val.type === 'ObjectExpression') {
                        propertyTypes.set(key, UcodeType.OBJECT as UcodeDataType);
                        const nested = this.extractObjectPropertyTypes(val, funcNodes, varInits, new Map());
                        if (nested.size > 0) nestedPropertyTypes.set(key, nested);
                    } else if (val.type === 'ArrayExpression') {
                        propertyTypes.set(key, UcodeType.ARRAY as UcodeDataType);
                    } else {
                        propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                    }
                }
            }

            if (propertyTypes.size === 0) return null;
            const exportResult: { propertyTypes: Map<string, UcodeDataType>; nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>; functionReturnTypes?: Map<string, UcodeDataType>; closedShape?: boolean } = { propertyTypes };
            if (nestedPropertyTypes.size > 0) {
                exportResult.nestedPropertyTypes = nestedPropertyTypes;
            }
            if (functionReturnTypes.size > 0) {
                exportResult.functionReturnTypes = functionReturnTypes;
            }
            if (isInlineLiteral) {
                exportResult.closedShape = true;
            }
            return exportResult;
        } catch {
            return null;
        }
    }

    /**
     * Get the type info for a named export (export const foo = ..., export function foo() {}).
     * Returns the type and property types if the export is an object.
     */
    getNamedExportTypeInfo(fileUri: string, exportName: string, _visited: Set<string> = new Set()): {
        type: UcodeDataType;
        propertyTypes?: Map<string, UcodeDataType>;
        nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>;
        propertyFunctionReturnTypes?: Map<string, string>;
    } | null {
        try {
            // Cycle guard for re-export / const-alias chains.
            const visitKey = `${fileUri}#${exportName}`;
            if (_visited.has(visitKey)) return null;
            _visited.add(visitKey);

            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const result = { ast: this.getCachedAst(fileUri, source) };
            if (!result.ast) return null;

            const body = result.ast.type === 'Program' ? result.ast.body : [];

            // Build maps of top-level variable initializers and function names
            const varInits = new Map<string, AstNode>();
            const funcNames = new Set<string>();
            const funcNodes = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) {
                    funcNames.add(stmt.id.name);
                    funcNodes.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations) {
                        if (decl.id.name && decl.init) {
                            varInits.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Find the named export
            for (const stmt of body) {
                if (stmt.type !== 'ExportNamedDeclaration') continue;
                const exportNode = stmt;

                if (exportNode.declaration) {
                    if (exportNode.declaration.type === 'FunctionDeclaration') {
                        const funcDecl = exportNode.declaration;
                        if (funcDecl.id.name === exportName) {
                            return { type: UcodeType.FUNCTION as UcodeDataType };
                        }
                    } else if (exportNode.declaration.type === 'VariableDeclaration') {
                        const varDecl = exportNode.declaration;
                        for (const declarator of varDecl.declarations) {
                            if (declarator.id.name !== exportName) continue;

                            const init = declarator.init;
                            if (!init) return { type: UcodeType.UNKNOWN as UcodeDataType };

                            // `export const VAL2 = VAL;` where VAL is an import binding in
                            // this file — follow the import chain into the source module
                            // (mirrors getNamedExportFunctionParameters' re-export handling).
                            if (init.type === 'Identifier') {
                                const chained = this.resolveReexportedIdentifierType(fileUri, init.name, _visited);
                                if (chained) return chained;
                            }

                            // `export const describe = dsl.describe;` (barrel re-export
                            // through a namespace member) — chase into the namespace's
                            // module and resolve the SAME named export there.
                            // docs/tc-barrel-reexport-typing.md
                            if (init.type === 'MemberExpression') {
                                const nsAlias = this.resolveNamespaceMemberAlias(fileUri, init);
                                if (nsAlias) {
                                    const visitKey = `${nsAlias.uri}#${nsAlias.member}`;
                                    if (!_visited.has(visitKey)) {
                                        const chained = this.getNamedExportTypeInfo(nsAlias.uri, nsAlias.member, _visited);
                                        if (chained) return chained;
                                    }
                                }
                            }

                            const nodeType = this.inferNodeType(init);
                            if (init.type === 'ObjectExpression') {
                                const propertyTypes = new Map<string, UcodeDataType>();
                                const nestedPropertyTypes = new Map<string, Map<string, UcodeDataType>>();

                                for (const prop of init.properties) {
                                    if (prop.type !== 'Property') continue;
                                    const rawKey = propertyKeyValue(prop);
                                    if (!rawKey) continue;
                                    const key = rawKey as string;

                                    const val = prop.value;
                                    if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                                        propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                                    } else if (val.type === 'ObjectExpression') {
                                        propertyTypes.set(key, UcodeType.OBJECT as UcodeDataType);
                                        const nested = this.extractObjectPropertyTypes(val, funcNodes, varInits, new Map());
                                        if (nested.size > 0) nestedPropertyTypes.set(key, nested);
                                    } else {
                                        propertyTypes.set(key, this.inferNodeType(val));
                                    }
                                }

                                const res: {
                                    type: UcodeDataType;
                                    propertyTypes?: Map<string, UcodeDataType>;
                                    nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>;
                                } = { type: nodeType };
                                if (propertyTypes.size > 0) res.propertyTypes = propertyTypes;
                                if (nestedPropertyTypes.size > 0) res.nestedPropertyTypes = nestedPropertyTypes;
                                return res;
                            }

                            return { type: nodeType };
                        }
                    }
                } else if (exportNode.specifiers) {
                    // export { foo, bar }
                    for (const specifier of exportNode.specifiers) {
                        if (specifier.exported.name !== exportName) continue;
                        const localName = specifier.local.name;

                        // Check if it's a function
                        if (funcNames.has(localName)) {
                            return { type: UcodeType.FUNCTION as UcodeDataType };
                        }

                        // Check if it's a variable with an initializer
                        const init = varInits.get(localName);
                        // `const VAL2 = VAL; export { VAL2 };` where VAL is an import
                        // binding — follow the chain to the module that really declares it.
                        if (init && init.type === 'Identifier') {
                            const chained = this.resolveReexportedIdentifierType(fileUri, init.name, _visited);
                            if (chained) return chained;
                        }
                        // `const x = ns.member; export { x };` — barrel re-export through a
                        // namespace member. docs/tc-barrel-reexport-typing.md
                        if (init && init.type === 'MemberExpression') {
                            const nsAlias = this.resolveNamespaceMemberAlias(fileUri, init);
                            if (nsAlias) {
                                const chained = this.getNamedExportTypeInfo(nsAlias.uri, nsAlias.member, _visited);
                                if (chained) return chained;
                            }
                        }
                        // Direct re-export: `import { x } from './a'; export { x };` — the
                        // name isn't a local var here, it's forwarded from the source module.
                        if (!init && !funcNames.has(localName)) {
                            const chained = this.resolveReexportedIdentifierType(fileUri, localName, _visited);
                            if (chained) return chained;
                        }
                        if (init) {
                            const nodeType = this.inferNodeType(init);
                            if (init.type === 'ObjectExpression') {
                                const propertyTypes = this.extractObjectPropertyTypes(init, funcNodes, varInits, new Map());
                                const res: { type: UcodeDataType; propertyTypes?: Map<string, UcodeDataType> } = { type: nodeType };
                                if (propertyTypes.size > 0) res.propertyTypes = propertyTypes;
                                return res;
                            }
                            return { type: nodeType };
                        }

                        return { type: UcodeType.UNKNOWN as UcodeDataType };
                    }
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * If `name` is an import binding in `fileUri`, follow the import chain to the
     * module that declares it and resolve its export type there. Returns null if
     * `name` isn't an import in this file (so the caller falls back to local
     * inference). Used to type a transitive re-export like
     * `import { VAL } from './c'; const VAL2 = VAL; export { VAL2 };`.
     */
    private resolveReexportedIdentifierType(fileUri: string, name: string, _visited: Set<string>): {
        type: UcodeDataType;
        propertyTypes?: Map<string, UcodeDataType>;
        nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>;
        propertyFunctionReturnTypes?: Map<string, string>;
    } | null {
        // Namespace re-export: `import * as _mock from 'utest.mock'; export const mock = _mock;`
        // — the whole namespace's exports become `mock`'s property shape.
        // docs/tc-barrel-reexport-typing.md
        const nsUri = this.findNamespaceImportSource(fileUri, name);
        if (nsUri && nsUri.startsWith('file://')) {
            const nsInfo = this.getNamespaceExportInfo(nsUri);
            if (nsInfo && nsInfo.types.size > 0) {
                const nsResult: {
                    type: UcodeDataType;
                    propertyTypes?: Map<string, UcodeDataType>;
                    nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>;
                    propertyFunctionReturnTypes?: Map<string, string>;
                } = { type: UcodeType.OBJECT as UcodeDataType, propertyTypes: nsInfo.types };
                if (nsInfo.nested.size > 0) nsResult.nestedPropertyTypes = nsInfo.nested;
                if (nsInfo.functionReturnTypes.size > 0) nsResult.propertyFunctionReturnTypes = nsInfo.functionReturnTypes;
                return nsResult;
            }
            return { type: UcodeType.OBJECT as UcodeDataType };
        }
        const reexp = this.findReexportedSource(fileUri, name);
        if (!reexp) return null;
        return this.getNamedExportTypeInfo(reexp.uri, reexp.importedName, _visited);
    }

    /**
     * Get return type and property types for a default export that is a function.
     * Analyzes the function's return statements for object literals.
     */
    getDefaultExportFunctionReturnInfo(fileUri: string): FactoryReturnInfo | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const result = { ast: this.getCachedAst(fileUri, source) };
            if (!result.ast) return null;

            const body = result.ast.type === 'Program' ? result.ast.body : [];

            // Build maps of top-level declarations
            const topLevelFuncs = new Map<string, AstNode>();
            const topLevelVars = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) {
                    topLevelFuncs.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations) {
                        if (decl.id.name && decl.init) {
                            topLevelVars.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Find default export declaration
            let defaultDecl: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type === 'ExportDefaultDeclaration') {
                    defaultDecl = stmt.declaration;
                    break;
                }
            }
            if (!defaultDecl) return null;

            // Resolve to the function node
            let funcNode: AstNode | null = null;
            if (defaultDecl.type === 'FunctionDeclaration' || defaultDecl.type === 'FunctionExpression') {
                funcNode = defaultDecl;
            } else if (defaultDecl.type === 'Identifier') {
                const name = defaultDecl.name;
                if (topLevelFuncs.has(name)) {
                    funcNode = topLevelFuncs.get(name)!;
                }
            }
            if (!funcNode) return null;

            const factoryInfo = this.computeFunctionReturnInfo(funcNode, topLevelFuncs);
            if (factoryInfo) return factoryInfo;

            // Fallback to simple return-type inference (string, null, union, …)
            // for default exports that aren't object factories. Same rationale as
            // the named-export fallback below.
            const simpleType = this.inferFunctionReturnType(funcNode);
            if (simpleType !== null) {
                return { returnType: simpleType, returnPropertyTypes: new Map() };
            }

            // Resolved to a function but couldn't infer the return — still signal
            // "this is a function" via a non-null result so the caller can upgrade
            // the symbol's dataType. See the matching comment in
            // getNamedExportFunctionReturnInfo for the rationale.
            return { returnType: UcodeType.UNKNOWN as UcodeDataType, returnPropertyTypes: new Map() };
        } catch {
            return null;
        }
    }

    /**
     * Get return type and property types for a NAMED export that is a function
     * (factory). Mirrors getDefaultExportFunctionReturnInfo for named exports:
     *   export function create() { return {...}; }
     *   export const create = function () { return {...}; };
     *   function create() { ... }  export { create };
     * Returns null unless the function provably returns an object literal in all
     * branches (so non-object-returning named functions are unaffected).
     */
    getNamedExportFunctionReturnInfo(fileUri: string, exportName: string, _visited: Set<string> = new Set()): FactoryReturnInfo | null {
        try {
            // Cycle guard for re-export / barrel-alias chains (docs/tc-barrel-reexport-typing.md).
            const visitKey = `${fileUri}#${exportName}`;
            if (_visited.has(visitKey)) return null;
            _visited.add(visitKey);

            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const result = { ast: this.getCachedAst(fileUri, source) };
            if (!result.ast) return null;

            const body = result.ast.type === 'Program' ? result.ast.body : [];

            // Build maps of top-level declarations (for `export { name }` resolution)
            const topLevelFuncs = new Map<string, AstNode>();
            const topLevelVarInits = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) {
                    topLevelFuncs.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations) {
                        if (decl.id.name && decl.init) {
                            topLevelVarInits.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Resolve the named export to a function node
            let funcNode: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type !== 'ExportNamedDeclaration') continue;
                const exportNode = stmt;

                if (exportNode.declaration) {
                    if (exportNode.declaration.type === 'FunctionDeclaration') {
                        const funcDecl = exportNode.declaration;
                        if (funcDecl.id.name === exportName) { funcNode = funcDecl; break; }
                    } else if (exportNode.declaration.type === 'VariableDeclaration') {
                        const varDecl = exportNode.declaration;
                        for (const declarator of varDecl.declarations) {
                            if (declarator.id.name !== exportName) continue;
                            const init = declarator.init;
                            if (init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')) {
                                funcNode = init;
                            } else if (init && init.type === 'Identifier') {
                                // `export const describe = someFn;` where someFn is an
                                // imported named function — chase the import chain.
                                // docs/tc-barrel-reexport-typing.md
                                const reexp = this.findReexportedSource(fileUri, init.name);
                                if (reexp) return this.getNamedExportFunctionReturnInfo(reexp.uri, reexp.importedName, _visited);
                            } else if (init && init.type === 'MemberExpression') {
                                // `export const describe = dsl.describe;` (barrel re-export
                                // through a namespace member). docs/tc-barrel-reexport-typing.md
                                const nsAlias = this.resolveNamespaceMemberAlias(fileUri, init);
                                if (nsAlias) return this.getNamedExportFunctionReturnInfo(nsAlias.uri, nsAlias.member, _visited);
                            }
                            break;
                        }
                        if (funcNode) break;
                    }
                } else if (exportNode.specifiers) {
                    let matched = false;
                    for (const specifier of exportNode.specifiers) {
                        if (specifier.exported.name !== exportName) continue;
                        matched = true;
                        const localName = specifier.local.name;
                        if (topLevelFuncs.has(localName)) {
                            funcNode = topLevelFuncs.get(localName)!;
                        } else {
                            const init = topLevelVarInits.get(localName);
                            if (init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')) {
                                funcNode = init;
                            } else if (init && init.type === 'MemberExpression') {
                                const nsAlias = this.resolveNamespaceMemberAlias(fileUri, init);
                                if (nsAlias) return this.getNamedExportFunctionReturnInfo(nsAlias.uri, nsAlias.member, _visited);
                            } else if (!init) {
                                // Direct re-export: `import { x } from './a'; export { x };`
                                const reexp = this.findReexportedSource(fileUri, localName);
                                if (reexp) return this.getNamedExportFunctionReturnInfo(reexp.uri, reexp.importedName, _visited);
                            }
                        }
                        break;
                    }
                    if (matched) break;
                }
            }

            if (!funcNode) return null;

            // First try the object-factory path — it produces richer info
            // (property types + nested function return types). A factory's inferred
            // object shape is more useful than a coarse `@returns {object}`, so it wins.
            const factoryInfo = this.computeFunctionReturnInfo(funcNode, topLevelFuncs);
            if (factoryInfo) return factoryInfo;

            // An explicit `@returns` JSDoc is authoritative for non-factory functions —
            // prefer it over body inference (e.g. `@returns {object|null}` on a function
            // whose body returns `json(...)`, which the analyzer would otherwise only
            // infer as `null | unknown`).
            const jsdocReturn = this.functionReturnTypeFromJsDoc(funcNode);
            if (jsdocReturn !== null) {
                return { returnType: jsdocReturn, returnPropertyTypes: new Map() };
            }

            // Otherwise infer a simple return type (string, null, integer, array, …)
            // so non-object-returning named exports still propagate their return type
            // to imported call sites.
            const simpleType = this.inferFunctionReturnType(funcNode);
            if (simpleType !== null) {
                return { returnType: simpleType, returnPropertyTypes: new Map() };
            }

            // Resolved to a function node but we couldn't infer its return type
            // (e.g. body returns a member call, or builds a string incrementally).
            // Still report it IS a function so the caller can upgrade the symbol's
            // dataType from UNKNOWN to FUNCTION — otherwise hover shows `unknown`
            // for an imported name we already know is callable, which is worse than
            // showing `function` with an unknown return.
            return { returnType: UcodeType.UNKNOWN as UcodeDataType, returnPropertyTypes: new Map() };
        } catch {
            return null;
        }
    }

    /**
     * Extract the parameter signature (ParamInfo[]) of a NAMED exported function,
     * for cross-file call-site argument checking. Mirrors the node-finding of
     * getNamedExportFunctionReturnInfo, then reads each param's JSDoc type.
     * Returns null if the export is absent or isn't a function.
     */
    getNamedExportFunctionParameters(fileUri: string, exportName: string, _visited: Set<string> = new Set()): ParamInfo[] | null {
        const funcNode = this.resolveNamedExportFunctionNode(fileUri, exportName, _visited);
        return funcNode ? this.extractFunctionParameters(funcNode) : null;
    }

    /**
     * Null-guard contract of a NAMED exported function (nullGuardContract.ts):
     * the parameter indices whose argument is proven non-null by a falsy result.
     * Resolved from the same export/re-export walk as the parameter signature and
     * stamped onto the imported symbol (docs/error-guard-null-narrowing.md).
     * Returns null when the export isn't a resolvable function.
     */
    getNamedExportNullGuardParams(fileUri: string, exportName: string): number[] | null {
        const funcNode = this.resolveNamedExportFunctionNode(fileUri, exportName, new Set());
        return funcNode ? inferNullGuardParams(funcNode) : null;
    }

    /** The AST node of a NAMED exported function, following barrel/namespace
     *  re-export chains. Shared resolution for the signature and null-guard
     *  contract extractors above. */
    private resolveNamedExportFunctionNode(fileUri: string, exportName: string, _visited: Set<string>): AstNode | null {
        try {
            // Cycle guard for re-export chains (`export { x } ←→`).
            const visitKey = `${fileUri}#${exportName}`;
            if (_visited.has(visitKey)) return null;
            _visited.add(visitKey);

            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;
            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const ast = this.getCachedAst(fileUri, source);
            if (!ast) return null;
            const body = ast.type === 'Program' ? ast.body : [];

            const topLevelFuncs = new Map<string, AstNode>();
            const topLevelVarInits = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) topLevelFuncs.set(stmt.id.name, stmt);
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations) {
                        if (decl.id.name && decl.init) topLevelVarInits.set(decl.id.name, decl.init);
                    }
                }
            }

            let funcNode: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type !== 'ExportNamedDeclaration') continue;
                const exportNode = stmt;
                if (exportNode.declaration) {
                    if (exportNode.declaration.type === 'FunctionDeclaration') {
                        const funcDecl = exportNode.declaration;
                        if (funcDecl.id.name === exportName) { funcNode = funcDecl; break; }
                    } else if (exportNode.declaration.type === 'VariableDeclaration') {
                        const varDecl = exportNode.declaration;
                        for (const declarator of varDecl.declarations) {
                            if (declarator.id.name !== exportName) continue;
                            const init = declarator.init;
                            if (init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')) {
                                funcNode = init;
                            } else if (init && init.type === 'Identifier') {
                                // `export const describe = someFn;` — chase an imported alias.
                                // docs/tc-barrel-reexport-typing.md
                                const reexp = this.findReexportedSource(fileUri, init.name);
                                if (reexp) return this.resolveNamedExportFunctionNode(reexp.uri, reexp.importedName, _visited);
                            } else if (init && init.type === 'MemberExpression') {
                                // `export const describe = dsl.describe;` — barrel re-export
                                // through a namespace member. docs/tc-barrel-reexport-typing.md
                                const nsAlias = this.resolveNamespaceMemberAlias(fileUri, init);
                                if (nsAlias) return this.resolveNamedExportFunctionNode(nsAlias.uri, nsAlias.member, _visited);
                            }
                            break;
                        }
                        if (funcNode) break;
                    }
                } else if (exportNode.specifiers) {
                    let matched = false;
                    for (const specifier of exportNode.specifiers) {
                        if (specifier.exported.name !== exportName) continue;
                        matched = true;
                        const localName = specifier.local.name;
                        if (topLevelFuncs.has(localName)) {
                            funcNode = topLevelFuncs.get(localName)!;
                        } else {
                            const init = topLevelVarInits.get(localName);
                            if (init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')) {
                                funcNode = init;
                            } else if (init && init.type === 'MemberExpression') {
                                const nsAlias = this.resolveNamespaceMemberAlias(fileUri, init);
                                if (nsAlias) return this.resolveNamedExportFunctionNode(nsAlias.uri, nsAlias.member, _visited);
                            } else {
                                // Re-export: `import { x } from './impl'; export { x };` — the
                                // name isn't declared here, it's forwarded. Follow the chain to
                                // the source module and resolve the signature there.
                                const reexp = this.findReexportedSource(fileUri, localName);
                                if (reexp) return this.resolveNamedExportFunctionNode(reexp.uri, reexp.importedName, _visited);
                            }
                        }
                        break;
                    }
                    if (matched) break;
                }
            }

            return funcNode;
        } catch {
            return null;
        }
    }

    /**
     * Extract the parameter signature of the DEFAULT exported function (inline
     * `export default function(){}` or `export default foo` where foo is declared
     * above). Returns null if there's no default-exported function.
     */
    getDefaultExportFunctionParameters(fileUri: string): ParamInfo[] | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;
            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const ast = this.getCachedAst(fileUri, source);
            if (!ast) return null;
            const body = ast.type === 'Program' ? ast.body : [];

            const topLevelFuncs = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id.name) topLevelFuncs.set(stmt.id.name, stmt);
            }

            let defaultDecl: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type === 'ExportDefaultDeclaration') { defaultDecl = stmt.declaration; break; }
            }
            if (!defaultDecl) return null;

            let funcNode: AstNode | null = null;
            if (defaultDecl.type === 'FunctionDeclaration' || defaultDecl.type === 'FunctionExpression') {
                funcNode = defaultDecl;
            } else if (defaultDecl.type === 'Identifier') {
                const name = defaultDecl.name;
                if (topLevelFuncs.has(name)) funcNode = topLevelFuncs.get(name)!;
            }

            return funcNode ? this.extractFunctionParameters(funcNode) : null;
        } catch {
            return null;
        }
    }

    /**
     * Build a ParamInfo[] from a resolved function node, reading each parameter's
     * JSDoc `@param {T}` type (unknown if unannotated). A forward declaration has
     * no real signature, so it yields null. Mirrors the in-file capture in
     * semanticAnalyzer's visitFunctionDeclaration.
     */
    private extractFunctionParameters(funcNode: AstNode): ParamInfo[] | null {
        const fn = asFunctionLike(funcNode);
        if (fn?.type === 'FunctionDeclaration' && fn.forwardDeclaration) return null;
        const params = fn?.params ?? [];
        const restParam = fn?.restParam;
        const leadingJsDoc = fn?.leadingJsDoc;

        const jsdocTypes = new Map<string, UcodeDataType>();
        const jsdocOptional = new Set<string>();
        if (leadingJsDoc?.value) {
            const parsed = parseJsDocComment(leadingJsDoc.value);
            for (const tag of parsed.tags) {
                if (tag.tag !== 'param' || !tag.name) continue;
                // `[name]` bracket optionality, exactly as the in-file capture threads it
                // into ParamInfo.optional — dropping it here made every cross-file call
                // that omits such a param a UC2003 false positive. (`{T=}`/`{?T}`/`{T?}`
                // arrive as T|null from resolveTypeExpression and need no flag.)
                if (tag.optional) jsdocOptional.add(tag.name);
                const resolved = resolveTypeExpression(tag.typeExpression);
                if (resolved !== null) jsdocTypes.set(tag.name, resolved);
            }
        }

        const result: ParamInfo[] = params.map((p) => {
            const declared = jsdocTypes.get(p.name) ?? (UcodeType.UNKNOWN as UcodeDataType);
            const optional = jsdocOptional.has(p.name);
            return {
                name: p.name,
                // An omitted optional arg IS null at runtime — same widening as in-file.
                type: optional && declared !== UcodeType.UNKNOWN ? widenWithNull(declared) : declared,
                isRest: false,
                ...(optional ? { optional: true } : {}),
            };
        });
        if (restParam) {
            result.push({ name: restParam.name, type: UcodeType.ARRAY as UcodeDataType, isRest: true });
        }
        return result;
    }

    /**
     * Given a resolved function node and the file's top-level functions, derive the
     * object-shape return info (property types + nested function return types) from
     * the function's return statements. Shared by default- and named-export
     * factory-return inference. Returns null unless an object literal is returned in
     * all branches.
     */
    private computeFunctionReturnInfo(
        funcNode: AstNode,
        topLevelFuncs: Map<string, AstNode>
    ): FactoryReturnInfo | null {
        const fn = asFunctionLike(funcNode);
        if (!fn) return null;
        const funcBody = fn.body;

        // Collect local function nodes and variable initializers within the function body
        const localFuncNodes = new Map<string, AstNode>();
        const localVarInits = new Map<string, AstNode>();
        const bodyStmts = funcBody.type === 'BlockStatement' ? funcBody.body : [];
        for (const stmt of bodyStmts) {
            if (stmt.type === 'FunctionDeclaration' && stmt.id.name) {
                localFuncNodes.set(stmt.id.name, stmt);
            }
            if (stmt.type === 'VariableDeclaration') {
                for (const decl of stmt.declarations) {
                    if (decl.id.name && decl.init) {
                        localVarInits.set(decl.id.name, decl.init);
                    }
                }
            }
        }

        // Find return statements at the top level of the function body (not nested functions).
        // returnPropMaps[i] / returnLocMaps[i] correspond to the same i-th return branch.
        // Non-object-literal returns (explicit `return null`, `return expr`, bare
        // `return;`) land in extraReturnTypes so the factory's return type stays
        // honest (docs/type-soundness-audit.md H-2).
        const returnPropMaps: Map<string, UcodeDataType>[] = [];
        const returnLocMaps: Map<string, { start: number; end: number }>[] = [];
        const extraReturnTypes: UcodeDataType[] = [];
        this.collectReturnObjectProperties(bodyStmts, localFuncNodes, localVarInits, topLevelFuncs, returnPropMaps, returnLocMaps, extraReturnTypes);

        if (returnPropMaps.length === 0) return null;

        // Intersection merge on KEYS (only always-present properties survive),
        // union on their TYPES — branch 0's type is not more true than branch 1's
        // (`{v: 1}` / `{v: "s"}` must read back as `integer | string`).
        const merged = new Map<string, UcodeDataType>(returnPropMaps[0]);
        for (let i = 1; i < returnPropMaps.length; i++) {
            const entry = returnPropMaps[i]!;
            for (const key of [...merged.keys()]) {
                if (!entry.has(key)) {
                    merged.delete(key);
                    continue;
                }
                const a = merged.get(key)!;
                const b = entry.get(key)!;
                if (a !== b) merged.set(key, this.unionTypes(a, b));
            }
        }

        if (merged.size === 0) return null;

        // A body that can fall off the end returns null implicitly.
        if (!this.blockAlwaysReturns(funcBody)) {
            extraReturnTypes.push(UcodeType.NULL as UcodeDataType);
        }

        // Definition locations taken from the first return branch (offsets are
        // file-local; the caller stamps the file URI).
        const propertyDefinitionLocations = new Map<string, { start: number; end: number }>();
        const firstLocs = returnLocMaps[0];
        if (firstLocs) {
            for (const key of merged.keys()) {
                const loc = firstLocs.get(key);
                if (loc) propertyDefinitionLocations.set(key, loc);
            }
        }

        // Analyze return types of function-typed properties
        const propertyFunctionReturnTypes = this.analyzePropertyFunctionReturnTypes(
            merged, localFuncNodes, localVarInits, topLevelFuncs,
            fn.params
        );

        // The returned OBJECT is joined with every non-object branch (and the
        // implicit fall-through null) — a caller deref without a guard is the
        // exact crash the null-safety warnings exist for.
        let returnType: UcodeDataType = UcodeType.OBJECT as UcodeDataType;
        for (const t of extraReturnTypes) {
            returnType = this.unionTypes(returnType, t);
        }

        const returnInfo: FactoryReturnInfo = {
            returnType,
            returnPropertyTypes: merged
        };
        if (propertyFunctionReturnTypes.size > 0) {
            returnInfo.propertyFunctionReturnTypes = propertyFunctionReturnTypes;
        }
        if (propertyDefinitionLocations.size > 0) {
            returnInfo.propertyDefinitionLocations = propertyDefinitionLocations;
        }
        return returnInfo;
    }

    /**
     * Recursively collect property types from return statements that return object literals.
     * Skips nested function bodies to only capture returns from the target function.
     */
    private collectReturnObjectProperties(
        stmts: AstNode[],
        localFuncNodes: Map<string, AstNode>,
        localVarInits: Map<string, AstNode>,
        topLevelFuncs: Map<string, AstNode>,
        result: Map<string, UcodeDataType>[],
        resultLocs: Map<string, { start: number; end: number }>[],
        extraReturnTypes?: UcodeDataType[]
    ): void {
        for (const stmt of stmts) {
            if (stmt.type === 'ReturnStatement') {
                const arg = stmt.argument;
                if (arg?.type === 'ObjectExpression') {
                    const locs = new Map<string, { start: number; end: number }>();
                    const propTypes = this.extractObjectPropertyTypes(arg, localFuncNodes, localVarInits, topLevelFuncs, locs);
                    if (propTypes.size > 0) {
                        result.push(propTypes);
                        resultLocs.push(locs);
                    }
                } else if (extraReturnTypes) {
                    // Non-object-literal branch: bare `return;` is null in ucode;
                    // anything else is typed like inferFunctionReturnType would.
                    extraReturnTypes.push(arg
                        ? this.inferReturnArgType(arg, localVarInits)
                        : UcodeType.NULL as UcodeDataType);
                }
            } else if (stmt.type === 'FunctionDeclaration') {
                // Skip nested function bodies
                continue;
            } else if (stmt.type === 'IfStatement') {
                const consequentBlock = stmt.consequent.type === 'BlockStatement' ? stmt.consequent.body : [stmt.consequent];
                this.collectReturnObjectProperties(consequentBlock, localFuncNodes, localVarInits, topLevelFuncs, result, resultLocs, extraReturnTypes);
                if (stmt.alternate) {
                    const alternateBlock = stmt.alternate.type === 'BlockStatement' ? stmt.alternate.body : [stmt.alternate];
                    this.collectReturnObjectProperties(alternateBlock, localFuncNodes, localVarInits, topLevelFuncs, result, resultLocs, extraReturnTypes);
                }
            } else if (stmt.type === 'BlockStatement') {
                this.collectReturnObjectProperties(stmt.body, localFuncNodes, localVarInits, topLevelFuncs, result, resultLocs, extraReturnTypes);
            }
        }
    }

    /** Union two data types, flattening nested unions (createUnionType dedups). */
    private unionTypes(a: UcodeDataType, b: UcodeDataType): UcodeDataType {
        const members: SingleType[] = [];
        for (const t of [a, b]) {
            if (typeof t === 'string') {
                members.push(t as UcodeType);
            } else if (isUnionType(t)) {
                members.push(...t.types);
            } else if (isObjectType(t) || isArrayType(t)) {
                members.push(t as SingleType);
            } else {
                members.push(UcodeType.UNKNOWN);
            }
        }
        return createUnionType(members);
    }

    /** Conservative "every path returns" check, mirroring the shape of
     *  typeChecker.blockAlwaysTerminates (minus the symbol-table lookup for
     *  user `neverReturns` functions — unavailable here). False negatives just
     *  add `| null` to a factory's return union: noise, never a missed crash. */
    private blockAlwaysReturns(block: AstNode | null | undefined): boolean {
        if (!block || typeof block !== 'object') return false;
        const stmts: AstNode[] = block.type === 'BlockStatement' ? block.body : [block];
        if (stmts.length === 0) return false;
        const last = stmts[stmts.length - 1]!;
        if (last.type === 'ReturnStatement') return true;
        if (last.type === 'ExpressionStatement') {
            const expr = last.expression;
            if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier'
                && (expr.callee.name === 'die' || expr.callee.name === 'exit')) return true;
        }
        if (last.type === 'TryStatement') {
            if (!this.blockAlwaysReturns(last.block)) return false;
            return !last.handler || this.blockAlwaysReturns(last.handler.body);
        }
        if (last.type === 'IfStatement') {
            return this.blockAlwaysReturns(last.consequent)
                && !!last.alternate && this.blockAlwaysReturns(last.alternate);
        }
        return false;
    }

    /**
     * Extract property types from an ObjectExpression, resolving identifiers
     * against known local and top-level declarations.
     */
    private extractObjectPropertyTypes(
        objNode: AstNode,
        localFuncNodes: Map<string, AstNode>,
        localVarInits: Map<string, AstNode>,
        topLevelFuncs: Map<string, AstNode>,
        outLocs?: Map<string, { start: number; end: number }>
    ): Map<string, UcodeDataType> {
        const propertyTypes = new Map<string, UcodeDataType>();
        const setLoc = (key: string, node: { start: number; end: number } | null | undefined) => {
            if (outLocs && node) {
                outLocs.set(key, { start: node.start, end: node.end });
            }
        };
        if (objNode.type !== 'ObjectExpression') return propertyTypes;
        for (const prop of objNode.properties) {
            if (prop.type !== 'Property') continue;
            const rawKey = propertyKeyValue(prop);
            if (!rawKey) continue;
            const key = rawKey as string;

            const val = prop.value;

            if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                // Inline method: jump to the function expression itself.
                setLoc(key, val);
            } else if (val.type === 'Identifier') {
                const name = val.name;
                // Prefer the referenced declaration's location so go-to-def lands on
                // `function exec()` rather than the `exec` reference in the return object.
                const declNode = localFuncNodes.get(name) || topLevelFuncs.get(name);
                if (declNode) {
                    propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                    setLoc(key, declNode);
                } else if (localVarInits.has(name)) {
                    const init = localVarInits.get(name)!;
                    propertyTypes.set(key, this.inferNodeType(init));
                    setLoc(key, init);
                } else {
                    propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                }
            } else if (val.type === 'Literal') {
                if (typeof val.value === 'number') {
                    // Exponent notation (`1e5`) is a double literal (ticket 115).
                    propertyTypes.set(key, ((val.literalType === 'double' || !Number.isInteger(val.value)) ? UcodeType.DOUBLE : UcodeType.INTEGER) as UcodeDataType);
                } else if (typeof val.value === 'string') {
                    propertyTypes.set(key, UcodeType.STRING as UcodeDataType);
                } else if (typeof val.value === 'boolean') {
                    propertyTypes.set(key, UcodeType.BOOLEAN as UcodeDataType);
                } else {
                    propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                }
                setLoc(key, val);
            } else if (val.type === 'ObjectExpression') {
                propertyTypes.set(key, UcodeType.OBJECT as UcodeDataType);
                setLoc(key, val);
            } else if (val.type === 'ArrayExpression') {
                propertyTypes.set(key, UcodeType.ARRAY as UcodeDataType);
                setLoc(key, val);
            } else {
                propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
            }
        }
        return propertyTypes;
    }

    /**
     * For function-typed properties in a factory return object, analyze what
     * those inner functions return (e.g., uci_ctx returns a uci.cursor).
     * Uses heuristic tracing: follows variable assignments and call patterns.
     */
    private analyzePropertyFunctionReturnTypes(
        propertyTypes: Map<string, UcodeDataType>,
        localFuncNodes: Map<string, AstNode>,
        localVarInits: Map<string, AstNode>,
        topLevelFuncs: Map<string, AstNode>,
        params: AstNode[]
    ): Map<string, string> {
        const result = new Map<string, string>();

        // Build a set of parameter names for heuristic module detection
        const paramNames = new Set<string>();
        for (const p of params) {
            if (p.type === 'Identifier') paramNames.add((p as IdentifierNode).name);
        }

        for (const [propName, propType] of propertyTypes) {
            if (propType !== UcodeType.FUNCTION as UcodeDataType) continue;

            // Find the function node for this property
            const funcNode = localFuncNodes.get(propName) || topLevelFuncs.get(propName);
            if (!funcNode) continue;

            const returnTypeHint = this.inferInnerFunctionReturnTypeHint(
                funcNode, localVarInits, paramNames
            );
            if (returnTypeHint) {
                result.set(propName, returnTypeHint);
            }
        }
        return result;
    }

    /**
     * Analyze an inner function's return statements to determine what known
     * object type it returns (e.g., uci.cursor, fs.file).
     */
    private inferInnerFunctionReturnTypeHint(
        funcNode: AstNode,
        localVarInits: Map<string, AstNode>,
        paramNames: Set<string>
    ): string | null {
        const fn = asFunctionLike(funcNode);
        if (!fn) return null;
        const body = fn.body;

        const stmts = body.type === 'BlockStatement' ? body.body : [];

        // Also collect assignments within the function body to augment localVarInits.
        // e.g., _cursor = cursor_fn() where _cursor was initially null.
        const augmentedInits = new Map(localVarInits);
        this.collectAssignments(stmts, augmentedInits);

        // Collect return values from the function (non-recursive, skip nested functions)
        const returnValues: AstNode[] = [];
        for (const stmt of stmts) {
            this.collectReturnValues(stmt, returnValues);
        }

        // First try to resolve to a known object type (e.g., uci.cursor)
        for (const retVal of returnValues) {
            const hint = this.resolveNodeToKnownType(retVal, augmentedInits, paramNames);
            if (hint) return hint;
        }

        // Fall back to inferring primitive return types from return expressions
        if (returnValues.length > 0) {
            return this.inferPrimitiveReturnType(returnValues);
        }
        return null;
    }

    /**
     * Infer a primitive return type from a set of return value AST nodes.
     * Returns type strings like "string", "integer", "boolean", "object", "array".
     */
    private inferPrimitiveReturnType(returnValues: AstNode[]): string | null {
        const types = new Set<string>();
        for (const node of returnValues) {
            const t = this.inferReturnExprType(node);
            if (t) types.add(t);
        }
        if (types.size === 0) return null;
        if (types.size === 1) return [...types][0]!;
        // Multiple types — return as union
        return [...types].join(' | ');
    }

    /**
     * Infer the type of a return expression.
     */
    private inferReturnExprType(node: AstNode): string | null {
        if (!node) return null;

        // Literals
        if (node.type === 'Literal') {
            const val = node.value;
            if (typeof val === 'string') return 'string';
            // Exponent notation (`1e5`) is a double literal (ticket 115).
            if (typeof val === 'number') return (node.literalType === 'double' || !Number.isInteger(val)) ? 'double' : 'integer';
            if (typeof val === 'boolean') return 'boolean';
            if (val === null) return 'null';
            return null;
        }

        // String operations: string concatenation, template literals
        if (node.type === 'BinaryExpression' && node.operator === '+') {
            const left = this.inferReturnExprType(node.left);
            const right = this.inferReturnExprType(node.right);
            if (left === 'string' || right === 'string') return 'string';
        }
        if (node.type === 'TemplateLiteral') return 'string';

        // Known builtin function calls that return specific types
        if (node.type === 'CallExpression') {
            if (node.callee.type === 'Identifier') {
                const name = node.callee.name;
                const returnType = this.resolveBuiltinReturnType(name);
                if (returnType) return returnType;
            }
        }

        // Object/Array expressions
        if (node.type === 'ObjectExpression') return 'object';
        if (node.type === 'ArrayExpression') return 'array';

        // Unary ! returns boolean
        if (node.type === 'UnaryExpression' && node.operator === '!') return 'boolean';

        // Comparison operators return boolean
        if (node.type === 'BinaryExpression') {
            const op: string = node.operator;
            if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(op)) return 'boolean';
        }

        // Logical || — take the type of the right side if left could be falsy
        if (node.type === 'LogicalExpression' && node.operator === '||') {
            return this.inferReturnExprType(node.right);
        }

        return null;
    }

    /**
     * Map well-known ucode builtin function names to their return types.
     */
    private resolveBuiltinReturnType(funcName: string): string | null {
        switch (funcName) {
            // String functions
            case 'trim': case 'ltrim': case 'rtrim':
            case 'replace': case 'substr': case 'sprintf':
            case 'join': case 'uc': case 'lc':
            case 'chr': case 'hex': case 'b64enc':
            case 'type': case 'proto':
            case 'readline':
                return 'string';
            // Array functions
            case 'split': case 'sort': case 'reverse':
            case 'keys': case 'values': case 'filter':
            case 'map': case 'slice':
                return 'array';
            // Number functions
            case 'length': case 'index': case 'rindex':
            case 'ord': case 'int': case 'time':
            case 'system':
                return 'integer';
            // Boolean functions
            case 'exists': case 'delete':
                return 'boolean';
            // Match returns array|null
            case 'match':
                return 'array | null';
            default:
                return null;
        }
    }

    /**
     * Collect assignment expressions (x = expr) from statements to augment
     * variable init tracking. Skips nested function bodies.
     */
    private collectAssignments(stmts: AstNode[], inits: Map<string, AstNode>): void {
        for (const stmt of stmts) {
            if (!stmt) continue;
            // Skip nested functions
            if (stmt.type === 'FunctionDeclaration' || stmt.type === 'FunctionExpression' ||
                stmt.type === 'ArrowFunctionExpression') continue;

            // Direct assignment: x = expr
            if (stmt.type === 'ExpressionStatement') {
                const expr = stmt.expression;
                if (expr.type === 'AssignmentExpression' && expr.left.type === 'Identifier') {
                    const name = expr.left.name;
                    // Only augment if current init is null/unknown
                    const existing = inits.get(name);
                    if (!existing || (existing.type === 'Literal' && existing.value === null)) {
                        inits.set(name, expr.right);
                    }
                }
            }

            // Recurse into control flow (if/for/while bodies)
            switch (stmt.type) {
                case 'BlockStatement':
                    this.collectAssignments(stmt.body, inits);
                    break;
                case 'ForStatement':
                case 'ForInStatement':
                case 'WhileStatement':
                    this.collectAssignments([stmt.body], inits);
                    break;
                case 'IfStatement':
                    this.collectAssignments([stmt.consequent], inits);
                    if (stmt.alternate) this.collectAssignments([stmt.alternate], inits);
                    break;
                case 'TryStatement':
                    this.collectAssignments([stmt.block], inits);
                    break;
                case 'CatchClause':
                    this.collectAssignments([stmt.body], inits);
                    break;
            }
        }
    }

    /**
     * Collect return value nodes from statements (skips nested function bodies).
     */
    private collectReturnValues(node: AstNode, results: AstNode[]): void {
        if (!node) return;
        // Skip nested function bodies
        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression') return;

        if (node.type === 'ReturnStatement') {
            const arg = node.argument;
            if (arg) results.push(arg);
            return;
        }

        // Recurse into control flow
        switch (node.type) {
            case 'Program':
            case 'BlockStatement':
                for (const c of node.body) this.collectReturnValues(c, results);
                break;
            case 'ForStatement':
            case 'ForInStatement':
            case 'WhileStatement':
                this.collectReturnValues(node.body, results);
                break;
            case 'IfStatement':
                this.collectReturnValues(node.consequent, results);
                if (node.alternate) this.collectReturnValues(node.alternate, results);
                break;
            case 'TryStatement':
                this.collectReturnValues(node.block, results);
                if (node.handler) this.collectReturnValues(node.handler, results);
                break;
            case 'CatchClause':
                this.collectReturnValues(node.body, results);
                break;
            case 'SwitchCase':
                for (const c of node.consequent) this.collectReturnValues(c, results);
                break;
        }
    }

    /**
     * Try to resolve an AST node to a known object type string by tracing
     * variable assignments and call patterns.
     * Returns hints like "uci.cursor", "fs.file", etc.
     */
    private resolveNodeToKnownType(
        node: AstNode,
        localVarInits: Map<string, AstNode>,
        paramNames: Set<string>,
        depth: number = 0
    ): string | null {
        if (depth > 5) return null; // prevent infinite loops

        // Direct identifier — trace through variable inits
        if (node.type === 'Identifier') {
            const name = node.name;
            const init = localVarInits.get(name);
            if (init) {
                return this.resolveNodeToKnownType(init, localVarInits, paramNames, depth + 1);
            }
            return null;
        }

        // Call expression — check if it's a known pattern
        if (node.type === 'CallExpression') {
            const callee = node.callee;

            if (callee.type === 'Identifier') {
                const funcName = callee.name;

                // Direct call: cursor(), connect(), open(), etc.
                const directResult = this.resolveKnownFunctionReturnType(funcName);
                if (directResult) return directResult;

                // Indirect call: variable holding a function reference — e.g., cursor_fn()
                // where cursor_fn = uci_mod.cursor
                const calleeInit = localVarInits.get(funcName);
                if (calleeInit?.type === 'MemberExpression') {
                    if (calleeInit.property.type === 'Identifier') {
                        const methodName = calleeInit.property.name;
                        const indirectResult = this.resolveKnownFunctionReturnType(methodName);
                        if (indirectResult) return indirectResult;
                    }
                }
            }

            // Member call: obj.cursor(), param.cursor(), etc.
            if (callee.type === 'MemberExpression') {
                if (callee.property.type === 'Identifier') {
                    const methodName = callee.property.name;
                    return this.resolveKnownFunctionReturnType(methodName);
                }
            }
        }

        return null;
    }

    /**
     * Map well-known function/method names to the object types they return.
     */
    private resolveKnownFunctionReturnType(funcName: string): string | null {
        switch (funcName) {
            case 'cursor': return 'uci.cursor';
            case 'connect': return 'ubus.connection';
            case 'open': return 'fs.file';  // could be fs.open or io.open
            case 'opendir': return 'fs.dir';
            case 'popen': return 'fs.proc';
            case 'listener': return 'nl80211.listener';
            default: return null;
        }
    }

    /**
     * Infer a simple type from an AST node (for variable initializers).
     */
    private inferNodeType(node: AstNode): UcodeDataType {
        switch (node.type) {
            case 'ObjectExpression': return UcodeType.OBJECT as UcodeDataType;
            case 'ArrayExpression': return UcodeType.ARRAY as UcodeDataType;
            case 'FunctionExpression':
            case 'ArrowFunctionExpression': return UcodeType.FUNCTION as UcodeDataType;
            case 'TemplateLiteral': return UcodeType.STRING as UcodeDataType;
            case 'UnaryExpression': {
                // ucode parses negative number literals as `-` UnaryExpression over a
                // Literal, so `INVALID_PARAMS: -32602` is a UnaryExpression, not a Literal.
                // Without this, every negative-valued object-literal constant resolved to
                // UNKNOWN at the import site (positive `NONE: 0` worked). `+x`/`-x` follow
                // the operand's numeric type; `!x` is boolean; `~x` is integer.
                const un = node;
                if (un.operator === '!') return UcodeType.BOOLEAN as UcodeDataType;
                if (un.operator === '~') return UcodeType.INTEGER as UcodeDataType;
                if (un.operator === '-' || un.operator === '+') {
                    const operand = this.inferNodeType(un.argument);
                    if (operand === UcodeType.INTEGER || operand === UcodeType.DOUBLE) return operand;
                    return UcodeType.INTEGER as UcodeDataType;
                }
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            case 'Literal': {
                const val = node.value;
                if (typeof val === 'string') return UcodeType.STRING as UcodeDataType;
                // Exponent notation (`1e5`) is a double literal (ticket 115).
                if (typeof val === 'number') return ((node.literalType === 'double' || !Number.isInteger(val)) ? UcodeType.DOUBLE : UcodeType.INTEGER) as UcodeDataType;
                if (typeof val === 'boolean') return UcodeType.BOOLEAN as UcodeDataType;
                if (val === null) return UcodeType.NULL as UcodeDataType;
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            case 'BinaryExpression': {
                // String concatenation: any + with a string operand → string
                const binNode = node;
                const binOp: string = binNode.operator;
                if (binOp === '+') {
                    const leftType = this.inferNodeType(binNode.left);
                    const rightType = this.inferNodeType(binNode.right);
                    if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
                        return UcodeType.STRING as UcodeDataType;
                    }
                    // Numeric operations
                    if ((leftType === UcodeType.INTEGER || leftType === UcodeType.DOUBLE) &&
                        (rightType === UcodeType.INTEGER || rightType === UcodeType.DOUBLE)) {
                        return (leftType === UcodeType.DOUBLE || rightType === UcodeType.DOUBLE)
                            ? UcodeType.DOUBLE as UcodeDataType : UcodeType.INTEGER as UcodeDataType;
                    }
                }
                // Comparison operators return boolean
                if (['==', '!=', '<', '>', '<=', '>=', '===', '!=='].includes(binOp)) {
                    return UcodeType.BOOLEAN as UcodeDataType;
                }
                // Arithmetic operators with known numeric operands
                if (['-', '*', '/', '%'].includes(binOp)) {
                    return UcodeType.INTEGER as UcodeDataType;
                }
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            case 'CallExpression': {
                // sprintf always returns string
                const callNode = node;
                if (callNode.callee.type === 'Identifier') {
                    const name = callNode.callee.name;
                    if (name === 'sprintf' || name === 'substr' || name === 'trim' || name === 'ltrim' || name === 'rtrim' ||
                        name === 'join' || name === 'replace' || name === 'uchr' || name === 'lc' || name === 'uc') {
                        return UcodeType.STRING as UcodeDataType;
                    }
                    if (name === 'length' || name === 'index' || name === 'rindex' || name === 'ord' ||
                        name === 'hex' || name === 'int' || name === 'time' || name === 'printf') {
                        return UcodeType.INTEGER as UcodeDataType;
                    }
                    if (name === 'split' || name === 'keys' || name === 'values' || name === 'sort' || name === 'reverse' ||
                        name === 'splice' || name === 'filter' || name === 'map') {
                        return UcodeType.ARRAY as UcodeDataType;
                    }
                    if (name === 'type') return UcodeType.STRING as UcodeDataType;
                }
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            default: return UcodeType.UNKNOWN as UcodeDataType;
        }
    }

    /**
     * Infer the return type of a function from its return statements.
     * Builds a UnionType when return statements yield distinct types, so a
     * function that returns `string` on the happy path and `null` from a catch
     * is reported as `string | null` (the imported call expression's narrowed
     * type then drives diagnostics like nullable-argument). A function with no
     * return statements is treated as always returning `null` (ucode semantics).
     */
    private inferFunctionReturnType(funcNode: AstNode): UcodeDataType | null {
        const fn = asFunctionLike(funcNode);
        if (!fn) return null;
        const body = fn.body;
        if (body.type !== 'BlockStatement') return null;
        const stmts = body.body;

        // Collect top-level `let/const` initializers so `return identifier;`
        // can be resolved through them (a common pattern: build a string in a
        // local then return it). Skips reassignments — we only look at the
        // declarator's init expression. False positives are bounded: if a var
        // is overwritten with a different type later, our inferred type may be
        // wrong but it's still better than UNKNOWN.
        const localVarInits = new Map<string, AstNode>();
        for (const s of stmts) {
            if (s.type === 'VariableDeclaration') {
                for (const d of s.declarations) {
                    if (d.id.name && d.init) localVarInits.set(d.id.name, d.init);
                }
            }
        }

        const returnTypes: UcodeDataType[] = [];
        this.collectReturnTypes(stmts, returnTypes, localVarInits);
        if (returnTypes.length === 0) return null;

        // Convert each collected return type to its base SingleType so the union
        // dedups properly (and unknowns become a clean "we can't say").
        const members: SingleType[] = [];
        let hasUnknown = false;
        for (const t of returnTypes) {
            if (t === UcodeType.UNKNOWN) { hasUnknown = true; continue; }
            if (typeof t === 'string') {
                members.push(t as UcodeType);
            } else if (isUnionType(t)) {
                for (const m of t.types) members.push(m);
            } else if (isObjectType(t) || isArrayType(t)) {
                members.push(t as SingleType);
            } else {
                hasUnknown = true; // ModuleType/DefaultImportType — out of scope here
            }
        }
        if (members.length === 0) return null;
        // If any branch was unknown, fold it in — otherwise the union would
        // overclaim coverage. e.g. one branch `return mystery()` shouldn't
        // turn the function into `string`-only.
        if (hasUnknown) members.push(UcodeType.UNKNOWN);
        return createUnionType(members);
    }

    /**
     * Collect return value types from statements, skipping nested functions.
     * Bare `return;` is counted as a `null` return (ucode's runtime behaviour).
     * Traverses through if/while/for/switch/try-catch/finally branches.
     * `localVarInits` is consulted when a return's argument is an Identifier,
     * so `let x = "foo"; return x;` returns STRING instead of UNKNOWN.
     */
    private collectReturnTypes(stmts: AstNode[], result: UcodeDataType[], localVarInits?: Map<string, AstNode>): void {
        for (const stmt of stmts) {
            if (!stmt || typeof stmt !== 'object') continue;
            if (stmt.type === 'FunctionDeclaration' || stmt.type === 'FunctionExpression' || stmt.type === 'ArrowFunctionExpression') {
                continue; // Skip nested function bodies
            }
            if (stmt.type === 'ReturnStatement') {
                const arg = stmt.argument;
                if (arg) {
                    result.push(this.inferReturnArgType(arg, localVarInits));
                } else {
                    // `return;` (no argument) → null in ucode
                    result.push(UcodeType.NULL as UcodeDataType);
                }
                continue;
            }
            // BlockStatement (and similar) hold their children in .body
            if (stmt.type === 'BlockStatement') {
                this.collectReturnTypes(stmt.body, result, localVarInits);
                continue;
            }
            // Try/catch/finally — handler is a CatchClause with its own .body
            if (stmt.type === 'TryStatement') {
                this.collectReturnTypes([stmt.block], result, localVarInits);
                if (stmt.handler?.body) this.collectReturnTypes([stmt.handler.body], result, localVarInits);
                continue;
            }
            // SwitchStatement — walk each case's consequent
            if (stmt.type === 'SwitchStatement') {
                for (const c of stmt.cases) {
                    this.collectReturnTypes(c.consequent, result, localVarInits);
                }
                continue;
            }
            // Generic recursion into common child slots
            switch (stmt.type) {
                case 'ForStatement':
                case 'ForInStatement':
                case 'WhileStatement':
                    this.collectReturnTypes([stmt.body], result, localVarInits);
                    break;
                case 'IfStatement':
                    this.collectReturnTypes([stmt.consequent], result, localVarInits);
                    if (stmt.alternate) this.collectReturnTypes([stmt.alternate], result, localVarInits);
                    break;
                case 'CatchClause':
                    this.collectReturnTypes([stmt.body], result, localVarInits);
                    break;
                case 'SwitchCase':
                    this.collectReturnTypes(stmt.consequent, result, localVarInits);
                    break;
            }
        }
    }

    /**
     * Type a return statement's argument. For identifiers, resolve through the
     * function's local var initializers so `return x` where `let x = "foo"`
     * gets typed as STRING.
     */
    private inferReturnArgType(node: AstNode, localVarInits?: Map<string, AstNode>): UcodeDataType {
        if (node.type === 'Identifier' && localVarInits) {
            const init = localVarInits.get(node.name);
            if (init) return this.inferNodeType(init);
        }
        return this.inferNodeType(node);
    }

    /**
     * Clear the file cache (useful when files change). Every content-tagged
     * cache must be listed here — leaving one out would let stale data survive
     * an intentional flush.
     */
    clearCache(): void {
        this.fileCache.clear();
        this.exportCache.clear();
        this.namespaceTypesCache.clear();
    }

    /**
     * Clear cache for a specific file. See clearCache() — same applies.
     */
    clearFileCache(fileUri: string): void {
        this.fileCache.delete(fileUri);
        this.exportCache.delete(fileUri);
        this.namespaceTypesCache.delete(fileUri);
    }
}
