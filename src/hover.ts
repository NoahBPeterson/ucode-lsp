import {
    type TextDocumentPositionParams,
    type Position,
    type TextDocuments,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { splitTopLevel } from './analysis/typeStringUtils';
import { UcodeLexer, TokenType, isKeyword, isMemberAccessDot, decodeEscape, type Token } from './lexer';
import type {
    AstNode, PropertyNode,
} from './ast/nodes';
import { astChildren } from './ast/astChildren';
import { allBuiltinFunctions } from './builtins';
import { type SemanticAnalysisResult, SymbolType, type Symbol as UcodeSymbol } from './analysis';
import { typeToString, type UcodeDataType, UcodeType, effectiveSymbolType, isObjectType, getObjectTypeName, isUnionType, getUnionTypes, extractModuleType, propertyTypeAt, isNeverType } from './analysis/symbolTable';
import { exceptionTypeRegistry, exceptionObjectType } from './analysis/exceptionTypes';
import { VERSION_MODULES } from './analysis/ucodeVersions';
import { findLuciWorkspace, isBundledLuciPath } from './analysis/luciEnv';
import * as path from 'path';
import { regexTypeRegistry } from './analysis/regexTypes';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { rtnlTypeRegistry } from './analysis/rtnlTypes';
import { Option } from 'effect';
import { MODULE_REGISTRIES, OBJECT_REGISTRIES, isKnownModule, isKnownObjectType, getModuleMemberDocumentation, getImportedSymbolDocumentation, getObjectMethodDocumentation, resolveReturnObjectType, type KnownObjectType } from './analysis/moduleDispatch';
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

/** Binary search for the token whose [pos, end) span contains `offset`.
 *  Tokens are position-sorted and non-overlapping, so this replaces the
 *  linear from-zero scans that made each hover O(all tokens). Returns -1
 *  when no token contains the offset (e.g. whitespace). */
/** Token types after which a following `-` token is a UNARY minus (sign), never
 *  binary subtraction — i.e. the position expects a new operand/expression to
 *  start, not to continue one. Mirrors the ucodeLexer's own `noRegexp` operand
 *  vs. operator-position classification (src/lexer/ucodeLexer.ts
 *  updateNoRegexpFlag: the same distinction that disambiguates a leading `/` as
 *  regex-literal-start vs. division), extended with the compound-assignment /
 *  misc operators that classification list didn't need to cover. Used ONLY to
 *  decide whether `-1` in source renders as one negative-literal hover token
 *  (`a[-1]`) or two independent tokens (`x - 1`, where the `1` must NOT show a
 *  sign) — see docs/tc-negative-array-index.md. Deliberately conservative: a
 *  previous token NOT in this set (or an operand-producing one) means "assume
 *  binary", so an unrecognized operator errs toward showing the bare literal
 *  rather than inventing a sign. */
const UNARY_MINUS_CONTEXT_TOKENS: ReadonlySet<TokenType> = new Set([
    TokenType.TK_LPAREN, TokenType.TK_LBRACK, TokenType.TK_QLBRACK, TokenType.TK_LBRACE,
    TokenType.TK_COMMA, TokenType.TK_SCOL, TokenType.TK_COLON, TokenType.TK_QMARK,
    TokenType.TK_ASSIGN, TokenType.TK_ASADD, TokenType.TK_ASSUB, TokenType.TK_ASMUL,
    TokenType.TK_ASDIV, TokenType.TK_ASMOD, TokenType.TK_ASEXP, TokenType.TK_ASLEFT,
    TokenType.TK_ASRIGHT, TokenType.TK_ASBAND, TokenType.TK_ASBXOR, TokenType.TK_ASBOR,
    TokenType.TK_ASAND, TokenType.TK_ASOR, TokenType.TK_ASNULLISH,
    TokenType.TK_EQ, TokenType.TK_NE, TokenType.TK_EQS, TokenType.TK_NES,
    TokenType.TK_LT, TokenType.TK_LE, TokenType.TK_GT, TokenType.TK_GE,
    TokenType.TK_AND, TokenType.TK_OR, TokenType.TK_NOT, TokenType.TK_NULLISH,
    TokenType.TK_BAND, TokenType.TK_BOR, TokenType.TK_BXOR, TokenType.TK_COMPL,
    TokenType.TK_ADD, TokenType.TK_SUB, TokenType.TK_MUL, TokenType.TK_DIV, TokenType.TK_MOD, TokenType.TK_EXP,
    TokenType.TK_LSHIFT, TokenType.TK_RSHIFT,
    TokenType.TK_RETURN, TokenType.TK_IF, TokenType.TK_WHILE, TokenType.TK_FOR, TokenType.TK_CASE,
    TokenType.TK_IN, TokenType.TK_DELETE, TokenType.TK_ARROW, TokenType.TK_ELLIP,
]);

/** Is the `-` token at `tokens[minusIdx]` a genuinely UNARY minus (so a directly
 *  following number/double token is really "the negative literal `-N`", not
 *  "subtract N")? True at the very start of the token stream (nothing to
 *  subtract from) or when the PRECEDING token is one that expects a fresh
 *  operand next (see UNARY_MINUS_CONTEXT_TOKENS). Conservative: anything else
 *  (an identifier, number, string, `)`, `]`, `}`, postfix `++`/`--`, …) means
 *  the minus continues an existing expression → binary. */
function isUnaryMinusContext(tokens: Token[], minusIdx: number): boolean {
    if (minusIdx <= 0) return true;
    const prev = tokens[minusIdx - 1];
    if (!prev) return true;
    return UNARY_MINUS_CONTEXT_TOKENS.has(prev.type);
}

function tokenIndexAtOffset(tokens: Token[], offset: number): number {
    let lo = 0, hi = tokens.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = tokens[mid]!;
        if (offset < t.pos) hi = mid - 1;
        else if (offset >= t.end) lo = mid + 1;
        else return mid;
    }
    return -1;
}

