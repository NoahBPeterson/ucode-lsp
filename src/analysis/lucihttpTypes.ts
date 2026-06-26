/**
 * lucihttp module type definitions (`liblucihttp-ucode`, ships /usr/lib/ucode/lucihttp.so).
 *
 * Export names are authoritative — introspected from the real `liblucihttp-ucode`
 * package on an OpenWrt 24.10 container:
 *   import * as m from 'lucihttp';  for (k in m) print(type(m[k]), k)
 * → functions: urlencode urldecode urlencoded_parser multipart_parser header_attribute
 *   int consts: ENCODE_FULL ENCODE_IF_NEEDED ENCODE_SPACE_PLUS
 *               DECODE_PLUS DECODE_KEEP_PLUS DECODE_IF_NEEDED DECODE_STRICT
 *
 * NOT a core ucode-mod-*: it's the ucode binding of the LuCI HTTP utility library,
 * pulled in by `luci-base`. Available in every release's package feed (22.03→main),
 * so it is NOT version-gated — the LSP treats it as importable on all targets (its
 * actual presence on a device is a packaging `DEPENDS`, like any non-core module).
 *
 * Parameter shapes are taken from real usage in luci-base/ucode/http.uc
 * (e.g. `multipart_parser(CONTENT_TYPE, cb)`, `urlencoded_parser(cb)`,
 * `header_attribute(buf, null)`, `urldecode(buf, DECODE_PLUS) || ''`). The upstream
 * C carries no jsdoc, so params are kept conservative and return types include null
 * where the runtime can produce it (under-constraining avoids false negatives).
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["urlencode", {
    name: "urlencode",
    parameters: [
      { name: "s", type: "string", optional: false },
      { name: "flags", type: "integer", optional: true },
    ],
    returnType: "string | null",
    description: "Percent-encode a string for use in a URL. `flags` is one of the ENCODE_* constants (default ENCODE_IF_NEEDED). Returns null on invalid input.",
  }],
  ["urldecode", {
    name: "urldecode",
    parameters: [
      { name: "s", type: "string", optional: false },
      { name: "flags", type: "integer", optional: true },
    ],
    returnType: "string | null",
    description: "Decode a percent-encoded URL string. `flags` is one of the DECODE_* constants (default DECODE_IF_NEEDED). Returns null on invalid input.",
  }],
  ["urlencoded_parser", {
    name: "urlencoded_parser",
    parameters: [
      { name: "callback", type: "function", optional: false },
    ],
    returnType: "object | null",
    description: "Create an incremental parser for `application/x-www-form-urlencoded` bodies. The callback is invoked with (what, buffer, length) as data is fed in. Returns a parser handle, or null on failure.",
  }],
  ["multipart_parser", {
    name: "multipart_parser",
    parameters: [
      { name: "content_type", type: "string", optional: false },
      { name: "callback", type: "function", optional: false },
    ],
    returnType: "object | null",
    description: "Create an incremental parser for `multipart/form-data` bodies, using the boundary from `content_type`. The callback is invoked with (what, buffer, length). Returns a parser handle, or null on failure.",
  }],
  ["header_attribute", {
    name: "header_attribute",
    parameters: [
      { name: "header", type: "string", optional: false },
      { name: "name", type: "string | null", optional: false },
    ],
    returnType: "string | null",
    description: "Extract an attribute from an HTTP header value (e.g. the `name`/`filename` of a Content-Disposition). Pass null for `name` to get the header's primary value. Returns null when absent.",
  }],
]);

export { functions as lucihttpFunctions };

// Encode/decode mode constants (int). Authoritative names from introspection.
export const lucihttpConstants = new Set([
  'ENCODE_IF_NEEDED', 'ENCODE_FULL', 'ENCODE_SPACE_PLUS',
  'DECODE_IF_NEEDED', 'DECODE_PLUS', 'DECODE_KEEP_PLUS', 'DECODE_STRICT',
]);

const constantDefs = new Map<string, ConstantDefinition>(
  Array.from(lucihttpConstants).map(name => [name, {
    name, value: 'number', type: 'number',
    description: `lucihttp ${name.startsWith('ENCODE') ? 'urlencode()' : 'urldecode()'} mode flag (\`${name}\`).`,
  }])
);

export const lucihttpModule: ModuleDefinition = {
  name: 'lucihttp',
  functions,
  constants: constantDefs,
  documentation: `## lucihttp Module

ucode binding of the LuCI HTTP utility library (\`liblucihttp-ucode\`): URL
percent-encoding/decoding, and incremental parsers for urlencoded / multipart
request bodies.

\`\`\`ucode
import { urlencode, urldecode, ENCODE_FULL, DECODE_PLUS } from 'lucihttp';

urlencode("a b&c", ENCODE_FULL);   // "a%20b%26c"
urldecode("a+b", DECODE_PLUS);     // "a b"
\`\`\`

Pulled in by \`luci-base\`, so present on any image that includes LuCI. Available
in the package feed of every release (22.03→main) — not version-gated.

**Functions:** urlencode, urldecode, urlencoded_parser, multipart_parser, header_attribute
**Encode flags:** ENCODE_IF_NEEDED, ENCODE_FULL, ENCODE_SPACE_PLUS
**Decode flags:** DECODE_IF_NEEDED, DECODE_PLUS, DECODE_KEEP_PLUS, DECODE_STRICT`,
  importValidation: {
    isValid: (name: string) => functions.has(name) || lucihttpConstants.has(name),
    getValidImports: () => [...functions.keys(), ...lucihttpConstants],
  },
};
