# Architectural Debt

## Resolved (0.6.26-0.6.28)

### Nullable Object Types in Method Resolution — DONE

The dual type inference system has been eliminated:
- `extractModuleType()` helper makes all downstream code UnionType-tolerant
- Type checker via `MODULE_REGISTRIES` is the single source of truth
- `inferXType` cascade removed (except `inferFsType` for bare builtins)
- Module function return types are correctly nullable (e.g., `io.handle | null`)
- Namespace module calls (`import * as io; io.open()`) resolved via type checker
- Flow-sensitive hover shows correct type at each position via SSA

## Remaining

### Bare builtin `inferFsType` — minor

`inferFsType` is kept for bare builtins like `open()` (without import) that return
`fs.file`. These aren't in the type checker's `initializeBuiltins` table. Could be
moved there, but low priority since it works.

### `parseReturnTypeString` duplication

`semanticAnalyzer.ts` has `parseReturnTypeString` which duplicates `parseReturnType`
in `typeChecker.ts`. Should be consolidated into one function. Both parse return type
strings like `"string | null"` into `UcodeDataType`.

### `createXDataType` factory functions — unused by cascade

The per-module factory functions (`createFsObjectDataType`, `createIoHandleDataType`,
`createUloopObjectDataType`, `createNl80211ObjectDataType`, `createUciObjectDataType`)
are still used by `inferFsType` (for bare builtins), `cfg/dataFlowAnalyzer.ts`, and
some test code. Could be removed if those callsites migrate to `parseSingleType`.

### PBR cross-file factory chain

The `propertyFunctionReturnTypes` mechanism works but `parseReturnTypeString` was
creating incomplete `ModuleType` objects (fixed in 0.6.26). The full chain
(factory → property function → cursor.get method hover) now works.
