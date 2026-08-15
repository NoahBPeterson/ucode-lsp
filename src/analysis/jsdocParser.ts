/**
 * JSDoc comment parser for ucode LSP
 * Parses @param and @returns tags from JSDoc comments and resolves type expressions
 */

import { UcodeType, type UcodeDataType, type SingleType, createUnionType, createArrayType, isObjectType, isArrayType, widenWithNull } from './symbolTable';
import { isKnownModule, isKnownObjectType } from './moduleDispatch';

export interface JsDocTag {
  tag: string;            // 'param', 'returns', 'type', 'typedef', 'property', 'global', 'callback', 'template'
  name?: string | undefined;          // parameter/property name (for @param/@property); may be dotted (`pos.x`) for @property
  typeExpression: string; // 'module:fs', 'string|number', etc.
  description?: string | undefined;   // trailing description after ' - '
  optional?: boolean | undefined;     // @param/@property declared optional: `[name]` / `[name=default]` (brackets already stripped from `name`)
  missingBraces?: boolean | undefined; // bare `@param string x` where the "type" was actually a type name — braces were omitted
}

// ---------------------------------------------------------------------------
// Small JSDoc tokenizer helpers. These replace the earlier one-shot regexes that
// used a non-nesting `[^}]+` brace capture (so `{{a: string}}` and inline object
// shapes broke) and a `(\w+)` name capture (so `[optional]` and dotted `pos.x`
// names were silently dropped).
// ---------------------------------------------------------------------------

/** Read a balanced `{…}` type span at the start of `s`. Handles nested braces
 *  (`{{a: string}}`). Returns the inner text (without the outer braces) and the
 *  remainder after the closing brace, or null if `s` doesn't start with `{` or the
 *  braces never balance (malformed). */
function readBracedType(s: string): { type: string; rest: string } | null {
  const t = s.replace(/^\s+/, '');
  if (!t.startsWith('{')) return null;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { type: t.slice(1, i).trim(), rest: t.slice(i + 1).replace(/^\s+/, '') };
      }
    }
  }
  return null; // unbalanced
}

/** Read a JSDoc name token at the start of `s`: `[name]` / `[name=default]` (optional),
 *  a dotted path `pos.x`, or a plain identifier. Returns the bare name, whether it was
 *  bracket-optional, and the remainder. Null if no name is present. */
function readName(s: string): { name: string; optional: boolean; rest: string } | null {
  const t = s.replace(/^\s+/, '');
  if (t.startsWith('[')) {
    const close = t.indexOf(']');
    if (close < 0) return null;
    const inner = t.slice(1, close);
    const [innerName = ''] = inner.split('=');
    const name = innerName.trim();
    if (!name) return null;
    return { name, optional: true, rest: t.slice(close + 1).replace(/^\s+/, '') };
  }
  const m = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(t);
  if (!m) return null;
  const [, matchedName = ''] = m;
  return { name: matchedName, optional: false, rest: t.slice(matchedName.length).replace(/^\s+/, '') };
}

/** A trailing tag description; a leading `-` separator is stripped. */
function readDescription(s: string): string | undefined {
  let t = s.trim();
  if (t.startsWith('-')) t = t.slice(1).trim();
  return t.length ? t : undefined;
}

import { splitTopLevel } from './typeStringUtils';
export { splitTopLevel };

/** The primitive/alias names JSDoc type expressions resolve directly. Exported so the
 *  UC7001 did-you-mean suggester can treat them as candidates. */
export const JSDOC_PRIMITIVE_MAP: Record<string, UcodeType> = {
  'string': UcodeType.STRING,
  // NOTE: 'number' is deliberately absent here — ucode has no `number` type
  // (`type(204)` is "int", `type(2.5)` is "double"), so the JS-ism `{number}`
  // means EITHER, and is resolved to `integer | double` below. Listing it here
  // as a single type made `x === 204` a hard "always false" error on correctly
  // annotated code.
  'integer': UcodeType.INTEGER,
  'int': UcodeType.INTEGER,
  'double': UcodeType.DOUBLE,
  'float': UcodeType.DOUBLE,
  'boolean': UcodeType.BOOLEAN,
  'bool': UcodeType.BOOLEAN,
  'array': UcodeType.ARRAY,
  'object': UcodeType.OBJECT,
  'function': UcodeType.FUNCTION,
  'null': UcodeType.NULL,
  'regex': UcodeType.REGEX,
  'regexp': UcodeType.REGEX,
  'unknown': UcodeType.UNKNOWN,
  'any': UcodeType.UNKNOWN,
};

