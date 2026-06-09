# `bun test` child-process stdio is broken (stdin not delivered, stdout not captured)

Minimal repro extracted while debugging why the ucode-lsp test harness (which spawns
`node dist/server.js` and speaks LSP over its stdio) hangs/times out.

## Symptom
Under `bun test`, a spawned child process receives **0 bytes on stdin (with an immediate
`end`)** and the parent **never receives the child's stdout `data` events** — even though
the child runs and its **exit code propagates correctly**. The identical spawn under the
`bun` runtime (`bun -e` / `bun run`) and under `node` works fine.

## Environment
- bun: reproduced on **both 1.3.14 and 1.3.8** (darwin arm64)
- node (child): v25.6.1
- OS: macOS (Darwin 25.x), Apple Silicon
- Note: it *worked* under `bun test` earlier in the same session, then degraded —
  suggesting a stateful/resource trigger rather than a clean version bug. `bun -e` is
  unaffected at all times.

## Repro A — stdin not delivered (run with `bun test repro.test.js`)
```js
const { test } = require('bun:test');
const { spawn } = require('child_process');
test('stdin delivered to child?', async () => {
  // Child writes (to a FILE, bypassing any stdout capture) how many stdin bytes it got.
  const code = `const fs=require('fs');let n=0;
    process.stdin.on('data',d=>n+=d.length);
    process.stdin.on('end',()=>{fs.writeFileSync('/tmp/probe.log','got '+n+' bytes; END');process.exit(0)});
    process.stdin.resume();
    setTimeout(()=>{fs.writeFileSync('/tmp/probe.log','TIMEOUT got '+n);process.exit(0)},2500);`;
  const p = spawn('node', ['-e', code], { stdio: ['pipe', 'ignore', 'ignore'] });
  await new Promise(r => setTimeout(r, 300));
  p.stdin.write('HELLO-STDIN-PAYLOAD'); // 19 bytes
  await new Promise(r => setTimeout(r, 3000));
  p.kill();
});
// Then: cat /tmp/probe.log
//   under `bun test`        → "got 0 bytes; END"     (BROKEN)
//   under `bun -e <same>`   → "TIMEOUT got 19"        (works)
//   under `node <same>`     → "TIMEOUT got 19"        (works)
```

## Repro B — stdout not captured (run with `bun test repro.test.js`)
```js
const { test } = require('bun:test');
const { spawn } = require('child_process');
test('child stdout captured?', async () => {
  const r = await new Promise(res => {
    const p = spawn('node', ['-e', 'process.stdout.write("OK");process.exit(3)'],
                    { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', dataFired = 0;
    p.stdout.on('data', d => { dataFired++; out += d; });
    p.on('close', code => res({ out, dataFired, code }));
    setTimeout(() => { p.kill(); res({ out, dataFired, timeout: true }); }, 4000);
  });
  console.log(r);
  // under `bun test` → { out: "", dataFired: 0, code: 3 }   (exit code OK, NO stdout)
  // under `bun -e`   → "OK"                                  (works)
});
```

## Expected
Child stdin receives the written bytes; parent receives the child's stdout `data`
events — same as the `bun` runtime and `node`.
