// CLI --target-version flag: the checker mode (dist/cli.js via bin/ucode-lsp.js)
// must accept an OpenWrt/ucode target release, default to 25.12, and gate
// version-dependent diagnostics (UC6005) accordingly. Runs the built CLI as a
// subprocess. See src/cli.ts.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

const BIN = path.resolve('bin/ucode-lsp.js');
let dir, file;

// `bpf` is a 23.05 feed module → gated below 23.05, available at 23.05+/default 25.12.
const CODE = "import { open_module } from 'bpf';\nopen_module();\n";

function runCli(args) {
  const r = cp.spawnSync('node', [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('CLI --target-version', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-tv-'));
    file = path.join(dir, 'm.uc');
    fs.writeFileSync(file, CODE);
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  test('default target (25.12): bpf is available → no UC6005', () => {
    const { out } = runCli([file]);
    expect(out).not.toContain('UC6005');
  });

  test('--target-version 22.03: bpf is gated → UC6005', () => {
    const { out } = runCli(['--target-version', '22.03', file]);
    expect(out).toContain('UC6005');
    expect(out).toContain('22.03');
  });

  test('--target-version=23.05: bpf available → no UC6005 (= form)', () => {
    const { out } = runCli(['--target-version=23.05', file]);
    expect(out).not.toContain('UC6005');
  });

  test('-t alias works', () => {
    const { out } = runCli(['-t', '22.03', file]);
    expect(out).toContain('UC6005');
  });

  test('invalid version exits 2 with a helpful message', () => {
    const { status, out } = runCli(['--target-version', '9.9', file]);
    expect(status).toBe(2);
    expect(out).toContain('invalid --target-version');
    expect(out).toContain('22.03, 23.05, 24.10, 25.12, main');
  });

  test('--help documents the flag and the 25.12 default', () => {
    const { out } = runCli(['--help']);
    expect(out).toContain('--target-version');
    expect(out).toContain('default: 25.12');
  });
});
