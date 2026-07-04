// CLI template-mode detection: the checker mode (dist/cli.js via bin/ucode-lsp.js)
// must detect ucode template files (`{% %}` / `{{ }}`) — e.g. uhttpd handlers — and
// lex them in template mode, exactly like the LSP server does. Without this the CLI
// parses a `{%` handler as a raw script and emits a spurious UC6001/UC3007/UC1002
// cascade on valid template code. Regression test for that gap. See src/cli.ts.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

const BIN = path.resolve('bin/ucode-lsp.js');
let dir;

function runCli(args) {
  const r = cp.spawnSync('node', [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function write(name, content) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  return f;
}

// The canonical, working uhttpd handler (verified end-to-end in a real OpenWrt
// container — see docs/uhttpd-false-negatives.md).
const CANONICAL_HANDLER = `{%
'use strict';
global.handle_request = function(env) {
    uhttpd.send('Status: 200 OK\\r\\n\\r\\n' + 'ok');
};
%}
`;

describe('CLI template-mode detection', () => {
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-tpl-')); });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  test('a leading {% code block is not a UC6001 false positive', () => {
    const f = write('block.uc', '{% let x = 1; print(x); %}\n');
    const { out } = runCli([f]);
    expect(out).not.toContain('UC6001');
    expect(out).toContain('No errors found');
  });

  test('canonical uhttpd handler is clean (no UC6001/UC3007/UC1002/UC1006)', () => {
    const f = write('handler.uc', CANONICAL_HANDLER);
    const { out } = runCli(['--verbose', f]);
    for (const code of ['UC6001', 'UC3007', 'UC1002', 'UC1006']) {
      expect(out).not.toContain(code);
    }
  });

  test('{{ }} expression template still lexes clean', () => {
    const f = write('expr.uc', '{{ 1 + 2 }}\n');
    const { out } = runCli([f]);
    expect(out).not.toContain('UC6001');
  });

  test('template detection does not mask the FN-1 broken handler (UC8012)', () => {
    // A file that assigns global.handle_request but is NOT a template → uhttpd emits
    // it as literal body and runs no code. Must still warn.
    const f = write('broken.uc', "'use strict';\nglobal.handle_request = function(env) {};\n");
    const { out } = runCli(['--verbose', f]);
    expect(out).toContain('UC8012');
  });

  test('a plain raw script is unaffected (real error still reported)', () => {
    const f = write('raw.uc', 'let x = ;\n');
    const { status, out } = runCli([f]);
    expect(status).toBe(1);
    expect(out).toContain('error');
  });
});
