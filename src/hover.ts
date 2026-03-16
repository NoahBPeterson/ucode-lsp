import {
    TextDocumentPositionParams,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType, isKeyword, Token } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType, Symbol as UcodeSymbol } from './analysis';
import { typeToString, UcodeDataType, UcodeType } from './analysis/symbolTable';
import { exceptionTypeRegistry } from './analysis/exceptionTypes';
import { regexTypeRegistry } from './analysis/regexTypes';
import { Option } from 'effect';
import { MODULE_REGISTRIES, isKnownModule, isKnownObjectType, getModuleMemberDocumentation, getImportedSymbolDocumentation, getObjectMethodDocumentation, resolveReturnObjectType, type KnownObjectType } from './analysis/moduleDispatch';
import { parseFormatSpecifiers } from './analysis/checkers/builtinValidation';

const BUILTIN_METHOD_NOTE = '\n\n---\n*Built-in C method — no source definition available*';

function appendBuiltinNote(doc: string): string {
    return doc + BUILTIN_METHOD_NOTE;
}

function detectMemberHoverContext(position: any, tokens: any[], document: any): { objectName: string, memberName: string, memberTokenPos: number, memberTokenEnd: number, resolvedObjectType?: KnownObjectType } | undefined {
    // Look for pattern: LABEL DOT LABEL (where cursor is over the second LABEL)
    // Also handles call chains: LABEL(...) DOT LABEL, LABEL DOT LABEL(...) DOT LABEL

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
    if (dotToken.type !== TokenType.TK_DOT || dotToken.end !== hoverToken.pos) {
        return undefined;
    }

    const objectToken = tokens[hoverTokenIndex - 2];

    // Verify the pattern: LABEL DOT LABEL
    if (objectToken.type === TokenType.TK_LABEL &&
        objectToken.end === dotToken.pos) {

        return {
            objectName: objectToken.value as string,
            memberName: hoverToken.value as string,
            memberTokenPos: hoverToken.pos,
            memberTokenEnd: hoverToken.end
        };
    }

    // Handle `this` keyword: THIS DOT LABEL
    if (objectToken.type === TokenType.TK_THIS &&
        objectToken.end === dotToken.pos) {

        return {
            objectName: 'this',
            memberName: hoverToken.value as string,
            memberTokenPos: hoverToken.pos,
            memberTokenEnd: hoverToken.end
        };
    }

    // Handle call chain pattern: ...LABEL(...) DOT LABEL
    if (objectToken.type === TokenType.TK_RPAREN &&
        objectToken.end === dotToken.pos) {
        // Walk backward through matched parens
        let parenDepth = 1;
        let j = hoverTokenIndex - 3;
        while (j >= 0 && parenDepth > 0) {
            if (tokens[j].type === TokenType.TK_RPAREN) parenDepth++;
            else if (tokens[j].type === TokenType.TK_LPAREN) parenDepth--;
            j--;
        }
        // j now points to the token before the opening paren
        if (j >= 0 && tokens[j].type === TokenType.TK_LABEL) {
            const funcName = tokens[j].value as string;
            let moduleName: string | undefined;
            if (j >= 2 && tokens[j - 1].type === TokenType.TK_DOT && tokens[j - 2].type === TokenType.TK_LABEL) {
                moduleName = tokens[j - 2].value as string;
            }
            const objType = resolveReturnObjectType(funcName, moduleName);
            if (objType) {
                return {
                    objectName: '__call_chain__',
                    memberName: hoverToken.value as string,
                    memberTokenPos: hoverToken.pos,
                    memberTokenEnd: hoverToken.end,
                    resolvedObjectType: objType
                };
            }
        }
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

/**
 * Detect known object type from a symbol's dataType.
 */
function detectObjectTypeFromDataType(dataType: any): KnownObjectType | null {
    if (!dataType || typeof dataType !== 'object' || !('moduleName' in dataType)) return null;
    const mn = dataType.moduleName as string;
    if (isKnownObjectType(mn)) return mn;
    return null;
}

/**
 * Unified member hover: handles object method hover (fs.file/dir/proc, io.handle, uloop.*, uci.cursor)
 * and module namespace hover (fs.opendir, io.open, uloop.init, etc.)
 */
function getUnifiedMemberHover(
    memberInfo: { objectName: string; propertyName: string },
    analysisResult: SemanticAnalysisResult
): string | null {
    const { objectName, propertyName } = memberInfo;

    // Look up the object in the symbol table
    let symbol = analysisResult.symbolTable.lookup(objectName);

    // Try CFG-based lookup if symbol table fails
    if (!symbol && analysisResult.cfgQueryEngine) {
        const cfgType = analysisResult.cfgQueryEngine.getTypeAtPosition(objectName, 0);
        if (cfgType) {
            symbol = {
                name: objectName,
                type: SymbolType.VARIABLE,
                dataType: cfgType,
                scope: 0,
                declared: true,
                used: true,
                node: {} as any,
                declaredAt: 0,
                usedAt: [0]
            } as UcodeSymbol;
        }
    }

    if (!symbol) return null;

    // 1. Check if it's a known object type (fs.file, io.handle, uloop.timer, etc.)
    const objType = detectObjectTypeFromDataType(symbol.dataType);
    if (objType) {
        const methodDoc = getObjectMethodDocumentation(objType, propertyName);
        if (Option.isSome(methodDoc)) return appendBuiltinNote(methodDoc.value);
    }

    // 2. Check if it's a module namespace import (import * as fs from 'fs') or require('fs')
    let moduleName: string | undefined;
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom) {
        moduleName = symbol.importedFrom;
    } else if (symbol.dataType && typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType) {
        moduleName = (symbol.dataType as any).moduleName as string;
    }

    if (moduleName && isKnownModule(moduleName)) {
        const doc = getModuleMemberDocumentation(moduleName, propertyName);
        if (Option.isSome(doc)) return doc.value;
    }

    return null;
}

const FORMAT_SPECIFIER_DESCRIPTIONS: Record<string, string> = {
    'd': 'signed decimal integer',
    'i': 'signed decimal integer',
    'u': 'unsigned decimal integer',
    'o': 'unsigned octal',
    'x': 'unsigned hex (lowercase)',
    'X': 'unsigned hex (uppercase)',
    'f': 'decimal floating point',
    'F': 'decimal floating point',
    'e': 'scientific notation (lowercase)',
    'E': 'scientific notation (uppercase)',
    'g': 'shortest of %e/%f (lowercase)',
    'G': 'shortest of %E/%F (uppercase)',
    'a': 'hex floating point (lowercase)',
    'A': 'hex floating point (uppercase)',
    's': 'string',
    'c': 'character',
    'J': 'JSON serialization (ucode-specific)',
    'n': 'number of characters written so far',
    'p': 'pointer address',
    '%': "literal '%'",
};

function getFormatSpecifierHover(token: Token, tokenIndex: number, tokens: Token[], offset: number, document: any): Hover | undefined {
    // Walk backwards: expect TK_LPAREN, then TK_LABEL with value printf/sprintf
    // Allow for optional comma/args between, but the string must be the first arg
    // Pattern: LABEL LPAREN STRING ...
    let lparenIdx = -1;
    for (let i = tokenIndex - 1; i >= 0; i--) {
        const t = tokens[i]!;
        if (t.type === TokenType.TK_LPAREN) {
            lparenIdx = i;
            break;
        }
        // If we hit anything other than whitespace-like tokens between LPAREN and our string,
        // this string is not the first argument
        if (t.type === TokenType.TK_COMMA || t.type === TokenType.TK_RPAREN ||
            t.type === TokenType.TK_SCOL || t.type === TokenType.TK_LBRACE) {
            return undefined;
        }
    }
    if (lparenIdx < 0) return undefined;

    // The token before LPAREN should be a LABEL with value printf or sprintf
    const labelIdx = lparenIdx - 1;
    if (labelIdx < 0) return undefined;
    const labelToken = tokens[labelIdx];
    if (!labelToken || labelToken.type !== TokenType.TK_LABEL) return undefined;
    const funcName = labelToken.value as string;
    if (funcName !== 'printf' && funcName !== 'sprintf') return undefined;

    // Check there are no tokens between LPAREN and our string (it must be the first arg)
    let hasTokensBetween = false;
    for (let i = lparenIdx + 1; i < tokenIndex; i++) {
        hasTokensBetween = true;
        break;
    }
    if (hasTokensBetween) return undefined;

    // Parse the format string (strip quotes)
    const rawValue = token.value as string;
    const specifiers = parseFormatSpecifiers(rawValue);
    if (specifiers.length === 0) return undefined;

    // Compute cursor offset within the string content
    // token.pos is the position of the opening quote, so string content starts at token.pos + 1
    const cursorOffsetInString = offset - token.pos - 1;

    // Find which specifier the cursor is over
    let argIndex = 0;
    for (const spec of specifiers) {
        if (spec.specifier !== '%') argIndex++; // %% doesn't consume an argument
        if (cursorOffsetInString >= spec.position && cursorOffsetInString < spec.endPosition) {
            // Found the specifier under the cursor
            const desc = FORMAT_SPECIFIER_DESCRIPTIONS[spec.specifier];
            if (!desc) return undefined;

            let markdown = `**Format specifier: \`${spec.fullMatch}\`**\n\n`;

            const hasModifiers = spec.flags || spec.width || spec.precision;
            if (hasModifiers) {
                markdown += '| | |\n|---|---|\n';
                markdown += `| Type | ${desc} |\n`;
                if (spec.flags) {
                    const flagDescs: string[] = [];
                    if (spec.flags.includes('-')) flagDescs.push('left-align');
                    if (spec.flags.includes('+')) flagDescs.push('always show sign');
                    if (spec.flags.includes(' ')) flagDescs.push('space before positive');
                    if (spec.flags.includes('0')) flagDescs.push('zero-pad');
                    if (spec.flags.includes('#')) flagDescs.push('alternate form');
                    markdown += `| Flags | \`${spec.flags}\` (${flagDescs.join(', ')}) |\n`;
                }
                if (spec.width) {
                    const widthDesc = spec.width === '*' ? 'from argument' : `${spec.width} (minimum field width)`;
                    markdown += `| Width | ${widthDesc} |\n`;
                }
                if (spec.precision) {
                    const precDesc = spec.precision === '*' ? 'from argument' : `${spec.precision} (decimal places)`;
                    markdown += `| Precision | ${precDesc} |\n`;
                }
            } else {
                if (spec.specifier === '%') {
                    markdown += `Prints a ${desc}.`;
                } else {
                    markdown += `Prints a **${desc}**.`;
                }
            }

            if (spec.specifier !== '%') {
                markdown += `\n\nArgument ${argIndex} in the call.`;
            }

            // Compute hover range: the specifier within the document
            const specStartOffset = token.pos + 1 + spec.position;
            const specEndOffset = token.pos + 1 + spec.endPosition;

            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: markdown
                },
                range: {
                    start: document.positionAt(specStartOffset),
                    end: document.positionAt(specEndOffset)
                }
            };
        }
    }

    return undefined;
}

