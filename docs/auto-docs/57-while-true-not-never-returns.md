# `while (true)` is not treated as non-terminating — code after it isn't flagged unreachable, and such functions aren't "never-returns"

**Severity: low-medium (false negative + inconsistency).** A `while (true)` / `while (1)` infinite loop leaves the CFG with a (bogus) exit edge, so code after it is reachable in the LSP's model — unlike the equivalent `for (;;)`, which is handled correctly. This is an inconsistency between the two infinite-loop forms.

## Reproduction

```ucode
while (true) { x = 1; }
print("dead");            // NOT flagged.  But for(;;){ x=1; } print("dead"); IS flagged UC4001
```

Knock-on (never-returns):

```ucode
function spin() { while (true) { tick(); } }
function f() { spin(); print("dead"); }   // print not flagged.
                                          // The for(;;) version of spin DOES propagate never-returns.
```

Verified: the `while(true)` body never exits in `/usr/local/bin/ucode` (the after-code never runs), so it is genuinely dead.

## Root cause

`src/analysis/cfg/cfgBuilder.ts` `visitWhileStatement` (≈ lines 334-369) **unconditionally** adds a false-exit edge from the condition block to the after-loop block (lines 347-348), regardless of a constant-`true` test. `visitForStatement` only adds that edge when `node.test` exists (lines 405-412), so a testless `for(;;)` correctly leaves the after-block unreachable. The while builder never special-cases a literal-true condition, and `functionNeverReturns` (semanticAnalyzer ≈ 4194) then finds `cfg.exit` reachable, so `spin` is judged able to return.

## Fix

In `visitWhileStatement`, when the test is the constant `true` / `1` (and the body has no `break` targeting this loop), omit the condition→after edge — mirroring the testless-`for` handling. This fixes both the unreachable-code miss and the never-returns inference together.
