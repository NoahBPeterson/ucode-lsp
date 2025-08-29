import {
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

function analyzeArrayParameter(tokens: Token[], startIndex: number): { valid: boolean; invalidToken?: Token; reason?: string } {
    const token = tokens[startIndex];
    if (!token) return { valid: true }; // No token means end of input
    
    // DEFINITIVE INVALID CASES - literals that are never arrays
    if (isNumericToken(token)) {
        return { valid: false, invalidToken: token, reason: 'number' };
    }
    if (token.type === TokenType.TK_STRING) {
        return { valid: false, invalidToken: token, reason: 'string' };
    }
    if (token.type === TokenType.TK_TRUE || token.type === TokenType.TK_FALSE) {
        return { valid: false, invalidToken: token, reason: 'boolean' };
    }
    if (token.type === TokenType.TK_NULL) {
        return { valid: false, invalidToken: token, reason: 'null' };
    }
    if (token.type === TokenType.TK_REGEXP) {
        return { valid: false, invalidToken: token, reason: 'regex' };
    }
    
    // DEFINITIVE VALID CASES - guaranteed arrays or array expressions
    if (token.type === TokenType.TK_LBRACK) {
        // Array literals [...] are definitely valid
        return { valid: true };
    }
    
    // FUNCTION CALLS - check FIRST before general identifier analysis
    const nextToken = tokens[startIndex + 1];
    if (String(token.type) === String(TokenType.TK_LABEL) && nextToken?.type === TokenType.TK_LPAREN) {
        return analyzeFunctionCall(tokens, startIndex);
    }
    
    // IDENTIFIERS - need context analysis (variables, assignments, etc.)
    if (String(token.type) === String(TokenType.TK_LABEL)) {
        return analyzeIdentifierContext(tokens, startIndex);
    }
    
    // PARENTHESIZED EXPRESSIONS - analyze contents
    if (token.type === TokenType.TK_LPAREN) {
        return analyzeParenthesizedExpression(tokens, startIndex);
    }
    
    // MEMBER EXPRESSIONS - obj.property or obj[key] could potentially be arrays
    if (String(token.type) === String(TokenType.TK_LABEL)) {
        for (let i = startIndex + 1; i < tokens.length; i++) {
            const t = tokens[i];
            if (t && (t.type === TokenType.TK_DOT || t.type === TokenType.TK_LBRACK)) {
                return analyzeMemberExpression(tokens, startIndex);
            }
            if (t && (t.type === TokenType.TK_COMMA || t.type === TokenType.TK_RPAREN)) break;
        }
    }
    
    // UNKNOWN TOKEN TYPES - be conservative and reject
    return { valid: false, invalidToken: token, reason: 'unknown expression type' };
}

function analyzeIdentifierContext(tokens: Token[], startIndex: number): { valid: boolean; invalidToken?: Token; reason?: string } {
    const nextToken = tokens[startIndex + 1];
    const followingToken = tokens[startIndex + 2];
    
    // Handle assignment expressions that we can analyze at token level
    // Note: Ideally this should be done with proper AST analysis
    if (nextToken && followingToken) {
        const assignmentOps = [TokenType.TK_ASSIGN, TokenType.TK_ASNULLISH, TokenType.TK_ASADD, 
                              TokenType.TK_ASSUB, TokenType.TK_ASMUL, TokenType.TK_ASDIV, TokenType.TK_ASMOD];
        
        if (assignmentOps.includes(nextToken.type)) {
            // Check what's being assigned - only flag obvious non-arrays
            if (followingToken.type === TokenType.TK_LBRACK) {
                return { valid: true }; // Assigning array literal: x = []
            }
            if (isNumericToken(followingToken)) {
                return { valid: false, invalidToken: followingToken, reason: getTokenReason(followingToken) };
            }
            if (followingToken.type === TokenType.TK_STRING) {
                return { valid: false, invalidToken: followingToken, reason: getTokenReason(followingToken) };
            }
            // For other assignments (variables, function calls, complex expressions), assume valid
            return { valid: true };
        }
    }
    
    // Plain variable reference - could be array
    return { valid: true };
}

function analyzeParenthesizedExpression(tokens: Token[], startIndex: number): { valid: boolean; invalidToken?: Token; reason?: string } {
    // Look inside parentheses
    let parenDepth = 0;
    let i = startIndex;
    
    const currentToken = tokens[i];
    if (currentToken && currentToken.type === TokenType.TK_LPAREN) {
        parenDepth++;
        i++;
        
        while (i < tokens.length && parenDepth > 0) {
            const token = tokens[i];
            if (token) {
                if (token.type === TokenType.TK_LPAREN) parenDepth++;
                if (token.type === TokenType.TK_RPAREN) parenDepth--;
                
                if (parenDepth === 1) { // We're inside the outermost parentheses
                    // Check if contains obvious non-array expressions
                    if (isNumericToken(token) && !hasArrayOperators(tokens, i)) {
                        return { valid: false, invalidToken: token, reason: getTokenReason(token) };
                    }
                    if (token.type === TokenType.TK_STRING && !hasArrayOperators(tokens, i)) {
                        return { valid: false, invalidToken: token, reason: 'string' };
                    }
                }
            }
            i++;
        }
    }
    
    // Complex parenthesized expression - assume valid (could be array operation)
    return { valid: true };
}

function analyzeFunctionCall(tokens: Token[], startIndex: number): { valid: boolean; invalidToken?: Token; reason?: string } {
    const funcToken = tokens[startIndex];
    if (!funcToken) return { valid: true };
    const funcName = funcToken.value as string;
    
    // Known array-returning functions
    const arrayReturningFunctions = [
        'split', 'slice', 'splice', 'filter', 'map', 'sort', 'reverse',
        'keys', 'values', 'match', 'matchAll', 'entries'
    ];
    
    if (arrayReturningFunctions.includes(funcName)) {
        return { valid: true };
    }
    
    // Known non-array-returning functions
    const nonArrayFunctions = [
        'join', 'length', 'indexOf', 'lastIndexOf', 'includes',
        'toString', 'parseInt', 'parseFloat', 'print', 'printf'
    ];
    
    if (nonArrayFunctions.includes(funcName)) {
        return { valid: false, invalidToken: funcToken, reason: 'function returns non-array' };
    }
    
    // Unknown function - could return array
    return { valid: true };
}

function analyzeMemberExpression(_tokens: Token[], _startIndex: number): { valid: boolean; invalidToken?: Token; reason?: string } {
    // Member expressions like obj.property or obj[key] could potentially be arrays
    // Example: data.items where items is an array property
    // We cannot determine statically if the property value is an array, so assume valid
    return { valid: true };
}

function hasArrayOperators(tokens: Token[], around: number): boolean {
    // Check if there are array operations nearby (like concat, spread, etc.)
    for (let i = Math.max(0, around - 3); i < Math.min(tokens.length, around + 3); i++) {
        const token = tokens[i];
        if (token && (token.type === TokenType.TK_LBRACK || token.type === TokenType.TK_ELLIP)) {
            return true;
        }
    }
    return false;
}

function getTokenReason(token: Token): string {
    if (isNumericToken(token)) return 'number';
    if (token.type === TokenType.TK_STRING) return 'string';
    if (token.type === TokenType.TK_TRUE || token.type === TokenType.TK_FALSE) return 'boolean';
    if (token.type === TokenType.TK_NULL) return 'null';
    if (token.type === TokenType.TK_REGEXP) return 'regex';
    return 'non-array value';
}

export function validateArrayFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    // Functions that expect arrays as first parameter
    const arrayFunctions = ['push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'sort', 'reverse', 'filter', 'map'];
    
    // Special case: join has reversed parameters: join(separator, array)
    const joinFunction = 'join';
    
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle regular array functions (array as first parameter)
            if (arrayFunctions.includes(funcToken.value)) {
                const paramValidation = analyzeArrayParameter(tokens, i + 2);
                if (!paramValidation.valid && paramValidation.invalidToken && paramValidation.reason) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(paramValidation.invalidToken.pos),
                            end: textDocument.positionAt(paramValidation.invalidToken.end)
                        },
                        message: `${funcToken.value}() first parameter should be an array, not a ${paramValidation.reason}.`,
                        source: 'ucode-semantic'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle join function: join(separator, array)
            if (funcToken.value === joinFunction) {
                // Check second parameter (should be array)
                const commaToken = tokens[i + 3];
                if (commaToken && commaToken.type === TokenType.TK_COMMA) {
                    const paramValidation = analyzeArrayParameter(tokens, i + 4);
                    if (!paramValidation.valid && paramValidation.invalidToken && paramValidation.reason) {
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                            range: {
                                start: textDocument.positionAt(paramValidation.invalidToken.pos),
                                end: textDocument.positionAt(paramValidation.invalidToken.end)
                            },
                            message: `join() second parameter should be an array, not a ${paramValidation.reason}. Note: uCode uses join(separator, array).`,
                            source: 'ucode-semantic'
                        };
                        diagnostics.push(diagnostic);
                    }
                }
            }
            
            // Special validations for specific functions
            if (funcToken.value === 'slice') {
                validateSliceParameters(textDocument, tokens, diagnostics, i);
            } else if (funcToken.value === 'splice') {
                validateSpliceParameters(textDocument, tokens, diagnostics, i);
            } else if (funcToken.value === 'filter' || funcToken.value === 'map') {
                validateFilterMapParameters(textDocument, tokens, diagnostics, i, funcToken.value);
            }
        }
    }
}

