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
const { VERSION_MODULES, VERSION_MODULE_FUNCTIONS, VERSION_OBJECT_METHODS } = require(path.resolve('src/analysis/ucodeVersions'));
const { TextDocument } = require('vscode-languageserver-textdocument');

// Pinned ucode hashes per OpenWrt release (PKG_SOURCE_VERSION from each branch's
// package/utils/ucode/Makefile) — the ground truth for module availability.
const UCODE_DIR = path.resolve('ucode');
const HASH = {
  '22.03': '46d93c9cc5da6fce581df86159bd0fc4357de41c',
  '23.05': '1a8a0bcf725520820802ad433db22d8f64fbed6c',
  '24.10': '3f64c8089bf3ea4847c96b91df09fbfcaec19e1d',
  '25.12': '85922056ef7abeace3cca3ab28bc1ac2d88e31b1',
};
// The release immediately BEFORE each one (a feature introducedIn V must be absent here).
const PREDECESSOR = { '23.05': '22.03', '24.10': '23.05', '25.12': '24.10' };
const MODULE_FILE = {
  io: 'lib/io.c', fs: 'lib/fs.c', socket: 'lib/socket.c', math: 'lib/math.c',
  nl80211: 'lib/nl80211.c', struct: 'lib/struct.c', digest: 'lib/digest.c',
  zlib: 'lib/zlib.c', uloop: 'lib/uloop.c', ubus: 'lib/ubus.c', uci: 'lib/uci.c',
  debug: 'lib/debug.c', log: 'lib/log.c', rtnl: 'lib/rtnl.c', resolv: 'lib/resolv.c',
};

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

  // Modules whose gate is FEED availability that lags SOURCE existence: their lib/*.c
  // exists in the ucode tree earlier than the OpenWrt feed shipped the module package.
  // For these the gate is deliberately later than source, so the source can't be
  // "absent at predecessor" — feed availability is verified separately (the dedicated
  // socket/zlib feed-gate tests above + the 2026-06 container ground-truth recorded in
  // VERSION_MODULES' doc comment). Source is still required to exist BY introducedIn.
  const FEED_GATED_LATER_THAN_SOURCE = new Set(['socket', 'zlib']);
  // External feed packages (ucode-mod-*) whose source lives in their OWN OpenWrt
  // package repos, NOT the core ucode tree this cross-check inspects. Their
  // per-version availability is ground-truthed by container introspection of the
  // real package feeds (see the module data gathered 2026-06), not by lib/*.c.
  const EXTERNAL_FEED_MODULES = new Set(['bpf', 'html', 'lua', 'uclient', 'udebug', 'uline', 'pkgen']);

  test.if(ok)('every gated CORE MODULE has source present at introducedIn (and absent at predecessor unless feed-gated)', () => {
    for (const [mod, intro] of Object.entries(VERSION_MODULES)) {
      if (EXTERNAL_FEED_MODULES.has(mod)) continue; // not in the core ucode tree
      const prev = PREDECESSOR[intro];
      if (!prev) continue; // introducedIn 'main' has no pinned hash to check
      const file = MODULE_FILE[mod];
      expect(file, `no MODULE_FILE mapping for '${mod}'`).toBeDefined();
      expect(gitShow(HASH[intro], file), `${file} should be PRESENT at ${intro}`).not.toBeNull();
      if (!FEED_GATED_LATER_THAN_SOURCE.has(mod)) {
        expect(gitShow(HASH[prev], file), `${file} should be ABSENT at ${prev}`).toBeNull();
      }
    }
  });

  test.if(ok)('every gated FUNCTION is absent at its predecessor release and present at introducedIn', () => {
    for (const [key, intro] of Object.entries(VERSION_MODULE_FUNCTIONS)) {
      const prev = PREDECESSOR[intro];
      if (!prev) continue;
      const [mod, fn] = key.split('.');
      const file = MODULE_FILE[mod];
      expect(file, `no MODULE_FILE mapping for '${mod}'`).toBeDefined();
      const atPrev = gitShow(HASH[prev], file) || '';
      const atIntro = gitShow(HASH[intro], file) || '';
      const registered = (src) => new RegExp(`\\{\\s*"${fn}"`).test(src); // { "fn", uc_… }
      expect(registered(atPrev), `${key} should be ABSENT in ${file} at ${prev}`).toBe(false);
      expect(registered(atIntro), `${key} should be PRESENT in ${file} at ${intro}`).toBe(true);
    }
  });

  test.if(ok)('every gated OBJECT METHOD is absent at its predecessor release and present at introducedIn', () => {
    for (const [key, intro] of Object.entries(VERSION_OBJECT_METHODS)) {
      const prev = PREDECESSOR[intro];
      if (!prev) continue;
      const parts = key.split('.');          // e.g. fs.file.ioctl → mod=fs, method=ioctl
      const mod = parts[0], method = parts[parts.length - 1];
      const file = MODULE_FILE[mod];
      expect(file, `no MODULE_FILE mapping for '${mod}'`).toBeDefined();
      const atPrev = gitShow(HASH[prev], file) || '';
      const atIntro = gitShow(HASH[intro], file) || '';
      const registered = (src) => new RegExp(`\\{\\s*"${method}"`).test(src);
      expect(registered(atPrev), `${key} should be ABSENT in ${file} at ${prev}`).toBe(false);
      expect(registered(atIntro), `${key} should be PRESENT in ${file} at ${intro}`).toBe(true);
    }
  });

  if (!ok) test.skip('vendored ucode/.git absent — source cross-check skipped', () => {});
});

