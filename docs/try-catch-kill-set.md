# A catch block's unconditional write doesn't kill intermediate try-block states

Status: **OPEN — 🟡 MEDIUM PRIORITY** (root cause behind a hard-error FP on
openwrt's own `unetd`). Found 2026-08-10 while triaging the corpus damage report.

## Repro

```ucode
function f() {
	let b;
	try {
		b = "text";
		b = json(b);       // b is now the parsed value
	} catch (e) {
		b = null;          // EVERY exception path ends here
	}
	if (!b) return null;
	b.hosts ??= {};        // ← we claim `b` may still be "text"
}
```

`getNarrowedTypeAtPosition('b', …)` reports a union that still contains
`string`. It cannot: an exception anywhere in the try lands in the catch, which
assigns `null` unconditionally, and `if (!b)` then removes null. The only value
reaching the member access is the parsed one.

Real instance: `openwrt/package/network/services/unetd/files/unet.uc:829-830`.

## Why it happens

`visitTryStatement` (cfg/cfgBuilder.ts) models "an exception can fire anywhere"
with a two-end approximation — edges `preTry → catch` and `tryBlock → catch`
(added 0.8.7 to fix the opposite over-narrowing bug). That part is right. The
gap is downstream: the position-based type resolution treats every write inside
the try as potentially reaching a read *after* the try, and a write in the catch
does not kill them.

Diagnostic-visible only through checks that read the raw union — the flow engine
itself gets this right (`uc(b)` on the same variable is silent), which is why it
went unnoticed.

## Fix sketch

When a catch block writes a variable on **every** path through it (an
unconditional assignment, not inside a nested branch), the join at `try.after`
should take the catch's OUT value for that variable rather than unioning the
try's intermediate states. Equivalently: give the exception edge a kill set
derived from the catch's must-write set.

Care: with an EMPTY catch (or one that doesn't touch the variable) the current
behavior is CORRECT and must be preserved —

```ucode
let a; try { a = "t"; a = json(a); } catch (e) { }
if (a) a.k;            // ← genuinely may be "t": a TRUE positive
```

## Mitigated meanwhile

UC5003's string-member check now separates definite from possible: a receiver
that is `string` / `string|null` stays a hard **error**; a union that also admits
property-carrying members (object, array, module, unknown) is a **warning**.
That takes the red off correct code without losing the real breakage.