/** Scan a JSDoc body (lines already `*`-stripped and joined) into line-anchored tags.
 *  Each entry is the tag word and the raw text up to the next line-anchored `@tag`. */
function scanRawTags(fullText: string): { tag: string; body: string; tagStart: number }[] {
  const re = /(^|\n)[ \t]*@([A-Za-z]+)\b/g;
  const marks: { tag: string; bodyStart: number; tagStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    const [, lead = '', tag = ''] = m;
    marks.push({ tag, bodyStart: re.lastIndex, tagStart: m.index + lead.length });
  }
  return marks.map((mk, i) => ({
    tag: mk.tag,
    body: fullText.slice(mk.bodyStart, marks[i + 1]?.tagStart ?? fullText.length).trim(),
    tagStart: mk.tagStart,
  }));
}

export interface ParsedJsDoc {
  tags: JsDocTag[];
  description?: string | undefined;   // Leading description before any tags
}

/**
 * Parse a JSDoc comment value (text between / ** and * /)
 * The value starts with '*' since /** produces value "* ..."
 */
export function parseJsDocComment(value: string): ParsedJsDoc {
  const tags: JsDocTag[] = [];

  // Strip leading * on each line and normalize
  const lines = value.split('\n').map(line => line.replace(/^\s*\*\s?/, ''));
  const fullText = lines.join('\n').trim();

  const rawTags = scanRawTags(fullText);

  // Leading description = everything before the first tag.
  const firstTagStart = rawTags[0]?.tagStart ?? -1;
  const description = firstTagStart === -1
    ? (fullText || undefined)
    : (fullText.slice(0, firstTagStart).trim() || undefined);

  let returnsSeen = false;

  for (const { tag, body } of rawTags) {
    switch (tag) {
      case 'param': {
        parseParamTag(body, tags);
        break;
      }
      case 'return':
      case 'returns': {
        if (returnsSeen) break; // keep only the first @returns (legacy behaviour)
        returnsSeen = true;
        const braced = readBracedType(body);
        if (braced) {
          tags.push({ tag: 'returns', typeExpression: braced.type, description: readDescription(braced.rest) });
        } else {
          // Bare `@returns type - desc`
          const first = body.split(/\s+/)[0] ?? '';
          const rest = body.slice(first.length);
          tags.push({ tag: 'returns', typeExpression: first.trim(), description: readDescription(rest) });
        }
        break;
      }
      case 'typedef': {
        // Both orders: `@typedef {Type} Name` and `@typedef Name {Type}`.
        const braced = readBracedType(body);
        if (braced) {
          const nm = readName(braced.rest);
          tags.push({ tag: 'typedef', typeExpression: braced.type, name: nm ? nm.name : undefined });
        } else {
          const nm = readName(body);
          if (nm) {
            const braced2 = readBracedType(nm.rest);
            tags.push({ tag: 'typedef', typeExpression: braced2 ? braced2.type : '', name: nm.name });
          } else {
            tags.push({ tag: 'typedef', typeExpression: '', name: undefined });
          }
        }
        break;
      }
      case 'property': {
        const braced = readBracedType(body);
        if (!braced) break; // malformed @property (no `{type}`) — nothing usable
        const nm = readName(braced.rest);
        if (!nm) break;
        tags.push({
          tag: 'property',
          typeExpression: braced.type,
          name: nm.name,
          description: readDescription(nm.rest),
          ...(nm.optional ? { optional: true } : {}),
        });
        break;
      }
      case 'callback': {
        // `@callback Name` — declares a function type name.
        const nm = readName(body);
        if (nm) tags.push({ tag: 'callback', typeExpression: 'function', name: nm.name });
        break;
      }
      case 'template': {
        // `@template T` or `@template T, U - desc` — generic type params.
        const head = body.split('\n')[0] ?? body;
        for (const part of head.split(',')) {
          const nm = readName(part);
          if (nm) tags.push({ tag: 'template', typeExpression: 'unknown', name: nm.name });
        }
        break;
      }
      case 'enum': {
        // `@enum {type}` — attaches to the following const/let declaration; the
        // referenceable name is the declaration's identifier (resolved by the caller).
        const braced = readBracedType(body);
        tags.push({ tag: 'enum', typeExpression: braced ? braced.type : 'integer' });
        break;
      }
      case 'global': {
        // `@global {type} name`, `@global name {type}`, or `@global name`.
        const braced = readBracedType(body);
        if (braced) {
          const nm = readName(braced.rest);
          if (nm) tags.push({ tag: 'global', typeExpression: braced.type, name: nm.name });
        } else {
          const nm = readName(body);
          if (nm) {
            const braced2 = readBracedType(nm.rest);
            tags.push({ tag: 'global', name: nm.name, typeExpression: braced2 ? braced2.type : '' });
          }
        }
        break;
      }
      default:
        break; // unrecognized tag — ignore
    }
  }

  return { tags, description };
}

