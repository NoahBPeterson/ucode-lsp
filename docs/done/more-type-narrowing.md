# Narrowing `match()` capture access after a guard — FIXED 0.7.59

Status: **IMPLEMENTED 0.7.59.** `m[2]`/`m[3]` after `if (!m || length(m) < 4) continue;`
are now `string` (not `string | null`), so `lc(m[2])` etc. don't false-warn.

## Root cause: THREE composing gaps (all in typeChecker.ts)

The `arr[i]` on `array<T> | null` is `T | null` for two reasons — the receiver may be null,
and the index may be out of bounds. The reported idiom eliminates both, but each removal was
missing:

1. **Union-base computed access ignored flow narrowing.** `checkMemberExpression`'s
   `array<T>|null` branch always returned `T | null`. It now consults
   `getNarrowedTypeAtPosition` for an identifier receiver: if narrowed to a non-null array AND
   the index is proven in bounds, it returns the bare element type. (`if (m && length(m)>2)
   m[2]` now clean.)
2. **Length in-bounds proof didn't cover early-exit guards.** `arrayIndexProvenInBounds` only
   inspected `if` *consequents*. It now also scans a block for a preceding early-exit guard
   `if (TEST) continue|break|return|die()|exit();` and applies the NEGATED test
   (`lengthLowerBound(..., negate=true)`) to later siblings — with a mutation gate
   (`arrLengthInvalidatedBetween`: a shift/pop/splice or reassignment of the array between the
   guard and the access re-nullifies).
3. **`if (!m || …) continue` didn't narrow m non-null.** The flow engine's early-exit narrowing
   handled a WHOLE-test `!m`, but not a `!m` disjunct of an `||` (`!(!m || B) = m && !B` still
   implies m non-null). `earlyExitNegatesIdentifier` generalizes it to any `!v` disjunct of a
   pure `||` early-exit.

4. **`|| ` RHS didn't narrow the receiver (doc line 11).** `collectGuards` handled `&&`-RHS
   narrowing but not `||`. In `!m || length(m) < 4`, the RHS runs only when `!m` is false, so
   `m` is non-null at the `length(m)` argument — but strict-mode arg checking flagged
   `length()` "may be null". Added the `||`-RHS case: within `B` of `A || B`, narrow by `!A`
   (reusing `earlyExitNegatesIdentifier` for a `!v` left disjunct).

Sound: an index at/above the proven bound, a base with no length guard, an `&&` early-exit
(negation is a union), or a length-reducing mutation between guard and access all keep the
`| null`. Tests: tests/inference/test-match-capture-narrowing.test.js.

---

## Original investigation sample (gl-ucode `rpc/dhcp` get_list)

```ucode
export default {
	get_list: function(args, ctx) {
		let lz = leases();
		let by_mac = {};
		// neighbours (reachable/stale = currently/recently connected)
		let neigh = ctx.popen("ip neigh show 2>/dev/null");
		if (type(neigh) != "string") neigh = "";   // narrow string|null -> string
		for (let line in split(neigh, "\n")) {
			let m = match(line, /^([0-9.]+) .* ([0-9a-fA-F:]{17}) (\w+)/);
			if (!m || length(m) < 4) continue; // `m` in length has this false diagnostic: Argument 1 of length() may be null. Use a type guard to narrow to string | array | object
			let mac = lc(m[2]); // Function 'lc': Argument is possibly 'null', expected 'string'. Use a guard or assertion => bad diag; should be narrowed to not null by previous line, no?
			let st = m[3]; // (variable) st: string | null (??? should be string) // if we have `array<string> | null`, and we eliminate null, and we know the length is >=4, then m[3] MUST be a string, no?
```