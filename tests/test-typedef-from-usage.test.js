// "Generate @typedef from usage" (0.8.2): a refactor action on an `@param {object}`
// parameter that mines the function body's member accesses into a `@typedef {object}`
// block with dotted @property lines (nested paths included) and points the @param at
// it. Types come only from usage that pins them (call → function, literal comparison /
// literal assignment → the literal's type); everything else is an honest `unknown`.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const CODE = [
  '/**',
  ' * Renders one dispatch target.',
  ' * @param {object} spec',
  ' * @param {string} name',
  ' */',
  'function action_path(spec, name) {',
  "\tif (spec?.action?.type == 'template')",
  '\t\treturn spec.action.path || name;',
  '\tspec.weight = 5;',
  '\treturn spec.resolve();',
  '}',
  "print(action_path({}, 'x'));",
].join('\n');

async function actionsAt(code, line, character) {
  const p = `/tmp/tfu-${n++}.uc`;
  await server.getDiagnostics(code, p); // prime the analysis cache
  const acts = await server.getCodeActions(p, [], line, character);
  // Both spellings: "Generate @typedef for 'x' …" and "Reuse @typedef 'Name' for 'x' …".
  return { p, mine: (acts || []).filter((a) => a.title.includes('@typedef')) };
}

test('offered on the @param {object} line, with mined nested properties', async () => {
  const { p, mine } = await actionsAt(CODE, 2, 12);
  expect(mine.length).toBe(1);
  expect(mine[0].title).toContain("'spec'");
  const edits = mine[0].edit.changes[`file://${p}`];
  expect(edits.length).toBe(2);
  const block = edits[0].newText;
  expect(block).toContain('@typedef {object} Spec');
  expect(block).toContain('@property {object} action');
  expect(block).toContain('@property {string} action.type');    // == string-literal comparison
  expect(block).toContain('@property {unknown} action.path');   // truthiness only — unpinned
  expect(block).toContain('@property {integer} weight');        // literal write
  expect(block).toContain('@property {function} resolve');      // called
  expect(edits[1].newText).toBe('Spec');                        // {object} → {Spec}
});

test('offered from the function signature too, not offered elsewhere', async () => {
  expect((await actionsAt(CODE, 5, 20)).mine.length).toBe(1);  // signature line
  expect((await actionsAt(CODE, 11, 2)).mine.length).toBe(0);  // unrelated line
});

test('not offered for a non-object @param, or when the body never dot-accesses it', async () => {
  const noObj = CODE.replace('@param {object} spec', '@param {string} spec');
  expect((await actionsAt(noObj, 2, 12)).mine.length).toBe(0);
  const noUse = [
    '/** @param {object} cfg */',
    'function noop(cfg) {',
    '\treturn cfg;',
    '}',
    'print(noop({}));',
  ].join('\n');
  expect((await actionsAt(noUse, 0, 10)).mine.length).toBe(0);
});