function validateSliceParameters(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number): void {
    // slice(array, start, end?) - start and end should be numbers
    const commaToken1 = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    
    if (commaToken1 && secondParamToken &&
        commaToken1.type === TokenType.TK_COMMA &&
        secondParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `slice() second parameter (start index) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
    
    // Check third parameter if it exists
    const commaToken2 = tokens[startIndex + 5];
    const thirdParamToken = tokens[startIndex + 6];
    
    if (commaToken2 && thirdParamToken &&
        commaToken2.type === TokenType.TK_COMMA &&
        thirdParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(thirdParamToken.pos),
                end: textDocument.positionAt(thirdParamToken.end)
            },
            message: `slice() third parameter (end index) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}

function validateSpliceParameters(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number): void {
    // splice(array, start, deleteCount?, ...items) - start and deleteCount should be numbers
    const commaToken1 = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    
    if (commaToken1 && secondParamToken &&
        commaToken1.type === TokenType.TK_COMMA &&
        secondParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `splice() second parameter (start index) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
    
    // Check third parameter (deleteCount) if it exists
    const commaToken2 = tokens[startIndex + 5];
    const thirdParamToken = tokens[startIndex + 6];
    
    if (commaToken2 && thirdParamToken &&
        commaToken2.type === TokenType.TK_COMMA &&
        thirdParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(thirdParamToken.pos),
                end: textDocument.positionAt(thirdParamToken.end)
            },
            message: `splice() third parameter (delete count) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}

function validateFilterMapParameters(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number, funcName: string): void {
    // filter(array, function) / map(array, function) - second parameter should be a function
    const commaToken = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    
    if (commaToken && secondParamToken &&
        commaToken.type === TokenType.TK_COMMA &&
        (isNumericToken(secondParamToken) || 
         secondParamToken.type === TokenType.TK_STRING)) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `${funcName}() second parameter should be a function, not a ${secondParamToken.type === TokenType.TK_NUMBER ? 'number' : 'string'}.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}