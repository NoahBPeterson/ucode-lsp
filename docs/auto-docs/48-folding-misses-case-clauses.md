# Folding ranges miss individual `case`/`default` clause bodies

**Severity: low (feature coverage).** A multi-line `switch` folds only as one region; the individual `case:`/`default:` clause bodies get no fold, so long case bodies can't be collapsed individually.

## Reproduction

A `switch` with several multi-line `case` clauses → only the whole `SwitchStatement` (and any `{}` blocks) fold.

## Root cause

`src/foldingRanges.ts` `BLOCK_NODE_TYPES` folds `SwitchStatement` and `BlockStatement`, but a ucode `case:` body is not a `BlockStatement`, so no per-clause fold is produced. (TS/JS folding providers emit a fold per case clause, from the `case` line to just before the next case.)

## Fix

Emit a folding range per `case`/`default` clause (and consider distinct folds for `else`/`catch` arms), starting at the clause line and ending before the next clause.
