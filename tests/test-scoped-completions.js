// Test that completions include symbols from scoped imports (e.g., import inside function body).
// Uses the LSP API to test what the user actually sees.

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

const testFile = '/tmp/test-scoped-completions.uc';

function completionNames(completions) {
    return (completions || []).map(c => c.label);
}

describe('Scoped Completions via LSP', function() {
    this.timeout(15000);

    let lspServer, getCompletions;

    before(async function() {
        lspServer = createLSPTestServer();
        await lspServer.initialize();
        getCompletions = lspServer.getCompletions;
    });

    after(function() {
        if (lspServer) lspServer.shutdown();
    });

    it('should complete scoped import at top level', async function() {
        const code = `import {readfile} from 'fs';
read
`;
        // cursor at line 1, char 4 (after "read")
        const completions = await getCompletions(code, testFile, 1, 4);
        const names = completionNames(completions);
        assert.ok(names.includes('readfile'),
            `Expected 'readfile' in completions, got: ${names.filter(n => n.startsWith('read')).join(', ')}`);
    });

    it('should complete scoped import inside function body', async function() {
        const code = `function create_pbr() {
    import {readfile} from 'fs';
    read
}
`;
        // cursor at line 2, char 8 (after "    read")
        const completions = await getCompletions(code, testFile, 2, 8);
        const names = completionNames(completions);
        assert.ok(names.includes('readfile'),
            `Expected 'readfile' in completions inside function, got: ${names.filter(n => n.startsWith('read')).join(', ')}`);
    });

    it('should complete function parameters inside body', async function() {
        const code = `function create_pbr(fs_mod, uci_mod) {
    fs_
}
`;
        // cursor at line 1, char 7 (after "    fs_")
        const completions = await getCompletions(code, testFile, 1, 7);
        const names = completionNames(completions);
        assert.ok(names.includes('fs_mod'),
            `Expected 'fs_mod' in completions, got: ${names.filter(n => n.startsWith('fs')).join(', ')}`);
    });

    it('should complete variables declared in enclosing function', async function() {
        const code = `function outer() {
    let outerVar = 1;
    function inner() {
        outer
    }
}
`;
        // cursor at line 3, char 13 (after "        outer")
        const completions = await getCompletions(code, testFile, 3, 13);
        const names = completionNames(completions);
        assert.ok(names.includes('outerVar'),
            `Expected 'outerVar' visible in inner function, got: ${names.filter(n => n.startsWith('outer')).join(', ')}`);
    });

    it('should always complete builtins inside any scope', async function() {
        const code = `function foo() {
    pri
}
`;
        // cursor at line 1, char 7 (after "    pri")
        const completions = await getCompletions(code, testFile, 1, 7);
        const names = completionNames(completions);
        assert.ok(names.includes('print'),
            `Expected 'print' in completions, got: ${names.filter(n => n.startsWith('pri')).join(', ')}`);
        assert.ok(names.includes('printf'),
            `Expected 'printf' in completions`);
    });
});
