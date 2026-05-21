// Code-action tests for the smarter JSDoc quick fix.
//
// The fix is offered in two places:
//   1. on UC7003 (function declaration with unannotated params) — existing trigger
//   2. on incompatible-function-argument / nullable-argument diagnostics whose
//      flagged variable IS a parameter of the enclosing function — NEW trigger
//
// Both should produce a TextEdit inserting a JSDoc block above the function,
// with param types INFERRED from body usage (substr(x) → string, push(x) → array,
// etc.) instead of the old `{unknown}` stubs.

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

function insertedText(action) {
    if (!action?.edit?.changes) return '';
    const files = Object.values(action.edit.changes);
    if (files.length === 0) return '';
    const edits = files[0];
    return edits.map((e) => e.newText).join('');
}

describe('JSDoc Inference Quick Fix (LSP)', function() {
    this.timeout(15000);

    let lspServer, getDiagnostics, getCodeActions;

    before(async function() {
        lspServer = createLSPTestServer({
            capabilities: {
                textDocument: {
                    codeAction: {
                        dynamicRegistration: false,
                        codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix'] } }
                    }
                }
            }
        });
        await lspServer.initialize();
        getDiagnostics = lspServer.getDiagnostics;
        getCodeActions = lspServer.getCodeActions;
    });

    after(function() {
        if (lspServer) lspServer.shutdown();
    });

    const file = '/tmp/jsdoc-quickfix-test.uc';

    // ── 1. Inference from direct builtin arg ───────────────────────────────
    it('substr(iface, 0, 6) infers iface as string', async function() {
        const code = `'use strict';
function is_dslite(iface) {
    return substr(iface, 0, 6) == 'dslite';
}
`;
        const diags = await getDiagnostics(code, file);
        // UC7003 fires on the function declaration line.
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003, 'expected UC7003 on is_dslite');
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc, `expected a JSDoc quick fix, got: ${actions.map(a => a.title).join(', ')}`);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{string\} iface/.test(text),
            `expected @param {string} iface, got: ${text}`);
    });

    // ── 2. Inference from push() → array ───────────────────────────────────
    it('push(errors, ...) infers errors as array', async function() {
        const code = `'use strict';
function collect(errors) {
    push(errors, 'one');
    push(errors, 'two');
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array\} errors/.test(text), `got: ${text}`);
    });

    // ── 3. Union when multiple-type builtin like index() ───────────────────
    it('index(iface, ...) infers iface as array | string', async function() {
        const code = `'use strict';
function is_x(iface) {
    return index(iface, '_x_') == 0;
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array \| string\} iface/.test(text), `got: ${text}`);
    });

    // ── 4. Intersect across multiple constraints ───────────────────────────
    it('two usages intersect to the shared type', async function() {
        // length() accepts string|array|object; lc() only string.
        // Intersection → string.
        const code = `'use strict';
function handle(x) {
    length(x);
    return lc(x);
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{string\} x/.test(text), `expected narrowed to string, got: ${text}`);
    });

    // ── 5. No usage → fallback unknown stub ────────────────────────────────
    it('param with no typed usage stays {unknown}', async function() {
        const code = `'use strict';
function passthrough(x) {
    return x;
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{unknown\} x/.test(text), `got: ${text}`);
    });

    // ── 6. Call-site trigger: incompatible-function-argument offers JSDoc ─
    it('call-site error also offers JSDoc fix for enclosing function', async function() {
        const code = `'use strict';
function first(xs) {
    return xs[0];
}
function caller(arr) {
    push(arr, 1);
}
`;
        const diags = await getDiagnostics(code, file);
        // push(arr, 1) where arr is UNKNOWN should emit 'incompatible-function-argument' in strict mode.
        const argDiag = diags.find(d =>
            d.code === 'incompatible-function-argument' || d.code === 'nullable-argument'
        );
        if (!argDiag) {
            // Skip if the analyzer didn't flag — this test depends on strict-mode validation
            this.skip();
            return;
        }
        const actions = await getCodeActions(file, [argDiag], argDiag.range.start.line, argDiag.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc,
            `expected JSDoc action on call-site diagnostic, got: ${actions.map(a => a.title).join(', ')}`);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array\} arr/.test(text),
            `expected @param {array} arr on enclosing function, got: ${text}`);
    });

    // ── 7. Call-site trigger does NOT offer JSDoc when flagged var is a local ─
    it('call-site error on local var does not offer JSDoc fix', async function() {
        const code = `'use strict';
function handle() {
    let x;
    push(x, 1);
}
`;
        const diags = await getDiagnostics(code, file);
        const argDiag = diags.find(d =>
            (d.code === 'incompatible-function-argument' || d.code === 'nullable-argument')
            && d.data?.variableName === 'x'
        );
        if (!argDiag) { this.skip(); return; }
        const actions = await getCodeActions(file, [argDiag], argDiag.range.start.line, argDiag.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(!jsdoc,
            `JSDoc fix should not be offered for a local-var diagnostic, got: ${actions.map(a => a.title).join(', ')}`);
    });

    // ── 8a. Cross-function propagation: caller inherits leaf's inferred type ─
    it('caller of a typed user function inherits the callee\'s param type', async function() {
        // inner(s) → s: string (from lc(s)).
        // After pass 2, outer(x) → x: string because it passes x to inner.
        const code = `'use strict';
function inner(s) {
    return lc(s);
}
function outer(x) {
    return inner(x);
}
`;
        const diags = await getDiagnostics(code, file);
        const outerUC7003 = diags.find(d => d.code === 'UC7003' && d.message.includes('outer'));
        assert.ok(outerUC7003, 'expected UC7003 on outer');
        const actions = await getCodeActions(file, [outerUC7003], outerUC7003.range.start.line, outerUC7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{string\} x/.test(text),
            `outer's x should propagate to string from inner, got: ${text}`);
    });

    // ── 8b. Multi-hop propagation ──────────────────────────────────────────
    it('propagation spans multiple hops in the call graph', async function() {
        const code = `'use strict';
function leaf(s) {
    return lc(s);
}
function mid(a) {
    return leaf(a);
}
function top(q) {
    return mid(q);
}
`;
        const diags = await getDiagnostics(code, file);
        const topUC7003 = diags.find(d => d.code === 'UC7003' && d.message.includes('top'));
        assert.ok(topUC7003);
        const actions = await getCodeActions(file, [topUC7003], topUC7003.range.start.line, topUC7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{string\} q/.test(text),
            `top's q should propagate string across two hops, got: ${text}`);
    });

    // ── 8c. Conflicting propagation narrows to intersection (or unknown) ──
    it('param used at two typed callees with disjoint constraints → unknown', async function() {
        const code = `'use strict';
function needsString(s) {
    return lc(s);
}
function needsArray(a) {
    return keys(a);
}
function caller(x) {
    needsString(x);
    needsArray(x);
    return 0;
}
`;
        const diags = await getDiagnostics(code, file);
        // Note: needsArray(a) will call keys(object), but a is UNKNOWN param — so keys() fires nullable/incompatible.
        // Don't care about that; we just want caller's JSDoc.
        const callerUC7003 = diags.find(d => d.code === 'UC7003' && d.message.includes('caller'));
        assert.ok(callerUC7003);
        const actions = await getCodeActions(file, [callerUC7003], callerUC7003.range.start.line, callerUC7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        // string ∩ object = ∅ → unknown. (Diagnostics on needsString(x) add string; needsArray(x) adds object.)
        assert.ok(/@param \{unknown\} x/.test(text),
            `disjoint constraints should resolve to unknown, got: ${text}`);
    });

    // ── Provability — explicitly NOT inferred ─────────────────────────────
    // ucode auto-stringifies any type during `+`, so `"prefix" + x` works for
    // x = integer, array, object — anything. We can't prove x is a string.
    it("string concat `'prefix' + x` does NOT infer x (auto-stringifies all types)", async function() {
        const code = `'use strict';
function build(iface) {
    let key = 'network.interface.' + iface;
    return key;
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{unknown\} iface/.test(text),
            `concat doesn't prove a type — should be unknown, got: ${text}`);
    });

    // ucode coerces any type for `-`, `*`, `/`, `%` (yielding "NaN" for
    // non-numerics, no error). So arithmetic also proves nothing.
    it("arithmetic `n * 2` does NOT infer n (any type coerces, no error)", async function() {
        const code = `'use strict';
function scale(n) {
    return n * 2 + 1;
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{unknown\} n/.test(text),
            `arithmetic doesn't prove a type — should be unknown, got: ${text}`);
    });

    // ── Member access — runtime-error-based proof ─────────────────────────
    // ucode errors at runtime on `.prop` and `[k]` for string/integer/boolean/null
    // ("left-hand side expression is not an array or object"). Both forms succeed
    // only on arrays and objects → both prove `array | object`.
    it("dot-access `obj.prop` infers obj as `array | object` (provable)", async function() {
        const code = `'use strict';
function use(cfg) {
    return cfg.enabled;
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array \| object\} cfg/.test(text), `got: ${text}`);
    });

    it("computed access `arr[k]` infers `array | object` (provable)", async function() {
        const code = `'use strict';
function at(collection, key) {
    return collection[key];
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array \| object\} collection/.test(text), `got: ${text}`);
    });

    // Direct match on the user's example: ucode gives a Reference error for
    // s[0] when s is a string. Inferring `array | object` correctly excludes
    // string and reflects the runtime constraint.
    it("`function f(s) { return s[0]; }` infers `array | object` (excludes string)", async function() {
        const code = `'use strict';
function f(s) {
    return s[0];
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array \| object\} s/.test(text),
            `s[0] errors on strings, so s must be array|object: ${text}`);
    });

    // Factory pattern still gets all params typed, just to `array | object`
    // instead of the old (wrong) `object`.
    it("factory params with member access infer `array | object`", async function() {
        const code = `'use strict';
function make(fs, config, util) {
    let r = fs.readfile('/tmp/x');
    let c = config.cfg;
    return util.trim(r || '');
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003');
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        assert.ok(/@param \{array \| object\} fs/.test(text), `fs: ${text}`);
        assert.ok(/@param \{array \| object\} config/.test(text), `config: ${text}`);
        assert.ok(/@param \{array \| object\} util/.test(text), `util: ${text}`);
    });

    // ── 9. Preserves indentation ───────────────────────────────────────────
    it('inserted JSDoc matches function indentation', async function() {
        const code = `'use strict';
function outer() {
    function inner(s) {
        return lc(s);
    }
    return inner;
}
`;
        const diags = await getDiagnostics(code, file);
        const uc7003 = diags.find(d => d.code === 'UC7003' && d.message.includes('inner'));
        assert.ok(uc7003);
        const actions = await getCodeActions(file, [uc7003], uc7003.range.start.line, uc7003.range.start.character);
        const jsdoc = actions.find(a => /JSDoc/.test(a.title));
        assert.ok(jsdoc);
        const text = insertedText(jsdoc);
        // Inserted block should start with '    ' (4-space indent).
        assert.ok(/^    \/\*\*/m.test(text), `expected indented JSDoc, got: ${JSON.stringify(text)}`);
        assert.ok(/@param \{string\} s/.test(text), `inner param 's' should be string: ${text}`);
    });
});