export function handleHover(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    analysisResult?: SemanticAnalysisResult,
    cachedTokens?: any[]
): Hover | undefined {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        return undefined;
    }

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);

    try {
        // Use cached tokens when available to avoid re-lexing the entire document
        let tokens: any[];
        if (cachedTokens && cachedTokens.length > 0) {
            tokens = cachedTokens;
        } else {
            const lexer = new UcodeLexer(text, { rawMode: true });
            tokens = lexer.tokenize();
        }
        
        // First check if we're hovering over a member expression (e.g., "rtnl.request")
        const memberContext = detectMemberHoverContext(textDocumentPositionParams.position, tokens, document);
        if (memberContext) {
            const { objectName, memberName, resolvedObjectType } = memberContext;

            // Call chain hover: cursor().foreach, fs.open().read, etc.
            if (resolvedObjectType) {
                const methodDoc = getObjectMethodDocumentation(resolvedObjectType, memberName);
                if (Option.isSome(methodDoc)) {
                    return {
                        contents: { kind: MarkupKind.Markdown, value: appendBuiltinNote(methodDoc.value) },
                        range: {
                            start: document.positionAt(memberContext.memberTokenPos),
                            end: document.positionAt(memberContext.memberTokenEnd)
                        }
                    };
                }
                return undefined;
            }

            // Look up the object in the symbol table to determine its module
            if (analysisResult && analysisResult.symbolTable) {
                // Try position-aware lookup first for correct scoping, then fall back
                let symbol = analysisResult.symbolTable.lookupAtPosition(objectName, offset);
                if (!symbol) {
                    symbol = analysisResult.symbolTable.lookup(objectName);
                }
                if (analysisResult.cfgQueryEngine && !symbol) {
                    const cfgType = analysisResult.cfgQueryEngine.getTypeAtPosition(objectName, offset);
                    if (cfgType) {
                        // Create a temporary symbol with CFG-inferred type
                        symbol = {
                            name: objectName,
                            type: SymbolType.VARIABLE,
                            dataType: cfgType,
                            scope: 0,
                            declared: true,
                            used: true,
                            node: {} as any,
                            declaredAt: offset,
                            usedAt: [offset]
                        } as UcodeSymbol;
                    }
                }
                if (symbol && symbol.propertyTypes && symbol.propertyTypes.has(memberName)) {
                    const propertyType = symbol.propertyTypes.get(memberName)!;
                    const typeString = typeToString(propertyType);
                    const scopeLabel = objectName === 'global'
                        ? `Global property on \`${objectName}\``
                        : `Property on \`${objectName}\``;
                    const hoverMarkdown = `**${memberName}**: \`${typeString}\`\n\n${scopeLabel}`;


                    return {
                        contents: { kind: MarkupKind.Markdown, value: hoverMarkdown },
                        range: {
                            start: document.positionAt(memberContext.memberTokenPos),
                            end: document.positionAt(memberContext.memberTokenEnd)
                        }
                    };
                }

                if (symbol && symbol.type === SymbolType.IMPORTED) {

                    // Get module-specific documentation for the member
                    const moduleName = symbol.importedFrom;
                    let hoverText: string | undefined;

                    if (moduleName && isKnownModule(moduleName)) {
                        const doc = getModuleMemberDocumentation(moduleName, memberName);
                        if (Option.isSome(doc)) {
                            hoverText = doc.value;
                        }
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
                } else if (symbol) {
                    // Non-imported variable — check if it's a typed object (io.handle, fs.file, etc.)
                    const objType = detectObjectTypeFromDataType(symbol.dataType);
                    if (objType) {
                        const methodDoc = getObjectMethodDocumentation(objType, memberName);
                        if (Option.isSome(methodDoc)) {
                            return {
                                contents: { kind: MarkupKind.Markdown, value: appendBuiltinNote(methodDoc.value) },
                                range: {
                                    start: document.positionAt(memberContext.memberTokenPos),
                                    end: document.positionAt(memberContext.memberTokenEnd)
                                }
                            };
                        }
                    }
                    // For other non-imported objects, don't show builtin hover
                    return undefined;
                }
            } else {
                // No analysis result or symbol table - for member expressions, don't show builtin hover
                return undefined;
            }
        }
        
        const token = tokens.find(t => t.pos <= offset && offset < t.end);
        const tokenIndex = token ? tokens.indexOf(token) : -1;

        // Check for printf/sprintf format specifier hover
        if (token && token.type === TokenType.TK_STRING && tokenIndex >= 0) {
            const fmtHover = getFormatSpecifierHover(token, tokenIndex, tokens, offset, document);
            if (fmtHover) return fmtHover;
        }

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
        
        // Handle 'from' keyword — when imported from io module, it's lexed as TK_FROM not TK_LABEL
        if (token && token.type === TokenType.TK_FROM && analysisResult) {
            const word = 'from';
            const symbol = analysisResult.symbolTable.lookup(word);
            if (symbol && symbol.type === SymbolType.IMPORTED && symbol.importedFrom === 'io') {
                const originalName = symbol.importSpecifier || symbol.name;
                const isFunctionCall = detectFunctionCall(offset, tokens);
                const ioDoc = getImportedSymbolDocumentation('io', originalName);
                let hoverText: string = Option.isSome(ioDoc) ? ioDoc.value : MODULE_REGISTRIES['io'].getModuleDocumentation();
                if (isFunctionCall && symbol.returnType) {
                    const returnTypeStr = typeToString(symbol.returnType);
                    hoverText = `(function call) **${word}()**: \`${returnTypeStr}\`\n\n${hoverText}`;
                }
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

        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            const word = token.value;

            // Check if this is a function call (e.g., test() instead of just test)
            const isFunctionCall = detectFunctionCall(offset, tokens);
            if (isFunctionCall && analysisResult) {
                let symbol = analysisResult.symbolTable.lookupAtPosition(word, offset);
                if (!symbol) {
                    symbol = analysisResult.symbolTable.lookup(word);
                }

                // Try CFG-based type lookup for flow-sensitive function types
                if (!symbol && analysisResult.cfgQueryEngine) {
                    const cfgType = analysisResult.cfgQueryEngine.getTypeAtPosition(word, offset);
                    if (cfgType) {
                        // If CFG found a type, create a symbol with it
                        // For function calls, the CFG type may be the function itself or its return type
                        symbol = {
                            name: word,
                            type: SymbolType.VARIABLE,
                            dataType: cfgType,
                            scope: 0,
                            declared: true,
                            used: true,
                            node: {} as any,
                            declaredAt: offset,
                            usedAt: [offset]
                        } as UcodeSymbol;
                    }
                }

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
            if (memberExpressionInfo && analysisResult && !memberExpressionInfo.cursorOnObject) {
                // Only show method/property hover when cursor is on the property side
                // When cursor is on the object side, fall through to the variable type display

                // Unified member hover: check object types and module namespaces
                const memberHoverDoc = getUnifiedMemberHover(memberExpressionInfo, analysisResult);
                if (memberHoverDoc) {
                    return {
                        contents: {
                            kind: MarkupKind.Markdown,
                            value: memberHoverDoc
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
            
            // 0. Check if we're inside an import specifier: import { WORD as ... } from 'module'
            // Show the original module function's documentation, not a same-named variable
            {
                const lineStart = text.lastIndexOf('\n', offset) + 1;
                const lineEnd = text.indexOf('\n', offset);
                const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
                const importMatch = line.match(/^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/);
                if (importMatch && importMatch[2]) {
                    const moduleName = importMatch[2];
                    // Check if the hovered word is an imported name (before 'as') in this import
                    const specifiersPart = importMatch[1]!;
                    const specifiers = specifiersPart.split(',').map((s: string) => s.trim());
                    for (const spec of specifiers) {
                        // Match "word as alias" or just "word"
                        const parts = spec.split(/\s+as\s+/);
                        const importedName = parts[0]?.trim();
                        if (importedName === word && isKnownModule(moduleName)) {
                            const doc = getImportedSymbolDocumentation(moduleName, importedName);
                            if (Option.isSome(doc)) {
                                return {
                                    contents: { kind: MarkupKind.Markdown, value: doc.value },
                                    range: {
                                        start: document.positionAt(token.pos),
                                        end: document.positionAt(token.end)
                                    }
                                };
                            }
                        }
                    }
                }
            }

            // 1. Check for user-defined symbols using the analysis cache (PRIORITY OVER GLOBAL FUNCTIONS)
            if (analysisResult) {
                // Try position-aware lookup first for correct scoping (local vars shadow globals)
                let symbol = analysisResult.symbolTable.lookupAtPosition(word, offset);
                const hadPositionMatch = !!symbol;

                // Fall back to regular lookup if position-aware lookup fails
                if (!symbol) {
                    symbol = analysisResult.symbolTable.lookup(word);
                }

                // Try CFG-based flow-sensitive type lookup
                if (!symbol && analysisResult.cfgQueryEngine) {
                    const cfgType = analysisResult.cfgQueryEngine.getTypeAtPosition(word, offset);
                    if (cfgType) {
                        // Create a temporary symbol with CFG-inferred type
                        symbol = {
                            name: word,
                            type: SymbolType.VARIABLE,
                            dataType: cfgType,
                            scope: 0,
                            declared: true,
                            used: true,
                            node: {} as any,
                            declaredAt: offset,
                            usedAt: [offset]
                        } as UcodeSymbol;
                    }
                }

                // If we have a symbol from non-positional lookup, check if CFG has more precise type.
                // Skip CFG override when we already have a position-aware match (it's scope-correct).
                if (symbol && !hadPositionMatch && analysisResult.cfgQueryEngine) {
                    const cfgType = analysisResult.cfgQueryEngine.getTypeAtPosition(word, offset);
                    if (cfgType && cfgType !== UcodeType.UNKNOWN && cfgType !== symbol.dataType) {
                        // CFG provides flow-sensitive type - use it (but not if it's UNKNOWN,
                        // which is less precise than what the symbol table already has)
                        symbol = {
                            ...symbol,
                            dataType: cfgType
                        };
                    }
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
                                // Check if type was narrowed via variable equality (e.g., if (x != y) return;)
                                // If so, show the other variable's full type info
                                if (analysisResult?.typeChecker && effectiveType === UcodeType.FUNCTION) {
                                    const eqSymbol = analysisResult.typeChecker.getEqualityNarrowSymbolAtPosition(symbol.name, offset);
                                    if (eqSymbol?.importedFrom && isKnownModule(eqSymbol.importedFrom)) {
                                        const originalName = eqSymbol.importSpecifier || eqSymbol.name;
                                        const doc = getImportedSymbolDocumentation(eqSymbol.importedFrom, originalName);
                                        if (Option.isSome(doc)) {
                                            hoverText = `(${symbol.type}) **${symbol.name}** — narrowed via equality\n\n${doc.value}`;
                                            break;
                                        }
                                    }
                                }
                                hoverText = `(${symbol.type}) **${symbol.name}**: \`${effectiveTypeStr}\``;
                            }
                            if (symbol.jsdocDescription) {
                                hoverText += `\n\n${symbol.jsdocDescription}`;
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
                            // Special handling for nl80211-const / rtnl-const objects
                            if (symbol.dataType && typeof symbol.dataType === 'object' &&
                                'moduleName' in symbol.dataType) {
                                const mn = (symbol.dataType as any).moduleName;
                                if (mn === 'nl80211-const') {
                                    hoverText = `(const object) **${symbol.name}**: \`object\`\n\nContainer for nl80211 module constants.`;
                                    break;
                                } else if (mn === 'rtnl-const') {
                                    hoverText = `(const object) **${symbol.name}**: \`object\`\n\nContainer for rtnl module constants.`;
                                    break;
                                }
                            }
                            // Unified imported symbol hover via moduleDispatch
                            if (symbol.importedFrom && isKnownModule(symbol.importedFrom)) {
                                const originalName = symbol.importSpecifier || symbol.name;
                                const doc = getImportedSymbolDocumentation(symbol.importedFrom, originalName);
                                if (Option.isSome(doc)) {
                                    hoverText = doc.value;
                                }
                            } else {
                                hoverText = `(imported) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            }
                            break;
                    }
                    
                    
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

            // Check built-in functions BEFORE exception properties
            // (builtin functions like 'type' take precedence over exception properties)
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

            // Check if this is an exception property (after builtin functions)
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
        const logFuncDoc = MODULE_REGISTRIES['log'].getFunctionDocumentation(word);
        if (Option.isSome(logFuncDoc)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: logFuncDoc.value
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

function detectMemberExpression(offset: number, tokens: any[]): { objectName: string; propertyName: string; cursorOnObject: boolean } | undefined {
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
                propertyName: afterNextToken.value as string,
                cursorOnObject: true
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
                propertyName: currentToken.value as string,
                cursorOnObject: false
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

