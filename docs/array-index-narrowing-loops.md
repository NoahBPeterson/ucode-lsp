# `arr[0]` not narrowed by a `while (length(arr) > 0)` guard

Status: **investigated, not implemented.** Verified with the validator. Date: 2026-06-08.

## Symptom

```js
while (length(ARGV) > 0) {
    let cmd = ARGV[0];   // cmd : string | null   ← should be string
    shift(ARGV);
}
```

`ARGV` is `array<string>`; `length(ARGV) > 0` proves index 0 is in bounds, so `ARGV[0]` can't
be the out-of-bounds `null` — `cmd` should be `string`.

## It already works for `if`, just not loops

The LSP types `arr[index]` as `element | null` (ucode returns null past the end), but
`arrayIndexProvenInBounds` (typeChecker.ts:884) already drops the null when a
`length(arr) <op> N` guard establishes a lower bound exceeding the literal index. Verified:

```js
if (length(ARGV) > 0)    { let cmd = ARGV[0]; substr(cmd, 1); }   // ✓ no diagnostic (narrowed to string)
while (length(ARGV) > 0) { let cmd = ARGV[0]; substr(cmd, 1); }   // ✗ "Argument 1 of substr() may be null"
```

`length(ARGV) > 0` → `lengthLowerBound` = 1, and index 0 < 1 → in bounds. The logic is correct;
it simply never runs for a `while`, because the `walk` only inspects `IfStatement` consequents:

```ts
// typeChecker.ts:897-902
if (node.type === 'IfStatement' && node.consequent
    && position >= node.consequent.start && position <= node.consequent.end) {
    checkTest(node.test);
}
```

There is no branch for `WhileStatement` / `DoWhileStatement` / the test of a `ForStatement`.

## Fix design

Add loop bodies to the `walk`, reusing the existing `checkTest`/`lengthLowerBound`:

```ts
if ((node.type === 'WhileStatement' || node.type === 'ForStatement') && node.body
    && position >= node.body.start && position <= node.body.end) {
    checkTest(node.test);
}
// (do-while: the body runs before the test, so the guard does NOT hold on first entry —
//  only narrow a do-while body if you can prove ≥1 prior iteration; simplest is to skip it.)
```

### Soundness — the mutation caveat (matters more for loops)

The guard holds **on body entry**, but loops commonly mutate the guarded array (`shift`/`pop`/
`splice` — the `while (length(ARGV) > 0) { … shift(ARGV) }` idiom is exactly this). So the
narrowing is sound only **up to the first length-reducing mutation** of `arrName` in the body:

```js
while (length(ARGV) > 0) {
    let a = ARGV[0];   // ✓ in bounds (guard fresh)
    shift(ARGV);       // length now possibly 0
    let b = ARGV[0];   // ✗ NOT in bounds — must stay element | null
}
```

In the user's case `let cmd = ARGV[0]` is at the **top** of the body (before `shift`), so it's
sound. Recommended: gate the loop-body narrowing on "no `shift`/`pop`/`splice`/length-reducing
write to `arrName` textually between the body start and the access position." The existing
`if`-consequent path skips this check (mutation between an `if (length==10)` guard and the
access is rare); for loops it's common, so the mutation gate is worth adding here even though
the `if` path omits it. `for (i…; i < length(arr); …)` index loops are already handled
separately (`arrayIndexInBoundsViaLoop`) and unaffected.

### Payoff

`cmd : string` for the ubiquitous `while (length(ARGV) > 0) { let cmd = ARGV[0]; … shift(ARGV) }`
CLI-arg loop and similar `while (length(q) > 0) { q[0] … }` queue-drain patterns — removing a
class of spurious nullable-argument diagnostics.
