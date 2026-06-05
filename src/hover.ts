import {
    TextDocumentPositionParams,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType, isKeyword, Token } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType, Symbol as UcodeSymbol } from './analysis';
import { typeToString, UcodeDataType, UcodeType, isObjectType, getObjectTypeName, isUnionType, getUnionTypes, extractModuleType } from './analysis/symbolTable';
import { exceptionTypeRegistry, exceptionObjectType } from './analysis/exceptionTypes';
import { regexTypeRegistry } from './analysis/regexTypes';
import { Option } from 'effect';
import { MODULE_REGISTRIES, isKnownModule, isKnownObjectType, getModuleMemberDocumentation, getImportedSymbolDocumentation, getObjectMethodDocumentation, resolveReturnObjectType, type KnownObjectType } from './analysis/moduleDispatch';
import { parseFormatSpecifiers } from './analysis/checkers/builtinValidation';
import { FileResolver } from './analysis/fileResolver';

const BUILTIN_METHOD_NOTE = '\n\n---\n*Built-in C method — no source definition available*';

// Lazily-created resolver for cross-file hovers (e.g. namespace-import members).
let hoverFileResolver: FileResolver | null = null;
function getHoverFileResolver(): FileResolver {
    if (!hoverFileResolver) hoverFileResolver = new FileResolver();
    return hoverFileResolver;
}

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

        // Allow member access patterns: x.foo =, x[0] =
        if (
            nextToken.type === TokenType.TK_DOT ||
            nextToken.type === TokenType.TK_LBRACK ||
            nextToken.type === TokenType.TK_RBRACK ||
            nextToken.type === TokenType.TK_LABEL  // identifier after dot
        ) {
            continue;
        }

        // Any other token means this isn't an assignment target
        return false;
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


/**
 * Detect known object type from a symbol's dataType.
 */
function detectObjectTypeFromDataType(dataType: UcodeDataType): KnownObjectType | null {
    // Check ObjectType directly (the canonical path)
    if (isObjectType(dataType)) {
        const name = getObjectTypeName(dataType);
        if (name && isKnownObjectType(name)) return name;
    }
    // Check union types — find the first ObjectType member
    if (isUnionType(dataType)) {
        for (const member of getUnionTypes(dataType)) {
            if (isObjectType(member) && isKnownObjectType(member.name)) {
                return member.name as KnownObjectType;
            }
        }
    }
    // Legacy: ModuleType with known object type name
    const modType = extractModuleType(dataType);
    if (modType && isKnownObjectType(modType.moduleName)) return modType.moduleName;
    return null;
}

/**
 * Unified member hover: handles object method hover (fs.file/dir/proc, io.handle, uloop.*, uci.cursor)
 * and module namespace hover (fs.opendir, io.open, uloop.init, etc.)
 */
