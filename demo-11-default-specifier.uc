// #11 — `default` as a brace specifier name. Both `import { default as X }` and
// `export { x as default }` (see demo-11-default-mod.uc) are valid ucode on EVERY
// version (22.03 → main, oracle-verified). The LSP used to reject them with
// "Expected identifier or string literal in import specifier" + a cascade.
//
// Run: ucode -R demo-11-default-specifier.uc   → prints 42
//   (-R because this file imports; the importer must be in module/raw mode)
import { default as Answer } from "./demo-11-default-mod.uc"; // default is colored like a keyword
print(Answer(), "\n");              // 42
