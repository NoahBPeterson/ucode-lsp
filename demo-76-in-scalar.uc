// #76 — `in` over a non-collection. ucode's `in` NEVER throws: it returns false
// for any scalar/null right side (verified in vm.c). So this is not a *runtime*
// error — but it is ALWAYS false, which is a logic bug, so the LSP flags it as an
// error with an accurate message ("'in' over a string is always false …"), no
// longer claiming `in` "requires" a collection (which implied a throw).
//
// Run: ucode demo-76-in-scalar.uc   → prints false / false / false (exit 0, no crash)
print("x" in "hello", "\n");   // false  — LSP: always-false error (string RHS)
let n = 5;
print(2 in n, "\n");           // false  — LSP: always-false error (integer RHS)
print(1 in null, "\n");        // false  — LSP: always-false error (null RHS)

// NOT flagged — these can legitimately be collections:
function ok(o) {
    return ("k" in o);         // o is unknown → no flag
}
print(ok({ k: 1 }), "\n");     // true
