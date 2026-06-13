// Version-gated diagnostics: a syntax feature valid only in newer ucode is flagged
// (UC6005) when the configured `ucode.targetVersion` predates it. The registry of
// such features lives in src/analysis/ucodeVersions.ts.
//
// This suite ALSO cross-checks the gating against the locally-built per-version
// oracle binaries (ucode_main / ucode24_10 / ucode23_05 / ucode22_03 on PATH): the
// LSP must emit UC6005 for a target exactly when that version's ucode rejects the
// code. The oracle half is skipped if the binaries aren't installed.

import { test, expect, describe } from 'bun:test';
const path = require('path');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const { UcodeLexer } = require(path.resolve('src/lexer/ucodeLexer'));
const { UcodeParser } = require(path.resolve('src/parser/ucodeParser'));
const { SemanticAnalyzer } = require(path.resolve('src/analysis/semanticAnalyzer'));
const { VERSION_MODULES, VERSION_MODULE_FUNCTIONS } = require(path.resolve('src/analysis/ucodeVersions'));
const { TextDocument } = require('vscode-languageserver-textdocument');

// Pinned ucode hashes per OpenWrt release (PKG_SOURCE_VERSION from each branch's
// package/utils/ucode/Makefile) — the ground truth for module availability.
const UCODE_DIR = path.resolve('ucode');
const HASH = { '24.10': '3f64c8089bf3ea4847c96b91df09fbfcaec19e1d', '25.12': '85922056ef7abeace3cca3ab28bc1ac2d88e31b1' };
const MODULE_FILE = { io: 'lib/io.c', fs: 'lib/fs.c', socket: 'lib/socket.c', math: 'lib/math.c', nl80211: 'lib/nl80211.c', struct: 'lib/struct.c' };