describe('UC6005 gating for 23.05 → 24.10 additions', () => {
  function f6005(code, tv) {
    const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
    const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
    return new SemanticAnalyzer(doc, { targetVersion: tv }).analyze(ast).diagnostics.some(d => d.code === 'UC6005');
  }
  const cases = {
    'digest module': "import { md5 } from 'digest';\nmd5('x');\n",
    'socket.strerror': "import { strerror } from 'socket';\nstrerror(1);\n",
    'struct.buffer': "import * as struct from 'struct';\nstruct.buffer();\n",
    'uloop.guard (namespace)': "import * as uloop from 'uloop';\nuloop.guard();\n",
    'ubus.open_channel': "import { open_channel } from 'ubus';\nopen_channel();\n",
  };
  // zlib is now a 25.12-feed module (gated whole), so zlib.deflater is covered by the
  // module gate and verified in the dedicated zlib test above — not a 24.10 addition.
  for (const [name, code] of Object.entries(cases)) {
    test(`${name}: flagged on 23.05/22.03, clean on 24.10/25.12/main`, () => {
      expect(f6005(code, 'main')).toBe(false);
      expect(f6005(code, '25.12')).toBe(false);
      expect(f6005(code, '24.10')).toBe(false);
      expect(f6005(code, '23.05')).toBe(true);
      expect(f6005(code, '22.03')).toBe(true);
    });
  }
});

describe('UC6005 object-method gating (handle methods added in 24.10)', () => {
  function f6005(code, tv) {
    const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
    const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
    return new SemanticAnalyzer(doc, { targetVersion: tv }).analyze(ast).diagnostics.some(d => d.code === 'UC6005');
  }
  const cases = {
    'fs.file.ioctl': "import { open } from 'fs';\nlet f = open('/dev/x');\nf.ioctl(1, 2);\n",
    'uci.cursor.list_append': "import { cursor } from 'uci';\nlet c = cursor();\nc.list_append('s', 'o', 'v');\n",
    'uci.cursor.list_remove': "import { cursor } from 'uci';\nlet c = cursor();\nc.list_remove('s', 'o', 'v');\n",
  };
  for (const [name, code] of Object.entries(cases)) {
    test(`${name}: flagged on 23.05/22.03, clean on 24.10+`, () => {
      expect(f6005(code, 'main')).toBe(false);
      expect(f6005(code, '24.10')).toBe(false);
      expect(f6005(code, '23.05')).toBe(true);
      expect(f6005(code, '22.03')).toBe(true);
    });
  }
  test('a pre-existing handle method (fs.file.read) is NOT flagged on 23.05', () => {
    expect(f6005("import { open } from 'fs';\nlet f = open('/x');\nf.read('line');\n", '23.05')).toBe(false);
  });
});

