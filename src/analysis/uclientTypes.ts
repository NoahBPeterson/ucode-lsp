/**
 * uclient module type definitions (ucode-mod-uclient) — HTTP/HTTPS client.
 *
 * Authoritative export from introspecting the real `ucode-mod-uclient` package on
 * OpenWrt 24.10 (first feed appearance): a single function, `new`. The returned
 * client handle requires a live setup to construct (`new()` returns null without
 * one), so its methods can't be witnessed by introspection and the upstream C has
 * no jsdoc. To stay sound, `new()` is typed as a permissive `object | null` —
 * member access on the handle is left unconstrained rather than asserting an
 * unverified method set.
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["new", {
    name: "new",
    parameters: [
      { name: "url", type: "string", optional: false },
      { name: "options", type: "any", optional: true },
    ],
    returnType: "object | null",
    description: "Create a new uclient HTTP/HTTPS client for the given URL. Returns a client handle, or null on failure.",
  }],
]);

export { functions as uclientFunctions };

export const uclientModule: ModuleDefinition = {
  name: 'uclient',
  functions,
  documentation: `## uclient Module

A non-blocking HTTP/HTTPS client (\`ucode-mod-uclient\`), built on libuclient.

\`\`\`ucode
import { new as uclient_new } from 'uclient';
let cl = uclient_new('https://example.org/');
\`\`\`

First available on OpenWrt **24.10** (feed package \`ucode-mod-uclient\`).

**Functions:** new — returns an HTTP client handle (\`object | null\`).`,
  importValidation: {
    isValid: (name: string) => functions.has(name),
    getValidImports: () => Array.from(functions.keys()),
  },
};