test('a nested function re-binding the name is excluded from mining', async () => {
  const code = [
    '/** @param {object} req */',
    'function outer(req) {',
    '\tlet inner = function (req) { return req.shadow_only; };',
    '\treturn [ req.real, inner ];',
    '}',
    'print(outer({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 0, 10);
  expect(mine.length).toBe(1);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@property {unknown} real');
  expect(block).not.toContain('shadow_only');
});

test('an existing typedef name forces an alternate name', async () => {
  const code = [
    '/** @typedef {object} Spec */',
    '',
    '/** @param {object} spec */',
    'function pick(spec) {',
    '\treturn spec.item;',
    '}',
    'print(pick({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 2, 8);
  expect(mine.length).toBe(1);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@typedef {object} PickSpec');
});

test('bracket-optional `[spec]` @param form is still matched', async () => {
  const code = [
    '/** @param {object} [spec] */',
    'function pick(spec) {',
    '\treturn spec?.item;',
    '}',
    'print(pick());',
  ].join('\n');
  expect((await actionsAt(code, 0, 10)).mine.length).toBe(1);
});

test('a computed link ends the nameable path', async () => {
  const code = [
    '/** @param {object} spec */',
    'function first(spec) {',
    '\treturn spec.list[0].x;',
    '}',
    'print(first({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 0, 10);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@property {unknown} list');
  expect(block).not.toContain('list.x');
});

test('offered on an object-literal method (the rpcd `call: function(req)` shape)', async () => {
  const code = [
    'function podman_request(m, p) { return { m, p }; }',
    'const methods = {',
    '\tlist: {',
    '\t\t/**',
    '\t\t * @param {object} req',
    '\t\t */',
    '\t\tcall: function(req) {',
    "\t\t\tif (req.args.query && req.args.query !== '')",
    "\t\t\t\treturn podman_request('GET', req.args.query);",
    '\t\t\treturn null;',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.list.call({ args: {} }));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 4, 14);
  expect(mine.length).toBe(1);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@typedef {object} Req');
  expect(block).toContain('@property {object} args');
  expect(block).toContain('@property {string} args.query'); // pinned by the !== '' comparison
  expect(block.startsWith('\t\t/**')); // indented like its JSDoc
});

test('offered on `let f = function` and `obj.f = function` forms', async () => {
  const declForm = [
    '/** @param {object} cfg */',
    'let reader = function (cfg) {',
    '\treturn cfg.path;',
    '};',
    'print(reader({}));',
  ].join('\n');
  expect((await actionsAt(declForm, 0, 8)).mine.length).toBe(1);
  const asgForm = [
    'let hooks = {};',
    '/** @param {object} ev */',
    'hooks.on_boot = function (ev) {',
    '\treturn ev.reason;',
    '};',
    'print(hooks);',
  ].join('\n');
  expect((await actionsAt(asgForm, 1, 8)).mine.length).toBe(1);
});

test('with NO JSDoc at all, the action scaffolds typedef + @param from scratch', async () => {
  // The real rpcd shape: bare `call: function(req)` with no annotations anywhere.
  const code = [
    'function podman_request(m, p) { return { m, p }; }',
    'const methods = {',
    '\tcontainers_list: {',
    "\t\targs: { query: '' },",
    '\t\tcall: function(req) {',
    "\t\t\tif (req.args.query && req.args.query !== '')",
    "\t\t\t\treturn podman_request('GET', req.args.query);",
    '\t\t\treturn null;',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.containers_list.call({ args: {} }));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 4, 20); // cursor on the bare `call: function(req)` line
  expect(mine.length).toBe(1);
  const edits = mine[0].edit.changes[`file://${p}`];
  expect(edits.length).toBe(2);
  expect(edits[0].newText).toContain('@typedef {object} Req');
  expect(edits[0].newText).toContain('@property {string} args.query');
  expect(edits[1].newText).toContain('@param {Req} req'); // the freshly created JSDoc
  expect(edits[1].newText.startsWith('\t\t/**')).toBe(true); // indented like the call line
});

