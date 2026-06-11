// Demo: accessing a member of a provably-null value is a ucode RUNTIME error.
//
// Verified vs /usr/local/bin/ucode:
//   let x; x.foo    -> "Reference error: left-hand side expression is null"
//   let x; x[0]     -> "Reference error: left-hand side expression is null"
//   let x; x.foo()  -> "Reference error: left-hand side expression is null"
//   let x; x?.foo   -> (no error — optional chaining short-circuits to null)
//
//   Verify at a glance (Tier 1: receiver is EXACTLY null):
//     * lines 18-20 → flagged "Cannot ... a null value ... Use optional chaining (?.)"
//     * line 23 (optional chaining) → clean
//     * line 26 (guarded by `if (cfg)`) → clean (that body never runs for a null cfg)
//     * line 31 (reassigned to an object first) → clean

let cfg;            // uninitialized → null

let a = cfg.port;   // FLAGGED — property read on null
let b = cfg[0];     // FLAGGED — index into null
cfg.connect();      // FLAGGED — method call on null

let c = cfg?.port;  // clean — optional chaining

if (cfg) {
    let d = cfg.port;   // clean — unreachable for a null cfg; narrowing suppresses it
}

let conf2;
conf2 = { port: 80 };
let e = conf2.port;     // clean — reassigned to an object before access

print(a, b, c, e, "\n");

// ── Tier 2: a POSSIBLY-null value (T | null) — WARNING (crashes only if null) ──
import { open } from "fs";
import { cursor } from "uci";

let fh = open("/etc/config/x");   // fs.file | null
fh.read(64);                      // WARN — fh may be null (open can fail)

if (fh)
    fh.read(64);                  // clean — guarded

cursor().foreach("net", "iface", (s) => {});  // WARN — cursor() returns uci.cursor | null

let c = cursor();
if (c)
    c.foreach("net", "iface", (s) => {});      // clean — guarded
