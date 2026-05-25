// E2e lifecycle/workspace coverage for server.ts via RAW LSP protocol — the
// shared test helper hardcodes init params (always sends workspaceFolders +
// rootUri), so it can't reach the rootUri-only / rootPath-only branches of
// onInitialize, the workspace-folder capability result, the configuration
// registration, or the onDidChangeWorkspaceFolders handler body. This drives
// dist/server.js directly with custom initialize params.

import { test, expect, describe } from 'bun:test';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'dist', 'server.js');
const frame = (obj) => {
  const s = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spawn a server, send a custom initialize, wait for the response, send
// `initialized`, run an optional follow-up, briefly let async handlers run, then
// kill. Returns the parsed initialize result.
async function runServer(initParams, followups = []) {
  const proc = spawn('node', [SERVER, '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = Buffer.alloc(0);
  let initResult = null;
  proc.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    // Drain framed messages; capture the response to id:1 (initialize).
    for (;;) {
      const m = buf.toString('utf8').match(/Content-Length: (\d+)\r\n\r\n/);
      if (!m) break;
      const headerEnd = buf.indexOf('\r\n\r\n') + 4;
      const len = parseInt(m[1], 10);
      if (buf.length < headerEnd + len) break;
      const body = buf.slice(headerEnd, headerEnd + len).toString('utf8');
      buf = buf.slice(headerEnd + len);
      try { const msg = JSON.parse(body); if (msg.id === 1 && msg.result) initResult = msg.result; } catch (_) {}
    }
  });

  proc.stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initParams }));
  // Wait for the initialize response.
  for (let i = 0; i < 100 && !initResult; i++) await sleep(20);
  proc.stdin.write(frame({ jsonrpc: '2.0', method: 'initialized', params: {} }));
  await sleep(150); // let onInitialized (registration + workspace scan kickoff) run
  for (const f of followups) { proc.stdin.write(frame(f)); await sleep(150); }
  try { proc.kill(); } catch (_) {}
  return initResult;
}

describe('server.ts lifecycle / workspace (raw e2e)', () => {
  test('initialize via rootUri only (no workspaceFolders)', async () => {
    const res = await runServer({
      processId: process.pid,
      rootUri: `file://${process.cwd()}`,
      capabilities: {},
    });
    expect(res).toBeTruthy();
    expect(res.capabilities).toBeTruthy();
    expect(res.capabilities.definitionProvider).toBe(true);
  });

  test('initialize via rootPath only (no workspaceFolders / rootUri)', async () => {
    const res = await runServer({
      processId: process.pid,
      rootPath: process.cwd(),
      capabilities: {},
    });
    expect(res).toBeTruthy();
    expect(res.capabilities.hoverProvider).toBe(true);
  });

  test('workspace + configuration capabilities → folder-change registration + handler', async () => {
    const res = await runServer(
      {
        processId: process.pid,
        workspaceFolders: [{ uri: `file://${process.cwd()}`, name: 'root' }],
        capabilities: {
          workspace: { workspaceFolders: true, configuration: true },
        },
      },
      [
        // Drive the onDidChangeWorkspaceFolders handler body (add + remove).
        {
          jsonrpc: '2.0',
          method: 'workspace/didChangeWorkspaceFolders',
          params: {
            event: {
              added: [{ uri: `file://${path.join(process.cwd(), 'src')}`, name: 'src' }],
              removed: [{ uri: `file://${process.cwd()}`, name: 'root' }],
            },
          },
        },
      ]
    );
    expect(res).toBeTruthy();
    // When the client advertises the workspaceFolders capability, the server
    // echoes support for it in the initialize result.
    expect(res.capabilities.workspace).toBeTruthy();
    expect(res.capabilities.workspace.workspaceFolders.supported).toBe(true);
  });

  test('didChangeWatchedFiles handles created/changed/deleted .uc and skips non-.uc', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-watch-'));
    const ucFile = path.join(dir, 'watched.uc');
    fs.writeFileSync(ucFile, 'let x = 1;\n');
    const res = await runServer(
      {
        processId: process.pid,
        workspaceFolders: [{ uri: `file://${dir}`, name: 'w' }],
        capabilities: {},
      },
      [
        {
          jsonrpc: '2.0',
          method: 'workspace/didChangeWatchedFiles',
          params: {
            changes: [
              { uri: `file://${ucFile}`, type: 1 }, // Created → read + analyze
              { uri: `file://${ucFile}`, type: 2 }, // Changed → read + analyze
              { uri: `file://${path.join(dir, 'gone.uc')}`, type: 3 }, // Deleted → drop cache
              { uri: `file://${path.join(dir, 'notes.txt')}`, type: 2 }, // non-.uc → skipped
              { uri: `file://${path.join(dir, 'missing.uc')}`, type: 1 }, // read fails → catch
            ],
          },
        },
      ]
    );
    expect(res).toBeTruthy();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
});
