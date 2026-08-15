// Mega-sweep differential: analyze EVERY ucode file across the vendored trees and
// external corpora using the analyzer from <srcRoot>, and dump one normalized
// diagnostic line per finding. Run it twice (baseline worktree vs working tree)
// and diff the JSON to prove a change moved nothing — or exactly what it moved.
//
// Usage: bun run scripts/megadiff.ts <srcRoot> <outFile>
//
// Lives in the repo ON PURPOSE: it was written into the /tmp scratchpad twice and
// deleted by the overnight cleaner both times.
import * as fs from 'fs';
import * as path from 'path';

const [srcRoot, outFile] = process.argv.slice(2);
if (!srcRoot || !outFile) {
  console.error('usage: bun run scripts/megadiff.ts <srcRoot> <outFile>');
  process.exit(2);
}

const { TextDocument } = await import('vscode-languageserver-textdocument');
const { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } = await import(path.join(srcRoot, 'lexer/index'));
const { UcodeParser } = await import(path.join(srcRoot, 'parser/ucodeParser'));
const { SemanticAnalyzer } = await import(path.join(srcRoot, 'analysis/semanticAnalyzer'));

const WS = '/Users/noahpeterson/Desktop/ucode-lsp';
const HOME = process.env.HOME ?? '';
const ROOTS = [
  `${WS}/luci`, `${WS}/luci-app-podman`, `${WS}/wwand`, `${WS}/lucihttp`,
  `${WS}/ucode`, `${WS}/resources`, `${WS}/uci`, `${WS}/openwrt`,
  `${HOME}/Downloads/sft1200-fw/glinet-ucode`,
];

const OPTS = {
  enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true,
  enableUnusedVariableDetection: true, enableShadowingWarnings: true,
};

/** *.uc / *.ut, plus extensionless scripts whose shebang mentions ucode. */
function isUcodeFile(p: string): boolean {
  if (p.endsWith('.uc') || p.endsWith('.ut')) return true;
  if (path.basename(p).includes('.')) return false;
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(80);
    const n = fs.readSync(fd, buf, 0, 80, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, n).toString('utf8');
    return head.startsWith('#!') && head.includes('ucode');
  } catch { return false; }
}

function* walk(dir: string): Generator<string> {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      yield* walk(p);
    } else if (e.isFile() && isUcodeFile(p)) yield p;
  }
}

const out: Record<string, string[]> = {};
let files = 0, lines = 0, failed = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    files++;
    lines += content.split('\n').length;
    const td = TextDocument.create('file://' + file, 'ucode', 1, content);
    try {
      const isTemplate = detectTemplateMode(content);
      const lexer = new UcodeLexer(content, { rawMode: !isTemplate });
      const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
      const ast = new UcodeParser(tokens, content).parse().ast;
      const analyzer = new SemanticAnalyzer(td, OPTS);
      const res = analyzer.analyze(ast);
      out[file] = res.diagnostics
        .map((d: { range: { start: { line: number; character: number }; end: { line: number; character: number } };
                   severity?: number; code?: string | number; message: string }) =>
          `${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}`
          + ` sev${d.severity} ${d.code ?? ''} ${d.message}`)
        .sort();
    } catch (e) {
      failed++;
      out[file] = [`ANALYZE-FAIL ${String(e)}`];
    }
  }
}

fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`analyzed ${files} files, ${lines} lines (${failed} analyze-fails) -> ${outFile}`);
