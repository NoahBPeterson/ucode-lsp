import { UcodeLexer } from '../lexer';
import { UcodeParser } from '../parser';
import { FunctionDeclarationNode, AstNode, ExportDefaultDeclarationNode, ExportNamedDeclarationNode, IdentifierNode } from '../ast/nodes';
import { discoverAvailableModules, getModuleMembers } from '../moduleDiscovery';
import { UcodeType, UcodeDataType, SingleType, createUnionType, isUnionType, isObjectType, isArrayType } from './symbolTable';
import { getOpenDocumentContent } from './openDocuments';
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

export class FileResolver {
    private workspaceRoot: string;
    // Caches keyed by file URI, tagged with the file's content so a changed file
    // is re-parsed. Content (not mtime) is the validator: mtime can collide on
    // coarse-resolution filesystems or when a tool restores timestamps, which
    // would serve a stale parse. Reading the file is cheap; the win is skipping
    // the lex+parse when the content is unchanged.
    private fileCache = new Map<string, { content: string; defs: FunctionDefinition[] }>();
    private exportCache = new Map<string, { content: string; exports: ModuleExport[] }>();

    /** Public buffer-or-disk read (prefers the open editor buffer) for callers
     *  that need the same content FileResolver parses — e.g. offset→position
     *  conversion in go-to-definition. */
    getFileContent(fileUri: string): string | null {
        return this.readFileContent(fileUri);
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
            
            // Handle relative imports
            if (importPath.startsWith('./') || importPath.startsWith('../')) {
                const resolvedPath = path.resolve(currentDir, importPath);
                
                // Check if file exists
                if (fs.existsSync(resolvedPath)) {
                    return this.filePathToUri(resolvedPath);
                }
                
                // Try with .uc extension if not present
                if (!resolvedPath.endsWith('.uc')) {
                    const withExtension = resolvedPath + '.uc';
                    if (fs.existsSync(withExtension)) {
                        return this.filePathToUri(withExtension);
                    }
                }

                // Fallback: treat relative dot-notation imports as workspace-relative
                if (importPath.startsWith('./')) {
                    const workspaceRelativePath = path.resolve(this.workspaceRoot, importPath.replace(/^\.\//, ''));
                    if (fs.existsSync(workspaceRelativePath)) {
                        return this.filePathToUri(workspaceRelativePath);
                    }

                    if (!workspaceRelativePath.endsWith('.uc')) {
                        const workspaceWithExtension = workspaceRelativePath + '.uc';
                        if (fs.existsSync(workspaceWithExtension)) {
                            return this.filePathToUri(workspaceWithExtension);
                        }
                    }
                }
            }
            
            // Handle absolute paths
            if (importPath.startsWith('/')) {
                const absolutePath = path.resolve(this.workspaceRoot, importPath.substring(1));
                if (fs.existsSync(absolutePath)) {
                    return this.filePathToUri(absolutePath);
                }
            }

            // Handle bare module names — resolve relative to importing file's directory
            // ucode runtime searches the importing file's directory for bare names
            if (!importPath.includes('/') && !importPath.startsWith('.') && !importPath.includes('.')) {
                const localPath = path.resolve(currentDir, importPath + '.uc');
                if (fs.existsSync(localPath)) {
                    return this.filePathToUri(localPath);
                }
                // Also try exact name (no extension)
                const exactPath = path.resolve(currentDir, importPath);
                if (fs.existsSync(exactPath)) {
                    return this.filePathToUri(exactPath);
                }
            }

            // Handle dotted module paths (e.g., 'u1905.u1905d.src.u1905.log')
            if (!importPath.includes('/') && !importPath.startsWith('.')) {
                const dottedPath = importPath.replace(/\./g, '/') + '.uc';
                const resolvedPath = path.resolve(this.workspaceRoot, dottedPath);
                if (fs.existsSync(resolvedPath)) {
                    return this.filePathToUri(resolvedPath);
                }
                // Also try dotted path relative to importing file's directory
                const localDottedPath = path.resolve(currentDir, dottedPath);
                if (fs.existsSync(localDottedPath)) {
                    return this.filePathToUri(localDottedPath);
                }
            }

            return null;
        } catch (error) {
            console.error('Error resolving import path:', error);
            return null;
        }
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
            const body = (parseResult.ast as any)?.body;
            if (!Array.isArray(body)) return null;

            for (const stmt of body) {
                if (!stmt || stmt.type !== 'ImportDeclaration') continue;
                for (const spec of (stmt.specifiers || [])) {
                    if (spec.type === 'ImportSpecifier' && spec.local?.name === localName) {
                        let src = stmt.source?.value;
                        if (typeof src !== 'string') return null;
                        src = src.replace(/^['"]|['"]$/g, '');
                        const resolved = this.resolveImportPath(src, fileUri);
                        if (!resolved) return null;
                        return { uri: resolved, importedName: spec.imported?.name || localName };
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
            const funcNode = node as FunctionDeclarationNode;
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
        const body = (ast as any).body;
        if (!Array.isArray(body)) return;
        for (const stmt of body) {
            const varDecl =
                stmt?.type === 'VariableDeclaration' ? stmt :
                (stmt?.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration')
                    ? stmt.declaration : null;
            if (!varDecl) continue;
            for (const d of varDecl.declarations || []) {
                const id = d?.id;
                if (id?.type !== 'Identifier' || !id.name) continue;
                if (defs.some(def => def.name === id.name)) continue; // function shadows
                defs.push({ name: id.name, node: d, start: id.start, end: id.end, kind: 'variable' });
            }
        }
    }

    /**
     * Visit all child nodes of an AST node
     */
    private visitChildren(node: AstNode, visitor: (child: AstNode) => void): void {
        for (const key in node) {
            if (key === 'type' || key === 'start' || key === 'end') continue;
            
            const value = (node as any)[key];
            if (Array.isArray(value)) {
                for (const item of value) {
                    if (item && typeof item === 'object' && item.type) {
                        visitor(item);
                    }
                }
            } else if (value && typeof value === 'object' && value.type) {
                visitor(value);
            }
        }
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
            for (const stmt of (result.ast as any).body || []) {
                const fnDecl = stmt.type === 'FunctionDeclaration' ? stmt
                    : (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'FunctionDeclaration') ? stmt.declaration
                    : null;
                if (fnDecl?.id?.name) {
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
    private findExports(node: AstNode, exports: ModuleExport[], topLevelFunctionNames?: Set<string>): void {
        if (node.type === 'ExportDefaultDeclaration') {
            const exportNode = node as ExportDefaultDeclarationNode;
            const decl = exportNode.declaration;
            const isFuncDecl = decl?.type === 'FunctionDeclaration' || decl?.type === 'FunctionExpression';
            // Check if default export is an identifier referencing a top-level function
            const isIdentifierFunc = decl?.type === 'Identifier' && topLevelFunctionNames?.has((decl as any).name);
            const exportedName = decl?.type === 'Identifier' ? (decl as any).name : undefined;
            exports.push({
                name: 'default',
                type: 'default',
                isFunction: isFuncDecl || !!isIdentifierFunc,
                exportedName
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
                    const varDecl = exportNode.declaration as any; // VariableDeclarationNode
                    for (const declarator of varDecl.declarations) {
                        exports.push({
                            name: declarator.id.name,
                            type: 'named',
                            isFunction: false
                        });
                    }
                }
            } else if (exportNode.specifiers) {
                // export { foo, bar }
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
            this.findExports(child, exports, topLevelFunctionNames);
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
    private namespaceTypesCache = new Map<string, { content: string; types: Map<string, UcodeDataType> }>();

    getNamespaceExportPropertyTypes(fileUri: string): Map<string, UcodeDataType> | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;
            const content = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const cached = this.namespaceTypesCache.get(fileUri);
            if (cached && cached.content === content) return cached.types;

            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const ast = parser.parse().ast as any;
            const types = new Map<string, UcodeDataType>();

            if (ast?.body) {
                for (const stmt of ast.body) {
                    if (!stmt) continue;
                    if (stmt.type === 'ExportNamedDeclaration') {
                        const decl = (stmt as any).declaration;
                        if (decl?.type === 'FunctionDeclaration' && decl.id?.name) {
                            types.set(decl.id.name, UcodeType.FUNCTION as UcodeDataType);
                        } else if (decl?.type === 'VariableDeclaration') {
                            for (const d of (decl.declarations || [])) {
                                if (d?.id?.name) types.set(d.id.name, this.inferShallowType(d.init));
                            }
                        }
                    } else if (stmt.type === 'ExportDefaultDeclaration') {
                        types.set('default', this.inferShallowType((stmt as any).declaration));
                    }
                }
            }

            this.namespaceTypesCache.set(fileUri, { content, types });
            return types;
        } catch (error) {
            console.error('Error loading namespace export property types:', error);
            return null;
        }
    }

    private inferShallowType(node: any): UcodeDataType {
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
                const lit: any = node;
                if (lit.literalType === 'string' || typeof lit.value === 'string') return UcodeType.STRING as UcodeDataType;
                if (lit.literalType === 'double' || (typeof lit.value === 'number' && !Number.isInteger(lit.value))) return UcodeType.DOUBLE as UcodeDataType;
                if (lit.literalType === 'integer' || typeof lit.value === 'number') return UcodeType.INTEGER as UcodeDataType;
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
    getDefaultExportPropertyTypes(fileUri: string): { propertyTypes: Map<string, UcodeDataType>; nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>; functionReturnTypes?: Map<string, UcodeDataType> } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            parser.setComments(lexer.comments);
            const result = parser.parse();
            if (!result.ast) return null;

            const body = (result.ast as any).body || [];

            // Build maps of top-level variable initializers, function names, and function nodes
            const varInits = new Map<string, AstNode>();
            const funcNames = new Set<string>();
            const funcNodes = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                    funcNames.add(stmt.id.name);
                    funcNodes.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations || []) {
                        if (decl.id?.name && decl.init) {
                            varInits.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Find default export declaration
            let defaultDecl: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type === 'ExportDefaultDeclaration') {
                    defaultDecl = (stmt as ExportDefaultDeclarationNode).declaration;
                    break;
                }
            }
            if (!defaultDecl) return null;

            // Resolve identifier to its initializer
            let objNode = defaultDecl;
            if (objNode.type === 'Identifier' && varInits.has((objNode as any).name)) {
                objNode = varInits.get((objNode as any).name)!;
            }

            // Must be an ObjectExpression
            if (objNode.type !== 'ObjectExpression') return null;

            const propertyTypes = new Map<string, UcodeDataType>();
            const nestedPropertyTypes = new Map<string, Map<string, UcodeDataType>>();
            const functionReturnTypes = new Map<string, UcodeDataType>();

            for (const prop of (objNode as any).properties || []) {
                const key = prop.key?.name || prop.key?.value;
                if (!key) continue;

                const val = prop.value;
                if (!val) continue;

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
                } else if (val.type === 'Literal' || val.type === 'StringLiteral') {
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
                    const nested = this.extractObjectPropertyTypes(val, funcNames, varInits, new Map());
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
                            const nested = this.extractObjectPropertyTypes(init, funcNames, varInits, new Map());
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

            if (propertyTypes.size === 0) return null;
            const exportResult: { propertyTypes: Map<string, UcodeDataType>; nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>; functionReturnTypes?: Map<string, UcodeDataType> } = { propertyTypes };
            if (nestedPropertyTypes.size > 0) {
                exportResult.nestedPropertyTypes = nestedPropertyTypes;
            }
            if (functionReturnTypes.size > 0) {
                exportResult.functionReturnTypes = functionReturnTypes;
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
    getNamedExportTypeInfo(fileUri: string, exportName: string): {
        type: UcodeDataType;
        propertyTypes?: Map<string, UcodeDataType>;
        nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>;
        propertyFunctionReturnTypes?: Map<string, string>;
    } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            parser.setComments(lexer.comments);
            const result = parser.parse();
            if (!result.ast) return null;

            const body = (result.ast as any).body || [];

            // Build maps of top-level variable initializers and function names
            const varInits = new Map<string, AstNode>();
            const funcNames = new Set<string>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                    funcNames.add(stmt.id.name);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations || []) {
                        if (decl.id?.name && decl.init) {
                            varInits.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Find the named export
            for (const stmt of body) {
                if (stmt.type !== 'ExportNamedDeclaration') continue;
                const exportNode = stmt as ExportNamedDeclarationNode;

                if (exportNode.declaration) {
                    if (exportNode.declaration.type === 'FunctionDeclaration') {
                        const funcDecl = exportNode.declaration as FunctionDeclarationNode;
                        if (funcDecl.id.name === exportName) {
                            return { type: UcodeType.FUNCTION as UcodeDataType };
                        }
                    } else if (exportNode.declaration.type === 'VariableDeclaration') {
                        const varDecl = exportNode.declaration as any;
                        for (const declarator of varDecl.declarations) {
                            if (declarator.id?.name !== exportName) continue;

                            const init = declarator.init;
                            if (!init) return { type: UcodeType.UNKNOWN as UcodeDataType };

                            const nodeType = this.inferNodeType(init);
                            if (init.type === 'ObjectExpression') {
                                const propertyTypes = new Map<string, UcodeDataType>();
                                const nestedPropertyTypes = new Map<string, Map<string, UcodeDataType>>();

                                for (const prop of init.properties || []) {
                                    const key = prop.key?.name || prop.key?.value;
                                    if (!key || !prop.value) continue;

                                    const val = prop.value;
                                    if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                                        propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                                    } else if (val.type === 'ObjectExpression') {
                                        propertyTypes.set(key, UcodeType.OBJECT as UcodeDataType);
                                        const nested = this.extractObjectPropertyTypes(val, funcNames, varInits, new Map());
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
                        if (init) {
                            const nodeType = this.inferNodeType(init);
                            if (init.type === 'ObjectExpression') {
                                const propertyTypes = this.extractObjectPropertyTypes(init, funcNames, varInits, new Map());
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
     * Get return type and property types for a default export that is a function.
     * Analyzes the function's return statements for object literals.
     */
    getDefaultExportFunctionReturnInfo(fileUri: string): { returnType: UcodeDataType; returnPropertyTypes: Map<string, UcodeDataType>; propertyFunctionReturnTypes?: Map<string, string> } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            parser.setComments(lexer.comments);
            const result = parser.parse();
            if (!result.ast) return null;

            const body = (result.ast as any).body || [];

            // Build maps of top-level declarations
            const topLevelFuncs = new Map<string, AstNode>();
            const topLevelVars = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                    topLevelFuncs.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations || []) {
                        if (decl.id?.name && decl.init) {
                            topLevelVars.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Find default export declaration
            let defaultDecl: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type === 'ExportDefaultDeclaration') {
                    defaultDecl = (stmt as ExportDefaultDeclarationNode).declaration;
                    break;
                }
            }
            if (!defaultDecl) return null;

            // Resolve to the function node
            let funcNode: AstNode | null = null;
            if (defaultDecl.type === 'FunctionDeclaration' || defaultDecl.type === 'FunctionExpression') {
                funcNode = defaultDecl;
            } else if (defaultDecl.type === 'Identifier') {
                const name = (defaultDecl as IdentifierNode).name;
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
            return null;
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
    getNamedExportFunctionReturnInfo(fileUri: string, exportName: string): { returnType: UcodeDataType; returnPropertyTypes: Map<string, UcodeDataType>; propertyFunctionReturnTypes?: Map<string, string> } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = getOpenDocumentContent(fileUri) ?? fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            parser.setComments(lexer.comments);
            const result = parser.parse();
            if (!result.ast) return null;

            const body = (result.ast as any).body || [];

            // Build maps of top-level declarations (for `export { name }` resolution)
            const topLevelFuncs = new Map<string, AstNode>();
            const topLevelVarInits = new Map<string, AstNode>();
            for (const stmt of body) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                    topLevelFuncs.set(stmt.id.name, stmt);
                }
                if (stmt.type === 'VariableDeclaration') {
                    for (const decl of stmt.declarations || []) {
                        if (decl.id?.name && decl.init) {
                            topLevelVarInits.set(decl.id.name, decl.init);
                        }
                    }
                }
            }

            // Resolve the named export to a function node
            let funcNode: AstNode | null = null;
            for (const stmt of body) {
                if (stmt.type !== 'ExportNamedDeclaration') continue;
                const exportNode = stmt as ExportNamedDeclarationNode;

                if (exportNode.declaration) {
                    if (exportNode.declaration.type === 'FunctionDeclaration') {
                        const funcDecl = exportNode.declaration as FunctionDeclarationNode;
                        if (funcDecl.id?.name === exportName) { funcNode = funcDecl; break; }
                    } else if (exportNode.declaration.type === 'VariableDeclaration') {
                        const varDecl = exportNode.declaration as any;
                        for (const declarator of varDecl.declarations || []) {
                            if (declarator.id?.name !== exportName) continue;
                            const init = declarator.init;
                            if (init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')) {
                                funcNode = init;
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
                            }
                        }
                        break;
                    }
                    if (matched) break;
                }
            }

            if (!funcNode) return null;

            // First try the object-factory path — it produces richer info
            // (property types + nested function return types).
            const factoryInfo = this.computeFunctionReturnInfo(funcNode, topLevelFuncs);
            if (factoryInfo) return factoryInfo;

            // Otherwise infer a simple return type (string, null, integer, array, …)
            // so non-object-returning named exports still propagate their return type
            // to imported call sites. Without this, every `let x = foo()` where foo()
            // returns string|null would type x as `unknown` and downstream diagnostics
            // (e.g. nullable-argument on `index(x, …)`) would degrade to a generic
            // "is unknown" warning.
            const simpleType = this.inferFunctionReturnType(funcNode);
            if (simpleType !== null) {
                return { returnType: simpleType, returnPropertyTypes: new Map() };
            }
            return null;
        } catch {
            return null;
        }
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
    ): { returnType: UcodeDataType; returnPropertyTypes: Map<string, UcodeDataType>; propertyFunctionReturnTypes?: Map<string, string> } | null {
        const funcBody = (funcNode as FunctionDeclarationNode).body;
        if (!funcBody) return null;

        // Collect local function names/nodes and variable initializers within the function body
        const localFuncNodes = new Map<string, AstNode>();
        const localFuncNames = new Set<string>();
        const localVarInits = new Map<string, AstNode>();
        const bodyStmts = (funcBody as any).body || [];
        for (const stmt of bodyStmts) {
            if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                localFuncNames.add(stmt.id.name);
                localFuncNodes.set(stmt.id.name, stmt);
            }
            if (stmt.type === 'VariableDeclaration') {
                for (const decl of stmt.declarations || []) {
                    if (decl.id?.name && decl.init) {
                        localVarInits.set(decl.id.name, decl.init);
                    }
                }
            }
        }

        // Find return statements at the top level of the function body (not nested functions)
        const returnPropMaps: Map<string, UcodeDataType>[] = [];
        this.collectReturnObjectProperties(bodyStmts, localFuncNames, localVarInits, topLevelFuncs, returnPropMaps);

        if (returnPropMaps.length === 0) return null;

        // Intersection merge: keep properties present in ALL return branches
        const merged = new Map<string, UcodeDataType>(returnPropMaps[0]);
        for (let i = 1; i < returnPropMaps.length; i++) {
            const entry = returnPropMaps[i]!;
            for (const key of [...merged.keys()]) {
                if (!entry.has(key)) {
                    merged.delete(key);
                }
            }
        }

        if (merged.size === 0) return null;

        // Analyze return types of function-typed properties
        const propertyFunctionReturnTypes = this.analyzePropertyFunctionReturnTypes(
            merged, localFuncNodes, localVarInits, topLevelFuncs,
            (funcNode as FunctionDeclarationNode).params || []
        );

        const returnInfo: { returnType: UcodeDataType; returnPropertyTypes: Map<string, UcodeDataType>; propertyFunctionReturnTypes?: Map<string, string> } = {
            returnType: UcodeType.OBJECT as UcodeDataType,
            returnPropertyTypes: merged
        };
        if (propertyFunctionReturnTypes.size > 0) {
            returnInfo.propertyFunctionReturnTypes = propertyFunctionReturnTypes;
        }
        return returnInfo;
    }

    /**
     * Recursively collect property types from return statements that return object literals.
     * Skips nested function bodies to only capture returns from the target function.
     */
    private collectReturnObjectProperties(
        stmts: AstNode[],
        localFuncNames: Set<string>,
        localVarInits: Map<string, AstNode>,
        topLevelFuncs: Map<string, AstNode>,
        result: Map<string, UcodeDataType>[]
    ): void {
        for (const stmt of stmts) {
            if (stmt.type === 'ReturnStatement') {
                const arg = (stmt as any).argument;
                if (arg?.type === 'ObjectExpression') {
                    const propTypes = this.extractObjectPropertyTypes(arg, localFuncNames, localVarInits, topLevelFuncs);
                    if (propTypes.size > 0) result.push(propTypes);
                }
            } else if (stmt.type === 'FunctionDeclaration' || stmt.type === 'FunctionExpression' || stmt.type === 'ArrowFunctionExpression') {
                // Skip nested function bodies
                continue;
            } else if (stmt.type === 'IfStatement') {
                const ifStmt = stmt as any;
                if (ifStmt.consequent) {
                    const block = ifStmt.consequent.type === 'BlockStatement' ? ifStmt.consequent.body : [ifStmt.consequent];
                    this.collectReturnObjectProperties(block, localFuncNames, localVarInits, topLevelFuncs, result);
                }
                if (ifStmt.alternate) {
                    const block = ifStmt.alternate.type === 'BlockStatement' ? ifStmt.alternate.body : [ifStmt.alternate];
                    this.collectReturnObjectProperties(block, localFuncNames, localVarInits, topLevelFuncs, result);
                }
            } else if (stmt.type === 'BlockStatement') {
                this.collectReturnObjectProperties((stmt as any).body || [], localFuncNames, localVarInits, topLevelFuncs, result);
            }
        }
    }

    /**
     * Extract property types from an ObjectExpression, resolving identifiers
     * against known local and top-level declarations.
     */
    private extractObjectPropertyTypes(
        objNode: AstNode,
        localFuncNames: Set<string>,
        localVarInits: Map<string, AstNode>,
        topLevelFuncs: Map<string, AstNode>
    ): Map<string, UcodeDataType> {
        const propertyTypes = new Map<string, UcodeDataType>();
        for (const prop of (objNode as any).properties || []) {
            const key = prop.key?.name || prop.key?.value;
            if (!key) continue;

            const val = prop.value;
            if (!val) continue;

            if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
            } else if (val.type === 'Identifier') {
                const name = val.name;
                if (localFuncNames.has(name) || topLevelFuncs.has(name)) {
                    propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                } else if (localVarInits.has(name)) {
                    const init = localVarInits.get(name)!;
                    propertyTypes.set(key, this.inferNodeType(init));
                } else {
                    propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                }
            } else if (val.type === 'Literal') {
                if (typeof val.value === 'number') {
                    propertyTypes.set(key, (Number.isInteger(val.value) ? UcodeType.INTEGER : UcodeType.DOUBLE) as UcodeDataType);
                } else if (typeof val.value === 'string') {
                    propertyTypes.set(key, UcodeType.STRING as UcodeDataType);
                } else if (typeof val.value === 'boolean') {
                    propertyTypes.set(key, UcodeType.BOOLEAN as UcodeDataType);
                } else {
                    propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                }
            } else if (val.type === 'ObjectExpression') {
                propertyTypes.set(key, UcodeType.OBJECT as UcodeDataType);
            } else if (val.type === 'ArrayExpression') {
                propertyTypes.set(key, UcodeType.ARRAY as UcodeDataType);
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
        const body = (funcNode as FunctionDeclarationNode).body;
        if (!body) return null;

        const stmts = (body as any).body || [];

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
            const val = (node as any).value;
            if (typeof val === 'string') return 'string';
            if (typeof val === 'number') return Number.isInteger(val) ? 'integer' : 'double';
            if (typeof val === 'boolean') return 'boolean';
            if (val === null) return 'null';
            return null;
        }

        // String operations: string concatenation, template literals
        if (node.type === 'BinaryExpression' && (node as any).operator === '+') {
            const left = this.inferReturnExprType((node as any).left);
            const right = this.inferReturnExprType((node as any).right);
            if (left === 'string' || right === 'string') return 'string';
        }
        if (node.type === 'TemplateLiteral') return 'string';

        // Known builtin function calls that return specific types
        if (node.type === 'CallExpression') {
            const call = node as any;
            if (call.callee?.type === 'Identifier') {
                const name = call.callee.name;
                const returnType = this.resolveBuiltinReturnType(name);
                if (returnType) return returnType;
            }
        }

        // Object/Array expressions
        if (node.type === 'ObjectExpression') return 'object';
        if (node.type === 'ArrayExpression') return 'array';

        // Unary ! returns boolean
        if (node.type === 'UnaryExpression' && (node as any).operator === '!') return 'boolean';

        // Comparison operators return boolean
        if (node.type === 'BinaryExpression') {
            const op = (node as any).operator;
            if (['==', '!=', '===', '!==', '<', '>', '<=', '>='].includes(op)) return 'boolean';
        }

        // Logical || — take the type of the right side if left could be falsy
        if (node.type === 'LogicalExpression' && (node as any).operator === '||') {
            return this.inferReturnExprType((node as any).right);
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
                const expr = (stmt as any).expression;
                if (expr?.type === 'AssignmentExpression' && expr.left?.type === 'Identifier' && expr.right) {
                    const name = expr.left.name;
                    // Only augment if current init is null/unknown
                    const existing = inits.get(name);
                    if (!existing || (existing.type === 'Literal' && (existing as any).value === null)) {
                        inits.set(name, expr.right);
                    }
                }
            }

            // Recurse into control flow (if/for/while bodies)
            for (const key of ['body', 'consequent', 'alternate', 'block']) {
                const child = (stmt as any)[key];
                if (Array.isArray(child)) {
                    this.collectAssignments(child, inits);
                } else if (child && typeof child === 'object' && child.type) {
                    this.collectAssignments([child], inits);
                }
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
            const arg = (node as any).argument;
            if (arg) results.push(arg);
            return;
        }

        // Recurse into control flow
        for (const key of ['body', 'consequent', 'alternate', 'block', 'handler', 'finalizer']) {
            const child = (node as any)[key];
            if (Array.isArray(child)) {
                for (const c of child) this.collectReturnValues(c, results);
            } else if (child && typeof child === 'object' && child.type) {
                this.collectReturnValues(child, results);
            }
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
            const name = (node as IdentifierNode).name;
            const init = localVarInits.get(name);
            if (init) {
                return this.resolveNodeToKnownType(init, localVarInits, paramNames, depth + 1);
            }
            return null;
        }

        // Call expression — check if it's a known pattern
        if (node.type === 'CallExpression') {
            const call = node as any;

            if (call.callee?.type === 'Identifier') {
                const funcName = call.callee.name;

                // Direct call: cursor(), connect(), open(), etc.
                const directResult = this.resolveKnownFunctionReturnType(funcName);
                if (directResult) return directResult;

                // Indirect call: variable holding a function reference — e.g., cursor_fn()
                // where cursor_fn = uci_mod.cursor
                const calleeInit = localVarInits.get(funcName);
                if (calleeInit?.type === 'MemberExpression') {
                    const member = calleeInit as any;
                    if (member.property?.type === 'Identifier') {
                        const methodName = member.property.name;
                        const indirectResult = this.resolveKnownFunctionReturnType(methodName);
                        if (indirectResult) return indirectResult;
                    }
                }
            }

            // Member call: obj.cursor(), param.cursor(), etc.
            if (call.callee?.type === 'MemberExpression') {
                const member = call.callee;
                if (member.property?.type === 'Identifier') {
                    const methodName = member.property.name;
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
            case 'Literal': {
                const val = (node as any).value;
                if (typeof val === 'string') return UcodeType.STRING as UcodeDataType;
                if (typeof val === 'number') return (Number.isInteger(val) ? UcodeType.INTEGER : UcodeType.DOUBLE) as UcodeDataType;
                if (typeof val === 'boolean') return UcodeType.BOOLEAN as UcodeDataType;
                if (val === null) return UcodeType.NULL as UcodeDataType;
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            case 'BinaryExpression': {
                // String concatenation: any + with a string operand → string
                const binNode = node as any;
                if (binNode.operator === '+') {
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
                if (['==', '!=', '<', '>', '<=', '>=', '===', '!=='].includes(binNode.operator)) {
                    return UcodeType.BOOLEAN as UcodeDataType;
                }
                // Arithmetic operators with known numeric operands
                if (['-', '*', '/', '%'].includes(binNode.operator)) {
                    return UcodeType.INTEGER as UcodeDataType;
                }
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            case 'CallExpression': {
                // sprintf always returns string
                const callNode = node as any;
                if (callNode.callee?.type === 'Identifier') {
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
        const body = (funcNode as any).body;
        if (!body) return null;
        const stmts = body.body || body;
        if (!Array.isArray(stmts)) return null;

        const returnTypes: UcodeDataType[] = [];
        this.collectReturnTypes(stmts, returnTypes);
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
     */
    private collectReturnTypes(stmts: AstNode[], result: UcodeDataType[]): void {
        for (const stmt of stmts) {
            if (!stmt || typeof stmt !== 'object') continue;
            if (stmt.type === 'FunctionDeclaration' || stmt.type === 'FunctionExpression' || stmt.type === 'ArrowFunctionExpression') {
                continue; // Skip nested function bodies
            }
            if (stmt.type === 'ReturnStatement') {
                const arg = (stmt as any).argument;
                if (arg) {
                    result.push(this.inferNodeType(arg));
                } else {
                    // `return;` (no argument) → null in ucode
                    result.push(UcodeType.NULL as UcodeDataType);
                }
                continue;
            }
            // BlockStatement (and similar) hold their children in .body
            if (stmt.type === 'BlockStatement' && Array.isArray((stmt as any).body)) {
                this.collectReturnTypes((stmt as any).body, result);
                continue;
            }
            // Try/catch/finally — handler is a CatchClause with its own .body
            if (stmt.type === 'TryStatement') {
                const tryStmt = stmt as any;
                if (tryStmt.block) this.collectReturnTypes([tryStmt.block], result);
                if (tryStmt.handler?.body) this.collectReturnTypes([tryStmt.handler.body], result);
                if (tryStmt.finalizer) this.collectReturnTypes([tryStmt.finalizer], result);
                continue;
            }
            // SwitchStatement — walk each case's consequent
            if (stmt.type === 'SwitchStatement') {
                const cases = (stmt as any).cases || [];
                for (const c of cases) {
                    if (Array.isArray(c?.consequent)) {
                        this.collectReturnTypes(c.consequent, result);
                    }
                }
                continue;
            }
            // Generic recursion into common child slots
            for (const key of ['body', 'consequent', 'alternate', 'block', 'handler', 'finalizer']) {
                const child = (stmt as any)[key];
                if (child == null) continue;
                if (Array.isArray(child)) {
                    this.collectReturnTypes(child, result);
                } else if (typeof child === 'object' && child.type) {
                    this.collectReturnTypes([child], result);
                }
            }
        }
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
