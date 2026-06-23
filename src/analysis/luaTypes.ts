/**
 * lua module type definitions (ucode-mod-lua) — the ucode↔Lua bridge.
 *
 * Authoritative export from introspecting the real `ucode-mod-lua` package on
 * OpenWrt 23.05 (first feed appearance): the module exposes a single function,
 * `create`. The returned Lua-VM handle dispatches its methods through a dynamic
 * `__index` (not enumerable via `for k in`), so its methods can't be witnessed by
 * introspection and the upstream C carries no jsdoc. To stay sound, `create()` is
 * typed as a permissive `object | null` — member access on the handle is therefore
 * left unconstrained (no false-positive "method does not exist") rather than
 * asserting a method set we can't verify.
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["create", {
    name: "create",
    parameters: [{ name: "init", type: "string", optional: true }],
    returnType: "object | null",
    description: "Create a new Lua VM instance and return a handle for invoking Lua code from ucode. Returns null on failure. (The handle's methods are provided dynamically by the bridge.)",
  }],
]);

export { functions as luaFunctions };

export const luaModule: ModuleDefinition = {
  name: 'lua',
  functions,
  documentation: `## lua Module

A bridge for running Lua code from ucode (\`ucode-mod-lua\`).

\`\`\`ucode
import { create } from 'lua';
let vm = create();
\`\`\`

First available on OpenWrt **23.05** (feed package \`ucode-mod-lua\`).

**Functions:** create — returns a Lua VM handle (\`object | null\`).`,
  importValidation: {
    isValid: (name: string) => functions.has(name),
    getValidImports: () => Array.from(functions.keys()),
  },
};
