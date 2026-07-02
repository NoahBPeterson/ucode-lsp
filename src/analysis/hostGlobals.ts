// Known host-injected globals: names a C host (or its ucode runtime) places in the global
// scope before user code runs, so they are never assigned anywhere in source. The LSP would
// otherwise flag a read as UC1001 ("Undefined variable"). These are "explained" → Case 1.
//
// Conservative + additive: only names with a clear, documented injection site belong here.
// Developers extend this per-project with a JSDoc `@global name` (optionally `@global
// {type} name`) — see docs/global-scope-soundness.md. Coarse types only (existence + kind);
// the host provides no signatures.

/** name → coarse ucode type string (parseable by TypeChecker.parseReturnTypePublic). */
export const KNOWN_HOST_GLOBALS: ReadonlyMap<string, string> = new Map([
  // uhttpd's ucode handler runtime injects the request/response handle as `uhttpd`
  // (docroot/send/recv/urldecode/…). Present in `*.uc` loaded as a uhttpd ucode handler.
  ['uhttpd', 'object'],
]);

export function isKnownHostGlobal(name: string): boolean {
  return KNOWN_HOST_GLOBALS.has(name);
}
