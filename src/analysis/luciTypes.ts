/**
 * The LuCI runtime environment ambient globals — the names every LuCI ucode template
 * (`…/ucode/template/*.ut`) and controller (`…/ucode/controller/*.uc`) receives at render
 * time WITHOUT importing anything.
 *
 * How the runtime builds them (all evidence in the LuCI source, luci-base):
 *   • dispatcher.uc `dispatch()` constructs `LuCIRuntime({ http, ubus, uci, ctx, version,
 *     config, dispatcher: {…}, striptags, entityencode, _: fn, N_: fn })`.
 *   • runtime.uc chains that env onto global — `scopes: [ proto(env, global) ]` — and its
 *     factory adds `media`, `theme`, `resource`, `pkgs_update_time`, and `include`
 *     (= render_any, the template-root include — see luciEnv.ts).
 *   • Templates render via `call(tmplfunc, null, scope)` with `scope = proto(scope ?? {},
 *     env-chain)`, so every env name is a free global inside them.
 *
 * Modeled here as two object registries (`luci.http` for the request/response object,
 * `luci.dispatcher` for the dispatcher helper table) plus the LUCI_ENV_GLOBALS declaration
 * table consumed by SemanticAnalyzer.detectAndDeclareLuciEnv. `ubus`/`uci` reuse the
 * existing `ubus.connection`/`uci.cursor` registries (dispatcher.uc: `connect()`/`cursor()`).
 *
 * Signatures below are read from luci-base ucode/http.uc and ucode/dispatcher.uc bodies.
 * Both objects are `openMembers`: they are plain ucode objects the runtime (and apps)
 * extend, so an unknown member resolves to `unknown`, not UC5004.
 */
import type { FunctionSignature } from './moduleTypes';
import type { ObjectTypeDefinition } from './registryFactory';

const arg = (name: string, type: string, optional = false): FunctionSignature['parameters'][number] =>
  ({ name, type, optional });

// ── luci.http — the per-request HTTP object (luci-base ucode/http.uc prototype) ──────────
const luciHttpMethods = new Map<string, FunctionSignature>([
  ['formvalue', { name: 'formvalue', parameters: [arg('name', 'string', true), arg('noparse', 'boolean', true)], returnType: 'string | array | object | null',
    description: 'The parsed value of the named form/query parameter (a repeated parameter yields an array; a file upload an object), or the whole parameter table when `name` is omitted. Null when the parameter is absent.' }],
  ['formvaluetable', { name: 'formvaluetable', parameters: [arg('prefix', 'string')], returnType: 'object',
    description: 'All form/query parameters whose name starts with `prefix + "."`, as a `{ suffix: value }` object (values stringified).' }],
  ['content', { name: 'content', parameters: [], returnType: 'string | null',
    description: 'The raw request body (input is parsed on first access). Null when there is none.' }],
  ['getcookie', { name: 'getcookie', parameters: [arg('name', 'string')], returnType: 'string | null',
    description: 'The named cookie from the `HTTP_COOKIE` request header, or null.' }],
  ['getenv', { name: 'getenv', parameters: [arg('name', 'string', true)], returnType: 'string | object | null',
    description: 'A CGI environment variable (e.g. `PATH_INFO`, `SCRIPT_NAME`, `REQUEST_METHOD`), or the whole environment object when `name` is omitted. Null when the variable is absent.' }],
  ['setfilehandler', { name: 'setfilehandler', parameters: [arg('callback', 'function')], returnType: 'null',
    description: 'Install the file-upload sink callback `(field, chunk, eof)`. Dies on a non-callable argument.' }],
  ['close', { name: 'close', parameters: [], returnType: 'null',
    description: 'Flush headers and mark the response closed (further template output is dropped by the runtime).' }],
  ['header', { name: 'header', parameters: [arg('key', 'string'), arg('value', 'string')], returnType: 'null',
    description: 'Set a response header (keys are lower-cased). Must happen before output is written.' }],
  ['prepare_content', { name: 'prepare_content', parameters: [arg('mime', 'string')], returnType: 'null',
    description: 'Set the response Content-Type (with XHTML/JSON compatibility fixups) unless headers are already out.' }],
  ['status', { name: 'status', parameters: [arg('code', 'integer', true), arg('message', 'string', true)], returnType: 'null',
    description: 'Set the HTTP response status (defaults to `200 OK`). Must happen before output is written.' }],
  ['write_headers', { name: 'write_headers', parameters: [], returnType: 'null',
    description: 'Emit the accumulated status line + headers now (idempotent — tracked via `eoh`).' }],
  ['write', { name: 'write', parameters: [arg('content', 'string')], returnType: 'boolean | null',
    description: 'Write raw response data (headers are flushed first if needed). Null/false once the response is closed or content is empty.' }],
  ['redirect', { name: 'redirect', parameters: [arg('url', 'string')], returnType: 'null',
    description: 'Send a `302 Found` redirect to `url` and close the response.' }],
  ['write_json', { name: 'write_json', parameters: [arg('value', 'any')], returnType: 'null',
    description: 'Serialize `value` as JSON and write it as the response body.' }],
  ['urlencode', { name: 'urlencode', parameters: [arg('value', 'string')], returnType: 'string | null',
    description: 'Percent-encode a string for safe use in a URL. Null on a null input.' }],
  ['urldecode', { name: 'urldecode', parameters: [arg('value', 'string')], returnType: 'string | null',
    description: 'Decode a percent-encoded URL component. Null on a null input.' }],
  // value-members (assigned on the request object by the runtime)
  ['eoh', { name: 'eoh', parameters: [], returnType: 'boolean',
    description: 'True once the response headers have been written (end-of-headers).' }],
  ['closed', { name: 'closed', parameters: [], returnType: 'boolean',
    description: 'True once the response has been closed — the LuCI runtime stops emitting template output.' }],
]);