test('a JSDoc that never mentions the param gets a @param line appended', async () => {
  const code = [
    '/**',
    ' * Reads one entry.',
    ' */',
    'function read_entry(cfg) {',
    '\treturn cfg.path;',
    '}',
    'print(read_entry({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 1, 4);
  expect(mine.length).toBe(1);
  const edits = mine[0].edit.changes[`file://${p}`];
  const appended = edits.find((e) => e.newText.includes('@param {Cfg} cfg'));
  expect(appended).toBeTruthy();
  expect(appended.range.start.line).toBe(2); // inserted before the closing */ line
});

test('rpcd collision fallback names the typedef after the ENCLOSING method, not `call`', async () => {
  const code = [
    '/** @typedef {object} Req */',
    'const methods = {',
    '\tcontainer_inspect: {',
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args;',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.container_inspect.call({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 3, 10);
  expect(mine.length).toBe(1);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@typedef {object} ContainerInspectReq');
});

test('rpcd `args` example object seeds property types usage cannot pin', async () => {
  // `args: { id: '' }` declares the ubus arg types by example — '' means string, so
  // `req.args.id` types string even though the body usage alone would say unknown.
  // NOTE: ucode parses bare object keys as string LITERALS, not Identifiers — the
  // seed detection must accept both (propertyKeyName), or it silently matches nothing.
  const code = [
    'const methods = {',
    '\tcontainer_inspect: {',
    "\t\targs: { id: '', count: 0, verbose: false },",
    '\t\tcall: function(req) {',
    '\t\t\treturn [ req.args.id, req.args.count, req.args.verbose ];',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.container_inspect.call({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 3, 20);
  expect(mine.length).toBe(1);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@property {string} args.id');
  expect(block).toContain('@property {integer} args.count');
  expect(block).toContain('@property {boolean} args.verbose');
});

test('sibling seeding is name-general — no args/call convention required', async () => {
  // Same shape, different names: the body reads `cfg.params.retries`, the sibling is
  // literally named `params`, the function property is `handler`. The name link is
  // discovered from the code, so it seeds exactly like rpcd's args/call does.
  const code = [
    'const service = {',
    '\trestart_task: {',
    '\t\tparams: { retries: 0, unit: "" },',
    '\t\thandler: function(cfg) {',
    '\t\t\treturn cfg.params.retries + length(cfg.params.unit);',
    '\t\t},',
    '\t},',
    '};',
    'print(service.restart_task.handler({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 3, 20);
  expect(mine.length).toBe(1);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@property {integer} params.retries');
  expect(block).toContain('@property {string} params.unit');
});

test('declared-but-unread sibling keys are folded into the typedef', async () => {
  // The sibling declaration is the request contract: `force` belongs in the typedef
  // even though this body never reads it. The link (body reads req.args.…) still
  // gates the fold — an unlinked sibling contributes nothing.
  const code = [
    'const methods = {',
    '\tcontainer_remove: {',
    "\t\targs: { id: '', force: false },",
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args.id;',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.container_remove.call({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 3, 20);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@property {string} args.id');
  expect(block).toContain('@property {boolean} args.force'); // declared, unread, still typed
});

test('a base read only as a whole value upgrades to object when keys fold in', async () => {
  const code = [
    'const methods = {',
    '\tcontainer_kill: {',
    "\t\targs: { signal: '' },",
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args;',   // whole-value read — args would mine as an unknown leaf
    '\t\t},',
    '\t},',
    '};',
    'print(methods.container_kill.call({}));',
  ].join('\n');
  const { p, mine } = await actionsAt(code, 3, 20);
  const block = mine[0].edit.changes[`file://${p}`][0].newText;
  expect(block).toContain('@property {object} args');
  expect(block).toContain('@property {string} args.signal');
});

test('an identical existing shape is REUSED instead of duplicated', async () => {
  const code = [
    'const methods = {',
    '\tcontainer_start: {',
    "\t\targs: { id: '' },",
    '\t\t/**',
    '\t\t * @typedef {object} IdReq',
    '\t\t * @property {object} args',
    '\t\t * @property {string} args.id',
    '\t\t */',
    '\t\t/**',
    '\t\t * @param {IdReq} req',
    '\t\t */',
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args.id;',
    '\t\t},',
    '\t},',
    '\tcontainer_stop: {',
    "\t\targs: { id: '' },",
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args.id;',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.container_start.call({}), methods.container_stop.call({}));',
  ].join('\n');
  const line = code.split('\n').findIndex((l, i) => i > 15 && l.includes('call: function(req)'));
  const { p, mine } = await actionsAt(code, line, 14);
  expect(mine.length).toBe(1);
  expect(mine[0].title).toContain("Reuse @typedef 'IdReq'");
  const edits = mine[0].edit.changes[`file://${p}`];
  expect(edits.length).toBe(1); // just the fresh @param JSDoc — no duplicate typedef block
  expect(edits[0].newText).toContain('@param {IdReq} req');
});

test('an overlapping shape WIDENS the existing typedef — one shared Req per dispatcher', async () => {
  // The user-directed model: containers_list already owns Req{args, args.query};
  // container_inspect (args: { id: '' }, reads args.id) should EXTEND Req with
  // args.id and point its own @param at Req — not mint ContainerInspectReq.
  const code = [
    'const methods = {',
    '\tcontainers_list: {',
    "\t\targs: { query: '' },",
    '\t\t/**',
    '\t\t * @typedef {object} Req',
    '\t\t * @property {object} args',
    '\t\t * @property {string} args.query',
    '\t\t */',
    '\t\t/**',
    '\t\t * @param {Req} req',
    '\t\t */',
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args.query;',
    '\t\t},',
    '\t},',
    '\tcontainer_inspect: {',
    "\t\targs: { id: '' },",
    '\t\tcall: function(req) {',
    '\t\t\treturn req.args.id;',
    '\t\t},',
    '\t},',
    '};',
    'print(methods.containers_list.call({}), methods.container_inspect.call({}));',
  ].join('\n');
  const lines = code.split('\n');
  const line = lines.findIndex((l, i) => i > 15 && l.includes('call: function(req)'));
  const { p, mine } = await actionsAt(code, line, 14);
  expect(mine.length).toBe(1);
  expect(mine[0].title).toContain("Extend @typedef 'Req'");
  expect(mine[0].title).toContain('args.id');
  const edits = mine[0].edit.changes[`file://${p}`];
  // Edit 1: the new @property line inserted into the EXISTING Req block (before its */).
  const widen = edits.find((e) => e.newText.includes('@property {string} args.id'));
  expect(widen).toBeTruthy();
  expect(widen.range.start.line).toBe(7); // the Req block's closing-*/ line
  // Edit 2: this method's fresh JSDoc pointing at Req — no new typedef block anywhere.
  expect(edits.some((e) => e.newText.includes('@param {Req} req'))).toBe(true);
  expect(edits.some((e) => e.newText.includes('@typedef'))).toBe(false);
});

test('zero-overlap and type-conflict shapes still generate their own typedef', async () => {
  // Disjoint paths: nothing links the shapes — no merge.
  const disjoint = [
    '/**',
    ' * @typedef {object} ActionSpec',
    ' * @property {object} action',
    ' * @property {string} action.path',
    ' */',
    '/** @param {object} req */',
    'function handler(req) {',
    '\treturn req.args.id;',
    '}',
    'print(handler({}));',
  ].join('\n');
  const r1 = await actionsAt(disjoint, 5, 8);
  expect(r1.mine[0].title).toContain('Generate @typedef');
  // Conflicting concrete types on a shared path: merging would falsify one side.
  const conflict = [
    '/**',
    ' * @typedef {object} Req',
    ' * @property {object} args',
    ' * @property {integer} args.id',
    ' */',
    '/** @param {object} req */',
    'function handler(req) {',
    "\tif (req.args.id === 'x') return 1;",
    '\treturn 0;',
    '}',
    'print(handler({}));',
  ].join('\n');
  const r2 = await actionsAt(conflict, 5, 8);
  expect(r2.mine[0].title).toContain('Generate @typedef');
  expect(r2.mine[0].edit.changes[`file://${r2.p}`][0].newText).not.toContain('{object} Req');
});

test('UC7009 hint fires on a bare-object @param and carries the fix, preferred', async () => {
  const p = `/tmp/tfu-${n++}.uc`;
  const d = await server.getDiagnostics(CODE, p);
  const hint = (d || []).find((x) => String(x.code) === 'UC7009');
  expect(hint).toBeTruthy();
  // Information, not Hint — VS Code hides Hints from the Problems panel, which
  // buried the suggestion for the exact author it was aimed at.
  expect(hint.severity).toBe(3);
  expect(hint.message).toContain("'spec'");
  const acts = await server.getCodeActions(p, [hint], hint.range.start.line, hint.range.start.character + 2);
  const fix = (acts || []).find((a) => a.title.includes('Generate @typedef'));
  expect(fix).toBeTruthy();
  expect(fix.kind).toBe('quickfix');
  expect(fix.isPreferred).toBe(true);
  expect(fix.diagnostics.length).toBe(1);
});

test('no UC7009 when the body never reads members, or the type is not bare object', async () => {
  const noUse = '/** @param {object} cfg */\nfunction idf(cfg) {\n\treturn cfg;\n}\nprint(idf({}));\n';
  const d1 = await server.getDiagnostics(noUse, `/tmp/tfu-${n++}.uc`);
  expect((d1 || []).filter((x) => String(x.code) === 'UC7009')).toEqual([]);
  const typed = '/** @param {Spec} spec */\n/** @typedef {object} Spec\n * @property {object} action */\nfunction g(spec) {\n\treturn spec.action;\n}\nprint(g({}));\n';
  const d2 = await server.getDiagnostics(typed, `/tmp/tfu-${n++}.uc`);
  expect((d2 || []).filter((x) => String(x.code) === 'UC7009')).toEqual([]);
});

test('UC7003 on a bare strict-mode function offers the typedef scaffold alongside Add JSDoc', async () => {
  const code = "'use strict';\nfunction handler(req) {\n\treturn req.args;\n}\nprint(handler({}));\n";
  const p = `/tmp/tfu-${n++}.uc`;
  const d = await server.getDiagnostics(code, p);
  const uc7003 = (d || []).find((x) => String(x.code) === 'UC7003');
  expect(uc7003).toBeTruthy();
  const acts = await server.getCodeActions(p, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
  const titles = (acts || []).map((a) => a.title);
  expect(titles.some((t) => t.includes('Generate @typedef'))).toBe(true);
  expect(titles.some((t) => t.includes('Add JSDoc'))).toBe(true);
});

test('the applied edit round-trips: clean analysis and typedef-fed hovers', async () => {
  const generated = [
    '/**',
    ' * @typedef {object} Spec',
    ' * @property {object} action',
    ' * @property {string} action.type',
    ' * @property {unknown} action.path',
    ' * @property {integer} weight',
    ' * @property {function} resolve',
    ' */',
    '',
    ...CODE.split('\n').map((l) => l.replace('@param {object} spec', '@param {Spec} spec')),
  ].join('\n');
  const p = `/tmp/tfu-${n++}.uc`;
  const d = await server.getDiagnostics(generated, p);
  expect((d || []).map((x) => `${x.code} ${x.message}`)).toEqual([]);
  const line = generated.split('\n').findIndex((l) => l.includes('action?.type'));
  const h = await server.getHover(generated, p, line, generated.split('\n')[line].indexOf('type ==') + 1);
  expect(h?.contents?.value).toContain('`string`');
});

test('an inline object shape resolves standalone and inside a union (UC7001 fix)', async () => {
  // The real-world shape from wwand-style code: @returns {{a:string,b:string}|null}.
  const code = [
    '/**',
    ' * @param {string} buf',
    ' * @returns {{header_buf:string, body_remainder:string}|null}',
    ' */',
    'export function read_headers(buf) {',
    '\tlet sep = index(buf, "X");',
    "\tif (type(sep) !== 'int' || sep < 0) return null;",
    '\treturn { header_buf: substr(buf, 0, sep), body_remainder: substr(buf, sep + 4) };',
    '};',
    'print(read_headers(""));',
  ].join('\n');
  const d = await server.getDiagnostics(code, `/tmp/tfu-${n++}.uc`);
  expect((d || []).filter((x) => String(x.code) === 'UC7001')).toEqual([]);
});

test("UC7001 suggests near-miss known types and its fix rewrites just the name", async () => {
  // The socket handle type is literally `socket` — `?Socket` is one case-fix away.
  const code = [
    "import * as socket from 'socket';",
    '/** @returns {?Socket} connected socket, or null on failure */',
    'export function connect() {',
    '\tlet sock = socket.create(socket.AF_UNIX, socket.SOCK_STREAM);',
    '\treturn sock || null;',
    '};',
    'print(connect());',
  ].join('\n');
  const p = `/tmp/tfu-${n++}.uc`;
  const d = await server.getDiagnostics(code, p);
  const uc = (d || []).find((x) => String(x.code) === 'UC7001');
  expect(uc.message).toContain("did you mean '?socket'?");
  const acts = await server.getCodeActions(p, [uc], uc.range.start.line, uc.range.start.character + 2);
  const fix = (acts || []).find((a) => a.title === "Change type to '?socket'");
  expect(fix.isPreferred).toBe(true);
  const edit = fix.edit.changes[`file://${p}`][0];
  expect(edit.newText).toBe('socket');
  // Replaces ONLY the name — the `?` nullable sugar survives.
  expect(edit.range.start.character).toBe(15);
  expect(edit.range.end.character).toBe(21);
});

test('UC7001 with no plausible near-miss stays suggestion-free', async () => {
  const code = '/** @param {CompletelyMadeUpThing} x */\nfunction f(x) {\n\treturn x;\n}\nprint(f(1));\n';
  const d = await server.getDiagnostics(code, `/tmp/tfu-${n++}.uc`);
  const uc = (d || []).find((x) => String(x.code) === 'UC7001');
  expect(uc.message).not.toContain('did you mean');
});

test('?socket resolves as a real union — null returns covered, handle identity kept', async () => {
  // The known-object annotation used to resolve to the module-record shape, which
  // widenWithNull returns unchanged — so `?socket` silently lost its null and every
  // `return null` under it drew a UC7005 "does not cover" warning.
  const code = [
    "import * as socket from 'socket';",
    'let _parsed = null;',
    '/** @returns {?socket} connected socket, or null on failure */',
    'export function connect() {',
    '\tif (!_parsed)',
    '\t\treturn null;',
    '\tlet sock = socket.create(socket.AF_UNIX, socket.SOCK_STREAM);',
    '\tif (!sock) return null;',
    '\treturn sock;',
    '};',
    'let conn = connect();',
    'print(conn);',
  ].join('\n');
  const p = `/tmp/tfu-${n++}.uc`;
  const d = await server.getDiagnostics(code, p);
  expect((d || []).filter((x) => String(x.code) === 'UC7005')).toEqual([]);
  const line = code.split('\n').findIndex((l) => l.includes('conn = '));
  const h = await server.getHover(code, p, line, code.split('\n')[line].indexOf('conn') + 1);
  expect(h?.contents?.value).toContain('`socket | null`');
});

test('a user-defined never-returning terminator narrows guards during the main pass', async () => {
  // `cleanup(){ …; exit(); }` + `if (!sock) { log(); cleanup(1); }` — the CFG
  // never-returns fixpoint runs AFTER the visit, so blockAlwaysTerminates saw an
  // unstamped symbol and the fall-through kept its null (podman pull-worker FPs).
  // Hoist-time syntactic stamping closes the gap; a body containing ANY return
  // stays unstamped (conservative).
  const code = [
    "import * as socket from 'socket';",
    'function term(code) { print(code); exit(code ?? 0); }',
    'function fatal(msg) { print(msg); term(1); }',   // chains resolve via the fixpoint
    '/** @returns {?socket} */',
    'function connect() {',
    '\tlet s = socket.create(socket.AF_INET, socket.SOCK_STREAM);',
    '\treturn s || null;',
    '};',
    'let sock = connect();',
    "if (!sock) { fatal('no sock'); }",
    "sock.send('hi');",
    'print(sock);',
  ].join('\n');
  const d = await server.getDiagnostics(code, `/tmp/tfu-${n++}.uc`);
  expect((d || []).filter((x) => String(x.code).startsWith('UC5'))).toEqual([]);
  // A would-be terminator that CAN return must not be stamped.
  const soft = code.replace('function fatal(msg) { print(msg); term(1); }',
    'function fatal(msg) { if (msg == "ignore") return; term(1); }');
  const d2 = await server.getDiagnostics(soft, `/tmp/tfu-${n++}.uc`);
  expect((d2 || []).some((x) => String(x.code) === 'UC5006')).toBe(true);
});
