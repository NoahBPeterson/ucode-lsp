/**
 * Hybrid validation system that supports both token-based and AST-based validation
 * This allows for gradual migration from the old system to the new one
 */

import {
    Diagnostic,
    TextDocument
} from 'vscode-languageserver/node';
import { validateWithLexer } from './lexer';
import { validateWithAst, ValidationOptions } from './ast-validator';

interface HybridValidationConfig {
    // Feature flags for gradual migration
    useAstParser?: boolean;
    fallbackToLexer?: boolean;
    
    // AST validation options
    astOptions?: ValidationOptions;
    
    // Performance settings
    maxValidationTime?: number; // milliseconds
    enablePerformanceLogging?: boolean;
}

export function validateDocument(
    textDocument: TextDocument, 
    connection: any,
    config: HybridValidationConfig = {}
): Diagnostic[] {
    const startTime = Date.now();
    
    // Default configuration
    const opts: Required<HybridValidationConfig> = {
        useAstParser: true, // TEMPORARILY DISABLED due to memory leak
        fallbackToLexer: true, // Fallback to lexer if AST fails
        astOptions: {
            enableAstValidation: true,
            enableTypeChecking: false, // Will enable gradually
            enableScopeAnalysis: false,
            enableControlFlowAnalysis: false
        },
        maxValidationTime: 5000, // 5 seconds max
        enablePerformanceLogging: false,
        ...config
    };

    let diagnostics: Diagnostic[] = [];
    let validationMethod = 'unknown';
    
    try {
        if (opts.useAstParser) {
            // Try AST-based validation first
            try {
                validationMethod = 'ast';
                diagnostics = validateWithAst(textDocument, connection, opts.astOptions);
                
                // If AST validation succeeded but produced no results and fallback is enabled,
                // also run lexer validation to catch anything we might have missed
                if (opts.fallbackToLexer && diagnostics.length === 0) {
                    const lexerDiagnostics = validateWithLexer(textDocument, connection);
                    if (lexerDiagnostics.length > 0) {
                        validationMethod = 'ast+lexer-fallback';
                        diagnostics.push(...lexerDiagnostics);
                    }
                }
                
            } catch (astError) {
                // AST validation failed
                if (connection && connection.console) {
                    connection.console.warn(`AST validation failed: ${astError}`);
                }
                
                if (opts.fallbackToLexer) {
                    validationMethod = 'lexer-fallback';
                    diagnostics = validateWithLexer(textDocument, connection);
                } else {
                    // No fallback, report the AST error
                    throw astError;
                }
            }
        } else {
            // Use traditional lexer-based validation
            validationMethod = 'lexer';
            diagnostics = validateWithLexer(textDocument, connection);
        }
        
    } catch (error) {
        // Catastrophic validation failure
        if (connection && connection.console) {
            connection.console.error(`Validation failed: ${error}`);
        }
        
        // Return empty diagnostics rather than crashing
        diagnostics = [];
        validationMethod = 'failed';
    }
    
    const endTime = Date.now();
    const validationTime = endTime - startTime;
    
    // Performance logging and timeout checking
    if (opts.enablePerformanceLogging && connection && connection.console) {
        connection.console.log(
            `Validation completed: method=${validationMethod}, ` +
            `time=${validationTime}ms, diagnostics=${diagnostics.length}`
        );
    }
    
    if (validationTime > opts.maxValidationTime && connection && connection.console) {
        connection.console.warn(
            `Validation took ${validationTime}ms (>${opts.maxValidationTime}ms threshold). ` +
            `Consider optimizing or reducing document size.`
        );
    }
    
    return diagnostics;
}

// Convenience function for enabling AST validation gradually
export function createValidationConfig(phase: 'lexer' | 'ast-basic' | 'ast-full'): HybridValidationConfig {
    switch (phase) {
        case 'lexer':
            return {
                useAstParser: false,
                fallbackToLexer: true,
                astOptions: {
                    enableAstValidation: false,
                    enableTypeChecking: false,
                    enableScopeAnalysis: false,
                    enableControlFlowAnalysis: false
                }
            };
            
        case 'ast-basic':
            return {
                useAstParser: true,
                fallbackToLexer: true,
                astOptions: {
                    enableAstValidation: true,
                    enableTypeChecking: false,
                    enableScopeAnalysis: false,
                    enableControlFlowAnalysis: false
                }
            };
            
        case 'ast-full':
            return {
                useAstParser: true,
                fallbackToLexer: false,
                astOptions: {
                    enableAstValidation: true,
                    enableTypeChecking: true,
                    enableScopeAnalysis: true,
                    enableControlFlowAnalysis: true
                }
            };
            
        default:
            return {};
    }
}

export { HybridValidationConfig };