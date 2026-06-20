# `socket.pair()` / `io.pipe()` return `array | null` with the element type lost

**Severity: low (inference gap).** These return a two-element array of handle objects, but the LSP models a bare `array | null`, so indexing into the result doesn't resolve the handle methods.

## Reproduction

```ucode
import * as socket from 'socket';
let p = socket.pair();
p[0].recv(10);      // p[0] is untyped — recv() doesn't resolve
```

Verified against the C source: `socket.pair` → 2-element array of socket instances; `io.pipe` → `[read_handle, write_handle]` of io.handle.

## Fix

Model `socket.pair()` as `array<socket> | null` and `io.pipe()` as `array<io.handle> | null`, so `pair()[0].recv()` / `pipe()[0].read()` resolve. (Consistent with ucode's generally-untyped arrays elsewhere, so lower priority, but these are fixed-shape two-handle arrays.)
