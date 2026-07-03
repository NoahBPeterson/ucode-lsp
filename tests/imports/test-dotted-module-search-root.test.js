// Regression for docs/dotted-module-search-root.md — dotted imports resolve against
// mirrored install roots, faithful to ucode's REQUIRE_SEARCH_PATH semantics (verified
// vs compiler.c + the interpreter): a dotted name is dots→slashes spliced into each
// search-path template. The runtime's default templates are <prefix>/share/ucode/*.uc,
// <prefix>/lib/ucode/*.so, and importer-relative ./*.uc — NOT arbitrary ancestors — so
// the LSP treats only share/ucode- or lib/ucode-suffixed ancestors as mirrored install
// roots. The motivating corpus case: …/usr/share/ucode/cli/modules/network.uc importing
// "cli.utils" must find …/usr/share/ucode/cli/utils.uc.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const base = '/tmp/test-dotted-search-root';
const ws = path.join(base, 'ws');
const FILES = {
  // Mirror of the installed-package layout from the ticket
  'files/usr/share/ucode/cli/utils.uc': 'export function time_format(t) { return "" + t; }\n',
  'files/usr/share/ucode/cli/modules/.keep': '',
  // Workspace-root-relative dotted layout (pre-existing behavior)
  'pkg/mod.uc': 'export function root_helper() { return 1; }\n',
  // Namespace-prefix layout (pre-existing behavior): bar.sibling from inside foo/bar/
  'foo/bar/sibling.uc': 'export function sib() { return 2; }\n',
  // A module under a GENERIC ancestor (not share/ucode, not the workspace root, not
  // the importer's dir) — the runtime would not find this, so neither may the LSP.
  'gen/genpkg/genmod.uc': 'export function gen_helper() { return 4; }\n',
  'gen/deep/nested/.keep': '',
};

let server;
beforeAll(async () => {
  for (const [name, content] of Object.entries(FILES)) {
    const p = path.join(ws, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  // A module OUTSIDE the workspace root that a dotted walk must NOT reach
  const outside = path.join(base, 'escape', 'mod.uc');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, 'export function nope() { return 3; }\n');
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });

const diagsAt = (content, file) => server.getDiagnostics(content, path.join(ws, file));
const moduleNotFound = (d) => d.filter((x) => x.code === 'UC3002');
const exportNotFound = (d) => d.filter((x) => /does not export/.test(x.message));

describe('dotted import via ancestor search root', () => {
  test('cli.utils resolves from cli/modules/ (the ticket case)', async () => {
    const d = await diagsAt(
      'import { time_format } from "cli.utils";\ntime_format(1);\n',
      'files/usr/share/ucode/cli/modules/network.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
  });

  test('resolution reaches the REAL file — bad named import is caught', async () => {
    const d = await diagsAt(
      'import { no_such_export } from "cli.utils";\nno_such_export();\n',
      'files/usr/share/ucode/cli/modules/network.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
    expect(exportNotFound(d).length).toBe(1);
  });

  test('truly missing dotted module still flags UC3002', async () => {
    const d = await diagsAt(
      'import { x } from "cli.doesnotexist";\nprint(x);\n',
      'files/usr/share/ucode/cli/modules/network.uc'
    );
    expect(moduleNotFound(d).length).toBe(1);
  });

  test('a generic ancestor is NOT treated as a search root (runtime fidelity)', async () => {
    // gen/genpkg/genmod.uc exists and gen/ is an ancestor of the importer — but the
    // runtime only searches configured roots (share/ucode-style), so "genpkg.genmod"
    // from gen/deep/nested/ must stay unresolved.
    const d = await diagsAt(
      'import { gen_helper } from "genpkg.genmod";\ngen_helper();\n',
      'gen/deep/nested/app.uc'
    );
    expect(moduleNotFound(d).length).toBe(1);
  });

  test('the walk does not escape the workspace root', async () => {
    // ../escape/mod.uc exists one level ABOVE the workspace root; the dotted
    // walk is workspace-bounded, so "escape.mod" must stay unresolved.
    const d = await diagsAt(
      'import { nope } from "escape.mod";\nnope();\n',
      'top.uc'
    );
    expect(moduleNotFound(d).length).toBe(1);
  });
});

describe('relative → dotted import quick fix', () => {
  test('offered for a relative import of a file under the mirrored install root', async () => {
    const file = 'files/usr/share/ucode/cli/modules/uses-relative.uc';
    const content = 'import { time_format } from "../utils.uc";\ntime_format(1);\n';
    const diags = await diagsAt(content, file);        // opens the doc & fills the AST cache
    expect(moduleNotFound(diags)).toEqual([]);         // relative form resolves too
    const actions = await server.getCodeActions(path.join(ws, file), [], 0, 30);
    const convert = actions.filter(a => a.title === 'Convert to dotted module import "cli.utils"');
    expect(convert.length).toBe(1);
    // The edit replaces exactly the source literal (offset-based, quote preserved).
    const edits = convert[0].edit.changes[`file://${path.join(ws, file)}`];
    expect(edits.length).toBe(1);
    expect(edits[0].newText).toBe('"cli.utils"');
    expect(edits[0].range.start.character).toBe(content.indexOf('"../utils.uc"'));
  });

  test('NOT offered when the target is outside any install-root mirror', async () => {
    const file = 'gen/deep/nested/uses-relative.uc';
    await diagsAt('import { gen_helper } from "../../genpkg/genmod.uc";\ngen_helper();\n', file);
    const actions = await server.getCodeActions(path.join(ws, file), [], 0, 35);
    expect(actions.filter(a => /dotted module import/.test(a.title))).toEqual([]);
  });
});

describe('pre-existing dotted behaviors still work', () => {
  test('workspace-root-relative dotted import resolves', async () => {
    const d = await diagsAt(
      'import { root_helper } from "pkg.mod";\nroot_helper();\n',
      'files/usr/share/ucode/cli/modules/deep.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
  });

  test('namespace-prefix dotted import (bar.sibling from foo/bar/) resolves', async () => {
    const d = await diagsAt(
      'import { sib } from "bar.sibling";\nsib();\n',
      'foo/bar/app.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
  });
});