/** Members of `http` that are value properties, not callable methods (hover formatting). */
export const LUCI_HTTP_VALUE_MEMBERS = new Set<string>(['eoh', 'closed']);

// ── luci.dispatcher — the `dispatcher` helper table from dispatcher.uc ───────────────────
const luciDispatcherMethods = new Map<string, FunctionSignature>([
  ['build_url', { name: 'build_url', parameters: [arg('path', 'string', true)], returnType: 'string',
    description: 'Join URL segments onto the CGI `SCRIPT_NAME` base (`/cgi-bin/luci/…`). Segments with unsafe characters are dropped. Variadic.' }],
  ['randomid', { name: 'randomid', parameters: [arg('num_bytes', 'integer')], returnType: 'string | null',
    description: '`num_bytes` of `/dev/urandom` hex-encoded (2 chars per byte), or null when the read comes up short.' }],
  ['lookup', { name: 'lookup', parameters: [arg('segments', 'string', true)], returnType: 'object | null',
    description: 'Resolve menu path segments (each may be `a/b/c`) to `{ node, url }`, or null when no menu node matches. Variadic.' }],
  ['menu_json', { name: 'menu_json', parameters: [arg('acl', 'object', true)], returnType: 'object | null',
    description: 'The merged `/usr/share/luci/menu.d` menu tree (cached in /tmp/luci-indexcache).' }],
  ['error404', { name: 'error404', parameters: [arg('msg', 'string', true)], returnType: 'boolean',
    description: 'Render the 404 page (falls back to plain text). Returns false.' }],
  ['error500', { name: 'error500', parameters: [arg('msg', 'string'), arg('ex', 'object', true)], returnType: 'boolean',
    description: 'Render the 500 page (or plain text mid-response). Returns false.' }],
  ['is_authenticated', { name: 'is_authenticated', parameters: [arg('auth', 'object', true)], returnType: 'object | null',
    description: 'The session object for the first authentication method in `auth.methods` that verifies, or null.' }],
  ['rollback_pending', { name: 'rollback_pending', parameters: [], returnType: 'object | boolean',
    description: '`{ remaining, session, token }` when a config-apply rollback timer is armed, else false.' }],
  ['load_luabridge', { name: 'load_luabridge', parameters: [arg('optional', 'boolean', true)], returnType: 'object | null',
    description: 'The Lua runtime bridge module, loading it on first use. With `optional`, null when luci-lua-runtime is not installed (otherwise a missing bridge raises).' }],
  // value-member
  ['lang', { name: 'lang', parameters: [], returnType: 'string',
    description: 'The negotiated UI language code for this request (e.g. "en").' }],
]);

