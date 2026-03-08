import { UcodeLexer } from '../lexer';
import { UcodeParser } from '../parser';
import { FunctionDeclarationNode, AstNode, ExportDefaultDeclarationNode, ExportNamedDeclarationNode, IdentifierNode } from '../ast/nodes';
import { discoverAvailableModules, getModuleMembers } from '../moduleDiscovery';
import { UcodeType, UcodeDataType } from './symbolTable';
import * as path from 'path';
import * as fs from 'fs';

export interface FunctionDefinition {
    name: string;
    node: FunctionDeclarationNode;
    start: number;
    end: number;
}

export interface ModuleExport {
    name: string;
    type: 'default' | 'named';
    isFunction: boolean;
    exportedName?: string; // Original identifier name for default exports (e.g., 'create_validators')
}

export class FileResolver {
    private workspaceRoot: string;
    private fileCache = new Map<string, FunctionDefinition[]>();
    private exportCache = new Map<string, ModuleExport[]>();

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
            // Check cache first
            const cached = this.fileCache.get(fileUri);
            if (cached) {
                return cached.find(def => def.name === functionName) || null;
            }

            // Load and parse file
            const definitions = this.loadFunctionDefinitions(fileUri);
            if (!definitions) return null;

            // Cache the results
            this.fileCache.set(fileUri, definitions);

            // Find the requested function
            return definitions.find(def => def.name === functionName) || null;
        } catch (error) {
            console.error('Error finding function definition:', error);
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

            // Check cache first
            const cached = this.exportCache.get(fileUri);
            if (cached) {
                return cached;
            }

            // Load and parse exports
            const exports = this.loadModuleExports(fileUri);
            if (!exports) return null;

            // Cache the results
            this.exportCache.set(fileUri, exports);
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

            const content = fs.readFileSync(filePath, 'utf8');
            
            // Parse the file
            const lexer = new UcodeLexer(content, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            const parseResult = parser.parse();

            if (!parseResult.ast) {
                return null;
            }

            // Find all function declarations
            const functions: FunctionDefinition[] = [];
            this.findFunctions(parseResult.ast, functions);

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
                end: funcNode.end
            });
        }

        // Recursively search child nodes
        this.visitChildren(node, (child) => {
            this.findFunctions(child, functions);
        });
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
            const source = fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
            const result = parser.parse();

            if (!result.ast) {
                return null;
            }

            // Build a set of top-level function names to detect `export default <identifier>`
            const topLevelFunctionNames = new Set<string>();
            for (const stmt of (result.ast as any).body || []) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                    topLevelFunctionNames.add(stmt.id.name);
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
     * Get property types for a default export that is an object.
     * Resolves identifiers to their declarations (ObjectExpression, etc.).
     */
    getDefaultExportPropertyTypes(fileUri: string): Map<string, UcodeDataType> | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
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
            for (const prop of (objNode as any).properties || []) {
                const key = prop.key?.name || prop.key?.value;
                if (!key) continue;

                const val = prop.value;
                if (!val) continue;

                if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
                    propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
                } else if (val.type === 'Identifier' && funcNames.has(val.name)) {
                    propertyTypes.set(key, UcodeType.FUNCTION as UcodeDataType);
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
                } else if (val.type === 'ArrayExpression') {
                    propertyTypes.set(key, UcodeType.ARRAY as UcodeDataType);
                } else if (val.type === 'Identifier') {
                    // Resolve variable identifier against known initializers
                    const init = varInits.get(val.name);
                    if (init) {
                        propertyTypes.set(key, this.inferNodeType(init));
                    } else {
                        propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                    }
                } else {
                    propertyTypes.set(key, UcodeType.UNKNOWN as UcodeDataType);
                }
            }

            return propertyTypes.size > 0 ? propertyTypes : null;
        } catch {
            return null;
        }
    }

    /**
     * Get return type and property types for a default export that is a function.
     * Analyzes the function's return statements for object literals.
     */
    getDefaultExportFunctionReturnInfo(fileUri: string): { returnType: UcodeDataType; returnPropertyTypes: Map<string, UcodeDataType> } | null {
        try {
            const filePath = this.uriToFilePath(fileUri);
            if (!filePath || !fs.existsSync(filePath)) return null;

            const source = fs.readFileSync(filePath, 'utf-8');
            const lexer = new UcodeLexer(source, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens, source);
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

            const funcBody = (funcNode as FunctionDeclarationNode).body;
            if (!funcBody) return null;

            // Collect local function names and variable initializers within the function body
            const localFuncNames = new Set<string>();
            const localVarInits = new Map<string, AstNode>();
            const bodyStmts = (funcBody as any).body || [];
            for (const stmt of bodyStmts) {
                if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
                    localFuncNames.add(stmt.id.name);
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

            return {
                returnType: UcodeType.OBJECT as UcodeDataType,
                returnPropertyTypes: merged
            };
        } catch {
            return null;
        }
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
     * Infer a simple type from an AST node (for variable initializers).
     */
    private inferNodeType(node: AstNode): UcodeDataType {
        switch (node.type) {
            case 'ObjectExpression': return UcodeType.OBJECT as UcodeDataType;
            case 'ArrayExpression': return UcodeType.ARRAY as UcodeDataType;
            case 'FunctionExpression':
            case 'ArrowFunctionExpression': return UcodeType.FUNCTION as UcodeDataType;
            case 'Literal': {
                const val = (node as any).value;
                if (typeof val === 'string') return UcodeType.STRING as UcodeDataType;
                if (typeof val === 'number') return (Number.isInteger(val) ? UcodeType.INTEGER : UcodeType.DOUBLE) as UcodeDataType;
                if (typeof val === 'boolean') return UcodeType.BOOLEAN as UcodeDataType;
                if (val === null) return UcodeType.NULL as UcodeDataType;
                return UcodeType.UNKNOWN as UcodeDataType;
            }
            default: return UcodeType.UNKNOWN as UcodeDataType;
        }
    }

    /**
     * Clear the file cache (useful when files change)
     */
    clearCache(): void {
        this.fileCache.clear();
    }

    /**
     * Clear cache for a specific file
     */
    clearFileCache(fileUri: string): void {
        this.fileCache.delete(fileUri);
    }
}