function detectMemberHoverContext(position: Position, tokens: Token[], document: TextDocument): { objectName: string, memberName: string, memberTokenPos: number, memberTokenEnd: number, resolvedObjectType?: KnownObjectType } | undefined {
    // Look for pattern: LABEL DOT LABEL (where cursor is over the second LABEL)
    // Also handles call chains: LABEL(...) DOT LABEL, LABEL DOT LABEL(...) DOT LABEL

    const offset = document.offsetAt(position);

    // Find the token at the hover position
    const hoverTokenIndex = tokenIndexAtOffset(tokens, offset);
    if (hoverTokenIndex === -1) {
        return undefined;
    }

    const hoverToken = tokens[hoverTokenIndex];
    if (!hoverToken) {
        return undefined;
    }

    // Check if we're hovering over a LABEL token
    if (hoverToken.type !== TokenType.TK_LABEL) {
        return undefined;
    }

    // Check if there's a DOT token immediately before this LABEL
    if (hoverTokenIndex < 2) {
        return undefined;
    }

    const dotToken = tokens[hoverTokenIndex - 1];
    if (!dotToken || !isMemberAccessDot(dotToken.type) || dotToken.end !== hoverToken.pos) {
        return undefined;
    }

    const objectToken = tokens[hoverTokenIndex - 2];
    if (!objectToken) {
        return undefined;
    }

    // Verify the pattern: LABEL DOT LABEL
    if (objectToken.type === TokenType.TK_LABEL &&
        objectToken.end === dotToken.pos) {

        return {
            objectName: String(objectToken.value),
            memberName: String(hoverToken.value),
            memberTokenPos: hoverToken.pos,
            memberTokenEnd: hoverToken.end
        };
    }

    // Handle `this` keyword: THIS DOT LABEL
    if (objectToken.type === TokenType.TK_THIS &&
        objectToken.end === dotToken.pos) {

        return {
            objectName: 'this',
            memberName: String(hoverToken.value),
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
            const t = tokens[j];
            if (t?.type === TokenType.TK_RPAREN) parenDepth++;
            else if (t?.type === TokenType.TK_LPAREN) parenDepth--;
            j--;
        }
        // j now points to the token before the opening paren
        const funcToken = j >= 0 ? tokens[j] : undefined;
        if (funcToken && funcToken.type === TokenType.TK_LABEL) {
            const funcName = String(funcToken.value);
            let moduleName: string | undefined;
            const dotBefore = tokens[j - 1];
            const labelBefore = tokens[j - 2];
            if (j >= 2 && dotBefore && labelBefore && isMemberAccessDot(dotBefore.type) && labelBefore.type === TokenType.TK_LABEL) {
                moduleName = String(labelBefore.value);
            }
            const objType = resolveReturnObjectType(funcName, moduleName);
            if (objType) {
                return {
                    objectName: '__call_chain__',
                    memberName: String(hoverToken.value),
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
            isMemberAccessDot(nextToken.type) ||
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
    const t = resolveVariableTypeForHoverRaw(symbol, offset, isAssignmentTarget, analysisResult);
    // NEVER (bottom) must never surface to hover — it only arises from unreachable
    // code such as `let x = die();` (die()/exit() are typed NEVER — docs/tc-nullish-
    // die-narrowing.md). getNarrowedTypeAtPosition already guards the narrowed path;
    // this covers the declared/SSA fallbacks too. Show `unknown` instead of `never`.
    return isNeverType(t) ? UcodeType.UNKNOWN : t;
}

function resolveVariableTypeForHoverRaw(
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

    // Position-aware SSA. Hovering the LHS of `a = …` shows the type it BECOMES (the
    // entry effective just after this position); everything else routes through
    // effectiveSymbolType — the branch-aware walk (conditional writes union with the
    // fall-through value; sibling-branch writes are invisible;
    // docs/type-soundness-audit.md I-1).
    const history = symbol.typeHistory;
    if (history && history.length > 0 && isAssignmentTarget) {
        let best: { from: number; type: UcodeDataType } | undefined;
        for (const e of history) {
            if (e.from > offset && (!best || e.from < best.from)) best = e;
        }
        if (best) return best.type;
    }
    if (isAssignmentTarget && symbol.currentType) {
        return symbol.currentType;
    }

    return effectiveSymbolType(symbol, offset);
}


/**
 * Detect known object type from a symbol's dataType.
 */
/** Extract a known object type name from a method/property returnType string,
 *  e.g. "fs.stat.dev" or "fs.stat.dev | null" → "fs.stat.dev". */
function knownObjectTypeFromReturn(returnType: string): KnownObjectType | null {
    for (const part of splitTopLevel(returnType, '|').map(s => s.trim())) {
        if (isKnownObjectType(part)) return part;
    }
    return null;
}

/** Walk a member chain through the object-type registry: from a base object type,
 *  follow each intermediate property/method to the object type it yields. Returns
 *  the object type that OWNS the final property, or null if any hop isn't a known
 *  object type. Resolves builtin handle shapes (e.g. `info.dev.major` on a stat
 *  result: fs.stat → dev → fs.stat.dev → major). */
function resolveChainOwnerObjectType(base: KnownObjectType, middle: string[]): KnownObjectType | null {
    let cur: KnownObjectType = base;
    for (const step of middle) {
        const m = OBJECT_REGISTRIES[cur].getMethod(step);
        if (Option.isNone(m)) return null;
        const next = knownObjectTypeFromReturn(m.value.returnType);
        if (!next) return null;
        cur = next;
    }
    return cur;
}

function detectObjectTypeFromDataType(dataType: UcodeDataType): KnownObjectType | null {
    // Check ObjectType directly (the canonical path)
    if (isObjectType(dataType)) {
        const name = getObjectTypeName(dataType);
        if (name && isKnownObjectType(name)) return name;
    }
    // Check union types — find the first known-object member. Members come in two
    // spellings: ObjectType ({name}) and module-typed objects ({moduleName}, e.g.
    // get_all()'s `uci.section | object | null`).
    if (isUnionType(dataType)) {
        for (const member of getUnionTypes(dataType)) {
            if (isObjectType(member) && isKnownObjectType(member.name)) {
                return member.name;
            }
            const mt = extractModuleType(member);
            if (mt && isKnownObjectType(mt.moduleName)) return mt.moduleName;
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
    documentUri?: string,
    offset?: number
): string | null {
    const { objectName, propertyName, chain } = memberInfo;

    // Chained access (ns.A.B): walk the chain from the BASE symbol via
    // propertyTypes/nestedPropertyTypes. The 1-level resolver below sees
    // `objectName='A'` which isn't a top-level symbol, so without this we'd
    // fail to find A and return null. Only one extra hop is supported (matches
    // the nestedPropertyTypes shape — `Map<name, Map<inner, type>>`).
    if (chain && chain.length >= 3) {
        // Position-aware lookup: the base is often a function PARAM or local, which a
        // bare global lookup never finds (scope-correct API is lookupAtPosition).
        const baseSym = (offset !== undefined ? analysisResult.symbolTable.resolveReference(chain[0]!, offset) : null);
        if (baseSym) {
            // `nl80211.const.NL80211_*` / `rtnl.const.*` on a namespace import:
            // the leaf is an integer constant with registry documentation.
            const nsModule = baseSym.type === SymbolType.IMPORTED && baseSym.importSpecifier === '*'
                ? baseSym.importedFrom : null;
            if ((nsModule === 'nl80211' || nsModule === 'rtnl') && chain[chain.length - 2] === 'const') {
                const constName = chain[chain.length - 1]!;
                const reg = nsModule === 'nl80211' ? nl80211TypeRegistry : rtnlTypeRegistry;
                const isConst = nsModule === 'nl80211'
                    ? nl80211TypeRegistry.isNl80211Constant(constName)
                    : rtnlTypeRegistry.isRtnlConstant(constName);
                if (isConst) return appendBuiltinNote(reg.getConstantDocumentation(constName));
            }
            // Builtin handle shapes: walk the chain through the object-type registry
            // (`info.dev.major` on a stat result: fs.stat → fs.stat.dev → major).
            // Takes precedence only when the base is a known handle type.
            const baseObjType = detectObjectTypeFromDataType(baseSym.dataType);
            if (baseObjType) {
                const owner = resolveChainOwnerObjectType(baseObjType, chain.slice(1, -1));
                if (owner) {
                    const doc = getObjectMethodDocumentation(owner, chain[chain.length - 1]!);
                    if (Option.isSome(doc)) return appendBuiltinNote(doc.value);
                }
            }

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
    const symbol = (offset !== undefined ? analysisResult.symbolTable.resolveReference(objectName, offset) : null);

    if (!symbol) return null;

    // 1. Check if it's a known object type (fs.file, io.handle, uloop.timer, etc.)
    const objType = detectObjectTypeFromDataType(symbol.dataType);
        if (objType) {
        const methodDoc = getObjectMethodDocumentation(objType, propertyName);
        if (Option.isSome(methodDoc)) return appendBuiltinNote(methodDoc.value);
        // Open-membership object types (uci.section, netifd daemon object): unknown
        // members are legal runtime-defined values — say so instead of no hover at all.
        if (OBJECT_REGISTRIES[objType].openMembers) {
            return `**${propertyName}**: \`unknown\`\n\nRuntime-defined member on \`${objType}\` (open shape — its members are not statically known; e.g. uci option values are config-defined).`;
        }
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
        // `nl80211.const` / `rtnl.const`: the constants-container object.
        if (propertyName === 'const' && (moduleName === 'nl80211' || moduleName === 'rtnl')) {
            const n = moduleName === 'nl80211'
                ? nl80211TypeRegistry.getConstantNames().length
                : rtnlTypeRegistry.getConstantNames().length;
            return `**const**: \`object\`\n\nContainer for the ${n} ${moduleName} module constants (all integers). Access as \`${moduleName}.const.NAME\`.`;
        }
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
                const fnNode = fnDef.node;
                const fnParams = (fnNode.type === 'FunctionDeclaration' || fnNode.type === 'FunctionExpression'
                    || fnNode.type === 'ArrowFunctionExpression') ? fnNode.params || [] : [];
                const params = fnParams.map(p => p.name).join(', ');
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

function getFormatSpecifierHover(token: Token, tokenIndex: number, tokens: Token[], offset: number, document: TextDocument): Hover | undefined {
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
    const funcName = labelToken.value;
    if (funcName !== 'printf' && funcName !== 'sprintf') return undefined;

    // Check there are no tokens between LPAREN and our string (it must be the first arg)
    let hasTokensBetween = false;
    for (let i = lparenIdx + 1; i < tokenIndex; i++) {
        hasTokensBetween = true;
        break;
    }
    if (hasTokensBetween) return undefined;

    // Parse the format string (strip quotes)
    const rawValue = String(token.value);
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
function findPropertyKeyAtOffset(node: AstNode, offset: number): PropertyNode | null {
    // Span pruning: a subtree that doesn't contain the offset can't hold the key.
    if (offset < node.start || offset > node.end) return null;
    if (node.type === 'Property') {
        if (node.key.start <= offset && offset <= node.key.end) {
            return node;
        }
    }
    for (const child of astChildren(node)) {
        const f = findPropertyKeyAtOffset(child, offset); if (f) return f;
    }
    return null;
}

/**
 * Find an imported NAME identifier (the `imported` side of an ImportSpecifier)
 * spanning `offset`, returning its module + original name. Works regardless of
 * how the import statement is wrapped across lines.
 */
function findImportedNameAtOffset(node: AstNode, offset: number): { moduleName: string; importedName: string } | null {
    // Span pruning: a subtree that doesn't contain the offset can't hold the name.
    if (offset < node.start || offset > node.end) return null;
    if (node.type === 'ImportDeclaration') {
        for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier') {
                if (spec.imported.start <= offset && offset <= spec.imported.end) {
                    const raw = node.source.value;
                    if (typeof raw === 'string') {
                        return { moduleName: raw.replace(/^['"]|['"]$/g, ''), importedName: spec.imported.name };
                    }
                }
            }
        }
    }
    for (const child of astChildren(node)) {
        const f = findImportedNameAtOffset(child, offset); if (f) return f;
    }
    return null;
}

/** Describe an object-literal property's value (function/literal/array/object) for hover. */
function formatPropertyValueHover(value: AstNode): string | undefined {
    if (!value || typeof value.type !== 'string') return undefined;
    if (value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression') {
        const fn = value;
        const params = (fn.params || []).map((p) => p.name);
        if (fn.restParam) params.push('...' + fn.restParam.name);
        const rest = fn.restParam ? ' with rest parameters' : '';
        if (fn.type === 'ArrowFunctionExpression') {
            let ret = 'unknown';
            if (fn.expression && fn.body && fn.body.type === 'Literal') {
                const bv = fn.body.value;
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

const CONTROL_CHAR_NAMES: Record<number, string> = {
    0x00: 'NUL (null)',
    0x07: 'BEL (bell)',
    0x08: 'BS (backspace)',
    0x09: 'TAB (horizontal tab)',
    0x0A: 'LF (newline)',
    0x0B: 'VT (vertical tab)',
    0x0C: 'FF (form feed)',
    0x0D: 'CR (carriage return)',
    0x1B: 'ESC (escape)',
    0x20: 'space',
    0x7F: 'DEL (delete)',
};

const formatCodepoint = (cp: number): string => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
// Inline-code span that survives an embedded backtick (\` escapes decode to one).
const mdCode = (s: string): string => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``);

/**
 * Hover for a `\`-escape inside a string or template literal: show the character it
 * decodes to (via the same decodeEscape the lexer uses, so hover and diagnostics can
 * never disagree). Paired `\uD8xx\uDCxx` surrogate halves are combined — hovering
 * either half shows the full astral character. Regex literals are excluded (their
 * escapes are regex semantics like \d, not character escapes).
 */
function escapeSequenceHover(text: string, offset: number, tokens: Token[], document: TextDocument): Hover | undefined {
    // Only the (unique) token containing the offset can match — find it directly.
    const tokIdx = tokenIndexAtOffset(tokens, offset);
    const tok = tokIdx >= 0 ? tokens[tokIdx] : undefined;
    if (tok && (tok.type === TokenType.TK_STRING || tok.type === TokenType.TK_TEMPLATE)) {

        // Scan the token's RAW source for escapes; exact offsets fall out of decodeEscape's
        // span lengths, and tracking the previous escape lets a hovered LOW surrogate half
        // pair with the escape immediately before it without any error-prone back-scanning.
        let i = tok.pos;
        let prev: { start: number; end: number; value: string; error?: string | undefined } | null = null;
        while (i < tok.end) {
            if (text[i] !== '\\') { i++; continue; }
            const esc = decodeEscape(text, i);
            const end = i + esc.length;
            if (offset >= i && offset < end) {
                if (!esc.error && esc.value === '') return undefined; // trailing backslash
                const raw = text.slice(i, end);

                if (esc.error) {
                    return escapeHoverResult(document, i, end,
                        `${mdCode(raw)} — **invalid escape sequence**\n\n${esc.error.replace(/^Invalid escape sequence: /, '')}`);
                }

                let char = esc.value;
                let rangeStart = i;
                let rangeEnd = end;
                const cp = char.charCodeAt(0);

                if (char.length === 1 && cp >= 0xD800 && cp <= 0xDBFF && text[end] === '\\' && end < tok.end) {
                    // high half — combine with an immediately-following low half
                    const next = decodeEscape(text, end);
                    if (!next.error && next.value.length === 1) {
                        const lo = next.value.charCodeAt(0);
                        if (lo >= 0xDC00 && lo <= 0xDFFF) { char = esc.value + next.value; rangeEnd = end + next.length; }
                    }
                } else if (char.length === 1 && cp >= 0xDC00 && cp <= 0xDFFF && prev && prev.end === i && !prev.error && prev.value.length === 1) {
                    // low half — combine with the escape immediately before it
                    const hi = prev.value.charCodeAt(0);
                    if (hi >= 0xD800 && hi <= 0xDBFF) { char = prev.value + esc.value; rangeStart = prev.start; }
                }

                const shownRaw = text.slice(rangeStart, rangeEnd);
                let body: string;
                if (char.length === 2) {
                    body = `${mdCode(shownRaw)} → ${mdCode(char)} — ${formatCodepoint(char.codePointAt(0)!)} (surrogate pair)`;
                } else if (cp >= 0xD800 && cp <= 0xDFFF) {
                    const half = cp <= 0xDBFF ? 'low' : 'high';
                    body = `${mdCode(shownRaw)} → unpaired surrogate half ${formatCodepoint(cp)} — ucode substitutes U+FFFD (\`�\`) unless paired with a ${half} half`;
                } else if (CONTROL_CHAR_NAMES[cp] !== undefined || cp < 0x20) {
                    body = `${mdCode(shownRaw)} → ${CONTROL_CHAR_NAMES[cp] ?? 'control character'} — ${formatCodepoint(cp)}`;
                } else {
                    body = `${mdCode(shownRaw)} → ${mdCode(char)} — ${formatCodepoint(cp)}`;
                    const kind = shownRaw[1]!;
                    if (!'abefnrtvux'.includes(kind) && !(kind >= '0' && kind <= '7') && !'\\\'"`$'.includes(kind)) {
                        body += '\n\nUnknown escape — ucode passes the character through unchanged';
                    }
                }
                return escapeHoverResult(document, rangeStart, rangeEnd, body);
            }
            prev = { start: i, end, value: esc.value, error: esc.error };
            i = end;
        }
        return undefined; // inside the string, but not on an escape
    }
    return undefined;
}

function escapeHoverResult(document: TextDocument, start: number, end: number, markdown: string): Hover {
    return {
        contents: { kind: MarkupKind.Markdown, value: markdown },
        range: { start: document.positionAt(start), end: document.positionAt(end) },
    };
}

/**
 * Markdown for a module-source string (`import … from '<name>'`, `require('<name>')`,
 * `include('<name>')`, `loadfile('<name>')`): builtin registry documentation with its
 * feed-availability floor, or the resolved workspace file with its export list, or —
 * for an unresolvable `luci.*` inside a LuCI tree — the device-provided story.
 * Null falls through to the plain string-literal hover.
 */
function moduleSourceHover(name: string, isInclude: boolean, documentUri: string): string | null {
    const resolver = getHoverFileResolver();

    if (!isInclude && isKnownModule(name)) {
        const intro = VERSION_MODULES[name];
        const introNote = intro && intro !== '22.03' ? `\n\n*Available since OpenWrt ${intro} (feed package \`ucode-mod-${name}\`).*` : '';
        return MODULE_REGISTRIES[name].getModuleDocumentation() + introNote;
    }

    const resolved = isInclude
        ? resolver.resolveIncludeTarget(name, documentUri)
        : resolver.resolveImportPath(name, documentUri);

    if (resolved && resolved.startsWith('file://')) {
        const filePath = decodeURIComponent(resolved.slice(7));
        const docPath = documentUri.startsWith('file://') ? decodeURIComponent(documentUri.slice(7)) : null;
        // A path into the bundled luci-base reference copy is presented as what it
        // stands for — the device's installed luci-base — not as a workspace file
        // (the relative path would be a meaningless trek into the extension).
        const bundled = isBundledLuciPath(filePath);
        const shown = bundled
            ? `luci-base \`${path.basename(filePath)}\` (bundled reference — provided by the device's installed LuCI at runtime)`
            : `\`${docPath ? path.relative(path.dirname(docPath), filePath) : filePath}\``;
        if (isInclude || filePath.endsWith('.ut')) {
            return `**Template \`${name}\`**\n\nResolves to ${shown}`;
        }
        const exports = resolver.getModuleExports(resolved) ?? [];
        const named = exports.filter((e) => e.type === 'named');
        const hasDefault = exports.some((e) => e.type === 'default');
        const shownNames = named.slice(0, 12).map((e) => e.isFunction ? `\`${e.name}()\`` : `\`${e.name}\``);
        const more = named.length > 12 ? ` … +${named.length - 12} more` : '';
        const exportLine = (shownNames.length || hasDefault)
            ? `\n\n**Exports:** ${[hasDefault ? '`default`' : '', ...shownNames].filter(Boolean).join(', ')}${more}`
            : '';
        return `**Module \`${name}\`**\n\nResolves to ${shown}${exportLine}`;
    }

    // Unresolvable luci.* inside a LuCI tree: same epistemics as the suppressed
    // diagnostic — the module lives on the device, assembled from installed packages.
    if (!isInclude && name.startsWith('luci.') && documentUri.startsWith('file://')) {
        const selfPath = decodeURIComponent(documentUri.slice(7));
        if (findLuciWorkspace(selfPath)) {
            return `**Module \`${name}\`**\n\nNot in this tree - on a device it resolves from \`/usr/share/ucode/luci/\`, `
                + `which is assembled from every installed LuCI package (this one may be compiled C, build-generated, or shipped by another package).`;
        }
    }

    return null;
}

export function handleHover(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: TextDocuments<TextDocument>,
    analysisResult?: SemanticAnalysisResult,
    cachedTokens?: Token[],
    cachedComments?: Token[]
): Hover | undefined {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        return undefined;
    }

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);

    try {
        // Use cached tokens/comments when available to avoid re-lexing the entire
        // document — without cachedComments every hover pays a full re-lex just to
        // learn where the comments are (quadratic when probing many positions).
        let tokens: Token[];
        let comments: Token[] = [];
        if (cachedTokens && cachedTokens.length > 0) {
            tokens = cachedTokens;
            if (cachedComments !== undefined) {
                comments = cachedComments;
            } else {
                const cl = new UcodeLexer(text, { rawMode: true });
                cl.tokenize();
                comments = cl.comments || [];
            }
        } else {
            const lexer = new UcodeLexer(text, { rawMode: true });
            tokens = lexer.tokenize();
            comments = lexer.comments || [];
        }

        // Suppress hover inside a comment — the cursor is on prose, not code, so a word there
        // must not resolve to a symbol (which surfaced the enclosing `function(val)`). Mirrors
        // completion's `isInsideStringOrComment`; inclusive bounds (start and end included).
        for (const c of comments) {
            if (typeof c?.pos === 'number' && typeof c?.end === 'number' && offset >= c.pos && offset <= c.end) {
                return undefined;
            }
        }

        // Escape sequence under the cursor inside a string/template → show the decoded
        // character. Checked before symbol resolution: words inside strings are prose.
        const escapeHover = escapeSequenceHover(text, offset, tokens, document);
        if (escapeHover) {
            return escapeHover;
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
                const symbol = analysisResult.symbolTable.resolveReference(objectName, offset);
                if (symbol && symbol.propertyTypes && symbol.propertyTypes.has(memberName)) {
                    // Flow-sensitive: show the most-recent write at/before the hovered position,
                    // so `rv.days` reads `object` before `rv.days = keys(rv.days)` and
                    // `array<string>` after — not one type for every occurrence.
                    const baseProperty = propertyTypeAt(symbol, memberName, offset) ?? symbol.propertyTypes.get(memberName)!;
                    // Prefer a guard-narrowed type for the member path inside a guarded
                    // branch (`if (o.x) { o.x… }` → `string`, not `string | null`) — the
                    // known propertyType seeds the narrowing (ticket 139).
                    const narrowedMember = analysisResult.typeChecker
                        ? analysisResult.typeChecker.getNarrowedTypeAtPosition(`${objectName}.${memberName}`, offset, baseProperty)
                        : null;
                    const propertyType = narrowedMember ?? baseProperty;
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
                        // Open-membership object types (uci.section, netifd daemon object):
                        // unknown members are legal runtime-defined values — say so rather
                        // than showing no hover at all.
                        if (OBJECT_REGISTRIES[objType].openMembers) {
                            return {
                                contents: {
                                    kind: MarkupKind.Markdown,
                                    value: `**${memberName}**: \`unknown\`\n\nRuntime-defined member on \`${objType}\` (open shape — its members are not statically known; e.g. uci option values are config-defined).`
                                },
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
                            if (ts && ts !== 'unknown' && ts !== 'any') {
                                return {
                                    contents: { kind: MarkupKind.Markdown, value: `**${memberName}**: \`${ts}\`\n\nNarrowed on \`${objectName}.${memberName}\`` },
                                    range: { start: document.positionAt(memberContext.memberTokenPos), end: document.positionAt(memberContext.memberTokenEnd) }
                                };
                            }
                        }
                    }

                    // Base is `unknown` (e.g. `let ctx = unknown_call(); ctx.get`), the
                    // display-only `any` sentinel (e.g. `let d = json(x); d.get` — behaves
                    // exactly like unknown here), or a generic `object` with no known shape
                    // (e.g. `@param {object} pkg; pkg.rt_tables_file`). We can't resolve the
                    // member's type, but returning nothing leaves the user no feedback on
                    // `.prop`. Surface a minimal hover so the member still shows *something*.
                    const baseTypeStr = typeToString(symbol.dataType);
                    // `object | null` receivers (dict value-shape reads, H-3) get the
                    // same minimal member hover a bare `object` does — the null side
                    // is the guard's problem, not the member's.
                    const isObjectOrNull = isUnionType(symbol.dataType)
                        && getUnionTypes(symbol.dataType).every(m => m === UcodeType.OBJECT || m === UcodeType.NULL)
                        && getUnionTypes(symbol.dataType).includes(UcodeType.OBJECT);
                    if (baseTypeStr === 'unknown' || baseTypeStr === 'any' || baseTypeStr === 'object' || isObjectOrNull) {
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
        
        const rawTokenIndex = tokenIndexAtOffset(tokens, offset);
        const rawToken = rawTokenIndex >= 0 ? tokens[rawTokenIndex] : undefined;
        // Hovering directly on a genuinely-unary `-` (`a[-1]`) should show the same
        // negative-literal hover as hovering the digit right after it — redirect to
        // that number/double token so the branch below sees one logical literal.
        let tokenIndex = rawTokenIndex;
        let token = rawToken;
        if (rawToken && rawToken.type === TokenType.TK_SUB) {
            const next = tokens[rawTokenIndex + 1];
            if (next && (next.type === TokenType.TK_NUMBER || next.type === TokenType.TK_DOUBLE)
                && isUnaryMinusContext(tokens, rawTokenIndex)) {
                tokenIndex = rawTokenIndex + 1;
                token = next;
            }
        }

        // Check for printf/sprintf format specifier hover
        // Import/require/include SOURCE strings are module references, not prose — hover
        // them as modules (registry docs / resolved file + exports), not `(literal) string`.
        if (token && token.type === TokenType.TK_STRING && typeof token.value === 'string' && tokenIndex >= 1) {
            const prev = tokens[tokenIndex - 1];
            const calleeTok = tokenIndex >= 2 ? tokens[tokenIndex - 2] : undefined;
            const isImportSource = prev?.type === TokenType.TK_LABEL && prev.value === 'from';
            const calleeName = prev?.type === TokenType.TK_LPAREN && calleeTok?.type === TokenType.TK_LABEL
                ? String(calleeTok.value) : undefined;
            if (isImportSource || calleeName === 'require' || calleeName === 'include' || calleeName === 'loadfile') {
                const mod = moduleSourceHover(token.value, calleeName === 'include', document.uri);
                if (mod) {
                    return {
                        contents: { kind: MarkupKind.Markdown, value: mod },
                        range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) },
                    };
                }
            }
        }

        if (token && token.type === TokenType.TK_STRING && tokenIndex >= 0) {
            const fmtHover = getFormatSpecifierHover(token, tokenIndex, tokens, offset, document);
            if (fmtHover) return fmtHover;
        }

        // Scalar literal hover: number/double/string/true/false/null. These have no
        // symbol-table entry, so without this branch hovering them returns nothing.
        // Show the ucode type() name plus the literal's source value.
        if (token) {
            let litType: string | undefined;
            switch (token.type) {
                case TokenType.TK_NUMBER: litType = 'integer'; break;
                case TokenType.TK_DOUBLE: litType = 'double'; break;
                case TokenType.TK_STRING: litType = 'string'; break;
                case TokenType.TK_TRUE:
                case TokenType.TK_FALSE:  litType = 'boolean'; break;
                case TokenType.TK_NULL:   litType = 'null'; break;
                default: litType = undefined;
            }
            if (litType) {
                // A numeric literal directly preceded by a genuinely UNARY `-`
                // (`a[-1]`, not `x - 1`) lexes as two tokens (TK_SUB, TK_NUMBER/
                // TK_DOUBLE) — the parser folds them into one negative-literal
                // UnaryExpression, so hover should show the same thing: extend the
                // range/text back to the minus and negate the decimal-value note.
                // (docs/tc-negative-array-index.md)
                let startPos = token.pos;
                let displayValue: string | number | boolean = token.value;
                if ((litType === 'integer' || litType === 'double') && tokenIndex > 0) {
                    const prevToken = tokens[tokenIndex - 1];
                    if (prevToken && prevToken.type === TokenType.TK_SUB && isUnaryMinusContext(tokens, tokenIndex - 1)) {
                        startPos = prevToken.pos;
                        if (typeof token.value === 'number') displayValue = -token.value;
                    }
                }
                const rawValue = document.getText().substring(startPos, token.end);
                // Non-decimal / exotic numeric spellings (0x1F, 0b, 0o7, 1e5, 0xFF.5):
                // show the decimal value the interpreter sees next to the source text.
                let valueNote = '';
                if ((litType === 'integer' || litType === 'double') && typeof displayValue === 'number'
                    && String(displayValue) !== rawValue) {
                    valueNote = ` = ${displayValue}`;
                }
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `(literal) \`${rawValue}\`${valueNote}: \`${litType}\``
                    },
                    range: {
                        start: document.positionAt(startPos),
                        end: document.positionAt(token.end)
                    }
                };
            }
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
        
        // A symbol literally named `from` (importable from io). Since 0.7.80 `from` lexes
        // as an ordinary TK_LABEL (docs/from-contextual-keyword.md).
        if (token && token.type === TokenType.TK_LABEL && token.value === 'from' && analysisResult) {
            const word = 'from';
            // Position-aware: a function-local `let from` shadows the io import, and this
            // early-return branch preempts the main hover path (stale-scope audit bug #3).
            const symbol = analysisResult.symbolTable.resolveReference(word, offset);
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
                const symbol = analysisResult.symbolTable.resolveReference(word, offset);

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
                        if (ts && ts !== 'unknown' && ts !== 'any') {
                            return {
                                contents: { kind: MarkupKind.Markdown, value: `**${memberExpressionInfo.propertyName}**: \`${ts}\`` },
                                range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) }
                            };
                        }
                    }
                }

                // Unified member hover: check object types and module namespaces
                const memberHoverDoc = getUnifiedMemberHover(memberExpressionInfo, analysisResult, document.uri, offset);
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
                const sameNameSymbol = analysisResult.symbolTable.resolveReference(word, offset);
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
                // Position-aware for correct scoping (local vars shadow globals)
                let symbol = analysisResult.symbolTable.resolveReference(word, offset);

                // A bare name that's a property of the builtin `global` object
                // (`global.X = …`) has no declared symbol of its own, but it IS a real
                // global binding — synthesize one from the stored property type so hover
                // shows the function/value instead of nothing. Mirrors the
                // "Undefined function"/"Undefined variable" suppression for these names.
                if (!symbol) {
                    const globalSym = analysisResult.symbolTable.lookupOpenScopes('global');
                    const propType = globalSym?.propertyTypes?.get(word);
                    if (propType !== undefined) {
                        symbol = {
                            name: word,
                            type: propType === UcodeType.FUNCTION ? SymbolType.FUNCTION : SymbolType.VARIABLE,
                            dataType: propType,
                            scope: 0,
                            declared: true,
                            used: true,
                            node: { type: 'Identifier', start: token.pos, end: token.end, name: word },
                            declaredAt: token.pos,
                            usedAt: [],
                        };
                    }
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
                                // An assumed host/CLI-injected global (unresolved SCREAMING_SNAKE):
                                // keep the flow-narrowed type (a `type(X) != …` + die() guard narrows
                                // it like any variable) and explain where the value comes from.
                                if (symbol.isAssumedInjectedGlobal) {
                                    hoverText = `(injected global, assumed) **${symbol.name}**: \`${effectiveTypeStr}\`\n\nNot defined in this file — expected to be provided by the host, e.g. \`ucode -D ${symbol.name}=<json>\` (the value can be ANY JSON type; unparseable text becomes a string). An uninjected read is \`null\` in non-strict mode and RAISES under \`'use strict'\`. Declare a JSDoc @global annotation to type it and silence UC1001.`;
                                }
                                // A bare-assignment implicit global: note the global-ness — the
                                // plain "(variable)" label hides that this name escapes the function.
                                if (analysisResult?.implicitGlobalNames?.has(symbol.name)) {
                                    hoverText = `(implicit global) **${symbol.name}**: \`${effectiveTypeStr}\`\n\nCreated by a bare assignment (\`${symbol.name} = …\`) — in non-strict ucode that makes it a GLOBAL, visible everywhere once the assignment has run (null before).`;
                                }
                            }
                            if (symbol.jsdocDescription) {
                                hoverText += `\n\n${symbol.jsdocDescription}`;
                            }
                            break;
                        case SymbolType.FUNCTION: {
                            // Render the parameter signature when known: `name(a: T, b: T)`.
                            // Rest params render as `...name`; optional as `name?`; a
                            // param's type is appended only when it is known (not `unknown`).
                            const params = symbol.parameters;
                            let sigStr = symbol.name;
                            if (params && params.length > 0) {
                                const paramLabels = params.map((p) => {
                                    const prefix = p.isRest ? '...' : '';
                                    const opt = p.optional && !p.isRest ? '?' : '';
                                    const tStr = typeToString(p.type);
                                    const tAnno = (tStr && tStr !== 'unknown') ? `: ${tStr}` : '';
                                    return `${prefix}${p.name}${opt}${tAnno}`;
                                });
                                sigStr = `${symbol.name}(${paramLabels.join(', ')})`;
                            } else if (params) {
                                sigStr = `${symbol.name}()`;
                            }
                            // Show function type with return type information
                            if (symbol.returnType) {
                                const returnTypeStr = typeToString(symbol.returnType);
                                hoverText = `(function) **${sigStr}**: \`function\`\n\nReturns: \`${returnTypeStr}\``;
                            } else {
                                hoverText = `(function) **${sigStr}**: \`function\``;
                            }
                            break;
                        }
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
            const tokIdx = tokenIndexAtOffset(tokens, offset);
            if (tokIdx > 0 && isMemberAccessDot(tokens[tokIdx - 1]?.type)) {
                // `nl80211.const` / `rtnl.const` — `const` lexes as a KEYWORD token, so
                // detectMemberExpression never matches it; resolve the container here.
                if (word === 'const' && tokIdx >= 2) {
                    const baseTok = tokens[tokIdx - 2];
                    const baseName = baseTok?.type === TokenType.TK_LABEL ? String(baseTok.value) : null;
                    const baseSym = baseName ? analysisResult?.symbolTable.resolveReference(baseName, offset) : null;
                    const nsModule = baseSym?.type === SymbolType.IMPORTED && baseSym.importSpecifier === '*'
                        ? baseSym.importedFrom : null;
                    if (nsModule === 'nl80211' || nsModule === 'rtnl') {
                        const n = nsModule === 'nl80211'
                            ? nl80211TypeRegistry.getConstantNames().length
                            : rtnlTypeRegistry.getConstantNames().length;
                        return {
                            contents: { kind: MarkupKind.Markdown, value: `**const**: \`object\`\n\nContainer for the ${n} ${nsModule} module constants (all integers). Access as \`${nsModule}.const.NAME\`.` },
                            range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) }
                        };
                    }
                }
                return {
                    contents: { kind: MarkupKind.Markdown, value: `**${word}**: \`unknown\`` },
                    range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) }
                };
            }

            // An implicit global (bare `X = …` assignment, possibly in another function):
            // there may be no scope-visible symbol at this position, but the name IS a
            // runtime global after the assignment runs.
            if (analysisResult?.implicitGlobalNames?.has(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `(implicit global) **${word}**: \`unknown\`\n\nCreated by a bare assignment (\`${word} = …\`) in this file — in non-strict ucode that makes it a GLOBAL, visible everywhere once the assignment has run (null before).`,
                    },
                    range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) },
                };
            }

            // An unresolved SCREAMING_SNAKE read — the ucode convention for host/CLI-
            // injected globals (`ucode -D NAME=<json>`). No symbol exists, but a bare
            // "no hover" leaves the user guessing; explain where the value comes from.
            if (/^[A-Z][A-Z0-9_]*$/.test(word) && word.length >= 2
                && !analysisResult?.symbolTable.lookupAtPosition(word, offset)
                && !analysisResult?.symbolTable.lookupOpenScopes(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `(injected global, assumed) **${word}**: \`unknown\`\n\nNot defined in this file — expected to be provided by the host, e.g. \`ucode -D ${word}=<json>\` (the value can be ANY JSON type; unparseable text becomes a string). An uninjected read is \`null\` in non-strict mode and RAISES under \`'use strict'\`. Declare \`/** @global {boolean} ${word} */\` (with the right type) to type it and silence UC1001.`,
                    },
                    range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) },
                };
            }

            // A `loadfile("x.uc")()`-injected global (no in-file symbol) — show its coarse
            // type + origin file, mirroring an imported symbol's hover.
            const lfg = analysisResult?.loadfileGlobals?.get(word);
            if (lfg) {
                const origin = lfg.uri.replace(/^.*\//, '');
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `(global) **${word}**: \`${lfg.typeStr}\`\n\nInjected via \`loadfile()\` from \`${origin}\``,
                    },
                    range: { start: document.positionAt(token.pos), end: document.positionAt(token.end) },
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
            const regexInfo = regexTypeRegistry.extractPattern(String(token.value));
            const flags = regexInfo.flags ?? '';
            // Cursor over the trailing flag characters → explain what each flag does, rather than
            // the generic pattern doc.
            const flagsStart = token.end - flags.length;
            if (flags && offset >= flagsStart && offset <= token.end) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: regexTypeRegistry.getRegexFlagsDocumentation(flags)
                    },
                    range: {
                        start: document.positionAt(flagsStart),
                        end: document.positionAt(token.end)
                    }
                };
            }
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