function getUnifiedMemberHover(
    memberInfo: { objectName: string; propertyName: string; chain?: string[] },
    analysisResult: SemanticAnalysisResult,
    documentUri?: string
): string | null {
    const { objectName, propertyName, chain } = memberInfo;

    // Chained access (ns.A.B): walk the chain from the BASE symbol via
    // propertyTypes/nestedPropertyTypes. The 1-level resolver below sees
    // `objectName='A'` which isn't a top-level symbol, so without this we'd
    // fail to find A and return null. Only one extra hop is supported (matches
    // the nestedPropertyTypes shape — `Map<name, Map<inner, type>>`).
    if (chain && chain.length >= 3) {
        const baseSym = analysisResult.symbolTable.lookup(chain[0]!);
        if (baseSym) {
            const aName = chain[chain.length - 2]!;
            const bName = chain[chain.length - 1]!;
            const inner = baseSym.nestedPropertyTypes?.get(aName);
            const innerType = inner?.get(bName);
            if (innerType !== undefined) {
                // If the base is a namespace import and the inner value is a
                // literal, show it. Otherwise just the type — the alternative
                // re-parses the source for every hover, which we want to avoid
                // unless the literal is actually available.
                let literal: string | null = null;
                if (baseSym.type === SymbolType.IMPORTED && baseSym.importSpecifier === '*'
                    && baseSym.importedFrom && baseSym.importedFrom.startsWith('file://')) {
                    literal = getHoverFileResolver().findExportedObjectPropertyLiteral(baseSym.importedFrom, aName, bName);
                }
                const typeStr = literal !== null ? `${innerType} = ${literal}` : `${innerType}`;
                return `**${bName}**: \`${typeStr}\`\n\nProperty on \`${chain.slice(0, -1).join('.')}\``;
            }
        }
    }

    // Look up the object in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);

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
    } else {
        const modType = extractModuleType(symbol.dataType);
        if (modType) moduleName = modType.moduleName;
    }

    if (moduleName && isKnownModule(moduleName)) {
        const doc = getModuleMemberDocumentation(moduleName, propertyName);
        if (Option.isSome(doc)) return doc.value;
    }

    // 3. User-module namespace import: `import * as U from './lib.uc'; U.fn()`.
    //    Resolve the member as an exported function of that module.
    if (documentUri && symbol.type === SymbolType.IMPORTED && symbol.importSpecifier === '*'
        && symbol.importedFrom && !symbol.importedFrom.startsWith('builtin://')) {
        const uri = symbol.importedFrom.startsWith('file://')
            ? symbol.importedFrom
            : getHoverFileResolver().resolveImportPath(symbol.importedFrom, documentUri);
        if (uri && !uri.startsWith('builtin://')) {
            const fnDef = getHoverFileResolver().findFunctionDefinition(uri, propertyName);
            if (fnDef && fnDef.kind === 'function') {
                const params = (((fnDef.node as any)?.params) || []).map((p: any) => p.name).join(', ');
                const moduleLabel = symbol.importedFrom.startsWith('file://')
                    ? (symbol.importedFrom.split('/').pop() || symbol.importedFrom)
                    : symbol.importedFrom;
                return `**(function)** **${propertyName}(${params})**\n\nExported from \`${moduleLabel}\``;
            }
        }
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

/** Find the object-literal Property whose KEY identifier spans `offset`. */
function findPropertyKeyAtOffset(node: any, offset: number): any | null {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return null;
    if (node.type === 'Property' && node.key && typeof node.key.start === 'number'
        && node.key.start <= offset && offset <= node.key.end) {
        return node;
    }
    for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = (node as any)[k];
        if (Array.isArray(v)) {
            for (const it of v) { const f = findPropertyKeyAtOffset(it, offset); if (f) return f; }
        } else if (v && typeof v === 'object' && typeof v.type === 'string') {
            const f = findPropertyKeyAtOffset(v, offset); if (f) return f;
        }
    }
    return null;
}

/**
 * Find an imported NAME identifier (the `imported` side of an ImportSpecifier)
 * spanning `offset`, returning its module + original name. Works regardless of
 * how the import statement is wrapped across lines.
 */
function findImportedNameAtOffset(node: any, offset: number): { moduleName: string; importedName: string } | null {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return null;
    if (node.type === 'ImportDeclaration' && Array.isArray(node.specifiers) && node.source) {
        for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier' && spec.imported && typeof spec.imported.start === 'number'
                && spec.imported.start <= offset && offset <= spec.imported.end) {
                const raw = node.source.value;
                if (typeof raw === 'string') {
                    return { moduleName: raw.replace(/^['"]|['"]$/g, ''), importedName: spec.imported.name };
                }
            }
        }
    }
    for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue;
        const v = (node as any)[k];
        if (Array.isArray(v)) {
            for (const it of v) { const f = findImportedNameAtOffset(it, offset); if (f) return f; }
        } else if (v && typeof v === 'object' && typeof v.type === 'string') {
            const f = findImportedNameAtOffset(v, offset); if (f) return f;
        }
    }
    return null;
}

