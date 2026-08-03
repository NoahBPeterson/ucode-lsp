# `debug.memdump()` now accepts a numeric fd and any resource with `fileno()`

Status: **NOT STARTED — 🟢 LOW PRIORITY** (hover/signature accuracy only; we do not arg-check
memdump today, so there is no false positive — just stale docs). Found 2026-08-01 reviewing
upstream `3ec4e5c..81205a2`.

## TL;DR

Upstream `9a87ce9` ("debug: rework memdump to invoke fileno() on resource values"):
`memdump(file)` widened from `string | fs.file | fs.proc` to

```
string | number | module:fs.file | module:fs.proc | module:uloop.handle | module:socket.socket
```

Mechanics: a resource argument is no longer unwrapped as `fs.file`/`fs.proc` data — instead any
resource exposing a callable `fileno()` is called and the returned fd is `dup()`ed; a plain
integer is used as an fd directly. Verified: `memdump(1)` returns true and writes the report to
stdout (Linux docker at `81205a2`; also works on macOS).

Old behavior on current pins: only string / fs.file / fs.proc — a number or socket returns null.

## What to update

- `src/analysis/debugTypes.ts:11` — `file` param currently
  `"string | module:fs.file | module:fs.proc"`. Widen (version-gated per-member, 0.7.66 infra)
  to the union above; in practice "any resource with a fileno() method" — fs.file, fs.proc,
  socket.socket, uloop.handle are the documented ones.
- `src/builtins.ts:147` — same stale doc string for the hover.
- Return doc: still `boolean | null` — unchanged.
- We currently emit no arg-type diagnostic for memdump (verified: `memdump(true)` → silent).
  Optional follow-up: add the arg check once the union is version-gated (bool → warn on all
  targets; number → warn only below the change).
