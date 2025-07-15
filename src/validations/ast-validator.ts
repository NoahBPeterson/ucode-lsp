/**
 * AST-based validation for ucode
 * This is the new validation system that uses the parser and AST
 */

import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { UcodeLexer } from '../lexer';
import { UcodeParser } from '../parser';
import { AstNode } from '../ast';

interface ValidationOptions {
    enableAstValidation?: boolean;
    enableTypeChecking?: boolean;
    enableScopeAnalysis?: boolean;
    enableControlFlowAnalysis?: boolean;
}

export function validateWithAst(
    textDocument: TextDocument, 
    connection: any,
    options: ValidationOptions = {}
): Diagnostic[] {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];
    
    // Default options
    const opts = {
        enableAstValidation: true,
        enableTypeChecking: false, // Start with false until we implement it
        enableScopeAnalysis: false,
        enableControlFlowAnalysis: false,
        ...options
    };

    try {
        // 1. Lexical analysis (same as before)
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // 2. Parse into AST
        const parser = new UcodeParser(tokens);
        const parseResult = parser.parse();
        
        // 3. Add parsing errors to diagnostics
        for (const error of parseResult.errors) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(error.start),
                    end: textDocument.positionAt(error.end)
                },
                message: error.message,
                source: 'ucode-parser',
                ...(error.code && { code: error.code })
            });
        }
        
        // 4. Add parsing warnings to diagnostics
        for (const warning of parseResult.warnings) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: textDocument.positionAt(warning.start),
                    end: textDocument.positionAt(warning.end)
                },
                message: warning.message,
                source: 'ucode-parser',
                ...(warning.code && { code: warning.code })
            });
        }
        
        // 5. If we have a valid AST, run semantic analysis
        if (parseResult.ast && opts.enableAstValidation) {
            const semanticDiagnostics = runSemanticAnalysis(
                parseResult.ast, 
                textDocument,
                opts
            );
            diagnostics.push(...semanticDiagnostics);
        }
        
        // Log parser statistics for debugging
        if (connection && connection.console) {
            connection.console.log(
                `AST Parser: ${parseResult.errors.length} errors, ` +
                `${parseResult.warnings.length} warnings, ` +
                `AST: ${parseResult.ast ? 'generated' : 'failed'}`
            );
        }
        
    } catch (error) {
        // Catastrophic parser error
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(0),
                end: textDocument.positionAt(text.length)
            },
            message: `Parser error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            source: 'ucode-parser'
        };
        diagnostics.push(diagnostic);
        
        if (connection && connection.console) {
            connection.console.error(`AST Parser catastrophic error: ${error}`);
        }
    }
    
    return diagnostics;
}

function runSemanticAnalysis(
    ast: AstNode, 
    textDocument: TextDocument,
    options: ValidationOptions
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    // For now, just run basic AST validation
    // Later we'll add symbol table, type checking, etc.
    
    try {
        // 1. Basic AST structure validation
        const structuralIssues = validateAstStructure(ast, textDocument);
        diagnostics.push(...structuralIssues);
        
        // 2. Scope analysis (if enabled)
        if (options.enableScopeAnalysis) {
            // TODO: Implement scope analysis
            // const scopeIssues = validateScopes(ast, textDocument);
            // diagnostics.push(...scopeIssues);
        }
        
        // 3. Type checking (if enabled)
        if (options.enableTypeChecking) {
            // TODO: Implement type checking
            // const typeIssues = validateTypes(ast, textDocument);
            // diagnostics.push(...typeIssues);
        }
        
        // 4. Control flow analysis (if enabled)
        if (options.enableControlFlowAnalysis) {
            // TODO: Implement control flow analysis
            // const flowIssues = validateControlFlow(ast, textDocument);
            // diagnostics.push(...flowIssues);
        }
        
    } catch (error) {
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(ast.start),
                end: textDocument.positionAt(ast.end)
            },
            message: `Semantic analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            source: 'ucode-semantic'
        };
        diagnostics.push(diagnostic);
    }
    
    return diagnostics;
}

function validateAstStructure(ast: AstNode, textDocument: TextDocument): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    
    // Simple AST traversal to check for basic structural issues
    function visit(node: AstNode): void {
        // Check for missing required properties
        if (!node.type) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(node.start),
                    end: textDocument.positionAt(node.end)
                },
                message: 'AST node missing type information',
                source: 'ucode-ast'
            });
        }
        
        // Check for invalid position information
        if (node.start < 0 || node.end < node.start) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: textDocument.positionAt(Math.max(0, node.start)),
                    end: textDocument.positionAt(Math.max(0, node.end))
                },
                message: 'AST node has invalid position information',
                source: 'ucode-ast'
            });
        }
        
        // Type-specific validations
        switch (node.type) {
            case 'VariableDeclaration':
                const varDecl = node as any;
                if (!varDecl.declarations || varDecl.declarations.length === 0) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(node.start),
                            end: textDocument.positionAt(node.end)
                        },
                        message: 'Variable declaration without declarators',
                        source: 'ucode-ast'
                    });
                }
                break;
                
            case 'FunctionDeclaration':
                const funcDecl = node as any;
                if (!funcDecl.id || !funcDecl.id.name) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(node.start),
                            end: textDocument.positionAt(node.end)
                        },
                        message: 'Function declaration without name',
                        source: 'ucode-ast'
                    });
                }
                break;
                
            case 'CallExpression':
                const callExpr = node as any;
                if (!callExpr.callee) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(node.start),
                            end: textDocument.positionAt(node.end)
                        },
                        message: 'Function call without callee',
                        source: 'ucode-ast'
                    });
                }
                break;
        }
        
        // Recursively visit child nodes
        visitChildren(node, visit);
    }
    
    visit(ast);
    return diagnostics;
}

function visitChildren(node: AstNode, visitor: (node: AstNode) => void): void {
    // This is a simplified visitor - a full implementation would
    // handle all AST node types and their children
    const nodeAny = node as any;
    
    for (const key of Object.keys(nodeAny)) {
        const value = nodeAny[key];
        
        if (value && typeof value === 'object') {
            if (Array.isArray(value)) {
                // Handle arrays of nodes
                for (const item of value) {
                    if (item && typeof item === 'object' && item.type) {
                        visitor(item);
                    }
                }
            } else if (value.type) {
                // Handle single node
                visitor(value);
            }
        }
    }
}

// Export validation options for external configuration
export { ValidationOptions };