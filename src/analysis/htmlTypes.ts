/**
 * html module type definitions (ucode-mod-html).
 *
 * Function/constant names are authoritative — introspected from the real
 * `ucode-mod-html` package on OpenWrt 23.05 (its first feed appearance):
 *   import * as html from 'html';  for (k in html) print(k)
 * → entityencode entitydecode striptags tokenize + TEXT RAW OPEN ATTR CLOSE
 *   COMMENT CDATA PROCINST EOF
 *
 * The module exposes no object handles. Parameter types are kept conservative
 * (the primary string input is typed; no extra constraints are invented) because
 * the upstream C carries no jsdoc — under-constraining avoids false negatives.
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["entityencode", {
    name: "entityencode",
    parameters: [{ name: "str", type: "string", optional: false }],
    returnType: "string",
    description: "Encode reserved HTML characters in the given string as HTML entities (e.g. `&` → `&amp;`).",
  }],
  ["entitydecode", {
    name: "entitydecode",
    parameters: [{ name: "str", type: "string", optional: false }],
    returnType: "string",
    description: "Decode HTML entities in the given string back to their literal characters.",
  }],
  ["striptags", {
    name: "striptags",
    parameters: [{ name: "str", type: "string", optional: false }],
    returnType: "string",
    description: "Remove HTML/XML tags from the given string, returning the plain text content.",
  }],
  ["tokenize", {
    name: "tokenize",
    parameters: [{ name: "str", type: "string", optional: false }],
    returnType: "array",
    description: "Tokenize the given HTML/XML string into an array of tokens. Each token's kind is one of the TEXT/RAW/OPEN/ATTR/CLOSE/COMMENT/CDATA/PROCINST/EOF constants.",
  }],
]);

export { functions as htmlFunctions };

// Token-kind constants returned by tokenize() (authoritative names from introspection).
export const htmlConstants = new Set([
  'TEXT', 'RAW', 'OPEN', 'ATTR', 'CLOSE', 'COMMENT', 'CDATA', 'PROCINST', 'EOF',
]);

const constantDefs = new Map<string, ConstantDefinition>(
  Array.from(htmlConstants).map(name => [name, { name, value: 'number', type: 'number', description: `html token kind constant (\`${name}\`), as produced by \`tokenize()\`.` }])
);

export const htmlModule: ModuleDefinition = {
  name: 'html',
  functions,
  constants: constantDefs,
  documentation: `## html Module

HTML/XML entity encoding, tag stripping, and tokenization (\`ucode-mod-html\`).

\`\`\`ucode
import { entityencode, striptags, tokenize, OPEN } from 'html';

entityencode("a & b");   // "a &amp; b"
striptags("<b>hi</b>");  // "hi"
for (let tok in tokenize(markup)) { ... }
\`\`\`

First available on OpenWrt **23.05** (feed package \`ucode-mod-html\`).

**Functions:** entityencode, entitydecode, striptags, tokenize
**Token kinds:** TEXT, RAW, OPEN, ATTR, CLOSE, COMMENT, CDATA, PROCINST, EOF`,
  importValidation: {
    isValid: (name: string) => functions.has(name) || htmlConstants.has(name),
    getValidImports: () => [...Array.from(functions.keys()), ...Array.from(htmlConstants)],
  },
};
