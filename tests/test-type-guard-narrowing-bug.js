const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Type Guard Narrowing Bug in Callbacks', function() {

    let lspServer;
    let getDiagnostics;

    before(async function() {
        lspServer = createLSPTestServer();
        await lspServer.initialize();
        getDiagnostics = lspServer.getDiagnostics;
    });

    after(function() {
        if (lspServer) {
            lspServer.shutdown();
        }
    });

    it('should narrow union types after type() guard checks in arrow function callbacks', async function() {
        const testPath = '/test-type-narrowing-callback.uc';

        const content = `import { cursor } from 'uci';

function to_array(x) {
    switch (type(x)) {
        case 'array': return length(x) ? x : null;
        case 'string': return [x];
    }
}

function parseBSSConfigurations() {
    cursor().foreach('umapd', null, section => {
        if (section['.type'] != 'backhaul' && section['.type'] != 'fronthaul')
            return;

        let section_auth = to_array(section.authentication);
        if (type(section_auth) == "array")
        {
            const authentication = map(section_auth, x => lc(x));
        }
        const ciphers = map(to_array(section.ciphers), x => lc(x));
        const bands = map(to_array(section.band), x => lc(x));
    });
}`;

        const diagnostics = await getDiagnostics(content, testPath);

        // Debug: Print all diagnostics
        console.log('ALL DIAGNOSTICS:', JSON.stringify(diagnostics.map(d => ({ line: d.range.start.line, message: d.message })), null, 2));

        // Find diagnostics related to our test function
        const mapWarnings = diagnostics.filter(d =>
            d.message.includes('may be null') ||
            d.message.includes('may be unknown')
        );

        console.log('MAP WARNINGS:', JSON.stringify(mapWarnings.map(d => ({ line: d.range.start.line, message: d.message })), null, 2));

        // BUG: We're getting 3 warnings but should only get 2
        // - authentication line (INSIDE guard) should NOT warn
        // - ciphers line (OUTSIDE guard) should warn
        // - bands line (OUTSIDE guard) should warn

        const lines = content.split('\n');
        const authLine = lines.findIndex(line => line.includes('const authentication = map'));
        const ciphersLine = lines.findIndex(line => line.includes('const ciphers = map'));
        const bandsLine = lines.findIndex(line => line.includes('const bands = map'));

        const warningOnAuth = mapWarnings.some(d => d.range.start.line === authLine);
        const warningOnCiphers = mapWarnings.some(d => d.range.start.line === ciphersLine);
        const warningOnBands = mapWarnings.some(d => d.range.start.line === bandsLine);

        // The authentication line should NOT have a warning (inside type guard)
        assert.strictEqual(warningOnAuth, false,
            'BUG: Should not have warning on authentication line (inside type guard in arrow callback)');

        // The ciphers and bands lines SHOULD have warnings (outside type guard)
        assert.strictEqual(warningOnCiphers, true, 'Should warn on ciphers line (outside guard)');
        assert.strictEqual(warningOnBands, true, 'Should warn on bands line (outside guard)');

        // Total count check
        assert.strictEqual(mapWarnings.length, 2,
            `Expected 2 warnings (ciphers and bands) but got ${mapWarnings.length}. Warnings: ${JSON.stringify(mapWarnings.map(d => ({ line: d.range.start.line, message: d.message })), null, 2)}`);
    });

    it('should narrow in regular functions (baseline - this should pass)', async function() {
        const testPath = '/test-narrowing-simple.uc';

        const content = `function to_array(x) {
    switch (type(x)) {
        case 'array': return length(x) ? x : null;
        case 'string': return [x];
    }
}

function test() {
    let section_auth = to_array(['psk', 'sae']);

    if (type(section_auth) == "array") {
        const result = map(section_auth, x => lc(x));
    }

    const ciphers = map(to_array(null), x => lc(x));
}`;

        const diagnostics = await getDiagnostics(content, testPath);

        const lines = content.split('\n');
        const resultLine = lines.findIndex(line => line.includes('const result = map'));
        const ciphersLine = lines.findIndex(line => line.includes('const ciphers = map'));

        const mapWarnings = diagnostics.filter(d =>
            d.message.includes('may be null') ||
            d.message.includes('may be unknown')
        );

        const warningOnResult = mapWarnings.some(d => d.range.start.line === resultLine);
        const warningOnCiphers = mapWarnings.some(d => d.range.start.line === ciphersLine);

        // In regular functions, type guards work correctly
        assert.strictEqual(warningOnResult, false, 'Should not warn inside type guard in regular function');
        assert.strictEqual(warningOnCiphers, true, 'Should warn outside type guard');
        assert.strictEqual(mapWarnings.length, 1, 'Should have exactly 1 warning in regular function');
    });

    it('should narrow inside nested callbacks', async function() {
        const testPath = '/test-narrowing-nested-callback.uc';

        const content = `function to_array(x) {
    switch (type(x)) {
        case 'array': return length(x) ? x : null;
        case 'string': return [x];
    }
}

function test() {
    const items = [1, 2, 3];
    map(items, item => {
        let val = to_array(item);
        if (type(val) == "array") {
            const result = map(val, x => x * 2);
        }
        const other = map(to_array(null), x => x);
    });
}`;

        const diagnostics = await getDiagnostics(content, testPath);

        const lines = content.split('\n');
        const resultLine = lines.findIndex(line => line.includes('const result = map'));
        const otherLine = lines.findIndex(line => line.includes('const other = map'));

        const mapWarnings = diagnostics.filter(d =>
            d.message.includes('may be null') ||
            d.message.includes('may be unknown')
        );

        const warningOnResult = mapWarnings.some(d => d.range.start.line === resultLine);
        const warningOnOther = mapWarnings.some(d => d.range.start.line === otherLine);

        // Inside type guard in callback should NOT warn
        assert.strictEqual(warningOnResult, false,
            'BUG: Should not warn inside type guard in nested callback');

        // Outside type guard should warn
        assert.strictEqual(warningOnOther, true, 'Should warn outside type guard');

        // Should have exactly 1 warning
        assert.strictEqual(mapWarnings.length, 1,
            `Expected 1 warning but got ${mapWarnings.length}`);
    });
});