function gitShow(hash, file) {
  try { return cp.execFileSync('git', ['-C', UCODE_DIR, 'show', `${hash}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; } // file absent at that hash
}
function haveUcodeGit() {
  try { cp.execFileSync('git', ['-C', UCODE_DIR, 'cat-file', '-e', HASH['24.10']], { stdio: 'ignore' }); return true; } catch { return false; }
}

const TARGETS = ['main', '25.12', '24.10', '23.05', '22.03'];
const ORACLE = { 'main': 'ucode_main', '25.12': 'ucode25_12', '24.10': 'ucode24_10', '23.05': 'ucode23_05', '22.03': 'ucode22_03' };

const NOSEMI = 'export function f() { return 7; }\n';
const SEMI = 'export function f() { return 7; };\n';

function flags6005(code, targetVersion) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
  return new SemanticAnalyzer(doc, { targetVersion }).analyze(ast).diagnostics.some(d => d.code === 'UC6005');
}

function oracleAvailable(bin) {
  try { cp.execFileSync(bin, ['-e', 'print(1)'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function oracleAccepts(bin, moduleSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uctv-'));
  try {
    fs.writeFileSync(path.join(dir, 'm.uc'), moduleSrc);
    fs.writeFileSync(path.join(dir, 'main.uc'), 'import { f } from "./m.uc";\nprint(f());\n');
    cp.execFileSync(bin, ['-R', '-L', dir, path.join(dir, 'main.uc')], { stdio: 'ignore' });
    return true;
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('UC6005 export-function-without-semicolon gating', () => {
  test('flagged on every release older than main (incl. 25.12), not on main', () => {
    expect(flags6005(NOSEMI, 'main')).toBe(false);
    for (const t of ['25.12', '24.10', '23.05', '22.03']) expect(flags6005(NOSEMI, t)).toBe(true);
  });
  test('never flagged when the trailing ; is present', () => {
    for (const t of TARGETS) expect(flags6005(SEMI, t)).toBe(false);
  });
  test('unset target defaults to 25.12 (latest release) → flagged', () => {
    // DEFAULT_TARGET_VERSION is the latest stable (25.12), which predates the
    // no-semicolon feature, so the no-`;` form is flagged by default.
    expect(flags6005(NOSEMI, undefined)).toBe(true);
  });
  test('message names the target release and the setting', () => {
    const doc = TextDocument.create('file:///t.uc', 'ucode', 1, NOSEMI);
    const { ast } = new UcodeParser(new UcodeLexer(NOSEMI, { rawMode: true }).tokenize(), NOSEMI).parse();
    const d = new SemanticAnalyzer(doc, { targetVersion: '23.05' }).analyze(ast).diagnostics.find(x => x.code === 'UC6005');
    expect(d.message).toContain('23.05');
    expect(d.message).toContain('ucode.targetVersion');
  });
});

describe('UC6005 module-availability gating (io module)', () => {
  // The `io` module (lib/io.c) was introduced after the 24.10 snapshot, first
  // shipping in 25.12. Importing it on an older target is flagged. (Module
  // availability is source-verified, not oracle-verified: builtin modules load as
  // shared .so plugins, so the per-version binaries can't witness it.)
  const IO = "import { open } from 'io';\n";
  function flags6005Mod(code, tv) {
    const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
    const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
    return new SemanticAnalyzer(doc, { targetVersion: tv }).analyze(ast).diagnostics.some(d => d.code === 'UC6005');
  }
  test('flagged on releases older than 25.12, clean on 25.12/main', () => {
    expect(flags6005Mod(IO, 'main')).toBe(false);
    expect(flags6005Mod(IO, '25.12')).toBe(false);
    for (const t of ['24.10', '23.05', '22.03']) expect(flags6005Mod(IO, t)).toBe(true);
  });
});

describe('UC6005 module-function gating (fs.mkdtemp/dup2, socket.open/pair)', () => {
  function f6005(code, tv) {
    const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
    const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
    return new SemanticAnalyzer(doc, { targetVersion: tv }).analyze(ast).diagnostics.some(d => d.code === 'UC6005');
  }
  const cases = {
    'named import fs.mkdtemp': "import { mkdtemp } from 'fs';\nmkdtemp('/tmp/x');\n",
    'namespace fs.dup2': "import * as fs from 'fs';\nfs.dup2(1, 2);\n",
    'named import socket.open': "import { open } from 'socket';\nopen();\n",
    'namespace socket.pair': "import * as socket from 'socket';\nsocket.pair();\n",
  };
  for (const [name, code] of Object.entries(cases)) {
    test(`${name}: flagged on 24.10, clean on 25.12/main`, () => {
      expect(f6005(code, 'main')).toBe(false);
      expect(f6005(code, '25.12')).toBe(false);
      expect(f6005(code, '24.10')).toBe(true);
    });
  }
  test('a function that existed on 24.10 (fs.open) is NOT flagged', () => {
    const code = "import * as fs from 'fs';\nfs.open('/x');\n";
    expect(f6005(code, '24.10')).toBe(false);
  });
});

// The authoritative check that the registry's `introducedIn` claims are CORRECT:
// cross-check each 25.12-introduced module/function against the real ucode source at
// the 24.10 and 25.12 pinned hashes (modules can't be witnessed by the binary
// oracles — they load as .so plugins). Skips if the vendored ucode/.git is absent.
describe('source cross-check: registry introducedIn vs ucode source at pinned hashes', () => {
  const ok = haveUcodeGit();

  test.if(ok)('every introducedIn:25.12 MODULE is absent at 24.10 and present at 25.12', () => {
    for (const [mod, intro] of Object.entries(VERSION_MODULES)) {
      if (intro !== '25.12') continue;
      const file = MODULE_FILE[mod];
      expect(file, `no MODULE_FILE mapping for '${mod}'`).toBeDefined();
      expect(gitShow(HASH['24.10'], file), `${file} should be ABSENT at 24.10`).toBeNull();
      expect(gitShow(HASH['25.12'], file), `${file} should be PRESENT at 25.12`).not.toBeNull();
    }
  });

  test.if(ok)('every introducedIn:25.12 FUNCTION is absent at 24.10 and present at 25.12', () => {
    for (const [key, intro] of Object.entries(VERSION_MODULE_FUNCTIONS)) {
      if (intro !== '25.12') continue;
      const [mod, fn] = key.split('.');
      const file = MODULE_FILE[mod];
      expect(file, `no MODULE_FILE mapping for '${mod}'`).toBeDefined();
      const at2410 = gitShow(HASH['24.10'], file) || '';
      const at2512 = gitShow(HASH['25.12'], file) || '';
      const registered = (src) => new RegExp(`\\{\\s*"${fn}"`).test(src); // { "fn", uc_… } in the function list
      expect(registered(at2410), `${key} should be ABSENT in ${file} at 24.10`).toBe(false);
      expect(registered(at2512), `${key} should be PRESENT in ${file} at 25.12`).toBe(true);
    }
  });

  if (!ok) test.skip('vendored ucode/.git absent — source cross-check skipped', () => {});
});

describe('cross-check vs per-version oracle binaries', () => {
  const haveOracles = TARGETS.every(t => oracleAvailable(ORACLE[t]));
  test.if(haveOracles)('LSP flags UC6005 for a target iff that version rejects the code', () => {
    for (const t of TARGETS) {
      const accepts = oracleAccepts(ORACLE[t], NOSEMI);
      expect(flags6005(NOSEMI, t)).toBe(!accepts); // flagged ⟺ oracle rejects
    }
  });
  if (!haveOracles) test.skip('oracles not installed — run the build to enable this cross-check', () => {});
});
