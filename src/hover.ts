import {
    TextDocumentPositionParams,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType, isKeyword, Token } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType, Symbol as UcodeSymbol } from './analysis';
import { typeToString, UcodeDataType } from './analysis/symbolTable';
import { debugTypeRegistry } from './analysis/debugTypes';
import { digestTypeRegistry } from './analysis/digestTypes';
import { logTypeRegistry } from './analysis/logTypes';
import { mathTypeRegistry } from './analysis/mathTypes';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { resolvTypeRegistry } from './analysis/resolvTypes';
import { rtnlTypeRegistry } from './analysis/rtnlTypes';
import { socketTypeRegistry } from './analysis/socketTypes';
import { structTypeRegistry } from './analysis/structTypes';
import { ubusTypeRegistry } from './analysis/ubusTypes';
import { uciTypeRegistry } from './analysis/uciTypes';
import { uloopTypeRegistry, uloopObjectRegistry } from './analysis/uloopTypes';
import { fsTypeRegistry } from './analysis/fsTypes';
import { fsModuleFunctions } from './fsBuiltins';
import { exceptionTypeRegistry } from './analysis/exceptionTypes';
import { zlibTypeRegistry } from './analysis/zlibTypes';
import { fsModuleTypeRegistry } from './analysis/fsModuleTypes';
import { regexTypeRegistry } from './analysis/regexTypes';

function detectMemberHoverContext(position: any, tokens: any[], document: any): { objectName: string, memberName: string, memberTokenPos: number, memberTokenEnd: number } | undefined {
    // Look for pattern: LABEL DOT LABEL (where cursor is over the second LABEL)
    // We want to find tokens that match this pattern at the hover position
    
    const offset = document.offsetAt(position);
    
    // Find the token at the hover position
    let hoverTokenIndex = -1;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.pos <= offset && offset < token.end) {
            hoverTokenIndex = i;
            break;
        }
    }
    
    if (hoverTokenIndex === -1) {
        return undefined;
    }
    
    const hoverToken = tokens[hoverTokenIndex];
    
    // Check if we're hovering over a LABEL token
    if (hoverToken.type !== TokenType.TK_LABEL) {
        return undefined;
    }
    
    // Check if there's a DOT token immediately before this LABEL
    if (hoverTokenIndex < 2) {
        return undefined;
    }
    
    const dotToken = tokens[hoverTokenIndex - 1];
    const objectToken = tokens[hoverTokenIndex - 2];
    
    // Verify the pattern: LABEL DOT LABEL
    if (dotToken.type === TokenType.TK_DOT && 
        objectToken.type === TokenType.TK_LABEL &&
        objectToken.end === dotToken.pos &&
        dotToken.end === hoverToken.pos) {
        
        return {
            objectName: objectToken.value as string,
            memberName: hoverToken.value as string,
            memberTokenPos: hoverToken.pos,
            memberTokenEnd: hoverToken.end
        };
    }
    
    return undefined;
}


function isAssignmentOperator(type: TokenType): boolean {
    switch (type) {
        case TokenType.TK_ASSIGN:
        case TokenType.TK_ASADD:
        case TokenType.TK_ASSUB:
        case TokenType.TK_ASMUL:
        case TokenType.TK_ASDIV:
        case TokenType.TK_ASMOD:
        case TokenType.TK_ASLEFT:
        case TokenType.TK_ASRIGHT:
        case TokenType.TK_ASBAND:
        case TokenType.TK_ASBXOR:
        case TokenType.TK_ASBOR:
        case TokenType.TK_ASEXP:
        case TokenType.TK_ASAND:
        case TokenType.TK_ASOR:
        case TokenType.TK_ASNULLISH:
            return true;
        default:
            return false;
    }
}

function isLikelyAssignmentTarget(tokens: Token[], tokenIndex: number): boolean {
    if (tokenIndex < 0 || tokenIndex >= tokens.length) {
        return false;
    }

    let prevIndex = tokenIndex - 1;
    while (prevIndex >= 0) {
        const prevToken = tokens[prevIndex];
        if (!prevToken) {
            break;
        }

        if (prevToken.type === TokenType.TK_NEWLINE || prevToken.type === TokenType.TK_SCOL) {
            prevIndex--;
            continue;
        }

        if (prevToken.type === TokenType.TK_LOCAL || prevToken.type === TokenType.TK_CONST) {
            return false;
        }

        break;
    }

    const prevToken = prevIndex >= 0 ? tokens[prevIndex] : undefined;
    if (prevToken && (prevToken.type === TokenType.TK_LOCAL || prevToken.type === TokenType.TK_CONST)) {
        // Variable declarations should reflect their declared literal type, not assignment result
        return false;
    }

    for (let i = tokenIndex + 1; i < tokens.length; i++) {
        const nextToken = tokens[i];
        if (!nextToken) {
            return false;
        }

        if (isAssignmentOperator(nextToken.type)) {
            return true;
        }

        if (
            nextToken.type === TokenType.TK_NEWLINE ||
            nextToken.type === TokenType.TK_SCOL ||
            nextToken.type === TokenType.TK_COMMA ||
            nextToken.type === TokenType.TK_COLON ||
            nextToken.type === TokenType.TK_ARROW ||
            nextToken.type === TokenType.TK_EOF
        ) {
            return false;
        }
    }

    return false;
}

function resolveVariableTypeForHover(
    symbol: UcodeSymbol,
    offset: number,
    isAssignmentTarget: boolean,
    analysisResult?: SemanticAnalysisResult
): UcodeDataType {
    // Check for flow-sensitive type narrowing first
    if (analysisResult && analysisResult.typeChecker && analysisResult.ast) {
        const typeChecker = analysisResult.typeChecker;

        // Check if this position is inside a null guard for this variable
        const narrowedType = typeChecker.getNarrowedTypeAtPosition(symbol.name, offset);
        if (narrowedType) {
            return narrowedType;
        }
    }

    if (symbol.currentType) {
        if (isAssignmentTarget) {
            return symbol.currentType;
        }

        if (symbol.currentTypeEffectiveFrom !== undefined && offset >= symbol.currentTypeEffectiveFrom) {
            return symbol.currentType;
        }
    }

    return symbol.dataType;
}


