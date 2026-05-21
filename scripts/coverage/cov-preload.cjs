// Preloaded into node processes during `bun run coverage:e2e` via NODE_OPTIONS.
//
// The LSP test harness shuts the server down with `serverProcess.kill()`
// (SIGTERM). A default SIGTERM exits the process WITHOUT running the
// NODE_V8_COVERAGE flush hook, so the server's coverage would be lost. This
// handler flushes V8 coverage and exits cleanly so the spawned server's
// coverage is actually written to NODE_V8_COVERAGE.
try {
  const v8 = require('v8');
  const flushAndExit = () => {
    try { v8.takeCoverage(); } catch (_) { /* coverage not enabled */ }
    process.exit(0);
  };
  process.on('SIGTERM', flushAndExit);
  process.on('SIGINT', flushAndExit);
} catch (_) { /* v8 module unavailable — nothing to do */ }
