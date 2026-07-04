/**
 * The `uhttpd` ambient object injected into a uhttpd ucode handler's scope.
 * Signatures are from uhttpd/ucode.c (the real source, master 2026-07-04):
 *   ucode.c:240-247 register send/sendc/recv/urldecode/urlencode + the docroot string.
 * Seeded only in handler context (a `{%` template that assigns global.handle_request) —
 * see docs/uhttpd-false-negatives.md and SemanticAnalyzer.declareUhttpdAmbient.
 */
import type { FunctionSignature } from './moduleTypes';
import type { ObjectTypeDefinition } from './registryFactory';

// `docroot` is a STRING property, not a method (ucode.c: ucv_string_new(conf.docroot)). The
// object-type factory is method-or-property, not mixed; since send/recv/… dominate, docroot
// is carried as a zero-arg member typed `string` so a bare `uhttpd.docroot` resolves to string.
const uhttpdMethods = new Map<string, FunctionSignature>([
  ['send', { name: 'send', parameters: [
      { name: 'value', type: 'any', optional: false },
    ], returnType: 'integer', description: 'Stringify and write the argument(s) to the response body. Variadic. Returns the number of bytes written.' }],
  ['sendc', { name: 'sendc', parameters: [
      { name: 'value', type: 'any', optional: false },
    ], returnType: 'integer', description: 'Alias of send(): stringify and write the argument(s) to the response body. Returns bytes written.' }],
  ['recv', { name: 'recv', parameters: [
      { name: 'length', type: 'integer', optional: true },
    ], returnType: 'string | null', description: 'Read up to `length` bytes (default BUFSIZ) of the request body from stdin. Returns the received string, or null on error. Raises if `length` is present and not an integer.' }],
  ['urldecode', { name: 'urldecode', parameters: [
      { name: 'str', type: 'string', optional: false },
    ], returnType: 'string | null', description: 'Decode a URL-encoded string. Returns the decoded string, or null if the argument is not a string.' }],
  ['urlencode', { name: 'urlencode', parameters: [
      { name: 'str', type: 'string', optional: false },
    ], returnType: 'string | null', description: 'URL-encode a string. Returns the encoded string, or null if the argument is not a string.' }],
  ['docroot', { name: 'docroot', parameters: [], returnType: 'string', description: 'The configured document root path (a string property, from `-h`/config docroot).' }],
]);

/** The uhttpd request/response ambient handle. */
export const uhttpdObjectType: ObjectTypeDefinition = {
  typeName: 'uhttpd',
  methods: uhttpdMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    sig.name === 'docroot'
      ? `**uhttpd.docroot**: \`string\`\n\n${sig.description}`
      : `**uhttpd.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};