function inferPropertyTypeFromValue(propertyValue: string): string | undefined {
    // Remove whitespace and normalize
    const value = propertyValue.trim();
    
    // Check for arrow function patterns
    if (value.includes('=>')) {
        const arrowIndex = value.indexOf('=>');
        const beforeArrow = value.slice(0, arrowIndex).trim();
        
        // Extract parameter list
        let params = '';
        if (beforeArrow.startsWith('(') && beforeArrow.includes(')')) {
            const parenMatch = beforeArrow.match(/^\((.*)\)/);
            params = parenMatch ? parenMatch[1] || '' : '';
        } else {
            // Single parameter without parentheses
            params = beforeArrow;
        }
        
        const hasRestParam = params.includes('...');
        
        // Infer return type from function body
        let returnType = 'unknown';
        const afterArrow = value.slice(value.indexOf('=>') + 2).trim();
        
        if (afterArrow.startsWith('warn(')) {
            returnType = 'null'; // warn() returns null
        } else if (afterArrow.includes('return ')) {
            // Try to infer from explicit return statements
            const returnMatch = afterArrow.match(/return\s+([^;]+)/);
            if (returnMatch && returnMatch[1]) {
                const returnExpr = returnMatch[1].trim();
                if (returnExpr === 'null' || returnExpr === 'undefined') {
                    returnType = returnExpr;
                } else if (returnExpr.match(/^\d+$/)) {
                    returnType = 'number';
                } else if (returnExpr.match(/^["'`]/)) {
                    returnType = 'string';
                } else if (returnExpr === 'true' || returnExpr === 'false') {
                    returnType = 'boolean';
                }
            }
        }
        
        let signature = `(${params}) => ${returnType}`;
        let description = 'Arrow function';
        
        if (hasRestParam) {
            description += ' with rest parameters';
        }
        
        return `**(function)** **${signature}**\n\n${description}`;
    }
    
    // Check for regular function expression
    if (value.startsWith('function')) {
        const funcMatch = value.match(/^function\s*\(([^)]*)\)/);
        const params = funcMatch ? funcMatch[1] : '';
        const hasRestParam = params && params.includes('...');
        
        let signature = `function(${params})`;
        let description = 'Function expression';
        
        if (hasRestParam) {
            description += ' with rest parameters';
        }
        
        return `**(function)** **${signature}**\\n\\n${description}`;
    }
    
    // For other values, provide generic type info
    if (value.startsWith('[')) {
        return `**(array)** Array literal`;
    } else if (value.startsWith('{')) {
        return `**(object)** Object literal`;
    } else if (value.match(/^['"`]/)) {
        return `**(string)** String literal`;
    } else if (value.match(/^\d/)) {
        return `**(number)** Number literal`;
    } else if (value === 'true' || value === 'false') {
        return `**(boolean)** Boolean literal`;
    }
    
    return undefined;
}

export function handleHover(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    analysisResult?: SemanticAnalysisResult
): Hover | undefined {
    console.error(`[HOVER] Starting hover at ${textDocumentPositionParams.position.line}:${textDocumentPositionParams.position.character}`);
    
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        console.error(`[HOVER] No document found for URI: ${textDocumentPositionParams.textDocument.uri}`);
        return undefined;
    }

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // First check if we're hovering over a member expression (e.g., "rtnl.request")
        const memberContext = detectMemberHoverContext(textDocumentPositionParams.position, tokens, document);
        if (memberContext) {
            const { objectName, memberName } = memberContext;
            console.log(`[HOVER] Member expression detected: ${objectName}.${memberName}`);
            
            // Look up the object in the symbol table to determine its module
            if (analysisResult && analysisResult.symbolTable) {
                const symbol = analysisResult.symbolTable.lookup(objectName);
                if (symbol && symbol.propertyTypes && symbol.propertyTypes.has(memberName)) {
                    const propertyType = symbol.propertyTypes.get(memberName)!;
                    const typeString = typeToString(propertyType);
                    const scopeLabel = objectName === 'global'
                        ? `Global property on \`${objectName}\``
                        : `Property on \`${objectName}\``;
                    const hoverMarkdown = `**${memberName}**: \`${typeString}\`\n\n${scopeLabel}`;

                    console.log(`[HOVER] Returning property hover for ${objectName}.${memberName}: ${typeString}`);

                    return {
                        contents: { kind: MarkupKind.Markdown, value: hoverMarkdown },
                        range: {
                            start: document.positionAt(memberContext.memberTokenPos),
                            end: document.positionAt(memberContext.memberTokenEnd)
                        }
                    };
                }

                if (symbol && symbol.type === SymbolType.IMPORTED) {
                    console.log(`[HOVER] Found imported symbol: ${objectName} from ${symbol.importedFrom}`);
                    
                    // Get module-specific documentation for the member
                    const moduleName = symbol.importedFrom;
                    let hoverText: string | undefined;
                    
                    if (moduleName === 'nl80211' && nl80211TypeRegistry.isNl80211Function(memberName)) {
                        hoverText = nl80211TypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'nl80211' && nl80211TypeRegistry.isNl80211Constant(memberName)) {
                        hoverText = nl80211TypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'rtnl' && rtnlTypeRegistry.isRtnlFunction(memberName)) {
                        hoverText = rtnlTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'rtnl' && rtnlTypeRegistry.isRtnlConstant(memberName)) {
                        hoverText = rtnlTypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'socket' && socketTypeRegistry.isSocketFunction(memberName)) {
                        hoverText = socketTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'socket' && socketTypeRegistry.isSocketConstant(memberName)) {
                        hoverText = socketTypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'ubus' && ubusTypeRegistry.isUbusFunction(memberName)) {
                        hoverText = ubusTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'ubus' && ubusTypeRegistry.isUbusConstant(memberName)) {
                        hoverText = ubusTypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'uloop' && uloopTypeRegistry.isUloopFunction(memberName)) {
                        hoverText = uloopTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'uloop' && uloopTypeRegistry.isUloopConstant(memberName)) {
                        hoverText = uloopTypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'zlib' && zlibTypeRegistry.isZlibFunction(memberName)) {
                        hoverText = zlibTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'zlib' && zlibTypeRegistry.isZlibConstant(memberName)) {
                        hoverText = zlibTypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'debug' && debugTypeRegistry.isDebugFunction(memberName)) {
                        hoverText = debugTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'digest' && digestTypeRegistry.isDigestFunction(memberName)) {
                        hoverText = digestTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'log' && logTypeRegistry.isLogFunction(memberName)) {
                        hoverText = logTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'log' && logTypeRegistry.isLogConstant(memberName)) {
                        hoverText = logTypeRegistry.getConstantDocumentation(memberName);
                    } else if (moduleName === 'math' && mathTypeRegistry.isMathFunction(memberName)) {
                        hoverText = mathTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'resolv' && resolvTypeRegistry.isResolvFunction(memberName)) {
                        hoverText = resolvTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'struct' && structTypeRegistry.isStructFunction(memberName)) {
                        hoverText = structTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'uci' && uciTypeRegistry.isUciFunction(memberName)) {
                        hoverText = uciTypeRegistry.getFunctionDocumentation(memberName);
                    } else if (moduleName === 'fs' && fsModuleTypeRegistry.isFsModuleFunction(memberName)) {
                        hoverText = fsModuleTypeRegistry.getFunctionDocumentation(memberName);
                    }
                    
                    if (hoverText) {
                        return {
                            contents: { kind: MarkupKind.Markdown, value: hoverText },
                            range: {
                                start: document.positionAt(memberContext.memberTokenPos),
                                end: document.positionAt(memberContext.memberTokenEnd)
                            }
                        };
                    }
                } else {
                    // Object exists but is not an imported symbol (e.g., user-defined variable)
                    // For member expressions on non-imported objects, don't show builtin hover
                    console.log(`[HOVER] Object ${objectName} is not an imported symbol, skipping member hover`);
                    return undefined;
                }
            } else {
                // No analysis result or symbol table - for member expressions, don't show builtin hover
                console.log(`[HOVER] No symbol table available for member expression, skipping hover`);
                return undefined;
            }
        }
        
        const token = tokens.find(t => t.pos <= offset && offset < t.end);
        const tokenIndex = token ? tokens.indexOf(token) : -1;
        
        
        // Check for rest parameters (like ...args)
        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            // Look for ellipsis token right before this label
            if (tokenIndex > 0) {
                const prevToken = tokens[tokenIndex - 1];
                if (prevToken && prevToken.type === TokenType.TK_ELLIP) {
                    // This is a rest parameter
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: `**(rest parameter)** **...${token.value}**: \`array\`\n\nRest parameter - collects remaining arguments into an array`
                        },
                        range: {
                            start: document.positionAt(prevToken.pos), // Include the ...
                            end: document.positionAt(token.end)
                        }
                    };
                }
            }
        }
        
        // Also check if we're hovering over the ellipsis itself
        if (token && token.type === TokenType.TK_ELLIP) {
            // Look for a label token right after this ellipsis
            if (tokenIndex + 1 < tokens.length) {
                const nextToken = tokens[tokenIndex + 1];
                if (nextToken && nextToken.type === TokenType.TK_LABEL) {
                    // This is a rest parameter
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: `**(rest parameter)** **...${nextToken.value}**: \`array\`\n\nRest parameter - collects remaining arguments into an array`
                        },
                        range: {
                            start: document.positionAt(token.pos), // The ellipsis
                            end: document.positionAt(nextToken.end)
                        }
                    };
                }
            }
        }
        
        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            const word = token.value;
            
            // Check if this is a function call (e.g., test() instead of just test)
            const isFunctionCall = detectFunctionCall(offset, tokens);
            if (isFunctionCall && analysisResult) {
                const symbol = analysisResult.symbolTable.lookup(word);
                if (symbol && (symbol.type === SymbolType.FUNCTION || symbol.type === SymbolType.IMPORTED)) {
                    // Show return type for function calls
                    if (symbol.returnType) {
                        const returnTypeStr = typeToString(symbol.returnType);
                        return {
                            contents: {
                                kind: MarkupKind.Markdown,
                                value: `(function call) **${word}()**: \`${returnTypeStr}\`\n\nReturn type of function call`
                            },
                            range: {
                                start: document.positionAt(token.pos),
                                end: document.positionAt(token.end)
                            }
                        };
                    }
                }
            }
            
            // Check if this is part of a member expression (e.g., fs.open)
            const memberExpressionInfo = detectMemberExpression(offset, tokens);
            if (memberExpressionInfo && analysisResult) {
                // Handle fs object method hover
                const fsMethodHover = getFsMethodHover(memberExpressionInfo, analysisResult);
                if (fsMethodHover) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: fsMethodHover
                        },
                        range: {
                            start: document.positionAt(token.pos),
                            end: document.positionAt(token.end)
                        }
                    };
                }
                
                // Handle uloop module function hover (namespace access like uloop.init)
                const uloopMethodHover = getUloopMethodHover(memberExpressionInfo, analysisResult);
                if (uloopMethodHover) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: uloopMethodHover
                        },
                        range: {
                            start: document.positionAt(token.pos),
                            end: document.positionAt(token.end)
                        }
                    };
                }
                
                // Handle fs module function hover (namespace access like fs.opendir)
                const fsModuleMethodHover = getFsModuleMethodHover(memberExpressionInfo, analysisResult);
                if (fsModuleMethodHover) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: fsModuleMethodHover
                        },
                        range: {
                            start: document.positionAt(token.pos),
                            end: document.positionAt(token.end)
                        }
                    };
                }
            }
            
            // Special case: check for object properties by examining the text context
            // Look for patterns like "property_name: (args) => ..."
            if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
                const word = token.value;
                
                // Get the line containing this token
                const lineStart = text.lastIndexOf('\n', token.pos) + 1;
                const lineEnd = text.indexOf('\n', token.end);
                const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
                
                // Check if this looks like an object property definition
                // Pattern: "propertyName: (params) => ..." or "propertyName: (...params) => ..."
                const propertyPattern = new RegExp(`\\b${word}\\s*:\\s*\\([^)]*\\)\\s*=>`);
                if (propertyPattern.test(line)) {
                    // Check if there's a builtin/global function with the same name
                    // If so, prioritize the builtin function documentation over property type
                    let hasBuiltinFunction = false;
                    if (analysisResult) {
                        const builtinSymbol = analysisResult.symbolTable.lookup(word);
                        hasBuiltinFunction = (builtinSymbol && builtinSymbol.type === SymbolType.FUNCTION) ?? false;
                    }
                    
                    if (!hasBuiltinFunction) {
                        // No builtin function found, show property type hover
                        const match = line.match(new RegExp(`\\b${word}\\s*:\\s*(\\([^)]*\\)\\s*=>.*?)(?:,|$|\\})`));
                        if (match) {
                            const functionDef = match[1].trim();
                            const hoverText = inferPropertyTypeFromValue(functionDef);
                            
                            if (hoverText) {
                                return {
                                    contents: {
                                        kind: MarkupKind.Markdown,
                                        value: hoverText
                                    },
                                    range: {
                                        start: document.positionAt(token.pos),
                                        end: document.positionAt(token.end)
                                    }
                                };
                            }
                        }
                    }
                    // If hasBuiltinFunction is true, we fall through to the builtin function lookup
                }
            }
            
            // 1. Check for user-defined symbols using the analysis cache (PRIORITY OVER GLOBAL FUNCTIONS)
            if (analysisResult) {
                let symbol = analysisResult.symbolTable.lookup(word);
                
                // If regular lookup fails, try position-aware lookup for scope-sensitive symbols
                if (!symbol) {
                    symbol = analysisResult.symbolTable.lookupAtPosition(word, offset);
                }
                
                // If still no symbol found, check if this might be a rest parameter in the current context
                if (!symbol) {
                    // Look for rest parameter usage by checking the text context
                    const lineStart = text.lastIndexOf('\n', offset) + 1;
                    const currentLineStart = Math.max(0, lineStart);
                    const beforeCurrentLine = text.slice(0, currentLineStart);
                    
                    // Look for recent arrow function definitions with rest parameters
                    // Pattern matches: (...word) or (anything, ...word) followed by =>
                    const restParamPattern = new RegExp(`\\([^)]*\\.\\.\\.${word}[^)]*\\)\\s*=>`, 'g');
                    const matches = [...beforeCurrentLine.matchAll(restParamPattern)];
                    
                    // If we find a rest parameter definition for this word recently, treat it as a rest parameter
                    if (matches.length > 0) {
                        const lastMatch = matches[matches.length - 1];
                        const matchPosition = lastMatch.index || 0;
                        
                        // Only consider it if the rest parameter definition is within ~200 characters (same function context)
                        if (offset - matchPosition < 200) {
                            return {
                                contents: {
                                    kind: MarkupKind.Markdown,
                                    value: `**(rest parameter)** **${word}**: \`array\`\n\nRest parameter - collects remaining arguments into an array`
                                },
                                range: {
                                    start: document.positionAt(token.pos),
                                    end: document.positionAt(token.end)
                                }
                            };
                        }
                    }
                }
                
                if (symbol) {
                    const isAssignmentContext = tokenIndex >= 0 ? isLikelyAssignmentTarget(tokens, tokenIndex) : false;
                    const effectiveType = resolveVariableTypeForHover(symbol, offset, isAssignmentContext, analysisResult);
                    const effectiveTypeStr = typeToString(effectiveType);

                    let hoverText = '';
                    switch (symbol.type) {
                        case SymbolType.VARIABLE:
                        case SymbolType.PARAMETER:
                            // Check if this parameter is a rest parameter (array type)
                            const declaredTypeStr = typeToString(symbol.dataType);
                            if (symbol.type === SymbolType.PARAMETER && (declaredTypeStr.includes('array') || declaredTypeStr.includes('Array'))) {
                                hoverText = `**(rest parameter)** **${symbol.name}**: \`array\`\n\nRest parameter - collects remaining arguments into an array`;
                            } else {
                                hoverText = `(${symbol.type}) **${symbol.name}**: \`${effectiveTypeStr}\``;
                            }
                            break;
                        case SymbolType.FUNCTION:
                            // Show function type with return type information
                            if (symbol.returnType) {
                                const returnTypeStr = typeToString(symbol.returnType);
                                hoverText = `(function) **${symbol.name}**: \`function\`\n\nReturns: \`${returnTypeStr}\``;
                            } else {
                                hoverText = `(function) **${symbol.name}**: \`function\``;
                            }
                            break;
                        case SymbolType.MODULE:
                            hoverText = `(module) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.IMPORTED:
                            // Special handling for module imports
                            if (symbol.importedFrom === 'debug') {
                                // Check if this is a specific debug function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (debugTypeRegistry.isDebugFunction(originalName)) {
                                    hoverText = debugTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getDebugModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'digest') {
                                // Check if this is a specific digest function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (digestTypeRegistry.isDigestFunction(originalName)) {
                                    hoverText = digestTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getDigestModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'log') {
                                // Check if this is a specific log function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (logTypeRegistry.isLogFunction(originalName)) {
                                    hoverText = logTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (logTypeRegistry.isLogConstant(originalName)) {
                                    hoverText = logTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getLogModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'math') {
                                // Check if this is a specific math function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (mathTypeRegistry.isMathFunction(originalName)) {
                                    hoverText = mathTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getMathModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'nl80211') {
                                // Check if this is a const import object first
                                if (symbol.dataType && typeof symbol.dataType === 'object' && 
                                    'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'nl80211-const') {
                                    hoverText = `(const object) **${symbol.name}**: \`object\`\n\nContainer for nl80211 module constants.`;
                                } else {
                                    // Check if this is a specific nl80211 function or constant (could be aliased)
                                    const originalName = symbol.importSpecifier || symbol.name;
                                    if (nl80211TypeRegistry.isNl80211Function(originalName)) {
                                        hoverText = nl80211TypeRegistry.getFunctionDocumentation(originalName);
                                    } else if (nl80211TypeRegistry.isNl80211Constant(originalName)) {
                                        hoverText = nl80211TypeRegistry.getConstantDocumentation(originalName);
                                    } else {
                                        hoverText = getNl80211ModuleDocumentation();
                                    }
                                }
                            } else if (symbol.importedFrom === 'resolv') {
                                // Check if this is a specific resolv function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (resolvTypeRegistry.isResolvFunction(originalName)) {
                                    hoverText = resolvTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getResolvModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'rtnl') {
                                // Check if this is a const import object first
                                if (symbol.dataType && typeof symbol.dataType === 'object' && 
                                    'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'rtnl-const') {
                                    hoverText = `(const object) **${symbol.name}**: \`object\`\n\nContainer for rtnl module constants.`;
                                } else {
                                    // Check if this is a specific rtnl function or constant (could be aliased)
                                    const originalName = symbol.importSpecifier || symbol.name;
                                    if (rtnlTypeRegistry.getFunctionNames().includes(originalName)) {
                                        hoverText = rtnlTypeRegistry.getFunctionDocumentation(originalName);
                                    } else if (rtnlTypeRegistry.getConstant(originalName)) {
                                        hoverText = rtnlTypeRegistry.getConstantDocumentation(originalName);
                                    } else {
                                        hoverText = getRtnlModuleDocumentation();
                                    }
                                }
                            } else if (symbol.importedFrom === 'fs') {
                                // Check if this is a specific fs function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                const fsDoc = fsModuleFunctions.get(originalName);
                                if (fsDoc) {
                                    hoverText = `**${symbol.name}** (fs module function)\n\n${fsDoc}`;
                                } else {
                                    hoverText = getFsModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'socket') {
                                // Check if this is a specific socket function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (socketTypeRegistry.isSocketFunction(originalName)) {
                                    hoverText = socketTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (socketTypeRegistry.isSocketConstant(originalName)) {
                                    hoverText = socketTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getSocketModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'ubus') {
                                // Check if this is a specific ubus function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (ubusTypeRegistry.isUbusFunction(originalName)) {
                                    hoverText = ubusTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (ubusTypeRegistry.isUbusConstant(originalName)) {
                                    hoverText = ubusTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getUbusModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'uci') {
                                // Check if this is a specific uci function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (uciTypeRegistry.isUciFunction(originalName)) {
                                    hoverText = uciTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getUciModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'uloop') {
                                // Check if this is a specific uloop function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (uloopTypeRegistry.isUloopFunction(originalName)) {
                                    hoverText = uloopTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (uloopTypeRegistry.isUloopConstant(originalName)) {
                                    hoverText = uloopTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getUloopModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'struct') {
                                // Check if this is a specific struct function (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (structTypeRegistry.isStructFunction(originalName)) {
                                    hoverText = structTypeRegistry.getFunctionDocumentation(originalName);
                                } else {
                                    hoverText = getStructModuleDocumentation();
                                }
                            } else if (symbol.importedFrom === 'zlib') {
                                // Check if this is a specific zlib function or constant (could be aliased)
                                const originalName = symbol.importSpecifier || symbol.name;
                                if (zlibTypeRegistry.isZlibFunction(originalName)) {
                                    hoverText = zlibTypeRegistry.getFunctionDocumentation(originalName);
                                } else if (zlibTypeRegistry.isZlibConstant(originalName)) {
                                    hoverText = zlibTypeRegistry.getConstantDocumentation(originalName);
                                } else {
                                    hoverText = getZlibModuleDocumentation();
                                }
                            } else {
                                hoverText = `(imported) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            }
                            break;
                    }
                    
                    console.log(`[HOVER_DEBUG] Generated hover text for "${word}":`, hoverText ? `"${hoverText.substring(0, 50)}..."` : 'EMPTY');
                    
                    if (hoverText) {
                        return {
                            contents: { kind: MarkupKind.Markdown, value: hoverText },
                            range: {
                                start: document.positionAt(token.pos),
                                end: document.positionAt(token.end)
                            }
                        };
                    }
                }
            }
            

            // Check if this is an exception property FIRST (before symbol table)
            if (exceptionTypeRegistry.isExceptionProperty(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: exceptionTypeRegistry.getPropertyDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
                        
            // Symbol table lookup moved to BEFORE global function checks for correct priority
            
            // 3. Fallback to built-in functions and keywords
            const documentation = allBuiltinFunctions.get(word);
            if (documentation) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${word}** (built-in function)\n\n${documentation}`
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            if (isKeyword(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${word}** (ucode keyword)`
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
        }
        
        // Handle regex literals
        if (token && token.type === TokenType.TK_REGEXP) {
            const regexInfo = regexTypeRegistry.extractPattern(token.value);
            if (regexInfo.pattern) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: regexTypeRegistry.getRegexDocumentation(regexInfo.pattern, regexInfo.flags)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
        }
    } catch (error) {
        const wordRange = getWordRangeAtPosition(text, offset);
        if (!wordRange) {
            return undefined;
        }
        
        const word = text.substring(wordRange.start, wordRange.end);
        
        // Check if this is a log module function
        if (logTypeRegistry.isLogFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: logTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        
        const documentation = allBuiltinFunctions.get(word);
        if (documentation) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `**${word}** (built-in function)\n\n${documentation}`
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
    }
    
    return undefined;
}

function detectFunctionCall(offset: number, tokens: any[]): boolean {
    // Find the token at the current position
    const currentTokenIndex = tokens.findIndex(t => t.pos <= offset && offset < t.end);
    if (currentTokenIndex === -1) return false;
    
    const currentToken = tokens[currentTokenIndex];
    
    // Check if current token is a label (function name)
    if (currentToken.type !== TokenType.TK_LABEL) return false;
    
    // Check if this is part of a function declaration by looking for 'function' keyword before
    if (currentTokenIndex > 0) {
        const prevToken = tokens[currentTokenIndex - 1];
        if (prevToken && prevToken.type === TokenType.TK_FUNC) {
            return false; // This is a function declaration, not a call
        }
    }
    
    // Check if there's an opening parenthesis immediately after this token
    if (currentTokenIndex + 1 < tokens.length) {
        const nextToken = tokens[currentTokenIndex + 1];
        if (nextToken.type === TokenType.TK_LPAREN && currentToken.end === nextToken.pos) {
            return true; // This is a function call
        }
    }
    
    return false;
}

function detectMemberExpression(offset: number, tokens: any[]): { objectName: string; propertyName: string } | undefined {
    // Find the token at the current position
    const currentTokenIndex = tokens.findIndex(t => t.pos <= offset && offset < t.end);
    if (currentTokenIndex === -1) return undefined;
    
    const currentToken = tokens[currentTokenIndex];
    
    // Look for pattern: LABEL DOT LABEL or LABEL DOT current_position
    // Check if current token is part of a member expression
    
    // Case 1: Hovering over object name in "object.property"
    if (currentTokenIndex + 2 < tokens.length) {
        const nextToken = tokens[currentTokenIndex + 1];
        const afterNextToken = tokens[currentTokenIndex + 2];
        
        if (nextToken.type === TokenType.TK_DOT && 
            afterNextToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: currentToken.value as string,
                propertyName: afterNextToken.value as string
            };
        }
    }
    
    // Case 2: Hovering over property name in "object.property"
    if (currentTokenIndex >= 2) {
        const prevToken = tokens[currentTokenIndex - 1];
        const beforePrevToken = tokens[currentTokenIndex - 2];
        
        if (prevToken.type === TokenType.TK_DOT && 
            beforePrevToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: beforePrevToken.value as string,
                propertyName: currentToken.value as string
            };
        }
    }
    
    return undefined;
}

function getWordRangeAtPosition(text: string, offset: number): { start: number; end: number } | undefined {
    const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let match;
    
    while ((match = wordRegex.exec(text)) !== null) {
        if (match.index <= offset && offset < match.index + match[0].length) {
            return {
                start: match.index,
                end: match.index + match[0].length
            };
        }
    }
    
    return undefined;
}

function getDebugModuleDocumentation(): string {
    return `## Debug Module

**Runtime debug functionality for ucode scripts**

The debug module provides comprehensive debugging and introspection capabilities for ucode applications.

### Usage

**Named import syntax:**
\`\`\`ucode
import { memdump, traceback } from 'debug';

let stacktrace = traceback(1);
memdump("/tmp/dump.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as debug from 'debug';

let stacktrace = debug.traceback(1);
debug.memdump("/tmp/dump.txt");
\`\`\`

### Available Functions

- **\`memdump()\`** - Write memory dump report to file
- **\`traceback()\`** - Generate stack trace from execution point  
- **\`sourcepos()\`** - Get current source position information
- **\`getinfo()\`** - Get detailed information about a value
- **\`getlocal()\`** - Get the value of a local variable
- **\`setlocal()\`** - Set the value of a local variable
- **\`getupval()\`** - Get the value of an upvalue (closure variable)
- **\`setupval()\`** - Set the value of an upvalue (closure variable)

### Environment Variables

- **\`UCODE_DEBUG_MEMDUMP_ENABLED\`** - Enable/disable automatic memory dumps (default: enabled)
- **\`UCODE_DEBUG_MEMDUMP_SIGNAL\`** - Signal for triggering memory dumps (default: SIGUSR2)
- **\`UCODE_DEBUG_MEMDUMP_PATH\`** - Output directory for memory dumps (default: /tmp)

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getDigestModuleDocumentation(): string {
    return `## Digest Module

**Cryptographic hash functions for ucode scripts**

The digest module provides secure hashing functionality using industry-standard algorithms.

### Usage

**Named import syntax:**
\`\`\`ucode
import { md5, sha256, sha1_file } from 'digest';

let hash = md5("Hello World");
let fileHash = sha256_file("/path/to/file.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as digest from 'digest';

let hash = digest.md5("Hello World");
let fileHash = digest.sha256_file("/path/to/file.txt");
\`\`\`

### Available Functions

**String hashing functions:**
- **\`md5()\`** - Calculate MD5 hash of string
- **\`sha1()\`** - Calculate SHA1 hash of string
- **\`sha256()\`** - Calculate SHA256 hash of string
- **\`sha384()\`** - Calculate SHA384 hash of string (extended)
- **\`sha512()\`** - Calculate SHA512 hash of string (extended)
- **\`md2()\`** - Calculate MD2 hash of string (extended)
- **\`md4()\`** - Calculate MD4 hash of string (extended)

**File hashing functions:**
- **\`md5_file()\`** - Calculate MD5 hash of file
- **\`sha1_file()\`** - Calculate SHA1 hash of file
- **\`sha256_file()\`** - Calculate SHA256 hash of file
- **\`sha384_file()\`** - Calculate SHA384 hash of file (extended)
- **\`sha512_file()\`** - Calculate SHA512 hash of file (extended)
- **\`md2_file()\`** - Calculate MD2 hash of file (extended)
- **\`md4_file()\`** - Calculate MD4 hash of file (extended)

### Notes

- Extended algorithms (MD2, MD4, SHA384, SHA512) may not be available on all systems
- All functions return \`null\` on error or invalid input
- File functions return \`null\` if the file cannot be read

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getLogModuleDocumentation(): string {
    return `## Log Module

**System logging functions for ucode scripts**

The log module provides bindings to the POSIX syslog functions as well as OpenWrt specific ulog library functions.

### Usage

**Named import syntax:**
\`\`\`ucode
import { openlog, syslog, LOG_PID, LOG_USER, LOG_ERR } from 'log';

openlog("my-log-ident", LOG_PID, LOG_USER);
syslog(LOG_ERR, "An error occurred!");

// OpenWrt specific ulog functions
import { ulog_open, ulog, ULOG_SYSLOG, LOG_DAEMON, LOG_INFO } from 'log';

ulog_open(ULOG_SYSLOG, LOG_DAEMON, "my-log-ident");
ulog(LOG_INFO, "The current epoch is %d", time());
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as log from 'log';

log.openlog("my-log-ident", log.LOG_PID, log.LOG_USER);
log.syslog(log.LOG_ERR, "An error occurred!");

// OpenWrt specific ulog functions
log.ulog_open(log.ULOG_SYSLOG, log.LOG_DAEMON, "my-log-ident");
log.ulog(log.LOG_INFO, "The current epoch is %d", time());
\`\`\`

### Available Functions

**Standard syslog functions:**
- **\`openlog()\`** - Open connection to system logger
- **\`syslog()\`** - Log a message to the system logger
- **\`closelog()\`** - Close connection to system logger

**OpenWrt ulog functions:**
- **\`ulog_open()\`** - Configure ulog logger
- **\`ulog()\`** - Log a message via ulog mechanism
- **\`ulog_close()\`** - Close ulog logger
- **\`ulog_threshold()\`** - Set ulog priority threshold

**Convenience functions:**
- **\`INFO()\`** - Log with LOG_INFO priority
- **\`NOTE()\`** - Log with LOG_NOTICE priority
- **\`WARN()\`** - Log with LOG_WARNING priority
- **\`ERR()\`** - Log with LOG_ERR priority

### Constants

**Log options:** LOG_PID, LOG_CONS, LOG_NDELAY, LOG_ODELAY, LOG_NOWAIT

**Log facilities:** LOG_AUTH, LOG_AUTHPRIV, LOG_CRON, LOG_DAEMON, LOG_FTP, LOG_KERN, LOG_LPR, LOG_MAIL, LOG_NEWS, LOG_SYSLOG, LOG_USER, LOG_UUCP, LOG_LOCAL0-7

**Log priorities:** LOG_EMERG, LOG_ALERT, LOG_CRIT, LOG_ERR, LOG_WARNING, LOG_NOTICE, LOG_INFO, LOG_DEBUG

**Ulog channels:** ULOG_KMSG, ULOG_STDIO, ULOG_SYSLOG

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getMathModuleDocumentation(): string {
    return `## Math Module

**Mathematical and trigonometric functions for ucode scripts**

The math module provides comprehensive mathematical operations including basic arithmetic, trigonometry, logarithms, and random number generation.

### Usage

**Named import syntax:**
\`\`\`ucode
import { sin, cos, pow, sqrt, abs } from 'math';

let angle = 3.14159 / 4;  // 45 degrees in radians
let x = cos(angle);       // ~0.707
let y = sin(angle);       // ~0.707
let hypotenuse = sqrt(pow(x, 2) + pow(y, 2));  // ~1.0
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as math from 'math';

let angle = 3.14159 / 4;  // 45 degrees in radians
let x = math.cos(angle);  // ~0.707
let y = math.sin(angle);  // ~0.707
let hypotenuse = math.sqrt(math.pow(x, 2) + math.pow(y, 2));  // ~1.0
\`\`\`

### Available Functions

**Basic operations:**
- **\`abs()\`** - Absolute value
- **\`pow()\`** - Exponentiation (x^y)
- **\`sqrt()\`** - Square root

**Trigonometric functions:**
- **\`sin()\`** - Sine (radians)
- **\`cos()\`** - Cosine (radians)
- **\`atan2()\`** - Arc tangent of y/x (radians)

**Logarithmic and exponential:**
- **\`log()\`** - Natural logarithm
- **\`exp()\`** - e raised to the power of x

**Random number generation:**
- **\`rand()\`** - Generate pseudo-random integer
- **\`srand()\`** - Seed the random number generator

**Utility functions:**
- **\`isnan()\`** - Test if value is NaN (not a number)

### Notes

- All trigonometric functions use radians, not degrees
- Functions return NaN for invalid inputs
- \`rand()\` returns integers in range [0, RAND_MAX] (at least 32767)
- \`srand()\` can be used to create reproducible random sequences

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getNl80211ModuleDocumentation(): string {
    return `## NL80211 Module

**WiFi/802.11 networking interface for ucode scripts**

The nl80211 module provides access to the Linux kernel's nl80211 subsystem for managing WiFi interfaces and wireless networking operations.

### Usage

**Named import syntax:**
\`\`\`ucode
import { request, waitfor, listener, error } from 'nl80211';
import { NL80211_CMD_GET_WIPHY, NL80211_CMD_TRIGGER_SCAN } from 'nl80211';

// Request wireless interface information
let result = request(NL80211_CMD_GET_WIPHY, NLM_F_DUMP);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as nl80211 from 'nl80211';

// Trigger a scan and wait for results
let result = nl80211.request(nl80211.NL80211_CMD_TRIGGER_SCAN, nl80211.NLM_F_ACK);
let scanResults = nl80211.waitfor([nl80211.NL80211_CMD_NEW_SCAN_RESULTS], 10000);
\`\`\`

### Available Functions

**Core operations:**
- **\`request()\`** - Send netlink request to nl80211 subsystem
- **\`waitfor()\`** - Wait for specific nl80211 events
- **\`listener()\`** - Create event listener for nl80211 messages
- **\`error()\`** - Get last error information

### Available Constants

**Netlink flags:**
- **NLM_F_*** - Request flags (ACK, DUMP, CREATE, etc.)

**NL80211 commands:**
- **NL80211_CMD_*** - WiFi interface commands (GET_WIPHY, TRIGGER_SCAN, etc.)

**Interface types:**
- **NL80211_IFTYPE_*** - WiFi interface types (STATION, AP, MONITOR, etc.)

**Hardware simulator:**
- **HWSIM_CMD_*** - Commands for mac80211_hwsim testing

### Notes

- Requires root privileges or appropriate capabilities
- Used for WiFi interface management, scanning, and monitoring
- Integrates with OpenWrt's wireless configuration system
- Event-driven architecture for asynchronous operations

*Hover over individual function names and constants for detailed parameter and return type information.*`;
}

function getResolvModuleDocumentation(): string {
    return `## Resolv Module

**DNS resolution functionality for ucode scripts**

The resolv module provides DNS resolution functionality for ucode, allowing you to perform DNS queries for various record types and handle responses.

### Usage

**Named import syntax:**
\`\`\`ucode
import { query, error } from 'resolv';

let result = query('example.com', { type: ['A'] });
if (!result) {
    let err = error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as resolv from 'resolv';

let result = resolv.query('example.com', { type: ['A'] });
if (!result) {
    let err = resolv.error();
    print('DNS error: ', err, '\\n');
}
\`\`\`

### Available Functions

**Core operations:**
- **\`query()\`** - Perform DNS queries for specified domain names
- **\`error()\`** - Get the last error message from DNS operations

### Supported DNS Record Types

- **A** - IPv4 address record
- **AAAA** - IPv6 address record
- **CNAME** - Canonical name record
- **MX** - Mail exchange record
- **NS** - Name server record
- **PTR** - Pointer record (reverse DNS)
- **SOA** - Start of authority record
- **SRV** - Service record
- **TXT** - Text record
- **ANY** - Any available record type

### Response Codes

- **NOERROR** - Query successful
- **FORMERR** - Format error in query
- **SERVFAIL** - Server failure
- **NXDOMAIN** - Non-existent domain
- **NOTIMP** - Not implemented
- **REFUSED** - Query refused
- **TIMEOUT** - Query timed out

### Examples

Basic A record lookup:
\`\`\`ucode
const result = query(['example.com']);
\`\`\`

Specific record type query:
\`\`\`ucode
const mxRecords = query(['example.com'], { type: ['MX'] });
\`\`\`

Multiple domains with custom nameserver:
\`\`\`ucode
const results = query(['example.com', 'google.com'], {
    type: ['A', 'MX'],
    nameserver: ['8.8.8.8', '1.1.1.1'],
    timeout: 10000
});
\`\`\`

Reverse DNS lookup:
\`\`\`ucode
const ptrResult = query(['192.0.2.1'], { type: ['PTR'] });
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getRtnlModuleDocumentation(): string {
    return `## RTNL Module
**Routing Netlink functionality for ucode scripts**

The rtnl module provides routing netlink functionality for ucode, allowing you to interact with the Linux kernel's routing and network interface subsystem.

### Usage

**Named import syntax:**
\`\`\`ucode
import { request, listener, error } from 'rtnl';
// Send routing request
let result = request(RTM_GETROUTE, NLM_F_DUMP);
\`\`\`

**Constants import syntax:**
\`\`\`ucode
import { 'const' as rtnlconst } from 'rtnl';
let routeType = rtnlconst.RTN_UNICAST;
let tableId = rtnlconst.RT_TABLE_MAIN;
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as rtnl from 'rtnl';
let result = rtnl.request(rtnl.RTM_GETROUTE, rtnl.NLM_F_DUMP);
\`\`\`

### Available Functions

**Core operations:**
- **\`request()\`** - Send netlink request to routing subsystem
- **\`listener()\`** - Create event listener for routing messages  
- **\`error()\`** - Get last error information

### Available Constants

**Route types:**
- **RTN_UNICAST** - Gateway or direct route
- **RTN_LOCAL** - Accept locally
- **RTN_BROADCAST** - Accept locally as broadcast

**Route tables:**
- **RT_TABLE_UNSPEC** - Unspecified table
- **RT_TABLE_MAIN** - Main routing table
- **RT_TABLE_LOCAL** - Local routing table

**Bridge flags:**
- **BRIDGE_FLAGS_MASTER** - Bridge master flag
- **BRIDGE_FLAGS_SELF** - Bridge self flag

*Hover over individual function and constant names for detailed information.*`;
}

function getSocketModuleDocumentation(): string {
    return `## Socket Module

**Network socket functionality for ucode scripts**

The socket module provides comprehensive network socket functionality for creating TCP/UDP connections, listening for incoming connections, and handling network communication.

### Usage

**Named import syntax:**
\`\`\`ucode
import { create, connect, listen, AF_INET, SOCK_STREAM } from 'socket';

// Create a TCP socket
let sock = create(AF_INET, SOCK_STREAM);
let result = connect(sock, "192.168.1.1", "80");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as socket from 'socket';

// Create a UDP socket
let sock = socket.create(socket.AF_INET, socket.SOCK_DGRAM);
let result = socket.connect(sock, "8.8.8.8", "53");
\`\`\`

### Available Functions

**Socket creation and connection:**
- **\`create()\`** - Create a new socket with specified domain, type, and protocol
- **\`connect()\`** - Connect socket to a remote address
- **\`listen()\`** - Listen for incoming connections on a socket

**Address resolution:**
- **\`sockaddr()\`** - Create socket address structures
- **\`addrinfo()\`** - Resolve hostnames and service names to addresses
- **\`nameinfo()\`** - Convert addresses back to hostnames

**I/O operations:**
- **\`poll()\`** - Wait for events on multiple sockets

**Error handling:**
- **\`error()\`** - Get socket error information
- **\`strerror()\`** - Convert error codes to human-readable strings

### Socket Constants

**Address Families:**
- **AF_INET** - IPv4 Internet protocols
- **AF_INET6** - IPv6 Internet protocols  
- **AF_UNIX** - Unix domain sockets

**Socket Types:**
- **SOCK_STREAM** - TCP (reliable, connection-oriented)
- **SOCK_DGRAM** - UDP (unreliable, connectionless)
- **SOCK_RAW** - Raw sockets

**Socket Options:**
- **SOL_SOCKET**, **SO_REUSEADDR**, **SO_KEEPALIVE**, etc.

**Message Flags:**
- **MSG_DONTWAIT**, **MSG_NOSIGNAL**, **MSG_PEEK**, etc.

**Protocols:**
- **IPPROTO_TCP**, **IPPROTO_UDP**, **IPPROTO_IP**, etc.

**Poll Events:**
- **POLLIN**, **POLLOUT**, **POLLERR**, **POLLHUP**, etc.

### Examples

Create and connect TCP socket:
\`\`\`ucode
let sock = create(AF_INET, SOCK_STREAM);
if (connect(sock, "example.com", "80") == 0) {
    print("Connected successfully\\n");
}
\`\`\`

Create UDP server:
\`\`\`ucode
let sock = create(AF_INET, SOCK_DGRAM);
listen(sock, "0.0.0.0", "8080");
\`\`\`

Wait for socket events:
\`\`\`ucode
let result = poll([{fd: sock, events: POLLIN}], 5000);
\`\`\`

*Hover over individual function names and constants for detailed parameter and return type information.*`;
}

function getFsMethodHover(memberInfo: { objectName: string; propertyName: string }, analysisResult: SemanticAnalysisResult): string | null {
    const { objectName, propertyName } = memberInfo;
    
    // Look up the object in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return null;
    }
    
    // Check if this is an fs object type
    const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
    if (!fsType) {
        return null;
    }
    
    // Get the method signature for this fs type
    const methodSignature = fsTypeRegistry.getFsMethod(fsType, propertyName);
    if (!methodSignature) {
        return null;
    }
    
    // Format the hover documentation
    let documentation = `**${propertyName}()** - ${fsType} method\n\n`;
    
    if (methodSignature.description) {
        documentation += methodSignature.description + '\n\n';
    }
    
    // Add parameter information
    if (methodSignature.parameters.length > 0) {
        documentation += '**Parameters:**\n';
        methodSignature.parameters.forEach((param, index) => {
            const paramName = getParameterName(propertyName, index);
            const isOptional = (methodSignature.minParams !== undefined && index >= methodSignature.minParams) ||
                             (methodSignature.maxParams !== undefined && index >= methodSignature.maxParams);
            documentation += `- **${paramName}**: \`${param}\`${isOptional ? ' (optional)' : ''}\n`;
        });
        documentation += '\n';
    }
    
    // Add return type information
    documentation += `**Returns:** \`${methodSignature.returnType}\`\n\n`;
    
    // Add specific examples for read method
    if (propertyName === 'read') {
        documentation += '**Examples:**\n';
        documentation += '```ucode\n';
        documentation += `${objectName}.read(10);        // Read 10 bytes\n`;
        documentation += `${objectName}.read("line");    // Read until newline\n`;
        documentation += `${objectName}.read("all");     // Read until EOF\n`;
        documentation += `${objectName}.read(":");       // Read until colon\n`;
        documentation += '```\n';
    }
    
    return documentation;
}

function getParameterName(methodName: string, paramIndex: number): string {
    const paramMappings: { [key: string]: string[] } = {
        'read': ['length'],
        'write': ['data'],
        'seek': ['offset', 'position'],
        'truncate': ['offset'],
        'lock': ['operation'],
        'ioctl': ['direction', 'type', 'num', 'value']
    };
    
    const params = paramMappings[methodName];
    if (params && paramIndex < params.length) {
        return params[paramIndex]!;
    }
    
    return `param${paramIndex + 1}`;
}

function getFsModuleDocumentation(): string {
    return `## FS Module

**File system operations for ucode scripts**

The fs module provides comprehensive file system functionality for reading, writing, and manipulating files and directories.

### Usage

**Named import syntax:**
\`\`\`ucode
import { open, readlink, stat } from 'fs';

let file = open("file.txt", "r");
let target = readlink("/sys/class/net/eth0");
let info = stat("/etc/passwd");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as fs from 'fs';

let file = fs.open("file.txt", "r");
let content = file.read("all");
file.close();
\`\`\`

### Available Functions

**File operations:**
- **\`open()\`** - Open files for reading/writing
- **\`fdopen()\`** - Associate file descriptor with handle
- **\`popen()\`** - Execute commands and handle I/O

**Directory operations:**
- **\`opendir()\`** - Open directories for reading
- **\`mkdir()\`** - Create directories
- **\`rmdir()\`** - Remove directories

**File system information:**
- **\`stat()\`** - Get file/directory information
- **\`lstat()\`** - Get info without following symlinks
- **\`readlink()\`** - Read symbolic link targets

**File manipulation:**
- **\`unlink()\`** - Remove files
- **\`symlink()\`** - Create symbolic links
- **\`chmod()\`** - Change file permissions
- **\`chown()\`** - Change file ownership

**Utility functions:**
- **\`error()\`** - Get last error information
- **\`getcwd()\`** - Get current working directory
- **\`chdir()\`** - Change current directory

### File Handle Objects

- **\`fs.file\`** - File handles with read/write/seek methods
- **\`fs.proc\`** - Process handles for command execution
- **\`fs.dir\`** - Directory handles for listing entries

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getStructModuleDocumentation(): string {
    return `## Struct Module

**Binary data packing/unpacking module for ucode scripts**

The struct module provides routines for interpreting byte strings as packed binary data, similar to Python's struct module.

### Usage

**Named import syntax:**
\`\`\`ucode
import { pack, unpack } from 'struct';

let buffer = pack('bhl', -13, 1234, 444555666);
let values = unpack('bhl', buffer);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as struct from 'struct';

let buffer = struct.pack('bhl', -13, 1234, 444555666);
let values = struct.unpack('bhl', buffer);
\`\`\`

### Available Functions

**Core functions:**
- **\`pack()\`** - Pack values into binary string according to format
- **\`unpack()\`** - Unpack binary string into values according to format
- **\`new()\`** - Create precompiled format instance for efficiency
- **\`buffer()\`** - Create struct buffer for incremental operations

### Format String Syntax

**Format characters:**
- **\`b/B\`** - signed/unsigned char (1 byte)
- **\`h/H\`** - signed/unsigned short (2 bytes)
- **\`i/I\`** - signed/unsigned int (4 bytes)
- **\`l/L\`** - signed/unsigned long (4 bytes)
- **\`q/Q\`** - signed/unsigned long long (8 bytes)
- **\`f\`** - float (4 bytes)
- **\`d\`** - double (8 bytes)
- **\`s\`** - string
- **\`?\`** - boolean

**Byte order prefixes:**
- **\`@\`** - native (default)
- **\`<\`** - little-endian
- **\`>\`** - big-endian
- **\`!\`** - network (big-endian)

### Examples

\`\`\`ucode
// Pack three integers as network byte order
let data = pack('!III', 1, 2, 3);

// Unpack the same data
let [a, b, c] = unpack('!III', data);

// Use precompiled format for efficiency
let fmt = struct.new('!III');
let packed = fmt.pack(1, 2, 3);
let unpacked = fmt.unpack(packed);
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getUbusModuleDocumentation(): string {
    return `## ubus Module

**OpenWrt unified bus communication for ucode scripts**

The ubus module provides comprehensive access to the OpenWrt unified bus (ubus) system, enabling communication with system services and daemons.

### Usage

**Named import syntax:**
\`\`\`ucode
import { connect, error, STATUS_OK } from 'ubus';

let conn = connect();
if (conn) {
    let objects = conn.list();
    print("Available objects:", length(objects));
} else {
    print("Connection failed:", error());
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as ubus from 'ubus';

let conn = ubus.connect();
if (conn) {
    let result = conn.call("system", "info", {});
    print("System info:", result);
}
\`\`\`

### Available Functions

- **\`connect()\`** - Establish connection to ubus daemon
- **\`error()\`** - Retrieve last ubus error information
- **\`open_channel()\`** - Create bidirectional ubus channel
- **\`guard()\`** - Set/get global ubus exception handler

### Status Constants

- **\`STATUS_OK\`** - Operation completed successfully
- **\`STATUS_INVALID_COMMAND\`** - Invalid or unknown command
- **\`STATUS_INVALID_ARGUMENT\`** - Invalid argument provided
- **\`STATUS_METHOD_NOT_FOUND\`** - Requested method not found
- **\`STATUS_NOT_FOUND\`** - Requested object not found
- **\`STATUS_NO_DATA\`** - No data available
- **\`STATUS_PERMISSION_DENIED\`** - Access denied
- **\`STATUS_TIMEOUT\`** - Operation timed out
- **\`STATUS_NOT_SUPPORTED\`** - Operation not supported
- **\`STATUS_UNKNOWN_ERROR\`** - Unknown error occurred
- **\`STATUS_CONNECTION_FAILED\`** - Connection failed

### Connection Methods

Once connected, the connection object provides methods like:
- **\`list()\`** - List available ubus objects
- **\`call()\`** - Call methods on ubus objects
- **\`publish()\`** - Publish ubus objects
- **\`listener()\`** - Register event listeners
- **\`subscriber()\`** - Create subscriptions

### Additional Information

The ubus module is specifically designed for OpenWrt systems and requires the ubus daemon to be running. It provides both synchronous and asynchronous communication patterns for maximum flexibility.

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getUciModuleDocumentation(): string {
    return `## UCI Module

**OpenWrt UCI configuration interface for ucode scripts**

The uci module provides access to the native OpenWrt libuci API for reading and manipulating UCI configuration files.

### Usage

**Named import syntax:**
\`\`\`ucode
import { cursor } from 'uci';

let ctx = cursor();
let hostname = ctx.get_first('system', 'system', 'hostname');
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as uci from 'uci';

let ctx = uci.cursor();
let hostname = ctx.get_first('system', 'system', 'hostname');
\`\`\`

### Available Functions

- **\`error()\`** - Query error information
- **\`cursor()\`** - Instantiate uci cursor for configuration manipulation

### UCI Cursor Methods

The cursor object provides comprehensive methods for configuration management:

- **Configuration Management**: \`load()\`, \`unload()\`, \`configs()\`
- **Data Access**: \`get()\`, \`get_all()\`, \`get_first()\`, \`foreach()\`
- **Data Modification**: \`add()\`, \`set()\`, \`delete()\`, \`rename()\`, \`reorder()\`
- **List Operations**: \`list_append()\`, \`list_remove()\`
- **Change Management**: \`save()\`, \`commit()\`, \`revert()\`, \`changes()\`

### Configuration Files

UCI configurations are stored in \`/etc/config/\` and can be manipulated through the cursor interface:

\`\`\`ucode
let ctx = cursor();

// Read configuration values
let hostname = ctx.get('system', '@system[0]', 'hostname');

// Modify configuration
ctx.set('system', '@system[0]', 'hostname', 'new-hostname');
ctx.commit('system');
\`\`\`

### Additional Information

The uci module is specifically designed for OpenWrt systems and provides safe, transactional access to system configuration files with support for delta records and change tracking.

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getUloopMethodHover(memberInfo: { objectName: string; propertyName: string }, analysisResult: SemanticAnalysisResult): string | null {
    const { objectName, propertyName } = memberInfo;
    
    // Look up the object in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return null;
    }
    
    // Check if this is a uloop namespace import (import * as uloop from 'uloop')
    if (symbol.type === 'imported' && symbol.importedFrom === 'uloop') {
        // Check if the property is a valid uloop function
        if (uloopTypeRegistry.isUloopFunction(propertyName)) {
            return uloopTypeRegistry.getFunctionDocumentation(propertyName);
        }
        
        // Check if the property is a valid uloop constant
        if (uloopTypeRegistry.isUloopConstant(propertyName)) {
            return uloopTypeRegistry.getConstantDocumentation(propertyName);
        }
    }
    
    // Check if this is a uloop object type with methods
    const uloopType = uloopObjectRegistry.isVariableOfUloopType(symbol.dataType);
    if (uloopType) {
        // Get the method signature for this uloop object type
        const methodSignature = uloopObjectRegistry.getUloopMethod(uloopType, propertyName);
        if (methodSignature) {
            const params = methodSignature.parameters.map(p => {
                if (p.optional && p.defaultValue !== undefined) {
                    return `[${p.name}: ${p.type}] = ${p.defaultValue}`;
                } else if (p.optional) {
                    return `[${p.name}: ${p.type}]`;
                } else {
                    return `${p.name}: ${p.type}`;
                }
            }).join(', ');
            
            let doc = `**${methodSignature.name}(${params}): ${methodSignature.returnType}**\n\n${methodSignature.description}\n\n`;
            
            if (methodSignature.parameters.length > 0) {
                doc += '**Parameters:**\n';
                methodSignature.parameters.forEach(param => {
                    const optional = param.optional ? ' (optional)' : '';
                    const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
                    doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\n`;
                });
                doc += '\n';
            }
            
            doc += `**Returns:** \`${methodSignature.returnType}\``;
            
            return doc;
        }
    }
    
    return null;
}