/** Parse a single `@param` tag body into a JsDocTag. Supports:
 *   `{type} name`, `{type} [name]`, `{type} name - desc`, and the brace-less legacy
 *   forms `name type` and the missing-braces mistake `type name` (flagged). */
function parseParamTag(body: string, tags: JsDocTag[]): void {
  const braced = readBracedType(body);
  if (braced) {
    const nm = readName(braced.rest);
    tags.push({
      tag: 'param',
      typeExpression: braced.type,
      name: nm ? nm.name : undefined,
      description: nm ? readDescription(nm.rest) : undefined,
      ...(nm && nm.optional ? { optional: true } : {}),
    });
    return;
  }

  // No braces. Two brace-less shapes are supported:
  //   `@param name type [- desc]`  (legacy bare form — first token is the NAME)
  //   `@param type name`           (braces were forgotten — first token is a real TYPE)
  const first = body.split(/\s+/)[0] ?? '';
  const afterFirst = body.slice(first.length).replace(/^\s+/, '');
  const second = afterFirst.split(/\s+/)[0] ?? '';
  const afterSecond = afterFirst.slice(second.length);

  const firstIsType = first !== '' && resolveTypeExpression(first) !== null;
  const secondIsType = second !== '' && resolveTypeExpression(second) !== null;

  if (firstIsType && !secondIsType && second !== '') {
    // `@param string x` — braces were omitted around the type.
    tags.push({
      tag: 'param',
      typeExpression: first,
      name: second,
      description: readDescription(afterSecond),
      missingBraces: true,
    });
    return;
  }

  // Legacy bare `@param name type [- desc]`.
  tags.push({
    tag: 'param',
    name: first || undefined,
    typeExpression: second.trim(),
    description: readDescription(afterSecond),
  });
}

/**
 * Resolve a type expression string to a UcodeDataType.
 * Returns null if the type is unknown.
 */
/** A resolved type as a UNION MEMBER: a known-object HANDLE annotation (`socket`,
 *  `fs.file`) resolves to the module-record shape `{type: OBJECT, moduleName}`, which
 *  cannot sit in a union — so `?socket` silently lost its null (widenWithNull returns
 *  such records unchanged, and union assembly flattened them to bare `object`).
 *  Registered object types have a first-class union representation (ObjectType,
 *  'objectKind') — the same one socket.create()'s own `socket | null` uses. */
function asUnionMember(t: UcodeDataType): UcodeDataType {
  if (t && typeof t === 'object' && t.type === UcodeType.OBJECT
      && 'moduleName' in t && typeof t.moduleName === 'string'
      && isKnownObjectType(t.moduleName)) {
    return { type: 'objectKind', name: t.moduleName };
  }
  return t;
}