/** Describe an object-literal property's value (function/literal/array/object) for hover. */
function formatPropertyValueHover(value: any): string | undefined {
    if (!value || typeof value.type !== 'string') return undefined;
    if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
        const params = ((value.params as any[]) || []).map((p) => p.name);
        if (value.restParam) params.push('...' + value.restParam.name);
        const rest = value.restParam ? ' with rest parameters' : '';
        if (value.type === 'ArrowFunctionExpression') {
            let ret = 'unknown';
            if (value.expression && value.body && value.body.type === 'Literal') {
                const bv = value.body.value;
                if (typeof bv === 'number') ret = 'number';
                else if (typeof bv === 'string') ret = 'string';
                else if (typeof bv === 'boolean') ret = 'boolean';
                else if (bv === null) ret = 'null';
            }
            return `**(function)** **(${params.join(', ')}) => ${ret}**\n\nArrow function${rest}`;
        }
        return `**(function)** **function(${params.join(', ')})**\n\nFunction expression${rest}`;
    }
    if (value.type === 'Literal') {
        const v = value.value;
        if (typeof v === 'string') return '**(string)** String literal';
        if (typeof v === 'number') return '**(number)** Number literal';
        if (typeof v === 'boolean') return '**(boolean)** Boolean literal';
        if (v === null) return '**(null)** Null literal';
    }
    if (value.type === 'ArrayExpression') return '**(array)** Array literal';
    if (value.type === 'ObjectExpression') return '**(object)** Object literal';
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
                if (symbol && symbol.propertyTypes && symbol.propertyTypes.has(memberName)) {
                    const propertyType = symbol.propertyTypes.get(memberName)!;
                    const typeString = typeToString(propertyType);
                    const scopeLabel = objectName === 'global'
                        ? `Global property on \`${objectName}\``
                        : `Property on \`${objectName}\``;

                    // Factory-returned methods carry an inferred return-type hint
                    // (e.g. `exec` → "string"); render them as a method instead of a
                    // bare `function` so the call result type is visible on hover.
                    const returnHint = symbol.propertyFunctionReturnTypes?.get(memberName);
                    let hoverMarkdown = returnHint
                        ? `**(function)** \`${memberName}(…)\` → \`${returnHint}\`\n\n${scopeLabel}`
                        : `**${memberName}**: \`${typeString}\`\n\n${scopeLabel}`;

                    // For catch-clause exception objects, surface the rich property
                    // doc (e.g. the stacktrace frame structure) instead of the generic one.
                    if (symbol.isExceptionParam) {
                        const prop = exceptionObjectType.properties?.get(memberName);
                        if (prop && exceptionObjectType.formatPropertyDoc) {
                            hoverMarkdown = exceptionObjectType.formatPropertyDoc(memberName, prop);
                        }
                    } else {
                        // When we know where the member is defined (factory-returned
                        // members from `@param {import('./x.uc')}`), link to its file.
                        const defLoc = symbol.propertyDefinitionLocations?.get(memberName);
                        if (defLoc) {
                            const fileName = defLoc.uri.split('/').pop() || defLoc.uri;
                            hoverMarkdown += `\n\nDefined in \`${fileName}\``;
                        }
                    }

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
                    // Check if it's a module type (e.g., let _fs = require('fs'); _fs.readfile)
                    let moduleName: string | undefined;
                    const modType = extractModuleType(symbol.dataType);
                    if (modType) {
                        moduleName = modType.moduleName;
                    }
                    if (moduleName && isKnownModule(moduleName)) {
                        const doc = getModuleMemberDocumentation(moduleName, memberName);
                        if (Option.isSome(doc)) {
                            return {
                                contents: { kind: MarkupKind.Markdown, value: doc.value },
                                range: {
                                    start: document.positionAt(memberContext.memberTokenPos),
                                    end: document.positionAt(memberContext.memberTokenEnd)
                                }
                            };
                        }
                    }
                    // Member-path type narrowing: a `type(o.x) == "str"` guard narrows
                    // the member path `o.x` at this position even though the base object
                    // has no known shape. Reflect that before the generic fallback.
                    if (analysisResult.typeChecker) {
                        const narrowed = analysisResult.typeChecker.getNarrowedTypeAtPosition(`${objectName}.${memberName}`, offset);
                        if (narrowed != null) {
                            const ts = typeToString(narrowed);
                            if (ts && ts !== 'unknown') {
                                return {
                                    contents: { kind: MarkupKind.Markdown, value: `**${memberName}**: \`${ts}\`\n\nNarrowed on \`${objectName}.${memberName}\`` },
                                    range: { start: document.positionAt(memberContext.memberTokenPos), end: document.positionAt(memberContext.memberTokenEnd) }
                                };
                            }
                        }
                    }

                    // Base is `unknown` (e.g. `let ctx = unknown_call(); ctx.get`) or a
                    // generic `object` with no known shape (e.g. `@param {object} pkg;
                    // pkg.rt_tables_file`). We can't resolve the member's type, but
                    // returning nothing leaves the user no feedback on `.prop`. Surface
                    // a minimal hover so the member still shows *something*.
                    const baseTypeStr = typeToString(symbol.dataType);
                    if (baseTypeStr === 'unknown' || baseTypeStr === 'object') {
                        return {
                            contents: {
                                kind: MarkupKind.Markdown,
                                value: `**${memberName}**: \`unknown\`\n\nProperty on \`${objectName}\` (\`${baseTypeStr}\`) — member types can't be resolved.`
                            },
                            range: {
                                start: document.positionAt(memberContext.memberTokenPos),
                                end: document.positionAt(memberContext.memberTokenEnd)
                            }
                        };
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

                // Member-path type narrowing: a `type(o.x) == "str"` guard narrows the
                // member path `o.x` at this position, so reflect that in the hover.
                if (analysisResult.typeChecker) {
                    const dotted = memberExpressionInfo.chain
                        ? memberExpressionInfo.chain.join('.')
                        : `${memberExpressionInfo.objectName}.${memberExpressionInfo.propertyName}`;
                    const narrowed = analysisResult.typeChecker.getNarrowedTypeAtPosition(dotted, offset);
                    if (narrowed != null) {
                        const ts = typeToString(narrowed);
                        if (ts && ts !== 'unknown') {
                            return {
                                contents: { kind: MarkupKind.Markdown, value: `**${memberExpressionInfo.propertyName}**: \`${ts}\`` },
                                range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) }
                            };
                        }
                    }
                }

                // Unified member hover: check object types and module namespaces
                const memberHoverDoc = getUnifiedMemberHover(memberExpressionInfo, analysisResult, document.uri);
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
            
            // Object-literal property hover: `{ propName: <value> }`. Resolve the
            // property from the AST and describe its value (function/literal/array/
            // object). Defer to a same-named user function when one exists, so the
            // builtin/function lookup below wins for those.
            if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string' && analysisResult?.ast) {
                const word = token.value;
                const sameNameSymbol = analysisResult.symbolTable.lookup(word);
                const hasUserFunction = (sameNameSymbol && sameNameSymbol.type === SymbolType.FUNCTION) ?? false;
                if (!hasUserFunction) {
                    const prop = findPropertyKeyAtOffset(analysisResult.ast, offset);
                    if (prop) {
                        const hoverText = formatPropertyValueHover(prop.value);
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
            }
            
            // 0. Hovering an imported NAME inside `import { NAME as alias } from 'module'`:
            // show the original module symbol's documentation. Resolved from the AST so
            // multi-line imports work and we only match the imported (not alias) side.
            if (analysisResult?.ast) {
                const imp = findImportedNameAtOffset(analysisResult.ast, offset);
                if (imp && isKnownModule(imp.moduleName)) {
                    const doc = getImportedSymbolDocumentation(imp.moduleName, imp.importedName);
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

            // 1. Check for user-defined symbols using the analysis cache (PRIORITY OVER GLOBAL FUNCTIONS)
            if (analysisResult) {
                // Try position-aware lookup first for correct scoping (local vars shadow globals)
                let symbol = analysisResult.symbolTable.lookupAtPosition(word, offset);

                // Fall back to regular lookup if position-aware lookup fails
                if (!symbol) {
                    symbol = analysisResult.symbolTable.lookup(word);
                }
                
                // (Arrow/function rest parameters are registered in the symbol
                // table with isRestParam and rendered by the symbol path below.)

                if (symbol) {
                    const isAssignmentContext = tokenIndex >= 0 ? isLikelyAssignmentTarget(tokens, tokenIndex) : false;
                    const effectiveType = resolveVariableTypeForHover(symbol, offset, isAssignmentContext, analysisResult);
                    const effectiveTypeStr = typeToString(effectiveType);

                    let hoverText = '';
                    switch (symbol.type) {
                        case SymbolType.VARIABLE:
                        case SymbolType.PARAMETER:
                            // Check if this parameter is a rest parameter (declared with ...spread)
                            if (symbol.type === SymbolType.PARAMETER && symbol.isRestParam) {
                                hoverText = `**(rest parameter)** **${symbol.name}**: \`array\`\n\nRest parameter - collects remaining arguments into an array`;
                            } else if (symbol.type === SymbolType.PARAMETER && symbol.isExceptionParam) {
                                // Rich catch-parameter hover: a usage example up top so the
                                // reader sees the idiomatic handler immediately, then a
                                // note on the string-coercion quirk, then the property and
                                // stack-frame schemas. The structure here mirrors what
                                // ucode actually exposes (verified against the runtime —
                                // `keys(e)` → ["type","message","stacktrace"];
                                // `keys(e.stacktrace[0])` → ["filename","line","byte","context"]).
                                const n = symbol.name;
                                hoverText = [
                                    `**(catch parameter)** **${n}**: \`exception\``,
                                    '',
                                    '**Typical usage**',
                                    '',
                                    '```ucode',
                                    'try { … }',
                                    `catch (${n}) {`,
                                    `    print("[" + ${n}.type + "] " + ${n}.message + "\\n");`,
                                    `    for (let frame in ${n}.stacktrace)`,
                                    '        printf("  at %s:%d\\n", frame.filename, frame.line);',
                                    '}',
                                    '```',
                                    '',
                                    `In string contexts, \`${n}\` coerces to \`${n}.message\` (e.g. \`"error: " + ${n}\` → \`"error: <message>"\`).`,
                                    '',
                                    '**Properties**',
                                    '',
                                    '| name | type | description |',
                                    '|---|---|---|',
                                    `| \`${n}.type\` | \`string\` | Kind of error — \`"Error"\`, \`"Type error"\`, \`"Reference error"\`, \`"Syntax error"\`, … |`,
                                    `| \`${n}.message\` | \`string\` | Human-readable error message. |`,
                                    `| \`${n}.stacktrace\` | \`array\` | Stack frames, newest first. |`,
                                    '',
                                    `**Stack frame** (\`${n}.stacktrace[i]\`)`,
                                    '',
                                    '| name | type | example |',
                                    '|---|---|---|',
                                    '| `filename` | `string` | `/path/to/script.uc` |',
                                    '| `line` | `integer` | `42` |',
                                    '| `byte` | `integer` | byte offset on the line |',
                                    '| `context` | `string` | snippet with a `Near here ---^` marker |',
                                ].join('\n');
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
                                // A module function bound to a variable
                                // (`let readfile = fs_mod.readfile`): show the module
                                // function's signature, like a named import.
                                if (symbol.importedFrom && isKnownModule(symbol.importedFrom)) {
                                    const originalName = symbol.importSpecifier || symbol.name;
                                    const doc = getImportedSymbolDocumentation(symbol.importedFrom, originalName);
                                    if (Option.isSome(doc)) {
                                        hoverText = doc.value;
                                        break;
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
                            {
                                const mn = extractModuleType(symbol.dataType)?.moduleName;
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

            // A member property access (`.prop`) — even on a computed or complex base
            // like `best[k].signal` or `f().signal`, where detectMemberExpression's
            // LABEL.LABEL pattern doesn't match — must NOT fall back to a same-named
            // global builtin (e.g. the `signal` builtin). Show a minimal property hover.
            const tokIdx = tokens.findIndex((t: any) => t.pos <= offset && offset < t.end);
            if (tokIdx > 0 && tokens[tokIdx - 1]?.type === TokenType.TK_DOT) {
                return {
                    contents: { kind: MarkupKind.Markdown, value: `**${word}**: \`unknown\`` },
                    range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) }
                };
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

function detectMemberExpression(offset: number, tokens: any[]): { objectName: string; propertyName: string; cursorOnObject: boolean; chain?: string[] } | undefined {
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
            // Walk further back through additional LABEL.DOT pairs so chained
            // access like `ns.A.B` surfaces the full chain. Without this, the
            // resolver would see `objectName='A'` and fail to find A as a
            // top-level symbol when A is actually a property of `ns`.
            const chain: string[] = [beforePrevToken.value as string, currentToken.value as string];
            let i = currentTokenIndex - 3;
            while (i >= 1) {
                const dot = tokens[i];
                const label = tokens[i - 1];
                if (dot?.type === TokenType.TK_DOT && label?.type === TokenType.TK_LABEL) {
                    chain.unshift(label.value as string);
                    i -= 2;
                } else {
                    break;
                }
            }
            const result: { objectName: string; propertyName: string; cursorOnObject: boolean; chain?: string[] } = {
                objectName: beforePrevToken.value as string,
                propertyName: currentToken.value as string,
                cursorOnObject: false
            };
            if (chain.length > 2) result.chain = chain;
            return result;
        }
    }

    return undefined;
}

function getWordRangeAtPosition(text: string, offset: number): { start: number; end: number } | undefined {
    // Identifier-character scan around the offset (no regex). Used only by the
    // error-fallback path, when lexing/analysis threw and there are no tokens.
    const isIdentChar = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
        || (c >= '0' && c <= '9') || c === '_' || c === '$';
    if (offset < 0 || offset > text.length) return undefined;

    let start = offset;
    while (start > 0 && isIdentChar(text[start - 1]!)) start--;
    let end = offset;
    while (end < text.length && isIdentChar(text[end]!)) end++;

    if (start === end) return undefined;               // not on a word
    const first = text[start]!;
    if (first >= '0' && first <= '9') return undefined; // identifiers don't start with a digit
    return { start, end };
}

