# Assignment inside a `while (...)` condition — scope + narrowing gaps

> ✅ **Finding #1 FIXED 0.7.63.** `collectImplicitGlobalNames` is now SCOPE-AWARE: a bare `x = …`
> / `x++` / `for (x in …)` enters the implicit-global set only when `x` is declared in NO
> enclosing lexical scope (function params + body decls, blocks, loop headers). So a local
> reassigned in a `while`-condition (`let chunk; while ((chunk = read()) && length(chunk)) …`) is
> no longer a false UC8004, WHILE a real implicit global (a bare `x =` where x isn't declared in
> scope — even if another function has its own `let x`) still flags.
>
> ✅ **Finding #2 FIXED 0.7.64.** It DID reproduce — but only under `'use strict'` (the length()
> nullable-argument diagnostic is strict-gated, so non-strict masked it). Root cause: the `&&`
> assignment-idiom `(chunk = read()) && length(chunk)` narrowed the assigned target only when the
> `&&` LHS was a plain identifier (`chunk && …`), not an assignment. `collectGuards` (condition
> position) + `collectPositiveTestGuards` (loop/if body) now unwrap an `=` assignment LHS to its
> target and apply the truthy guard — so `(x = expr) && …` narrows `x` exactly like `x && …`.
> Verified sound: an unguarded nullable still fires, and `||` / other variables are NOT narrowed.
> 12 tests (`tests/diagnostics/test-while-condition-assignment-local.test.js`).

Status: **DONE (both findings fixed).** Reported 2026-07-05; #1 fixed 0.7.63, #2 fixed 0.7.64.

## Motivating code

```ucode
function move_file(src, dst) {
    if (rename(src, dst) == true) return true;
    let src_f = open(src, 'r');
    if (!src_f) return false;
    let dst_f = open(dst, 'w');
    if (!dst_f) { src_f.close(); return false; }
    let ok = true, chunk;
    while ((chunk = src_f.read(65536)) && length(chunk)) {   // ← the interesting line
        dst_f.write(chunk);
    }
    src_f.close();
    dst_f.close();
    return ok;
}
```

The `read()` idiom `(chunk = read()) && length(chunk)` is standard: `&&` short-circuits, so
`length(chunk)` runs only when `(chunk = read())` is truthy — i.e. `chunk` is a non-empty string,
never null. So `length(chunk)` can never receive null.

## Finding #1 (REPRODUCED) — a local assigned in a `while` condition is mis-scoped as a global

The dev build flags **UC8004** "Global 'chunk' is assigned only inside function 'move_file'" on
the `chunk` in the `while` condition. `chunk` is a **local** (`let ok = true, chunk;`), so this is
a false positive. Isolation (2026-07-05) shows it fires for the assignment-in-`while`-condition
regardless of how `chunk` is declared:

| declaration | UC8004? |
|---|---|
| `let ok = true, chunk;` then `while ((chunk = 1)) …` | ✗ (fired) |
| `let chunk;` then `while ((chunk = 1)) …` | ✗ (fired) |
| `let ok = true, chunk = null;` then `while ((chunk = 1)) …` | ✗ (fired) |

So it's **not** the multi-declarator or the missing initializer — an assignment expression used as
(part of) a `while` condition isn't resolving to the local of that name; the write is attributed to
an implicit global, tripping UC8004 (the "global assigned only inside a function" heuristic). Likely
the assignment-target resolution / definite-assignment walk doesn't descend into a `while` test's
assignment expression the way it does for a statement-position assignment. Fix: ensure a
`while`/`for`/`do` **condition** assignment resolves its target against the enclosing scope (and
feeds SSA) exactly like a statement assignment.

## Finding #2 (REPRODUCED under `'use strict'` — FIXED 0.7.64) — the reported "length() may be null"

> Re-investigation (2026-07-06): it reproduces ONLY under `'use strict'`. The culprit is the `&&`
> LHS being an ASSIGNMENT, not while-vs-if-vs-value context: `chunk && length(chunk)` narrows,
> `(chunk = read()) && length(chunk)` did not. The guard extractors now unwrap the `=` assignment
> to its target. Original (pre-fix) investigation notes below.


The original report was `length(chunk)` → "Argument 1 of length() may be null. Use a type guard to
narrow to string | array | object." In the dev build this does **not** reproduce for a typed
`fs.file` handle: `(chunk = h.read(65536)) && length(chunk)` is clean (the `&&`-RHS narrowing of the
assigned variable already works). Possible explanations, to pin down:

- The user's editor may be running an **older installed build** than the current dev `server.js`
  (the `&&`-RHS narrowing may have been added since). Confirm the running version / reload.
- The user's `open`/`read` may resolve to a **different handle type** (or an unknown/implicit
  global) whose `read()` return isn't the `string | null` that narrows cleanly — an untyped handle
  yields "unknown", not "may be null".
- Once Finding #1 is fixed and `chunk` is a proper local again, re-check whether the `&&` narrowing
  still holds inside a `while` **condition** specifically (vs an `if` — the confirmed-working case).

## Next step

Fix Finding #1 (the clear, reproduced FP), then re-run the exact motivating code and confirm the
length() narrowing holds in the `while`-condition position. If Finding #2 resurfaces, capture the
user's exact handle type + build to reproduce.

## Tests

- `while ((x = expr)) { … }` with a local `x` → no UC8004.
- `while ((chunk = h.read(n)) && length(chunk)) …` with a typed `fs.file` `h` → no "length may be
  null".
- Regression: a genuine global assigned only inside a function still gets UC8004.
