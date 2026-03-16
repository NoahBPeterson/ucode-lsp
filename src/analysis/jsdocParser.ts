/**
 * JSDoc comment parser for ucode LSP
 * Parses @param and @returns tags from JSDoc comments and resolves type expressions
 */

import { UcodeType, UcodeDataType, createUnionType } from './symbolTable';
import { isKnownModule, isKnownObjectType } from './moduleDispatch';

export interface JsDocTag {
  tag: string;            // 'param', 'returns', 'type'
  name?: string | undefined;          // parameter name (for @param)
  typeExpression: string; // 'module:fs', 'string|number', etc.
  description?: string | undefined;   // trailing description after ' - '
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
  let description: string | undefined;

  // Strip leading * on each line and normalize
  const lines = value.split('\n').map(line => {
    let trimmed = line.replace(/^\s*\*\s?/, '');
    return trimmed;
  });

  const fullText = lines.join('\n').trim();

  // Extract description (text before first @tag)
  const firstTagIndex = fullText.search(/@(?:param|returns?|type(?:def)?|property)\b/);
  if (firstTagIndex > 0) {
    description = fullText.substring(0, firstTagIndex).trim() || undefined;
  } else if (firstTagIndex === -1) {
    description = fullText || undefined;
  }

  // Parse @param tags
  // Supports: @param {type} name, @param {type} name - description, @param name type, @param name type - description
  const paramRegexBraces = /@param\s+\{([^}]+)\}\s+(\w+)(?:\s+-\s+(.*))?/g;
  const paramRegexBare = /@param\s+(\w+)\s+(\S+)(?:\s+-\s+(.*))?/g;

  let match: RegExpExecArray | null;

  // Try brace syntax first: @param {type} name
  while ((match = paramRegexBraces.exec(fullText)) !== null) {
    tags.push({
      tag: 'param',
      typeExpression: match[1]!.trim(),
      name: match[2]!,
      description: match[3]?.trim()
    });
  }

  // If no brace-style params found, try bare syntax: @param name type
  if (tags.filter(t => t.tag === 'param').length === 0) {
    while ((match = paramRegexBare.exec(fullText)) !== null) {
      tags.push({
        tag: 'param',
        name: match[1]!,
        typeExpression: match[2]!.trim(),
        description: match[3]?.trim()
      });
    }
  }

  // Parse @returns / @return tags
  const returnsRegexBraces = /@returns?\s+\{([^}]+)\}(?:\s+-?\s*(.*))?/;
  const returnsRegexBare = /@returns?\s+(\S+)(?:\s+-?\s*(.*))?/;

  const returnsMatch = returnsRegexBraces.exec(fullText) || returnsRegexBare.exec(fullText);
  if (returnsMatch) {
    // Only add if not already captured as a param
    tags.push({
      tag: 'returns',
      typeExpression: returnsMatch[1]!.trim(),
      description: returnsMatch[2]?.trim()
    });
  }

  // Parse @typedef tag: @typedef {type} Name or @typedef {object} Name
  const typedefRegex = /@typedef\s+\{([^}]+)\}\s+(\w+)/;
  const typedefMatch = typedefRegex.exec(fullText);
  if (typedefMatch) {
    tags.push({
      tag: 'typedef',
      typeExpression: typedefMatch[1]!.trim(),
      name: typedefMatch[2]!
    });
  }

  // Parse @property tags: @property {type} name or @property {type} name - description
  const propertyRegex = /@property\s+\{([^}]+)\}\s+(\w+)(?:\s+-\s+(.*))?/g;
  while ((match = propertyRegex.exec(fullText)) !== null) {
    tags.push({
      tag: 'property',
      typeExpression: match[1]!.trim(),
      name: match[2]!,
      description: match[3]?.trim()
    });
  }

  return { tags, description };
}

/**
 * Resolve a type expression string to a UcodeDataType.
 * Returns null if the type is unknown.
 */
export function resolveTypeExpression(typeExpr: string): UcodeDataType | null {
  typeExpr = typeExpr.trim();

  // Handle optional type: type?  → type|null
  if (typeExpr.endsWith('?')) {
    const baseType = resolveTypeExpression(typeExpr.slice(0, -1));
    if (baseType === null) return null;
    if (typeof baseType === 'string') {
      return createUnionType([baseType as UcodeType, UcodeType.NULL]);
    }
    return baseType;
  }

  // Handle union types: type1|type2
  if (typeExpr.includes('|')) {
    const parts = typeExpr.split('|').map(p => p.trim()).filter(Boolean);
    const types: UcodeType[] = [];
    for (const part of parts) {
      const resolved = resolveTypeExpression(part);
      if (resolved === null) return null;
      if (typeof resolved === 'string') {
        types.push(resolved as UcodeType);
      } else if (typeof resolved === 'object' && resolved.type === UcodeType.UNION) {
        types.push(...(resolved as any).types);
      } else {
        // Complex type in union (module type etc.) — flatten to base
        types.push(resolved.type);
      }
    }
    return createUnionType(types);
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
  const primitiveMap: Record<string, UcodeType> = {
    'string': UcodeType.STRING,
    'number': UcodeType.DOUBLE,
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

  const lower = typeExpr.toLowerCase();
  if (lower in primitiveMap) {
    return primitiveMap[lower]! as UcodeDataType;
  }

  // Bare module names: 'fs', 'uci', etc. → module type (no 'module:' prefix needed)
  if (isKnownModule(typeExpr)) {
    return { type: UcodeType.OBJECT, moduleName: typeExpr };
  }

  return null;
}

/**
 * Resolve a type expression, returning UNKNOWN for unrecognized types
 */
export function resolveTypeExpressionOrUnknown(typeExpr: string): UcodeDataType {
  return resolveTypeExpression(typeExpr) ?? (UcodeType.UNKNOWN as UcodeDataType);
}

/**
 * Represents a parsed @typedef with its properties.
 */
export interface ParsedTypedef {
  name: string;
  baseType: string;  // The type in @typedef {type} Name
  properties: Map<string, { type: UcodeDataType; description?: string | undefined }>;
}

/**
 * Extract a @typedef from a parsed JSDoc comment.
 * Returns null if the comment doesn't contain a @typedef.
 */
export function extractTypedef(parsed: ParsedJsDoc): ParsedTypedef | null {
  const typedefTag = parsed.tags.find(t => t.tag === 'typedef');
  if (!typedefTag || !typedefTag.name) return null;

  const properties = new Map<string, { type: UcodeDataType; description?: string | undefined }>();
  for (const tag of parsed.tags) {
    if (tag.tag === 'property' && tag.name) {
      const resolved = resolveTypeExpression(tag.typeExpression);
      if (resolved !== null) {
        properties.set(tag.name, { type: resolved, description: tag.description });
      }
    }
  }

  return {
    name: typedefTag.name,
    baseType: typedefTag.typeExpression,
    properties
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
  return {
    modulePath: match[1]!,
    propertyName: match[2]
  };
}