function getUloopModuleDocumentation(): string {
    return `**uloop** - OpenWrt uloop event loop module

Provides event-driven programming capabilities for handling timers, file descriptors, processes, signals, and background tasks.

### Core Functions

- **\`init()\`** - Initialize the event loop
- **\`run([timeout])\`** - Run the event loop  
- **\`end()\`** - Stop the event loop
- **\`done()\`** - Stop and cleanup the event loop

### Event Objects

- **\`timer(timeout, callback)\`** - Create timer objects
- **\`handle(fd, callback, events)\`** - Monitor file descriptors
- **\`process(cmd, args, env, callback)\`** - Execute external processes  
- **\`task(taskFunc, outputCb, inputCb)\`** - Run background tasks
- **\`interval(timeout, callback)\`** - Create repeating timers
- **\`signal(signal, callback)\`** - Handle Unix signals

### Constants

- **\`ULOOP_READ\`** (1) - Monitor for read events
- **\`ULOOP_WRITE\`** (2) - Monitor for write events  
- **\`ULOOP_EDGE_TRIGGER\`** (4) - Use edge-triggered mode
- **\`ULOOP_BLOCKING\`** (8) - Keep descriptor blocking

### Usage Examples

\`\`\`ucode
import * as uloop from 'uloop';

uloop.init();

// Create a timer
let timer = uloop.timer(1000, () => {
    printf("Timer fired!\\n");
});

// Monitor a file descriptor  
let handle = uloop.handle(fd, (events) => {
    if (events & uloop.ULOOP_READ) {
        // Handle read event
    }
}, uloop.ULOOP_READ);

// Run the event loop
uloop.run();
\`\`\`

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getZlibModuleDocumentation(): string {
    return `## Zlib Module

**Data compression and decompression module**

The zlib module provides single-call and stream-oriented functions for interacting with zlib data compression.

### Usage

**Named import syntax:**
\`\`\`ucode
import { deflate, inflate, Z_BEST_SPEED, Z_NO_FLUSH } from 'zlib';

const compressed = deflate("Hello World!", true, Z_BEST_SPEED);
const decompressed = inflate(compressed);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as zlib from 'zlib';

const compressed = zlib.deflate("Hello World!");
const decompressed = zlib.inflate(compressed);

// Streaming compression
const deflater = zlib.deflater(false, zlib.Z_DEFAULT_COMPRESSION);
deflater.write("data chunk", zlib.Z_NO_FLUSH);
const result = deflater.read();
\`\`\`

### Available Functions

- **\`deflate()\`** - Compresses data in Zlib or gzip format
- **\`inflate()\`** - Decompresses data in Zlib or gzip format  
- **\`deflater()\`** - Initialize a deflate stream for streaming compression
- **\`inflater()\`** - Initialize an inflate stream for streaming decompression

### Compression Levels

- **\`Z_NO_COMPRESSION\`** (0) - No compression
- **\`Z_BEST_SPEED\`** (1) - Fastest compression
- **\`Z_BEST_COMPRESSION\`** (9) - Maximum compression
- **\`Z_DEFAULT_COMPRESSION\`** (-1) - Default balance of speed/compression

### Flush Options

- **\`Z_NO_FLUSH\`** (0) - No flushing, accumulate data
- **\`Z_PARTIAL_FLUSH\`** (1) - Partial flush without closing stream  
- **\`Z_SYNC_FLUSH\`** (2) - Sync flush, align to byte boundary
- **\`Z_FULL_FLUSH\`** (3) - Full flush, reset compression state
- **\`Z_FINISH\`** (4) - Finish stream, no more input expected

### Additional Information

Supports both single-call compression/decompression and streaming operations. The streaming API allows processing large amounts of data in chunks without loading everything into memory.

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getFsModuleMethodHover(memberInfo: { objectName: string; propertyName: string }, analysisResult: SemanticAnalysisResult): string | null {
    const { objectName, propertyName } = memberInfo;
    
    // Look up the object in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return null;
    }
    
    // Check if this is an fs module (from require('fs') or import * as fs from 'fs')
    const isFsModule = (
        // Direct fs module import: import * as fs from 'fs'
        (symbol.type === 'imported' && symbol.importedFrom === 'fs') ||
        
        // Module symbol from require: const fs = require('fs')
        (symbol.type === 'module' && symbol.dataType && 
         typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType && 
         symbol.dataType.moduleName === 'fs')
    );
    
    if (isFsModule) {
        // Check if the property is a valid fs module function
        if (fsModuleTypeRegistry.isFsModuleFunction(propertyName)) {
            return fsModuleTypeRegistry.getFunctionDocumentation(propertyName);
        }
    }
    
    return null;
}
