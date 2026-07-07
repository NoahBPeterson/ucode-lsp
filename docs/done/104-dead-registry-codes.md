> 🟡 **PARTIAL** (2026-06-15 triage). Since #103 (commit f33ca11) these are now live: INVALID_EXPORT, INVALID_OPERATION, METHOD_NOT_FOUND, PROPERTY_NOT_FOUND, MISSING_SEMICOLON (≈7 revived). Still dead: UC2001 TYPE_MISMATCH, UC2005 INVALID_RETURN_TYPE, UC4002-4004 INVALID_BREAK/CONTINUE/RETURN, UC3004 CIRCULAR_DEPENDENCY, UC9001 INTERNAL_ERROR. `src/validations/` still exists with its import commented out (server.ts:54).

# A large set of `UC####` registry codes (and the entire `src/validations/` directory) are dead — defined but never emitted

**Severity: low (dead code / wasted registry).** `errorConstants.ts` declares many codes the live analyzer never produces, and the codes that *would* correctly label the un-coded live diagnostics (finding 103) sit unused.

## Findings

Zero live emission (grep of `src/` excluding tests and the dead `src/validations/`) for: `TYPE_MISMATCH` (UC2001), `INVALID_OPERATION` (UC2002), `INVALID_RETURN_TYPE` (UC2005), `INVALID_PROPERTY_ACCESS` (UC5001), `INVALID_METHOD_CALL` (UC5002), `PROPERTY_NOT_FOUND` (UC5003), `METHOD_NOT_FOUND` (UC5004), `MISSING_SEMICOLON` (UC6003), `INVALID_EXPORT` (UC3003), `CIRCULAR_DEPENDENCY` (UC3004), `INVALID_BREAK/CONTINUE/RETURN` (UC4002-4004), `INTERNAL_ERROR` (UC9001).

The UC5xxx/UC6xxx codes *are* referenced — but only inside `src/validations/` (ast-validator, method-calls, const-reassignments, lexer), which is imported **only as a commented-out line** (`server.ts:54`), so it never runs.

## The irony

The natural codes for member-access (UC5003/UC5004) and missing-semicolon (UC6003) exist in the registry, while the live diagnostics for exactly those problems ship **un-coded** (finding 103). And `CIRCULAR_DEPENDENCY` (UC3004) exists while circular imports go undetected (finding 75).

## Fix

Either wire the dead `src/validations/` path back in (it also contains the only const-reassignment check — finding 16), or delete the dead codes and assign the live diagnostics the appropriate existing codes.

---

## Resolution (2026-07-06, this session)

- `src/validations/` DELETED (8 files; its only unique check — const reassignment — has been live
  as UC1010 for a while). The commented-out import in server.ts removed.
- Dead codes REMOVED from errorConstants.ts: UC2001 TYPE_MISMATCH, UC2005 INVALID_RETURN_TYPE,
  UC4002/4003/4004 INVALID_BREAK/CONTINUE/RETURN, UC9001 INTERNAL_ERROR.
- UC3004 CIRCULAR_DEPENDENCY kept and NOW LIVE: circular-import detection shipped this session
  (see auto-docs/75, batch H).
- UC5003/UC5004/UC6003 confirmed live (member access + missing-semicolon paths).
