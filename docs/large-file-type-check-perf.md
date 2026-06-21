# Large-file analysis is slow (type-checker member-narrowing hotspot)

Status: **diagnosed 2026-06-21; adaptive-debounce mitigation shipped; root fix planned.**

## Symptom

Editing a large file (firewall4 `fw4.uc`, 3378 lines) feels laggy — diagnostics update
slowly as you type. Reported as a perf "regression."

## NOT a regression (measured)

fw4.uc full semantic analysis, same machine:

| Build | ms/analysis |
|---|---|
| pre-session baseline (`f6a5815`, 0.6.255, before template/object-method work) | **536** |
| HEAD (after all 0.7.x session work) | **540** |

The 4ms delta is noise. The object-method precompute pass (0.7.1) costs ~7ms here (550 vs
543 with it short-circuited) — not the cause. This is a **pre-existing** large-file cost.

## Where the time goes

Phase breakdown on fw4.uc (10-iter avg):

| Phase | ms |
|---|---|
| lex + parse | 10 |
| scope only (no typecheck, no CFG) | 47 |
| **full analysis** | **541** |
| analysis without type checking | 54 |

So **type checking is ~490ms of the 540ms.** `checkNode` is called 22k times for 14k AST
nodes (1.6× — not pathological redundancy). The dominant node type is **MemberExpression
(6934 checks)**; each identifier-receiver member access runs narrowing lookups
(`getNarrowedTypeAtPosition` → `flowBaseAt` + `legacyNarrowedTypeAtPosition`).

**Strong clue:** disabling CFG makes analysis ~**9× SLOWER** (4873ms vs 541ms). The
CFG-backed flow engine is what keeps narrowing near-linear; the legacy position-walk
narrowing is ~O(n²). Even with CFG, narrowing over 6934 member accesses is the hotspot.

## Mitigation (shipped)

Adaptive debounce (`server.ts`): analysis is synchronous CPU work, so a 540ms file blocked
the event loop on every 50ms-debounced keypause. The debounce now adapts to the file's own
last analysis cost (`debounceForDocument`: `clamp(lastAnalysisMs, 50, 750)`), so a slow file
re-analyzes at most ~once per its analysis time instead of fighting every keystroke. Fast
files stay at 50ms. This reduces *frequency* of the 540ms block during typing; it does not
make a single analysis faster.

## Fix #1 — guard-collection cache (LANDED, 0.7.2)

`legacyNarrowedTypeAtPosition` calls `getGuardsForPosition` → `collectGuards`, which walks the
AST and is a **pure function of (AST, variable, position)** (no symbol/SSA reads — verified).
It was called ~15k times per analysis. Added a per-analysis `guardCache` keyed by
`variable + position` (cleared in `setAST`; also caches the `transitiveTypeAliases` side
effect). Interleaved A/B (median of 10, 3 fresh-process rounds):

| | ms/analysis (fw4.uc) |
|---|---|
| before | 535 / 533 / 540 |
| after  | 364 / 370 / 367 |

**~32% faster**, sound (the SSA-dependent narrowing application still runs fresh per call;
only the structural guard lookup is memoized), full suite 2179/0. After this, guard
collection drops from ~340ms to ~44ms; the remaining ~367ms is distributed across member/call
checks with no single O(n²) left.

## Root fix (further work — not started)

Make member-expression type checking near-linear:
- Memoize per-analysis member-access results (same `obj.prop` chain re-checked many times).
- Ensure narrowing lookups are O(1)/O(log n), not O(statements) — investigate
  `legacyNarrowedTypeAtPosition` (the O(n²) path the CFG masks) and retire it where the flow
  engine fully covers the guard forms.
- Profile with `--cpu-prof` to confirm the exact split between `flowBaseAt`,
  `legacyNarrowedTypeAtPosition`, and registry/object-type detection.

Also compounding the felt lag: the **background workspace scan** analyzes all ~400 `.uc`
files (each large file ~540ms), blocking the event loop in chunks — see the workspace-scan
perf note. Yielding/throttling the scan would keep typing responsive while it runs.

## Reproduction

```
# time analysis of fw4.uc
bun -e 'import {readFileSync} from "fs"; import {UcodeLexer} from "./src/lexer/index.ts";
import {UcodeParser} from "./src/parser/ucodeParser.ts"; import {SemanticAnalyzer} from "./src/analysis/semanticAnalyzer.ts";
const code=readFileSync("./firewall4/root/usr/share/ucode/fw4.uc","utf8");
const doc={getText:()=>code,positionAt:o=>({line:0,character:o}),offsetAt:p=>p.character,uri:"file:///f.uc",languageId:"ucode",version:1};
const a=()=>{const lx=new UcodeLexer(code,{rawMode:true});const ast=new UcodeParser(lx.tokenize(),code).parse().ast;new SemanticAnalyzer(doc,{enableScopeAnalysis:true,enableTypeChecking:true,enableControlFlowAnalysis:true}).analyze(ast);};
a();const t=performance.now();for(let i=0;i<10;i++)a();console.log(((performance.now()-t)/10).toFixed(0),"ms");'
```