/** Members of `dispatcher` that are value properties, not callable methods. */
export const LUCI_DISPATCHER_VALUE_MEMBERS = new Set<string>(['lang']);

export const luciHttpObjectType: ObjectTypeDefinition = {
  typeName: 'luci.http', openMembers: true, methods: luciHttpMethods,
  formatDoc: (_n, sig) => LUCI_HTTP_VALUE_MEMBERS.has(sig.name)
    ? `**http.${sig.name}**: \`${sig.returnType}\`\n\n${sig.description}`
    : `**http.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

export const luciDispatcherObjectType: ObjectTypeDefinition = {
  typeName: 'luci.dispatcher', openMembers: true, methods: luciDispatcherMethods,
  formatDoc: (_n, sig) => LUCI_DISPATCHER_VALUE_MEMBERS.has(sig.name)
    ? `**dispatcher.${sig.name}**: \`${sig.returnType}\`\n\n${sig.description}`
    : `**dispatcher.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

// ── The env declaration table (consumed by SemanticAnalyzer.detectAndDeclareLuciEnv) ─────
/** How an env name is typed when seeded. */
export type LuciEnvShape =
  | { kind: 'objectType'; objectType: 'luci.http' | 'luci.dispatcher' | 'ubus.connection' | 'uci.cursor' }
  | { kind: 'plain'; type: 'object' | 'string' | 'integer' | 'boolean' }
  | { kind: 'fn'; returnType: 'string' | 'null'; params: string[] };

export const LUCI_ENV_GLOBALS: ReadonlyArray<{ name: string; shape: LuciEnvShape; doc: string }> = [
  { name: 'http', shape: { kind: 'objectType', objectType: 'luci.http' },
    doc: 'The per-request HTTP object (luci.http) — form values, CGI env, headers, response output.' },
  { name: 'ubus', shape: { kind: 'objectType', objectType: 'ubus.connection' },
    doc: 'The shared ubus connection the dispatcher opened (`connect()`).' },
  { name: 'uci', shape: { kind: 'objectType', objectType: 'uci.cursor' },
    doc: 'The shared uci cursor the dispatcher opened (`cursor()`).' },
  { name: 'dispatcher', shape: { kind: 'objectType', objectType: 'luci.dispatcher' },
    doc: 'Dispatcher helpers — build_url, menu_json, lookup, error404/error500, lang, ….' },
  { name: 'ctx', shape: { kind: 'plain', type: 'object' },
    doc: 'The per-request dispatch context (request path, authsession/authuser, ACLs, matched menu node).' },
  { name: 'version', shape: { kind: 'plain', type: 'object' },
    doc: 'Version info: `{ luciname, luciversion, distname, distversion }` (from luci.version + /etc/os-release).' },
  { name: 'config', shape: { kind: 'plain', type: 'object' },
    doc: 'LuCI configuration: `{ main, apply }` — the uci `luci.main` / `luci.apply` sections.' },
  { name: 'media', shape: { kind: 'plain', type: 'string' },
    doc: 'URL base of the active theme (uci `luci.main.mediaurlbase`, with fallback probing).' },
  { name: 'theme', shape: { kind: 'plain', type: 'string' },
    doc: 'Basename of the active theme (e.g. "bootstrap").' },
  { name: 'resource', shape: { kind: 'plain', type: 'string' },
    doc: 'URL base for static resources (uci `luci.main.resourcebase`, typically "/luci-static/resources").' },
  { name: 'pkgs_update_time', shape: { kind: 'plain', type: 'integer' },
    doc: 'mtime of the package database — used to cache-bust static resource URLs.' },
  // env members ASSIGNED after construction (dispatcher.uc dispatch() / runtime.uc) —
  // just as ambient in every template as the constructor keys above.
  { name: 'dispatched', shape: { kind: 'plain', type: 'object' },
    doc: 'The resolved menu node for this request (`runtime.env.dispatched = resolved.node`).' },
  { name: 'requested', shape: { kind: 'plain', type: 'object' },
    doc: 'The originally requested menu node (defaults to the dispatched one).' },
  { name: 'media_error', shape: { kind: 'plain', type: 'string' },
    doc: 'The last theme-template compile error, when no theme header could be rendered.' },
  { name: 'lua_active', shape: { kind: 'plain', type: 'boolean' },
    doc: 'True once the Lua runtime bridge has been loaded for this request.' },
  { name: '_', shape: { kind: 'fn', returnType: 'string', params: ['msgid'] },
    doc: 'Translate `msgid` via the loaded catalog, falling back to `msgid` itself — always a string.' },
  { name: 'N_', shape: { kind: 'fn', returnType: 'string', params: ['count', 'singular', 'plural'] },
    doc: 'Plural-aware translate: the catalog match for `count`, falling back to `singular`/`plural`.' },
  { name: 'striptags', shape: { kind: 'fn', returnType: 'string', params: ['value'] },
    doc: 'Strip HTML tags from a value and entity-encode the rest (html module).' },
  { name: 'entityencode', shape: { kind: 'fn', returnType: 'string', params: ['value'] },
    doc: 'Encode HTML special characters (`<>&"`, non-ASCII) as entities (html module).' },
  // `include` is deliberately NOT declared: the env one (= runtime render_any) shadows the
  // builtin at render time, but the builtin model plus the template-root resolution in
  // fileResolver/luciEnv covers the same calls without hiding include()'s own diagnostics.
];