function detectFunctionCall(offset: number, tokens: Token[]): boolean {
    // Find the token at the current position
    const currentTokenIndex = tokenIndexAtOffset(tokens, offset);
    if (currentTokenIndex === -1) return false;
    
    const currentToken = tokens[currentTokenIndex];
    if (!currentToken) return false;

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
        if (nextToken && nextToken.type === TokenType.TK_LPAREN && currentToken.end === nextToken.pos) {
            return true; // This is a function call
        }
    }
    
    return false;
}

function detectMemberExpression(offset: number, tokens: Token[]): { objectName: string; propertyName: string; cursorOnObject: boolean; chain?: string[] } | undefined {
    // Find the token at the current position
    const currentTokenIndex = tokenIndexAtOffset(tokens, offset);
    if (currentTokenIndex === -1) return undefined;

    const currentToken = tokens[currentTokenIndex];
    if (!currentToken) return undefined;

    // Look for pattern: LABEL DOT LABEL or LABEL DOT current_position
    // Check if current token is part of a member expression

    // Case 1: Hovering over object name in "object.property"
    if (currentTokenIndex + 2 < tokens.length) {
        const nextToken = tokens[currentTokenIndex + 1];
        const afterNextToken = tokens[currentTokenIndex + 2];

        if (nextToken && afterNextToken &&
            isMemberAccessDot(nextToken.type) &&
            afterNextToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: String(currentToken.value),
                propertyName: String(afterNextToken.value),
                cursorOnObject: true
            };
        }
    }

    // Case 2: Hovering over property name in "object.property"
    if (currentTokenIndex >= 2) {
        const prevToken = tokens[currentTokenIndex - 1];
        const beforePrevToken = tokens[currentTokenIndex - 2];

        if (prevToken && beforePrevToken &&
            isMemberAccessDot(prevToken.type) &&
            beforePrevToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            // Walk further back through additional LABEL.DOT pairs so chained
            // access like `ns.A.B` surfaces the full chain. Without this, the
            // resolver would see `objectName='A'` and fail to find A as a
            // top-level symbol when A is actually a property of `ns`.
            const chain: string[] = [String(beforePrevToken.value), String(currentToken.value)];
            let i = currentTokenIndex - 3;
            while (i >= 1) {
                const dot = tokens[i];
                const label = tokens[i - 1];
                if (isMemberAccessDot(dot?.type) && label?.type === TokenType.TK_LABEL) {
                    chain.unshift(String(label.value));
                    i -= 2;
                } else {
                    break;
                }
            }
            const result: { objectName: string; propertyName: string; cursorOnObject: boolean; chain?: string[] } = {
                objectName: String(beforePrevToken.value),
                propertyName: String(currentToken.value),
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

