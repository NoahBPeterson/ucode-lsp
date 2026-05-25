// E2e member-completion coverage for object VARIABLES (not modules/object-types),
// driven through the spawned server. Before this, `obj.` / `e.` returned nothing —
// completion.ts ignored a symbol's inferred propertyTypes. Now it surfaces them,
// scope-aware (catch params, function-local objects included).
//
// NB: createLSPTestServer.getCompletions resolves with a bare CompletionItem[]
// (the server's handleCompletion returns an array), NOT a {items} CompletionList.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let getCompletions;
const labelsOf = (c) => (Array.isArray(c) ? c : (c && c.items) || []).map((i) => i.label);

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getCompletions = server.getCompletions;
});

describe('Object-variable property completion (e2e)', () => {
  test('top-level object literal: o. → its properties', async () => {
    const code = 'let o = { alpha: 1, beta: "x" };\no.\n';
    const labels = labelsOf(await getCompletions(code, '/tmp/opc-top.uc', 1, 2));
    expect(labels.sort()).toEqual(['alpha', 'beta']);
  });

  test('function-local object (scoped): loc. → its properties', async () => {
    const code = 'function f() {\n  let loc = { aa: 1, bb: 2 };\n  loc.\n}\n';
    const labels = labelsOf(await getCompletions(code, '/tmp/opc-local.uc', 2, 6));
    expect(labels.sort()).toEqual(['aa', 'bb']);
  });

  test('catch param (scoped exception object): e. → message/stacktrace/type', async () => {
    const code = 'try {\n  risky();\n} catch (e) {\n  e.\n}\n';
    const labels = labelsOf(await getCompletions(code, '/tmp/opc-exc.uc', 3, 4));
    for (const p of ['message', 'stacktrace', 'type']) {
      expect(labels).toContain(p);
    }
  });

  test('catch param with a different name: err. → exception properties', async () => {
    const code = 'try {\n  risky();\n} catch (err) {\n  err.\n}\n';
    const labels = labelsOf(await getCompletions(code, '/tmp/opc-exc2.uc', 3, 6));
    expect(labels).toContain('message');
  });

  test('direct call chain on a local factory: mk(). → its return properties', async () => {
    const code = 'function mk() { return { p: 1, q: "s" }; }\nmk().\n';
    const labels = labelsOf(await getCompletions(code, '/tmp/opc-callchain.uc', 1, 5));
    expect(labels.sort()).toEqual(['p', 'q']);
  });

  test('completion items are typed properties (kind=Property, type in detail)', async () => {
    const code = 'let o = { count: 5, name: "n" };\no.\n';
    const c = await getCompletions(code, '/tmp/opc-detail.uc', 1, 2);
    const list = Array.isArray(c) ? c : (c && c.items) || [];
    const count = list.find((i) => i.label === 'count');
    expect(count).toBeDefined();
    expect(count.kind).toBe(10); // CompletionItemKind.Property
    expect(count.detail).toContain('integer');
  });
});