/**
 * Render-scope names LuCI's OWN machinery feeds to theme/base templates through channels
 * no static walk can see from the template's side — the Lua bridge's render scopes and
 * dispatcher paths that standalone theme repos (argon, kucat, …) can never observe.
 * Suppression-only (UC1001/UC1002; typed unknown, no symbol declared), seeded ONLY in
 * `.ut` templates inside a LuCI context. Curated from the in-tree floor analysis — every
 * name below appears free in luci-base's or a shipped theme's templates and is provided
 * at render time:
 *   header/footer:  node, css (menu node + inline stylesheet from the page's header
 *                   scope), trigger_apply/trigger_revert/rollback_token (config-apply
 *                   footer controls), https_port (redirect hint), lua_active/media_error
 *                   are already env members above.
 *   sysauth:        duser/fuser (default/failed user), auth_message/auth_html/
 *                   auth_fields/auth_assets/auth_plugin (2FA/plugin login forms).
 * Deliberately EXCLUDED: generic words like `message`/`title`/`view`/`exception` — those
 * are per-render keys the include-scope index mines where visible, and blanket-declaring
 * them would mask real typos.
 */
export const LUCI_TEMPLATE_RENDER_COMPAT_NAMES: ReadonlyArray<string> = [
  'node', 'css',
  // Page templates feed these to header/footer: `include('header', { blank_page, css })`
  // (luci-app-commands), `{ js }` script injection (Lua-era convention, still read by
  // third-party themes — fleet evidence: luci-theme-glass footer, 9 blank_page reads
  // across shipped themes).
  'blank_page', 'js',
  'trigger_apply', 'trigger_revert', 'rollback_token', 'https_port',
  'duser', 'fuser',
  'auth_message', 'auth_html', 'auth_fields', 'auth_assets', 'auth_plugin',
];
