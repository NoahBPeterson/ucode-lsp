// Known host-injected globals: names a C host (or its ucode runtime) places in the global
// scope before user code runs, so they are never assigned anywhere in source. The LSP would
// otherwise flag a read as UC1001 ("Undefined variable"). These are "explained" → Case 1.
//
// Conservative + additive: only names with a clear, documented injection site belong here.
// Developers extend this per-project with a JSDoc `@global name` (optionally `@global
// {type} name`) — see docs/global-scope-soundness.md. Coarse types only (existence + kind);
// the host provides no signatures.

/** name → coarse ucode type string (parseable by TypeChecker.parseReturnTypePublic).
 *  Names here are suppressed in EVERY file. `uhttpd` used to live here, but it only exists in
 *  a uhttpd HANDLER — seeding it everywhere let a non-handler script reference `uhttpd` with
 *  no UC1001 (report FN-5). It is now declared, TYPED (uhttpd object handle), and gated to
 *  handler context in SemanticAnalyzer.declareUhttpdAmbient. */
export const KNOWN_HOST_GLOBALS: ReadonlyMap<string, string> = new Map([]);

export function isKnownHostGlobal(name: string): boolean {
  return KNOWN_HOST_GLOBALS.has(name);
}

/** Names a C host INVOKES as an entry point (the inverse of KNOWN_HOST_GLOBALS, which the
 *  host injects). A handler registers one by assigning `global.<name> = <callable>`; the host
 *  then calls it, so it is NOT dead code even when nothing in the file references it — a
 *  `global.<name>` binding must be exempt from the UC1006 "declared but never used" warning.
 *  Conservative: only well-documented host callbacks belong here. */
export const HOST_ENTRY_POINT_CALLBACKS: ReadonlySet<string> = new Set([
  // uhttpd's ucode handler runtime looks up `handle_request` in the VM scope and calls it
  // per request (uhttpd/ucode.c: UH_UCODE_CB). The contract is `global.handle_request = fn`.
  'handle_request',
]);

export function isHostEntryPointCallback(name: string): boolean {
  return HOST_ENTRY_POINT_CALLBACKS.has(name);
}
