import { UcodeLexer } from '../lexer';
import { UcodeParser } from '../parser';
import { FunctionDeclarationNode, AstNode } from '../ast/nodes';
import * as path from 'path';
import * as fs from 'fs';

export interface FunctionDefinition {
    name: string;
    node: FunctionDeclarationNode;
    start: number;
    end: number;
}

export class FileResolver {
    private workspaceRoot: string;
    private fileCache = new Map<string, FunctionDefinition[]>();

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
    }

    /**
     * Resolve a relative import path to an absolute file path
     */
    resolveImportPath(importPath: string, currentFileUri: string): string | null {
        try {
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
            }
            
            // Handle absolute paths
            if (importPath.startsWith('/')) {
                const absolutePath = path.resolve(this.workspaceRoot, importPath.substring(1));
                if (fs.existsSync(absolutePath)) {
                    return this.filePathToUri(absolutePath);
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