describe('UC6005 gating for 22.03 → 23.05 additions', () => {
  function n6005(code, tv) {
    const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
    const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
    return new SemanticAnalyzer(doc, { targetVersion: tv }).analyze(ast).diagnostics.filter(d => d.code === 'UC6005').length;
  }
  // These modules first appear in the 23.05 feed → flagged on 22.03, clean on 23.05+.
  const cases = {
    'log module': "import { openlog } from 'log';\n",
    'debug module': "import { memdump } from 'debug';\n",
    'fs.pipe': "import { pipe } from 'fs';\npipe();\n",
    'nl80211.listener': "import { listener } from 'nl80211';\nlistener();\n",
    'rtnl.listener': "import { listener } from 'rtnl';\nlistener();\n",
    'uloop.interval (namespace)': "import * as uloop from 'uloop';\nuloop.interval(1);\n",
    'uloop.signal (namespace)': "import * as uloop from 'uloop';\nuloop.signal('SIGINT', () => {});\n",
    'fs.file.lock (method)': "import { open } from 'fs';\nlet f = open('/x');\nf.lock('x');\n",
    'fs.file.truncate (method)': "import { open } from 'fs';\nlet f = open('/x');\nf.truncate(0);\n",
    'fs.file.isatty (method)': "import { open } from 'fs';\nlet f = open('/x');\nf.isatty();\n",
  };
  for (const [name, code] of Object.entries(cases)) {
    test(`${name}: flagged on 22.03, clean on 23.05+`, () => {
      expect(n6005(code, 'main')).toBe(0);
      expect(n6005(code, '23.05')).toBe(0);
      expect(n6005(code, '22.03')).toBeGreaterThan(0);
    });
  }
  // Feed-availability gates: socket first ships in the 24.10 feed, zlib in 25.12
  // (their lib/*.c existed earlier in source, but no module package was built).
  // Verified against the openwrt/rootfs aarch64 package feeds.
  test('socket module: flagged on 22.03 AND 23.05, clean on 24.10+', () => {
    const code = "import { create } from 'socket';\n";
    expect(n6005(code, '22.03')).toBeGreaterThan(0);
    expect(n6005(code, '23.05')).toBeGreaterThan(0);
    expect(n6005(code, '24.10')).toBe(0);
    expect(n6005(code, '25.12')).toBe(0);
    expect(n6005(code, 'main')).toBe(0);
  });
  test('zlib module: flagged on 22.03/23.05/24.10, clean on 25.12+', () => {
    const code = "import { deflate } from 'zlib';\n";
    expect(n6005(code, '22.03')).toBeGreaterThan(0);
    expect(n6005(code, '23.05')).toBeGreaterThan(0);
    expect(n6005(code, '24.10')).toBeGreaterThan(0);
    expect(n6005(code, '25.12')).toBe(0);
    expect(n6005(code, 'main')).toBe(0);
  });
  test('no double-flag: a gated-MODULE function (socket.open) on 22.03 yields exactly one UC6005', () => {
    // socket module is gated (24.10) AND socket.open is gated (25.12); on 22.03 only
    // the module-level diagnostic should fire, not both.
    expect(n6005("import { open } from 'socket';\nopen();\n", '22.03')).toBe(1);
  });
  test('a pre-existing fs.file method (read) is NOT flagged on 22.03', () => {
    expect(n6005("import { open } from 'fs';\nlet f = open('/x');\nf.read('line');\n", '22.03')).toBe(0);
  });
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
