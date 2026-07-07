// CLI --type-coverage flag: audit mode that reports every variable occurrence
// whose hover is missing or whose displayed type contains `unknown`, probed
// through the REAL handleHover path so the report can't disagree with the
// editor. Runs the built CLI as a subprocess. See src/cli.ts.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

const BIN = path.resolve('bin/ucode-lsp.js');
let dir, file;

const CODE = [
  "let greeting = 'hello';",       // string — well-typed, must NOT be reported
  'function mangle(item) {',       // unannotated param — unknown
  '    return item;',              // read of that param — unknown
  '}',
  'let outcome = mangle(greeting);', // unknown return — unknown
  'let sum = undeclared_thing + 1;', // read of an undeclared name — no hover
  'print(greeting, outcome, sum);',
  '',
].join('\n');

function runCli(args) {
  const r = cp.spawnSync('node', [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

describe('CLI --type-coverage', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-tc-'));
    file = path.join(dir, 'cover.uc');
    fs.writeFileSync(file, CODE);
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  test('reports unknown-typed variables with file(line,startCol-endCol) locations', () => {
    const { status, stdout } = runCli(['--type-coverage', file]);
    expect(status).toBe(0);
    // param declaration: `item` on line 2, cols 17-20
    expect(stdout).toContain("(2,17-20): unknown-type: 'item'");
    // its read on line 3, cols 12-15
    expect(stdout).toContain("(3,12-15): unknown-type: 'item'");
    // the variable holding the unknown return
    expect(stdout).toMatch(/\(5,5-11\): unknown-type: 'outcome' shows as `unknown[^`]*`/);
  });

  test('reports no-hover for reads of undeclared names', () => {
    const { stdout } = runCli(['--type-coverage', file]);
    expect(stdout).toContain("(6,11-26): no-hover: 'undeclared_thing'");
  });

  test('well-typed variables are NOT reported', () => {
    const { stdout } = runCli(['--type-coverage', file]);
    expect(stdout).not.toContain("'greeting'");
  });

  test('prints a coverage summary and suppresses normal diagnostics', () => {
    const { stdout, stderr } = runCli(['--type-coverage', file]);
    expect(stderr).toMatch(/Type coverage: \d+\.\d% — \d+\/\d+ variable occurrences typed/);
    expect(stderr).toContain('unknown-type');
    expect(stderr).toContain('no-hover');
    // audit mode replaces the diagnostics listing (undeclared_thing would be UC1001)
    expect(stdout).not.toContain('UC1001');
  });

  test('a fully-typed file reports 100% and no findings', () => {
    const clean = path.join(dir, 'clean.uc');
    fs.writeFileSync(clean, "let s = 'x';\nlet n = 1;\nprint(s, n);\n");
    const { status, stdout, stderr } = runCli(['--type-coverage', clean]);
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('Type coverage: 100.0%');
  });

  test('--help documents the flag', () => {
    const { stdout, stderr } = runCli(['--help']);
    expect(stdout + stderr).toContain('--type-coverage');
  });
});
