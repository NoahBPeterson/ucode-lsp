// #17 — using a let/const before its declaration. let/const are block-scoped and NOT
// hoisted in ucode, so an early read never sees the declaration below it: in strict mode
// the interpreter throws "access to undeclared variable"; in non-strict it silently reads
// null (or an outer binding), which is a guaranteed-wrong-read bug. The LSP now reports
// ONE accurate diagnostic — UC1011 "used before its declaration" (like the UC1009 it
// already gives for functions) — and correctly tells apart a reachable forward reference
// from a reference to a scope that isn't reachable.
//
// Spot-check in the editor; line-by-line expectation below. Run under strict to see ucode
// itself reject the reachable cases:  ucode demo-17-used-before-declaration.uc

// ── reachable forward reference → UC1011 "used before its declaration" ──
print(EARLY, "\n");          // UC1011 on EARLY  (declared just below, same scope)
const EARLY = 5;

function outer() {
    function g() { return captured; }   // UC1011 on `captured` (closure sees it before decl)
    let captured = 42;
    return g();
}

// ── NOT reachable → plain UC1001 "Undefined variable" (not mislabeled) ──
if (true) { let blockLocal = 1; }
print(blockLocal, "\n");     // UC1001: blockLocal is out of scope here

for (let i = 0; i < 3; i++) { /* ... */ }
print(i, "\n");              // UC1001: the loop's `i` does not escape the loop

// ── valid: declare first, then use → clean ──
const OK = 7;
print(OK, "\n");             // no diagnostic
