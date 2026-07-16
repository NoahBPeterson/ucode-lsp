// Regression tests for two whole-file analyzer crashes found by the --type-coverage audit
// (docs/tc-analyzer-crash-inferredparams-scoperole.md, docs/tc-analyzer-crash-moduletype-argtype.md).
//
// Both crashes throw INSIDE SemanticAnalyzer.analyze()'s main try/catch (semanticAnalyzer.ts),
// which converts the exception into a single opaque "Semantic analysis error: ..." diagnostic
// and short-circuits everything analyze() would normally do AFTER the crash point (notably
// resolvePendingUndefinedRefs — the UC1001 "Undefined variable" classifier — and unused-variable
// detection). The observable symptom: the crash message appears, and diagnostics for code AFTER
// the crashing statement (e.g. an unused-variable warning on a trailing `let`) go missing.
//
// Drives the built CLI as a subprocess (see tests/cli/test-cli-type-coverage.test.js for the
// same pattern) so this exercises the exact same code path a real editor session hits.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

const BIN = path.resolve('bin/ucode-lsp.js');
let dir;

function runCli(args) {
  const r = cp.spawnSync('node', [BIN, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function writeAndRun(name, code) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, code);
  return runCli([file]);
}

describe('analyzer crash regressions (--type-coverage audit)', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-crash-'));
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  describe('crash 1: object literal with a function-valued property assigned to an implicit global', () => {
    const CODE = [
      'uvol_uci = { f: function(a) { return a; } };',
      'let after1 = 1;',
      '',
    ].join('\n');

    test('does not crash the whole-file analysis', () => {
      const { stdout } = writeAndRun('crash1.uc', CODE);
      expect(stdout).not.toContain('Semantic analysis error');
    });

    test('analysis continues past the crashing statement (recovers the trailing unused-variable warning)', () => {
      const { stdout } = writeAndRun('crash1.uc', CODE);
      expect(stdout).toContain("'after1' is declared but never used");
    });

    test('the arrow-function variant (`global.v = { f: (x) => x }`) also does not crash', () => {
      const arrowCode = [
        'global.v = { f: (x) => x };',
        'let after1b = 1;',
        '',
      ].join('\n');
      const { stdout } = writeAndRun('crash1b.uc', arrowCode);
      expect(stdout).not.toContain('Semantic analysis error');
      expect(stdout).toContain("'after1b' is declared but never used");
    });
  });

  describe('crash 2: module-typed value (require() result) passed to a null-narrowing builtin', () => {
    const CODE = [
      'let fsx = require("fs");',
      'printf("%s\\n", type(fsx));',
      'let after2 = 1;',
      '',
    ].join('\n');

    test('does not crash the whole-file analysis', () => {
      const { stdout } = writeAndRun('crash2.uc', CODE);
      expect(stdout).not.toContain('Semantic analysis error');
      expect(stdout).not.toContain('argType.includes is not a function');
    });

    test('analysis continues past the crashing statement (recovers the trailing unused-variable warning)', () => {
      const { stdout } = writeAndRun('crash2.uc', CODE);
      expect(stdout).toContain("'after2' is declared but never used");
    });

    test('--type-coverage on the same source produces no no-hover findings', () => {
      const { stdout } = writeAndRun('crash2-tc.uc', CODE);
      const { stdout: tcOut } = runCli(['--type-coverage', path.join(dir, 'crash2-tc.uc')]);
      expect(tcOut).not.toContain('no-hover');
    });
  });
});
