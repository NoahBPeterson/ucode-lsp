#!/usr/bin/env node
if (process.argv.includes('--stdio') ||
    process.argv.includes('--pipe') ||
    process.argv.includes('--node-ipc') ||
    process.argv.some(a => a.startsWith('--socket='))) {
    require('../dist/server.js');
} else {
    require('../dist/cli.js');
}
