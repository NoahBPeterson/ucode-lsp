// Unit tests for FileResolver (src/analysis/fileResolver.ts).
//
// Drives the public API against real temp .uc files, which exercises the deep
// private type-inference helpers (inferNodeType, inferReturnExprType,
// resolveBuiltinReturnType, extractObjectPropertyTypes, collectReturnObject-
// Properties, etc.) that were otherwise only hit incidentally.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileResolver } from '../src/analysis/fileResolver';
import { UcodeType } from '../src/analysis/symbolTable';

let dir;
let uriOf;
const W = (rel, txt) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, txt);
  return f;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-fr-'));
  uriOf = (rel) => 'file://' + path.join(dir, rel);
});
afterAll(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

describe('isBuiltinModule', () => {
  const fr = new FileResolver();
  test('recognizes a builtin module', () => {
    expect(fr.isBuiltinModule('fs')).toBe(true);
  });
  test('rejects a relative path', () => {
    expect(fr.isBuiltinModule('./local.uc')).toBe(false);
    expect(fr.isBuiltinModule('definitely-not-a-module')).toBe(false);
  });
});

describe('resolveImportPath', () => {
  test('builtin module → builtin:// URI', () => {
    const fr = new FileResolver(dir);
    expect(fr.resolveImportPath('fs', uriOf('app.uc'))).toBe('builtin://fs');
  });

  test('relative import with explicit .uc', () => {
    W('lib.uc', 'export function f() {};\n');
    const fr = new FileResolver(dir);
    const got = fr.resolveImportPath('./lib.uc', uriOf('app.uc'));
    expect(got).toBe(uriOf('lib.uc'));
  });

  test('relative import requires the explicit .uc extension (ucode does not auto-append it)', () => {
    W('noext.uc', 'export function g() {};\n');
    const fr = new FileResolver(dir);
    // ucode: `import … from './noext'` → "Unable to resolve path" (finding #70).
    expect(fr.resolveImportPath('./noext', uriOf('app.uc'))).toBe(null);
    // With the extension it resolves.
    expect(fr.resolveImportPath('./noext.uc', uriOf('app.uc'))).toBe(uriOf('noext.uc'));
  });

  test('bare same-directory name', () => {
    W('sibling.uc', 'export function s() {};\n');
    const fr = new FileResolver(dir);
    expect(fr.resolveImportPath('sibling', uriOf('app.uc'))).toBe(uriOf('sibling.uc'));
  });

  test('dotted module path (workspace-relative)', () => {
    W('sub/deep.uc', 'export function d() {};\n');
    const fr = new FileResolver(dir);
    expect(fr.resolveImportPath('sub.deep', uriOf('app.uc'))).toBe(uriOf('sub/deep.uc'));
  });

  test('unresolvable import → null', () => {
    const fr = new FileResolver(dir);
    expect(fr.resolveImportPath('./does-not-exist.uc', uriOf('app.uc'))).toBeNull();
  });
});

describe('findFunctionDefinition', () => {
  test('locates a function declaration with kind=function', () => {
    const f = W('defs.uc', 'export function alpha() {};\nexport let BETA = 7;\nexport let gamma = (n) => n;\n');
    const fr = new FileResolver(dir);
    const d = fr.findFunctionDefinition('file://' + f, 'alpha');
    expect(d).not.toBeNull();
    expect(d.kind).toBe('function');
  });

  test('locates a top-level let variable with kind=variable', () => {
    const fr = new FileResolver(dir);
    const d = fr.findFunctionDefinition(uriOf('defs.uc'), 'BETA');
    expect(d).not.toBeNull();
    expect(d.kind).toBe('variable');
  });

  test('locates a const-arrow-function variable', () => {
    const fr = new FileResolver(dir);
    const d = fr.findFunctionDefinition(uriOf('defs.uc'), 'gamma');
    expect(d).not.toBeNull();
    expect(d.kind).toBe('variable');
  });

  test('returns null for a missing name', () => {
    const fr = new FileResolver(dir);
    expect(fr.findFunctionDefinition(uriOf('defs.uc'), 'nope')).toBeNull();
  });

  test('returns null for a nonexistent file', () => {
    const fr = new FileResolver(dir);
    expect(fr.findFunctionDefinition(uriOf('ghost.uc'), 'x')).toBeNull();
  });
});

describe('getModuleExports', () => {
  test('named function, variable, default, and specifier exports', () => {
    const f = W('exports.uc',
      'export function fnExp() {};\n' +
      'export let varExp = 1;\n' +
      'function local() {};\n' +
      'export { local };\n' +
      'export default fnExp;\n');
    const fr = new FileResolver(dir);
    const exps = fr.getModuleExports('file://' + f);
    expect(exps).not.toBeNull();
    const byName = Object.fromEntries(exps.map((e) => [e.name, e]));
    expect(byName.fnExp.isFunction).toBe(true);
    expect(byName.varExp.isFunction).toBe(false);
    expect(byName.local).toBeDefined();
    expect(byName.default.type).toBe('default');
    expect(byName.default.isFunction).toBe(true); // default references a top-level function
  });

  test('builtin module exports come from the module registry', () => {
    const fr = new FileResolver(dir);
    const exps = fr.getModuleExports('builtin://fs');
    expect(Array.isArray(exps)).toBe(true);
    expect(exps.length).toBeGreaterThan(0);
  });

  test('nonexistent file → null', () => {
    const fr = new FileResolver(dir);
    expect(fr.getModuleExports(uriOf('ghost.uc'))).toBeNull();
  });
});

describe('getNamedExportTypeInfo', () => {
  const setup = () => {
    const f = W('named.uc',
      'export function fnE() { return 1; };\n' +
      'export let numV = 42;\n' +
      'export let strV = "hi";\n' +
      'export let objV = { a: 1, fn: function() {}, nested: { x: 2 } };\n' +
      'export let arrV = [1, 2, 3];\n' +
      'let internal = { p: 5 };\n' +
      'export { internal };\n');
    return new FileResolver(dir);
  };

  test('function export → FUNCTION', () => {
    expect(setup().getNamedExportTypeInfo(uriOf('named.uc'), 'fnE').type).toBe(UcodeType.FUNCTION);
  });
  test('integer variable export', () => {
    expect(setup().getNamedExportTypeInfo(uriOf('named.uc'), 'numV').type).toBe(UcodeType.INTEGER);
  });
  test('string variable export', () => {
    expect(setup().getNamedExportTypeInfo(uriOf('named.uc'), 'strV').type).toBe(UcodeType.STRING);
  });
  test('object variable export carries property types', () => {
    const info = setup().getNamedExportTypeInfo(uriOf('named.uc'), 'objV');
    expect(info.type).toBe(UcodeType.OBJECT);
    expect(info.propertyTypes.get('a')).toBe(UcodeType.INTEGER);
    expect(info.propertyTypes.get('fn')).toBe(UcodeType.FUNCTION);
    expect(info.propertyTypes.get('nested')).toBe(UcodeType.OBJECT);
  });
  test('array variable export', () => {
    expect(setup().getNamedExportTypeInfo(uriOf('named.uc'), 'arrV').type).toBe(UcodeType.ARRAY);
  });
  test('export specifier resolving to an object variable', () => {
    const info = setup().getNamedExportTypeInfo(uriOf('named.uc'), 'internal');
    expect(info.type).toBe(UcodeType.OBJECT);
    expect(info.propertyTypes.get('p')).toBe(UcodeType.INTEGER);
  });
  test('missing export → null', () => {
    expect(setup().getNamedExportTypeInfo(uriOf('named.uc'), 'nope')).toBeNull();
  });
});

describe('getDefaultExportPropertyTypes', () => {
  test('default-exported object with varied property value types', () => {
    const f = W('defaultobj.uc',
      'function helper() { return "x"; }\n' +
      'let shared = { k: 1 };\n' +
      'export default {\n' +
      '  fnProp: function() {},\n' +
      '  refFn: helper,\n' +
      '  num: 5,\n' +
      '  str: "s",\n' +
      '  bool: true,\n' +
      '  obj: { inner: 1 },\n' +
      '  arr: [1],\n' +
      '  ref: shared\n' +
      '};\n');
    const fr = new FileResolver(dir);
    const info = fr.getDefaultExportPropertyTypes('file://' + f);
    expect(info).not.toBeNull();
    const pt = info.propertyTypes;
    expect(pt.get('fnProp')).toBe(UcodeType.FUNCTION);
    expect(pt.get('refFn')).toBe(UcodeType.FUNCTION);
    expect(pt.get('num')).toBe(UcodeType.INTEGER);
    expect(pt.get('str')).toBe(UcodeType.STRING);
    expect(pt.get('bool')).toBe(UcodeType.BOOLEAN);
    expect(pt.get('obj')).toBe(UcodeType.OBJECT);
    expect(pt.get('arr')).toBe(UcodeType.ARRAY);
    expect(pt.get('ref')).toBe(UcodeType.OBJECT);
  });

  test('non-object default export → null', () => {
    const f = W('defaultnum.uc', 'export default 42;\n');
    const fr = new FileResolver(dir);
    expect(fr.getDefaultExportPropertyTypes('file://' + f)).toBeNull();
  });
});

describe('getDefaultExportFunctionReturnInfo (factory function)', () => {
  test('factory returning an object literal exposes return property types', () => {
    const f = W('factory.uc',
      'export default function create() {\n' +
      '  return {\n' +
      '    name: "n",\n' +
      '    count: 3,\n' +
      '    run: function() { return 1; }\n' +
      '  };\n' +
      '}\n');
    const fr = new FileResolver(dir);
    const info = fr.getDefaultExportFunctionReturnInfo('file://' + f);
    expect(info).not.toBeNull();
    expect(info.returnType).toBe(UcodeType.OBJECT);
    expect(info.returnPropertyTypes.get('name')).toBe(UcodeType.STRING);
    expect(info.returnPropertyTypes.get('count')).toBe(UcodeType.INTEGER);
    expect(info.returnPropertyTypes.get('run')).toBe(UcodeType.FUNCTION);
  });

  test('factory whose inner (named) function returns a known object type (uci.cursor)', () => {
    const f = W('factory2.uc',
      'export default function build(uci) {\n' +
      '  function ctx() { return uci.cursor(); }\n' +
      '  return { ctx };\n' +
      '}\n');
    const fr = new FileResolver(dir);
    const info = fr.getDefaultExportFunctionReturnInfo('file://' + f);
    expect(info).not.toBeNull();
    expect(info.propertyFunctionReturnTypes?.get('ctx')).toBe('uci.cursor');
  });

  test('default export that is not a function → null', () => {
    const f = W('factory3.uc', 'export default { a: 1 };\n');
    const fr = new FileResolver(dir);
    expect(fr.getDefaultExportFunctionReturnInfo('file://' + f)).toBeNull();
  });
});

describe('findReexportedSource', () => {
  test('follows a one-level re-export to its source module + original name', () => {
    W('orig.uc', 'export function realFn() {};\n');
    const rb = W('reexp.uc', "import { realFn } from './orig.uc';\nexport { realFn };\n");
    const fr = new FileResolver(dir);
    const r = fr.findReexportedSource('file://' + rb, 'realFn');
    expect(r).not.toBeNull();
    expect(r.uri).toBe(uriOf('orig.uc'));
    expect(r.importedName).toBe('realFn');
  });

  test('returns null when the name is not imported there', () => {
    const fr = new FileResolver(dir);
    expect(fr.findReexportedSource(uriOf('orig.uc'), 'realFn')).toBeNull();
  });
});

describe('cache management', () => {
  test('getFileContent returns file content; reflects clearCache', () => {
    const f = W('cached.uc', 'export function c() {};\n');
    const fr = new FileResolver(dir);
    expect(fr.getFileContent('file://' + f)).toContain('function c');
    // populate caches
    fr.findFunctionDefinition('file://' + f, 'c');
    fr.getModuleExports('file://' + f);
    fr.clearFileCache('file://' + f);
    fr.clearCache();
    // still resolves after clearing
    expect(fr.findFunctionDefinition('file://' + f, 'c')).not.toBeNull();
  });

  test('getFileContent returns null for a missing file', () => {
    const fr = new FileResolver(dir);
    expect(fr.getFileContent(uriOf('ghost.uc'))).toBeNull();
  });
});
