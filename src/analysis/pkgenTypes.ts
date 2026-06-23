/**
 * pkgen module type definitions (ucode-mod-pkgen) — X.509 key/cert generation
 * via mbedTLS.
 *
 * Names are authoritative — module functions and handle method/resource names from
 * the vendored source's tables (openwrt/package/utils/ucode-mod-pkgen/src/ucode.c):
 *   global_fns: load_key cert_info generate_key generate_cert generate_pkcs12 errno error
 *   generate_key()/load_key() → uc_resource_new(uc_pk_type)  → "mbedtls.pk" (pem, der)
 *   generate_cert()           → uc_resource_new(uc_crt_type) → "mbedtls.crt" (pem, der)
 *   cert_info()               → builds an info object (issuer/subject/valid_from/…)
 *
 * Parameter types are permissive (no upstream jsdoc); returns are typed from the C
 * resource/return patterns (handle|null, string|null, object|null).
 * First available on OpenWrt 25.12 (feed package `ucode-mod-pkgen`).
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ObjectTypeDefinition } from './registryFactory';

const ANY = (n: string, optional = false) => ({ name: n, type: 'any', optional });
const fn = (name: string, parameters: FunctionSignature['parameters'], returnType: string, description: string): [string, FunctionSignature] =>
  [name, { name, parameters, returnType, description }];

const functions = new Map<string, FunctionSignature>([
  fn('generate_key', [ANY('options', true)], 'mbedtls.pk | null', 'Generate a new private key and return a key handle, or null on error.'),
  fn('load_key', [ANY('data')], 'mbedtls.pk | null', 'Load a private key from PEM/DER data and return a key handle, or null.'),
  fn('generate_cert', [ANY('options')], 'mbedtls.crt | null', 'Generate an X.509 certificate and return a cert handle, or null on error.'),
  fn('cert_info', [ANY('data')], 'object | null', 'Parse a certificate and return an info object (issuer, subject, valid_from, valid_to, serial), or null.'),
  fn('generate_pkcs12', [ANY('options')], 'string | null', 'Generate a PKCS#12 bundle and return it as a string, or null on error.'),
  fn('error', [], 'string | null', 'Return a description of the last pkgen/mbedTLS error, or null if none.'),
  fn('errno', [], 'int | null', 'Return the numeric code of the last pkgen/mbedTLS error, or null if none.'),
]);

export { functions as pkgenFunctions };

const pemDer = (): ReadonlyMap<string, FunctionSignature> => new Map<string, FunctionSignature>([
  fn('pem', [], 'string | null', 'Serialize to PEM format. Returns null on error.'),
  fn('der', [], 'string | null', 'Serialize to DER (binary) format. Returns null on error.'),
]);

export const mbedtlsPkObjectType: ObjectTypeDefinition = { typeName: 'mbedtls.pk', methods: pemDer() };
export const mbedtlsCrtObjectType: ObjectTypeDefinition = { typeName: 'mbedtls.crt', methods: pemDer() };

export const pkgenModule: ModuleDefinition = {
  name: 'pkgen',
  functions,
  documentation: `## pkgen Module

X.509 key and certificate generation via mbedTLS (\`ucode-mod-pkgen\`).

\`\`\`ucode
import { generate_key, generate_cert } from 'pkgen';
let key = generate_key({ type: 'ec', curve: 'secp256r1' });
let pem = key.pem();
\`\`\`

First available on OpenWrt **25.12** (feed package \`ucode-mod-pkgen\`).

**Functions:** generate_key, load_key, generate_cert, cert_info, generate_pkcs12, error, errno
**Handles:** mbedtls.pk (key: pem/der), mbedtls.crt (cert: pem/der)`,
  importValidation: {
    isValid: (name: string) => functions.has(name),
    getValidImports: () => Array.from(functions.keys()),
  },
};