export function resolveTypeExpression(typeExpr: string): UcodeDataType | null {
  typeExpr = typeExpr.trim();

  // Closure-style function type: `function(integer): string`, `function()`.
  // Parameter/return modeling is not carried; the value is a callable.
  if (/^function\s*\(/.test(typeExpr)) {
    return UcodeType.FUNCTION;
  }

  // Handle nullable/optional type sugar — all mean `type|null` (in ucode an
  // omitted argument IS null, so optional and nullable collapse):
  //   `type?` (suffix), `?type` (Closure nullable prefix), `type=` (Closure optional suffix)
  if (typeExpr.endsWith('?') || typeExpr.endsWith('=')) {
    const baseType = resolveTypeExpression(typeExpr.slice(0, -1));
    if (baseType === null) return null;
    return widenWithNull(asUnionMember(baseType));
  }
  if (typeExpr.startsWith('?') && typeExpr.length > 1) {
    const baseType = resolveTypeExpression(typeExpr.slice(1));
    if (baseType === null) return null;
    return widenWithNull(asUnionMember(baseType));
  }

  // Inline object shape `{ a: string }` — valid as a standalone type and as a union
  // member (`{header_buf:string}|null`). The type system's ObjectType carries no
  // property map, so the shape collapses to `object` here; per-property detail is
  // preserved only on the dedicated @param symbol path (parseInlineObjectShape there).
  if (typeExpr.startsWith('{') && typeExpr.endsWith('}')) {
    return parseInlineObjectShape(typeExpr) !== null ? UcodeType.OBJECT : null;
  }

  // Handle union types: type1|type2 — split at TOP LEVEL only, so a `|` inside an
  // inline shape or `array<…>` doesn't shred the member expression.
  if (typeExpr.includes('|')) {
    const parts = splitTopLevel(typeExpr, '|').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const types: SingleType[] = [];
      for (const part of parts) {
        const resolved0 = resolveTypeExpression(part);
        if (resolved0 === null) return null;
        const resolved = asUnionMember(resolved0); // known-object handles keep their identity in unions
        if (typeof resolved === 'string') {
          types.push(resolved);
        } else if (typeof resolved === 'object' && resolved.type === UcodeType.UNION) {
          types.push(...resolved.types);
        } else if (isObjectType(resolved) || isArrayType(resolved)) {
          // ObjectType or ArrayType can be used directly as SingleType
          types.push(resolved);
        } else {
          // Complex type in union (a true MODULE type etc.) — flatten to base
          types.push(resolved.type);
        }
      }
      return createUnionType(types);
    }
  }

  // Element-typed arrays: `array<T>` (matches the LSP's own display), `Array<T>`,
  // or the JSDoc/TS `T[]` form → ArrayType(T). The element type is resolved
  // recursively — `string[][]`, `array<fs.file>`, and (since the union handler went
  // depth-aware) `array<a|b>` with a union element all work; an unresolved element
  // falls back to `unknown`.
  const angleMatch = typeExpr.match(/^[Aa]rray<(.+)>$/);
  const bracketMatch = typeExpr.match(/^(.+)\[\]$/);
  const elementExpr = angleMatch ? angleMatch[1] : (bracketMatch ? bracketMatch[1] : null);
  if (elementExpr) {
    const elementType = resolveTypeExpression(elementExpr.trim()) ?? UcodeType.UNKNOWN;
    return createArrayType(elementType);
  }

  // Handle module: prefix → module type
  if (typeExpr.startsWith('module:')) {
    const moduleName = typeExpr.substring(7);
    if (isKnownModule(moduleName)) {
      return { type: UcodeType.OBJECT, moduleName };
    }
    return null;
  }

  // Handle known object types (e.g., fs.file, uci.cursor)
  if (isKnownObjectType(typeExpr)) {
    return { type: UcodeType.OBJECT, moduleName: typeExpr };
  }

  // Handle primitive types
  const lower = typeExpr.toLowerCase();
  // `{number}` is a JS-ism: ucode has no such type, and a numeric value is an
  // `int` OR a `double`. Resolving it to one of them makes strict comparisons
  // against literals of the other kind look impossible.
  if (lower === 'number') return createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]);
  const primitive = JSDOC_PRIMITIVE_MAP[lower];
  if (primitive !== undefined) {
    return primitive;
  }

  // Bare module names: 'fs', 'uci', etc. → module type (no 'module:' prefix needed)
  if (isKnownModule(typeExpr)) {
    return { type: UcodeType.OBJECT, moduleName: typeExpr };
  }

  return null;
}

/**
 * Resolve a type expression, keeping the resolvable part of a union even when some
 * members are unknown. `unresolved` lists the member strings that couldn't be resolved
 * (so the caller can still warn), while `type` carries the union of the resolvable ones
 * (null only when nothing resolved). For non-union expressions this is just a thin
 * wrapper over resolveTypeExpression.
 */
export function resolveTypeExpressionDetailed(typeExpr: string): { type: UcodeDataType | null; unresolved: string[] } {
  const trimmed = typeExpr.trim();
  // Only split a TOP-LEVEL union (not `|` nested inside `<>`/`{}`); a leading nullable
  // sugar (`?T`) or object shape is handled by resolveTypeExpression directly.
  if (trimmed.includes('|') && !trimmed.startsWith('{') && !trimmed.startsWith('?') && !/^[Aa]rray</.test(trimmed)) {
    const parts = splitTopLevel(trimmed, '|').map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const types: SingleType[] = [];
      const unresolved: string[] = [];
      for (const part of parts) {
        const r = resolveTypeExpression(part);
        if (r === null) { unresolved.push(part); continue; }
        if (typeof r === 'string') types.push(r);
        else if (typeof r === 'object' && r.type === UcodeType.UNION) types.push(...r.types);
        else if (isObjectType(r) || isArrayType(r)) types.push(r);
        else types.push(r.type);
      }
      return { type: types.length === 0 ? null : createUnionType(types), unresolved };
    }
  }
  const r = resolveTypeExpression(trimmed);
  return { type: r, unresolved: r === null ? [trimmed] : [] };
}

