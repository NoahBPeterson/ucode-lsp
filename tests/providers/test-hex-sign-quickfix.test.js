// E2e code-action tests for the hex-sign-split UC6005 quick fix. The UC6005 compat
// fix is dispatched per feature via diagnostic.data.feature (server.ts): the old
// unconditional "Add ';'" belonged to export-function-no-semicolon only, and applied
// to `0x1e+2` it produced the mangled `0x1e+;2`. The hex-sign feature instead inserts
// spaces around the sign, un-bonding it from the literal: `0x1e+2` → `0x1e + 2`.
// docs/done/sign-after-exponent-number-lexing.md.

import { test, expect, describe, beforeAll } from 'bun:test';
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics, getCodeActions;

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
});

// Apply insert-only TextEdits to a single-line source string.
function applyInserts(code, edits) {
  const byOffsetDesc = [...edits].sort((a, b) => b.range.start.character - a.range.start.character);
  let out = code;
  for (const e of byOffsetDesc) {
    const off = e.range.start.character;
    out = out.slice(0, off) + e.newText + out.slice(off);
  }
  return out;
}

describe('Hex-sign-split UC6005 quick fix (e2e)', () => {
  test('`0x1e+2` offers the space-separation fix and NOT "Add \';\'"', async () => {
    const code = 'let hexsum = 0x1e+2;';
    const diags = await getDiagnostics(code, '/tmp/hexfix-a.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    expect(gate).toBeDefined();
    const actions = await getCodeActions('/tmp/hexfix-a.uc', [gate], gate.range.start.line, gate.range.start.character);
    const titles = actions.map((a) => a.title);
    expect(titles.some((t) => t.startsWith('Separate the `+` with spaces'))).toBe(true);
    expect(titles.some((t) => t.startsWith("Add ';'"))).toBe(false);
    // The retarget escape hatch stays available.
    expect(titles).toContain('Target a different OpenWrt release…');
  });

  test('applying the fix yields `0x1e + 2`, not `0x1e+;2`', async () => {
    const code = 'let hexsum = 0x1e+2;';
    const diags = await getDiagnostics(code, '/tmp/hexfix-b.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    const actions = await getCodeActions('/tmp/hexfix-b.uc', [gate], gate.range.start.line, gate.range.start.character);
    const fix = actions.find((a) => a.title.startsWith('Separate the `+`'));
    expect(fix).toBeDefined();
    const edits = Object.values(fix.edit.changes)[0];
    expect(applyInserts(code, edits)).toBe('let hexsum = 0x1e + 2;');
  });

  test('`0x1e+ 2` (space already after the sign) gets only the leading space', async () => {
    const code = 'let hexsum = 0x1e+ 2;';
    const diags = await getDiagnostics(code, '/tmp/hexfix-c.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    expect(gate).toBeDefined();
    const actions = await getCodeActions('/tmp/hexfix-c.uc', [gate], gate.range.start.line, gate.range.start.character);
    const fix = actions.find((a) => a.title.startsWith('Separate the `+`'));
    const edits = Object.values(fix.edit.changes)[0];
    expect(edits.length).toBe(1);
    expect(applyInserts(code, edits)).toBe('let hexsum = 0x1e + 2;');
  });

  test('a minus sign works too: `0X1E-2` → `0X1E - 2`', async () => {
    const code = 'let h = 0X1E-2;';
    const diags = await getDiagnostics(code, '/tmp/hexfix-d.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    const actions = await getCodeActions('/tmp/hexfix-d.uc', [gate], gate.range.start.line, gate.range.start.character);
    const fix = actions.find((a) => a.title.startsWith('Separate the `-`'));
    expect(fix).toBeDefined();
    const edits = Object.values(fix.edit.changes)[0];
    expect(applyInserts(code, edits)).toBe('let h = 0X1E - 2;');
  });

  test("export-function UC6005 still offers its \"Add ';'\" fix", async () => {
    const code = 'export function f() {}\nf();\n';
    const diags = await getDiagnostics(code, '/tmp/hexfix-e.uc');
    const gate = diags.find((d) => d.code === 'UC6005');
    expect(gate).toBeDefined();
    const actions = await getCodeActions('/tmp/hexfix-e.uc', [gate], gate.range.start.line, gate.range.start.character);
    const titles = actions.map((a) => a.title);
    expect(titles.some((t) => t.startsWith("Add ';'"))).toBe(true);
    expect(titles.some((t) => t.startsWith('Separate the'))).toBe(false);
  });
});
