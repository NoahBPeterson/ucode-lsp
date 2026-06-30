# Go-to-definition returns a zero-width range for local symbols (editor highlights nothing)

**Severity: low (feature quality).** Definition of a local variable / function / parameter returns a range whose `start == end`, so jumping to the definition highlights nothing. Cross-file/imported definitions return a real span, so the behaviour is inconsistent.

## Reproduction

Go-to-definition on any local variable or function usage. `src/definition.ts` `getSymbolDefinition` (~line 213) sets:

```ts
range.start = range.end = positionAt(symbol.declaredAt)
```

→ e.g. `{line:0,character:4}` → `{line:0,character:4}` (empty). By contrast `locateFunctionDefinition` (the imported/cross-file case) returns a real identifier span.

## Fix

Return a span covering the declared identifier: `declaredAt` .. `declaredAt + name.length`, matching what the cross-file path already produces.