/** Parse an inline object-shape type `{ a: string, b: integer }` into a property map.
 *  Returns null when `expr` isn't a `{…}` object shape. Nested inline shapes collapse to
 *  `object` (the LSP carries only one nesting level of property types on a symbol). */
export function parseInlineObjectShape(expr: string): Map<string, UcodeDataType> | null {
  const t = expr.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const inner = t.slice(1, -1).trim();
  const props = new Map<string, UcodeDataType>();
  if (inner === '') return props; // `{}` — empty object
  for (const rawPart of splitTopLevel(inner, ',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const parts = splitTopLevel(part, ':');
    if (parts.length < 2) return null; // not `key: type`
    const [keyPart = ''] = parts;
    const key = keyPart.trim().replace(/^['"]|['"]$/g, '');
    const valExpr = parts.slice(1).join(':').trim();
    if (!key) return null;
    props.set(key, resolveTypeExpression(valExpr) ?? UcodeType.UNKNOWN);
  }
  return props;
}

/**
 * A single parsed @property inside a @typedef. `type` is the resolved leaf type, or null
 * when it couldn't be resolved standalone (e.g. it names another @typedef) — the consumer
 * resolves those against the typedef registry. `children` holds dotted sub-properties
 * (`pos.x`, `pos.y` → `pos` with children `x`, `y`).
 */
export interface ParsedTypedefProperty {
  typeExpression: string;
  type: UcodeDataType | null;
  optional: boolean;
  description?: string | undefined;
  children?: Map<string, ParsedTypedefProperty> | undefined;
}

/**
 * Represents a parsed @typedef with its properties.
 */
export interface ParsedTypedef {
  name: string;
  baseType: string;  // The type in @typedef {type} Name
  properties: Map<string, ParsedTypedefProperty>;
  duplicateProperties?: string[] | undefined; // property names declared more than once
}

/**
 * Extract a @typedef from a parsed JSDoc comment.
 * Returns null if the comment doesn't contain a (named) @typedef.
 */
export function extractTypedef(parsed: ParsedJsDoc): ParsedTypedef | null {
  const typedefTag = parsed.tags.find(t => t.tag === 'typedef');
  if (!typedefTag || !typedefTag.name) return null;

  const properties = new Map<string, ParsedTypedefProperty>();
  const duplicates: string[] = [];

  for (const tag of parsed.tags) {
    if (tag.tag !== 'property' || !tag.name) continue;
    const path = tag.name.split('.').map(s => s.trim()).filter(Boolean);
    if (path.length === 0) continue;

    // Walk/create nested container maps for a dotted path (`pos.x`).
    let map = properties;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      if (seg === undefined) continue;
      let node = map.get(seg);
      let children = node?.children;
      if (!node) {
        children = new Map();
        node = { typeExpression: '', type: UcodeType.OBJECT, optional: false, children };
        map.set(seg, node);
      } else if (!children) {
        children = new Map();
        node.children = children;
      }
      node.type = UcodeType.OBJECT;
      map = children;
    }

    const leaf = path[path.length - 1];
    if (leaf === undefined) continue;
    const existing = map.get(leaf);
    if (existing && existing.typeExpression !== '') duplicates.push(tag.name);
    map.set(leaf, {
      typeExpression: tag.typeExpression,
      type: resolveTypeExpression(tag.typeExpression),
      optional: !!tag.optional,
      description: tag.description,
      ...(existing?.children ? { children: existing.children } : {}),
    });
  }

  return {
    name: typedefTag.name,
    baseType: typedefTag.typeExpression,
    properties,
    ...(duplicates.length ? { duplicateProperties: duplicates } : {}),
  };
}

/**
 * Parse an import() type expression.
 * Supports: import('module').property, import('module')
 * Returns null if the expression is not an import() type.
 */
export interface ImportTypeExpression {
  modulePath: string;
  propertyName?: string | undefined;
}

export function parseImportTypeExpression(typeExpr: string): ImportTypeExpression | null {
  const match = /^import\(\s*['"]([^'"]+)['"]\s*\)(?:\.(\w+))?$/.exec(typeExpr.trim());
  if (!match) return null;
  const [, modulePath = ''] = match;
  return {
    modulePath,
    propertyName: match[2]
  };
}
