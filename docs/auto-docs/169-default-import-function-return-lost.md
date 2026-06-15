> 🟡 **PARTIAL** (2026-06-15 triage). Literal returns now propagate (`return 42`/`return "hello"` → correct UC2004), via semanticAnalyzer.ts:1256-1262 + fileResolver.ts:1111. STILL OPEN: parameter-dependent returns (`function run(a,b){return a+b;}`) stay unknown — inferNodeType (fileResolver.ts:2082) returns UNKNOWN for parameter Identifiers not in localVarInits.

# A default-imported function loses its return type

**Severity: low (cross-file inference gap).** `import D from './m.uc'` where the module does `export default someFunction` types `D` as a bare `function`, so call results are `unknown`.

## Reproduction

```ucode
// d_fn.uc:  function run(a,b){ return a+b; }  export default run;
import D from './d_fn.uc';
let r = D(1, 2);      // r: unknown
```

Mitigant: signature help DOES work for default imports — `D(` shows `D(a, b)` — so parameters cross the boundary; only the return-type / object-shape of an `export default` value is dropped.

## Fix

Propagate the return type of a default-exported function to the default-import binding (mirroring the named-import path). (Same root as finding 168.)
