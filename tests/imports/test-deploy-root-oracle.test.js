// Deploy-layout resolver — behaviours grounded in ucode-on-device (OpenWrt owrt-main / owrt-2410
// containers) as the oracle. Each case was run against the real `ucode` binary to establish the
// correct answer, then asserted here against FileResolver.resolveImportPath directly (returns the
// resolved absolute path, or null). REQUIRE_SEARCH_PATH on-device is:
//     [ "/usr/lib/ucode/*.so", "/usr/share/ucode/*.uc", "./*.so", "./*.uc" ]
// Verified on-device: absolute `import` resolves; absolute `require()` FAILS; dotted resolves via
// /usr/share/ucode; a `.uc` under /usr/lib/ucode is NOT found (that root is *.so-only); relative
// `import "./x.uc"` resolves; bare `import "name"` resolves importer-relative.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { FileResolver } = require('../../src/analysis/fileResolver');

const base = '/tmp/test-deploy-root-oracle';
const ws = path.join(base, 'ws');
const FILES = {
  // absolute import under files/ and root/ deploy roots (on-device: absolute import is legal)
  'af/files/usr/share/hostap/common.uc': 'export const c = 1;\n',
  'af/files/usr/share/hostap/consumer.uc': '',
  'ar/root/usr/share/hostap/common.uc': 'export const c = 1;\n',
  'ar/root/usr/share/hostap/consumer.uc': '',
  'af/files/usr/share/hostap/adir/keep.uc': 'export const k = 1;\n', // adir/ is a directory
  // relative import (on-device: legal)
  'rel/dep.uc': 'export const r = 5;\n',
  'rel/main.uc': '',
  // dotted name via a deploy-root SIBLING: share/ucode (.uc root) vs lib/ucode (.so-only)
  'sib/files/usr/share/ucode/cli/utils.uc': 'export const u = 1;\n',
  'sib/files/usr/lib/ucode/libmod.uc': 'export const v = 1;\n',
  'sib/files/usr/share/fw4/main.uc': '',
  // ANCESTOR mirror: importer INSIDE a share/ucode tree (mirror) vs a lib/ucode tree (not a mirror)
  'sanc/files/usr/share/ucode/app/mod.uc': '',
  'sanc/files/usr/share/ucode/lib/helper.uc': 'export const h = 1;\n',
  'lanc/files/usr/lib/ucode/app/mod.uc': '',
  'lanc/files/usr/lib/ucode/lib/helper.uc': 'export const h = 1;\n',
  // share/ucodex near-miss (segment must be EXACTLY share/ucode)
  'nm/files/usr/share/ucodex/cli/mod.uc': '',
  'nm/files/usr/share/ucodex/cli/utils.uc': 'export const u = 1;\n',
  // importer-relative dotted + bare name (on-device: ./ importer-relative for import)
  'imp/pkg/main.uc': '',
  'imp/pkg/cli/utils.uc': 'export const u = 1;\n',
  'imp/pkg/helper.uc': 'export const b = 1;\n',
};

let r;
beforeAll(() => {
  for (const [name, content] of Object.entries(FILES)) {
    const p = path.join(ws, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  r = new FileResolver(ws);
});
afterAll(() => { try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });

const uri = (rel) => 'file://' + path.join(ws, rel);
const resolve = (spec, fromRel) => {
  const out = r.resolveImportPath(spec, uri(fromRel));
  return out ? out.replace('file://' + ws + '/', '') : null;
};

describe('absolute import — legal on-device, resolves under the same package deploy root', () => {
  test('01 files/ deploy root maps /usr/share/... to the package tree', () => {
    expect(resolve('/usr/share/hostap/common.uc', 'af/files/usr/share/hostap/consumer.uc'))
      .toBe('af/files/usr/share/hostap/common.uc');
  });
  test('02 root/ deploy root works the same as files/', () => {
    expect(resolve('/usr/share/hostap/common.uc', 'ar/root/usr/share/hostap/consumer.uc'))
      .toBe('ar/root/usr/share/hostap/common.uc');
  });
  test('03 an absolute import that maps to a DIRECTORY does not resolve (isFile guard)', () => {
    expect(resolve('/usr/share/hostap/adir', 'af/files/usr/share/hostap/consumer.uc')).toBeNull();
  });
});

describe('relative import — legal on-device', () => {
  test('04 "./dep.uc" resolves relative to the importer', () => {
    expect(resolve('./dep.uc', 'rel/main.uc')).toBe('rel/dep.uc');
  });
});

describe('dotted name — /usr/share/ucode is the .uc root, /usr/lib/ucode is .so-only', () => {
  test('05 resolves under a share/ucode deploy sibling', () => {
    expect(resolve('cli.utils', 'sib/files/usr/share/fw4/main.uc'))
      .toBe('sib/files/usr/share/ucode/cli/utils.uc');
  });
  test('06 does NOT resolve a .uc under a lib/ucode deploy sibling (that root is *.so-only)', () => {
    expect(resolve('libmod', 'sib/files/usr/share/fw4/main.uc')).toBeNull();
  });
  test('07 importer inside a share/ucode tree resolves via the ancestor mirror', () => {
    expect(resolve('lib.helper', 'sanc/files/usr/share/ucode/app/mod.uc'))
      .toBe('sanc/files/usr/share/ucode/lib/helper.uc');
  });
  test('08 importer inside a lib/ucode tree does NOT resolve a .uc via a mirror', () => {
    expect(resolve('lib.helper', 'lanc/files/usr/lib/ucode/app/mod.uc')).toBeNull();
  });
  test('09 the search-root segment must be EXACTLY share/ucode (share/ucodex is a near-miss)', () => {
    expect(resolve('cli.utils', 'nm/files/usr/share/ucodex/cli/mod.uc')).toBeNull();
  });
});

describe('importer-relative dotted + bare name — legal on-device', () => {
  test('10 dotted "cli.utils" resolves importer-relative; bare "helper" resolves importer-relative', () => {
    expect(resolve('cli.utils', 'imp/pkg/main.uc')).toBe('imp/pkg/cli/utils.uc');
    expect(resolve('helper', 'imp/pkg/main.uc')).toBe('imp/pkg/helper.uc');
  });
});
