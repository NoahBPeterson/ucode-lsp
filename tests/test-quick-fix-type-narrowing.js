const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Quick Fix Type Narrowing Code Actions', function() {
  this.timeout(15000);

  let lspServer;
  let getDiagnostics;
  let getCodeActions;

  before(async function() {
    lspServer = createLSPTestServer({
      capabilities: {
        textDocument: {
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ['quickfix'] }
            }
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

  async function getActionsForCode(code, filterCode) {
    const tmpFile = `/tmp/test-qf-${Date.now()}-${Math.random().toString(36).slice(2)}.uc`;
    const diagnostics = await getDiagnostics(code, tmpFile);
    const matching = diagnostics.filter(d => d.code === filterCode);
    if (matching.length === 0) return { diagnostics, actions: [], matching: [] };
    const diag = matching[0];
    const actions = await getCodeActions(tmpFile, [diag], diag.range.start.line, diag.range.start.character);
    return { diagnostics, actions, matching, diag };
  }

  function findAction(actions, titleFragment) {
    return actions.find(a => a.title.includes(titleFragment));
  }

  function getEditText(action) {
    if (!action || !action.edit || !action.edit.changes) return null;
    const keys = Object.keys(action.edit.changes);
    if (keys.length === 0) return null;
    const edits = action.edit.changes[keys[0]];
    if (!edits || edits.length === 0) return null;
    return edits[0].newText;
  }

  // Shared test code snippets
  const funcCode = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let val = maybeNull(3);
    let parts = split(val, ",");
    return parts;
}
print(process());
`;

  const loopCode = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let items = ["a", "b", "c"];
    for (let i in items) {
        let val = maybeNull(i);
        let parts = split(val, ",");
    }
}
print(process());
`;

  const topLevelCode = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
let val = maybeNull(3);
print(split(val, ","));
`;

  // ================================================================
  // 1. FUNCTION BODY
  // ================================================================
  describe('Null argument in function body', function() {

    it('should offer "Add null guard" with return', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      assert(actions.length > 0, 'Should have code actions');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should offer Add null guard');
      const text = getEditText(guard);
      assert(text.includes('if (val == null)'), `Should check null, got: ${text}`);
      assert(text.includes('return;'), `Should use return in function, got: ${text}`);
    });

    it('should NOT offer continue in function (not a loop)', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const text = getEditText(findAction(actions, 'Add null guard'));
      assert(!text.includes('continue'), 'Should NOT use continue outside a loop');
    });

    it('should NOT offer nullish coalescing', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const coalesce = findAction(actions, 'nullish coalescing');
      assert(!coalesce, 'Should NOT offer nullish coalescing');
    });

    it('should NOT offer (x as type) assertion', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const assertion = actions.find(a => a.title.includes('assertion'));
      assert(!assertion, 'Should NOT offer assertion — ucode has no as keyword');
    });
  });

  // ================================================================
  // 2. LOOP BODY
  // ================================================================
  describe('Null argument in loop body', function() {

    it('should offer "Add null guard" with continue in loop', async function() {
      const { actions } = await getActionsForCode(loopCode, 'nullable-argument');
      assert(actions.length > 0, 'Should have code actions');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should offer Add null guard');
      const text = getEditText(guard);
      assert(text.includes('if (val == null)'), `Should check null, got: ${text}`);
      assert(text.includes('continue;'), `Should use continue in loop, got: ${text}`);
    });

    it('should NOT offer return in loop', async function() {
      const { actions } = await getActionsForCode(loopCode, 'nullable-argument');
      const typeActions = actions.filter(a => !a.title.includes('Disable'));
      for (const action of typeActions) {
        const text = getEditText(action);
        if (text && text.includes('return;')) {
          assert.fail(`Should NOT offer return in loop, but action "${action.title}" contains return`);
        }
      }
    });

    it('should offer wrapping guard in loop', async function() {
      const { actions } = await getActionsForCode(loopCode, 'nullable-argument');
      const wrapGuard = findAction(actions, 'Wrap in null guard');
      assert(wrapGuard, 'Should offer wrapping guard in loop');
    });
  });

  // ================================================================
  // 3. TOP LEVEL
  // ================================================================
  describe('Null argument at top level', function() {

    it('should offer wrapping guard at top level', async function() {
      const { actions } = await getActionsForCode(topLevelCode, 'nullable-argument');
      assert(actions.length > 0, 'Should have code actions');
      const wrapGuard = findAction(actions, 'Wrap in null guard');
      assert(wrapGuard, 'Should offer wrapping guard at top level');
    });

    it('should NOT offer early return or continue at top level', async function() {
      const { actions } = await getActionsForCode(topLevelCode, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(!guard, 'Should NOT offer Add null guard (no return/continue) at top level');
    });
  });

  // ================================================================
  // 4. WRAPPING GUARD SUPPRESSED WHEN VARIABLE USED LATER
  // ================================================================
  describe('Wrapping guard scoping safety', function() {

    it('should NOT offer wrapping guard when declared variable is used later', async function() {
      // `parts` is declared on the diagnostic line and used on the next line
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let val = maybeNull(3);
    let parts = split(val, ",");
    return parts;
}
print(process());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const wrapGuard = findAction(actions, 'Wrap in null guard');
      assert(!wrapGuard, 'Should NOT offer wrap when declared variable (parts) is used later');
    });

    it('should offer wrapping guard when no variable is declared on the line', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let val = maybeNull(3);
    print(split(val, ","));
}
print(process());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const wrapGuard = findAction(actions, 'Wrap in null guard');
      assert(wrapGuard, 'Should offer wrap when line does not declare a variable');
    });

    it('should offer wrapping guard when declared variable is NOT used later', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let val = maybeNull(3);
    let unused = split(val, ",");
}
print(process());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const wrapGuard = findAction(actions, 'Wrap in null guard');
      assert(wrapGuard, 'Should offer wrap when declared variable is not used later');
    });
  });

  // ================================================================
  // 5. COMPLEX EXPRESSION (nested call)
  // ================================================================
  describe('Complex expression (nested call)', function() {

    it('should trace through function calls to offer inner type guard', async function() {
      // For split(trim(line), ","), the diagnostic on trim(line) should trace to `line`
      // and offer a type guard on it — guarding the inner variable fixes everything.
      const code = `
function process(line) {
    let parts = split(trim(line), ",");
    return parts;
}
print(process("hello"));
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        const guard = findAction(actions, 'Add type guard');
        assert(guard, `Should offer type guard on inner variable, got: ${actions.map(a => a.title).join(', ')}`);
        const text = getEditText(guard);
        assert(text.includes('type(line)'), `Guard should reference line, got: ${text}`);
      }
    });
  });

  // ================================================================
  // 6. DISABLE COMMENT
  // ================================================================
  describe('Disable comment action', function() {

    it('should always offer disable-line action', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const disableAction = findAction(actions, 'Disable ucode-lsp');
      assert(disableAction, 'Should always offer disable-line action');
    });
  });

  // ================================================================
  // 7. NULLABLE-IN-OPERATOR
  // ================================================================
  describe('nullable-in-operator diagnostics', function() {

    it('should offer null guard for nullable in-operator', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : {"key": "value"};
}
let obj = maybeNull(3);
if ("key" in obj) {
    print("found");
}
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-in-operator');
      if (matching.length > 0) {
        assert(actions.length > 0, 'Should have code actions');
        const hasGuard = actions.some(a =>
          a.title.includes('null guard') || a.title.includes('Wrap')
        );
        assert(hasGuard, 'Should offer a null-related quick fix');
      }
    });
  });

  // ================================================================
  // 8. NESTED FUNCTION RESETS LOOP CONTEXT
  // ================================================================
  describe('Nested function resets loop context', function() {

    it('should NOT offer continue inside callback in a loop', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let items = ["a", "b"];
    for (let i in items) {
        let result = map(items, function(item) {
            let val = maybeNull(item);
            let parts = split(val, ",");
            return parts;
        });
    }
}
print(process());
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        const guard = findAction(actions, 'Add null guard');
        assert(guard, 'Should offer Add null guard');
        const text = getEditText(guard);
        assert(text.includes('return;'), 'Should use return inside callback (not continue)');
        assert(!text.includes('continue;'), 'Should NOT use continue inside callback');
      }
    });
  });

  // ================================================================
  // 9. GUARD FORMAT
  // ================================================================
  describe('Guard format correctness', function() {

    it('early-exit guard should use if without braces', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      const text = getEditText(guard);
      assert(text.includes('if (val == null)'), `Should have null check, got: ${text}`);
      assert(text.includes('return;'), `Should have return, got: ${text}`);
      assert(!text.includes('{'), 'Early-exit guard should NOT use braces');
    });

    it('wrapping guard should use braces', async function() {
      // Use a code where the variable isn't used later so wrap is offered
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let val = maybeNull(3);
    print(split(val, ","));
}
print(process());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const wrapGuard = findAction(actions, 'Wrap in null guard');
      assert(wrapGuard, 'Should have wrapping guard');
      const text = getEditText(wrapGuard);
      assert(text.includes('if (val != null) {'), `Should open with brace, got: ${text}`);
      assert(text.includes('}'), 'Should close with brace');
    });
  });

  // ================================================================
  // 10. WHILE LOOP
  // ================================================================
  describe('While loop context', function() {

    it('should use continue in while loop', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let i = 0;
    while (i < 10) {
        let val = maybeNull(i);
        let parts = split(val, ",");
        i++;
    }
}
print(process());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should offer guard in while loop');
      const text = getEditText(guard);
      assert(text.includes('continue;'), 'Should use continue in while loop');
    });
  });

  // ================================================================
  // 11. FOR-IN LOOP
  // ================================================================
  describe('For-in loop context', function() {

    it('should use continue in for-in loop', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function process() {
    let obj = {"a": 1, "b": 2};
    for (let key in obj) {
        let val = maybeNull(key);
        let parts = split(val, ",");
    }
}
print(process());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should offer guard in for-in loop');
      const text = getEditText(guard);
      assert(text.includes('continue;'), 'Should use continue in for-in loop');
    });
  });

  // ================================================================
  // 12. ARROW FUNCTION
  // ================================================================
  describe('Arrow function context', function() {

    it('should offer guard inside arrow function', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
let process = () => {
    let val = maybeNull(3);
    let parts = split(val, ",");
    return parts;
};
print(process());
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        const guard = findAction(actions, 'Add null guard');
        assert(guard, 'Should offer guard inside arrow function');
      }
    });
  });

  // ================================================================
  // 13. DEEPLY NESTED
  // ================================================================
  describe('Deeply nested context', function() {

    it('should use continue in nested loop inside function', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : "hello";
}
function outer() {
    function inner() {
        let items = [1, 2, 3];
        for (let i in items) {
            let val = maybeNull(i);
            let parts = split(val, ",");
        }
    }
    return inner;
}
print(outer());
`;
      const { actions } = await getActionsForCode(code, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should offer guard in nested loop');
      const text = getEditText(guard);
      assert(text.includes('continue;'), 'Should use continue in loop even when deeply nested');
    });
  });

  // ================================================================
  // 14. ACTION TITLES
  // ================================================================
  describe('Action titles', function() {

    it('all actions should have non-empty titles and be quickfix kind', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      for (const action of actions) {
        assert(action.title && action.title.length > 0, 'Title should be non-empty');
        assert(action.kind === 'quickfix', 'Kind should be quickfix');
      }
    });

    it('guard actions should have simple generic titles', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should have guard action');
      // Title should be simple, not mention "early return" or "continue"
      assert.strictEqual(guard.title, 'Add null guard', `Title should be simple, got: ${guard.title}`);
    });
  });

  // ================================================================
  // 15. EDIT RANGE CORRECTNESS
  // ================================================================
  describe('Edit range correctness', function() {

    it('insert-before action should target line start', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should have guard');
      const edits = guard.edit.changes[Object.keys(guard.edit.changes)[0]];
      const edit = edits[0];
      assert.strictEqual(edit.range.start.character, 0, 'Should start at character 0');
      // Edit replaces the target line (prepending the guard) to avoid scroll-on-undo
      assert(edit.newText.includes('return;'), 'Edit should contain the guard');
    });
  });

  // ================================================================
  // 16. ACTION COUNT
  // ================================================================
  describe('Action count', function() {

    it('function body with var used later: 1 guard + 1 disable = 2 total', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      // funcCode has `let parts = split(val, ","); return parts;` — parts used later
      // So: Add null guard (return) + Disable = 2
      assert.strictEqual(actions.length, 2,
        `Expected 2 actions, got ${actions.length}: ${actions.map(a => a.title).join(', ')}`);
    });

    it('loop body with var used later: 1 guard + 1 wrap + 1 disable = 3 total', async function() {
      // In loopCode, `let parts = split(val, ",")` — parts is NOT used later (loop body ends)
      const { actions } = await getActionsForCode(loopCode, 'nullable-argument');
      // Add null guard (continue) + Wrap in null guard + Disable = 3
      assert.strictEqual(actions.length, 3,
        `Expected 3 actions, got ${actions.length}: ${actions.map(a => a.title).join(', ')}`);
    });
  });

  // ================================================================
  // 14. MEMBER EXPRESSION IN LOOP HEADER WITH || FALLBACK
  // ================================================================
  describe('Member expression with || fallback in loop header', function() {

    it('should suppress diagnostic for keys(data.platform || {}) — fallback covers it', async function() {
      const code = `
function process(data) {
    let lines = [];
    for (let k in keys(data.platform || {})) {
        let v = data.platform[k];
        push(lines, k);
    }
    return lines;
}
print(process({}));
`;
      // The || {} fallback guarantees keys() always gets an object, so no diagnostic
      let result = await getActionsForCode(code, 'nullable-argument');
      if (result.matching.length === 0) {
        result = await getActionsForCode(code, 'incompatible-function-argument');
      }
      assert.strictEqual(result.matching.length, 0, 'Should have no diagnostic — || {} fallback covers it');
    });

    it('should insert guard inline after declaration in one-liner function', async function() {
      const code = `
function is_dslite(iface) { let _p = network_get_protocol(iface); return _p != null && substr(_p, 0, 6) == 'dslite'; }
print(is_dslite("wan"));
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      assert(matching.length > 0, `Should have incompatible-function-argument diagnostic`);
      const guard = findAction(actions, 'Add type guard');
      assert(guard, `Should offer type guard, got: ${actions.map(a => a.title).join(', ')}`);
      // The guard should be an inline insert (not before the line), with the text
      // inserted at a character position on the same line (not at character 0)
      const edits = guard.edit.changes[Object.keys(guard.edit.changes)[0]];
      const edit = edits[0];
      assert(edit.range.start.line === edit.range.end.line, 'Should be an insert (same start/end line)');
      assert(edit.range.start.character > 0, `Should insert inline (not at char 0), got char ${edit.range.start.character}`);
      assert(edit.newText.includes('type(_p)'), `Guard should check type(_p), got: ${edit.newText}`);
      assert(edit.newText.includes('return;'), `Guard should use return, got: ${edit.newText}`);
      assert(!edit.newText.includes('\n'), `Guard should be inline (no newlines), got: ${edit.newText}`);
    });

    it('should insert guard inline for function parameter in one-liner', async function() {
      const code = `
function is_mwan4_strategy(iface) { return iface && index(iface, 'mwan4_strategy_') == 0; }
print(is_mwan4_strategy("wan"));
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      assert(matching.length > 0, `Should have incompatible-function-argument diagnostic`);
      const guard = findAction(actions, 'Add type guard');
      assert(guard, `Should offer type guard, got: ${actions.map(a => a.title).join(', ')}`);
      const edits = guard.edit.changes[Object.keys(guard.edit.changes)[0]];
      const edit = edits[0];
      assert(edit.range.start.character > 0, `Should insert inline (not at char 0), got char ${edit.range.start.character}`);
      assert(edit.newText.includes('type(iface)'), `Guard should check type(iface), got: ${edit.newText}`);
      assert(edit.newText.includes('return;'), `Guard should use return, got: ${edit.newText}`);
      assert(!edit.newText.includes('\n'), `Guard should be inline (no newlines), got: ${edit.newText}`);
      // Should NOT offer wrap action (variable is scoped inside the function)
      const wrap = findAction(actions, 'Wrap in type guard');
      assert(!wrap, `Should NOT offer wrap action for one-liner function param, got: ${actions.map(a => a.title).join(', ')}`);
    });

    it('should expand braceless for-loop into block with guard inside', async function() {
      const code = `
function process(targets, target, extra) {
    if (!targets[target]) targets[target] = [];
    for (let line in extra)
        push(targets[target], line);
}
print(process({}, "a", ["x"]));
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      assert(matching.length > 0, 'Should have incompatible-function-argument diagnostic');
      const extract = findAction(actions, 'Extract to variable');
      assert(extract, `Should offer extract action, got: ${actions.map(a => a.title).join(', ')}`);
      const text = getEditText(extract);
      // Should wrap the for-loop body in braces
      assert(text.includes('for (let line in extra) {'), `Should expand for-loop with brace, got: ${text}`);
      assert(text.includes('let _val'), `Should extract to variable, got: ${text}`);
      assert(text.includes('continue;'), `Should use continue in loop, got: ${text}`);
      assert(text.includes('push(_val, line)'), `Should replace expression in body, got: ${text}`);
      assert(text.trimEnd().endsWith('}'), `Should close the block, got: ${text}`);
    });

    it('should expand else-if branch into block with extract + guard inside', async function() {
      // Use a case where the || fallback does NOT cover the expected type
      const code = `
let verbosity = 1;
function quiet_mode(mode, uci_getter) {
    if (mode == 'on') verbosity = 0;
    else if (uci_getter) verbosity = int(uci_getter());
}
print(quiet_mode('on', null));
`;
      // int(uci_getter()) where uci_getter() returns unknown → incompatible-function-argument
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      assert(matching.length > 0, 'Should have incompatible-function-argument diagnostic');
      const extract = findAction(actions, 'Extract to variable');
      assert(extract, `Should offer extract action, got: ${actions.map(a => a.title).join(', ')}`);
      const text = getEditText(extract);
      // Should preserve else-if chain and expand body into block
      assert(text.includes('else if (uci_getter) {'), `Should keep else-if prefix, got: ${text}`);
      assert(text.includes('let _val'), `Should extract to variable inside block, got: ${text}`);
      assert(text.includes('return;') || text.includes('continue;'), `Should have guard keyword, got: ${text}`);
      assert(text.endsWith('}'), `Should close the block, got: ${text}`);
      // Should NOT have insert-before actions that break the chain
      const insertGuard = findAction(actions, 'Add null guard');
      assert(!insertGuard, `Should NOT offer insert-before guard on else line`);
    });

    it('should insert guard before if-line when diagnostic is in condition (AST-aware)', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : [1,2,3];
}
function process() {
    let items = maybeNull(3);
    if (index(items, 1) >= 0) return true;
    return false;
}
print(process());
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      assert(matching.length > 0, 'Should have nullable-argument diagnostic on index(items, ...)');
      const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable'));
      assert(guard, `Should offer a guard action, got: ${actions.map(a => a.title).join(', ')}`);
      const text = getEditText(guard);
      // Guard should be inserted BEFORE the if-line — the return; must come before the if
      assert(text.includes('return;'), `Guard should have early return, got: ${text}`);
      const returnPos = text.indexOf('return;');
      const ifPos = text.indexOf('if (index(items');
      assert(ifPos === -1 || returnPos < ifPos, `Guard return should come before the if-line, got: ${text}`);
    });

    it('should insert guard before while-loop when diagnostic is in condition', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : [1,2,3];
}
function process() {
    let items = maybeNull(3);
    while (index(items, 1) >= 0) {
        pop(items);
    }
}
print(process());
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      assert(matching.length > 0, 'Should have nullable-argument diagnostic in while condition');
      const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable'));
      assert(guard, `Should offer a guard action, got: ${actions.map(a => a.title).join(', ')}`);
      const text = getEditText(guard);
      // Guard return should come BEFORE the while line
      assert(text.includes('return;'), `Guard should have early return, got: ${text}`);
      const returnPos = text.indexOf('return;');
      const whilePos = text.indexOf('while (index(items');
      assert(whilePos === -1 || returnPos < whilePos, `Guard return should come before while, got: ${text}`);
    });

    it('should insert guard before braced if when diagnostic is in condition', async function() {
      const code = `
function maybeNull(x) {
    return x > 5 ? null : [1,2,3];
}
function process() {
    let items = maybeNull(3);
    if (index(items, 1) >= 0) {
        return true;
    }
    return false;
}
print(process());
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      assert(matching.length > 0, 'Should have nullable-argument diagnostic in braced-if condition');
      const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable'));
      assert(guard, `Should offer a guard action, got: ${actions.map(a => a.title).join(', ')}`);
      const text = getEditText(guard);
      // Guard return should come BEFORE the if-block
      assert(text.includes('return;'), `Guard should have early return, got: ${text}`);
      const returnPos = text.indexOf('return;');
      const ifBlockPos = text.indexOf('if (index(items, 1) >= 0) {');
      assert(ifBlockPos === -1 || returnPos < ifBlockPos, `Guard return should come before the if-block, got: ${text}`);
    });

    it('should never include null in type guard conditions', async function() {
      // call() expects object | null for arg 3, but "null" should be filtered out
      // since type(x) never returns "null" — guard should just be type(x) != "object"
      const code = `
function process(iface) {
    call(print, null, iface);
}
process('wan');
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      if (matching.length > 0) {
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable'));
        if (guard) {
          const text = getEditText(guard);
          assert(!text.includes('"null"'), `Guard should never include "null" type, got: ${text}`);
        }
      }
    });

    it('should generate clean type guard without null passthrough hacks', async function() {
      // Guard should be simple: type(x) != "string" && type(x) != "array" && type(x) != "object"
      // No convoluted null-passthrough logic — if the user wants null handling, they adjust it.
      const code = `
function process(x) {
    let n = length(x);
    return n;
}
print(process(null));
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      if (matching.length > 0) {
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable'));
        if (guard) {
          const text = getEditText(guard);
          assert(!text.includes('"null"'), `Guard should not reference "null" type, got: ${text}`);
          assert(!text.includes('!= null'), `Guard should not have null passthrough, got: ${text}`);
          assert(text.includes('type(x)'), `Guard should use type() checks, got: ${text}`);
        }
      }
    });

    it('should replace expression at diagnostic position, not first match on line', async function() {
      // When the same expression appears multiple times, the extract-to-variable
      // action must replace the one at the diagnostic position, not the first one.
      const code = `
let targets = {};
function install(changed) {
    for (let target in keys(targets)) {
        if (targets[target] && length(targets[target])) {
            print(targets[target]);
        }
    }
}
install(['x']);
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      if (matching.length > 0) {
        const extract = findAction(actions, 'Extract to variable');
        if (extract) {
          const text = getEditText(extract);
          // The extracted variable should replace the targets[target] inside length(),
          // NOT the first targets[target] in the truthiness check.
          // So the line should still have targets[target] before _val.
          assert(text.includes('targets[target] && length(_val)') || text.includes('targets[target] && length(_val'),
            `Should replace the expression at diagnostic position, not first match, got: ${text}`);
        }
      }
    });

    it('should tighten guard types based on downstream usages of the variable', async function() {
      // length(lines) expects string|array|object, but join('\n', lines) expects array.
      // The guard should be tightened to just array — preventing a new diagnostic on join().
      const code = `
function process(lines) {
    let n = length(lines);
    let result = join('\\n', lines);
    return n + result;
}
print(process(null));
`;
      const { actions, matching } = await getActionsForCode(code, 'incompatible-function-argument');
      assert(matching.length > 0, 'Should have diagnostic on length(lines)');
      const guard = findAction(actions, 'Add type guard');
      assert(guard, `Should offer type guard, got: ${actions.map(a => a.title).join(', ')}`);
      const text = getEditText(guard);
      // Should be tightened to just "array" — not string|array|object
      assert(text.includes('"array"'), `Guard should include array, got: ${text}`);
      assert(!text.includes('"string"'), `Guard should NOT include string (tightened by join), got: ${text}`);
      assert(!text.includes('"object"'), `Guard should NOT include object (tightened by join), got: ${text}`);
    });

    it('should narrow diagnostic range to left operand of || fallback', async function() {
      // In strict mode, int(s.timeout || '600') should highlight just s.timeout, not the whole expr
      const code = `'use strict';
function get_timeout(s) {
    let timeout = int(s.timeout || '600');
    return timeout;
}
print(get_timeout({timeout: '30'}));
`;
      const diagnostics = await getDiagnostics(code, `/tmp/test-qf-range-${Date.now()}.uc`);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      assert(matching.length > 0, 'Should have a diagnostic in strict mode');
      const diag = matching[0];
      const lineText = code.split('\n')[diag.range.start.line];
      const highlighted = lineText.substring(diag.range.start.character, diag.range.end.character);
      // Should highlight just s.timeout, not s.timeout || '600'
      assert(!highlighted.includes('||'), `Diagnostic should not include ||, got: '${highlighted}'`);
      assert(highlighted.trim().startsWith('s.timeout'), `Diagnostic should highlight s.timeout, got: '${highlighted}'`);
    });

    it('should offer "type guard with default" when || fallback exists', async function() {
      const code = `'use strict';
function get_timeout(s) {
    let timeout = int(s.timeout || '600');
    return timeout;
}
print(get_timeout({timeout: '30'}));
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length === 0) {
        // Try incompatible-function-argument
        const result2 = await getActionsForCode(code, 'incompatible-function-argument');
        assert(result2.matching.length > 0, 'Should have diagnostic in strict mode');
        var allActions = result2.actions;
      } else {
        var allActions = actions;
      }
      const defaultAction = findAction(allActions, 'type guard with default');
      assert(defaultAction, `Should offer 'type guard with default', got: ${allActions.map(a => a.title).join(', ')}`);
      const text = getEditText(defaultAction);
      // Should extract variable, add type guard with fallback
      assert(text.includes('let _val = s.timeout'), `Should extract s.timeout, got: ${text}`);
      assert(text.includes("_val = '600'"), `Should assign fallback '600', got: ${text}`);
      assert(text.includes('int(_val)'), `Should replace expr with _val, got: ${text}`);
      assert(text.includes('type(_val)'), `Should use type() guard, got: ${text}`);
    });

    // --- Statement redirect tests ---
    // When a diagnostic is inside a multi-line expression, guards must be
    // inserted before the enclosing statement, not on the diagnostic line.

    it('should redirect guard before return statement for object literal', async function() {
      const code = `'use strict';
function get_config(uci_get) {
    return {
        logging: int(uci_get('globals', 'logging') || '0'),
    };
}
print(get_config(null));
`;
      const tmpFile = `/tmp/test-qf-obj-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      assert(matching.length > 0, 'Should have diagnostic in strict mode');
      const diag = matching[0];
      const actions = await getCodeActions(tmpFile, [diag], diag.range.start.line, diag.range.start.character);
      // Should offer "type guard with default" that extracts before the return
      const defaultAction = findAction(actions, 'type guard with default');
      assert(defaultAction, `Should offer 'type guard with default', got: ${actions.map(a => a.title).join(', ')}`);
      if (defaultAction.edit && defaultAction.edit.changes) {
        const edits = Object.values(defaultAction.edit.changes)[0];
        const insertText = edits.map(e => e.newText).join('');
        assert(insertText.includes('let _val'), `Should extract to variable, got: ${insertText}`);
        assert(insertText.includes("_val = '0'"), `Should assign fallback, got: ${insertText}`);
        assert(insertText.includes('int(_val)'), `Should replace in object, got: ${insertText}`);
      }
      // Should NOT offer "Wrap" — can't wrap an object property
      const wrapAction = findAction(actions, 'Wrap in');
      assert(!wrapAction, `Should not offer wrap inside expression context`);
    });

    it('should redirect guard before multi-line variable declaration', async function() {
      // let x = [\n  length(items)\n];
      const code = `'use strict';
function process(items) {
    let results = [
        length(items),
        'done'
    ];
    return results;
}
print(process(null));
`;
      const tmpFile = `/tmp/test-qf-arr-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      if (matching.length > 0) {
        const diag = matching[0];
        const diagLine = diag.range.start.line;
        const actions = await getCodeActions(tmpFile, [diag], diagLine, diag.range.start.character);
        // Guard should be before the `let results = [` line, not inside the array
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable') && !a.title.includes('default'));
        if (guard && guard.edit && guard.edit.changes) {
          const edits = Object.values(guard.edit.changes)[0];
          for (const e of edits) {
            // The insert should target a line BEFORE the diagnostic line
            if (e.range.start.line !== undefined && e.newText.includes('return;')) {
              assert(e.range.start.line < diagLine,
                `Guard should be inserted before diagnostic line ${diagLine}, but targets line ${e.range.start.line}`);
            }
          }
        }
      }
    });

    it('should redirect guard before return for nested function call arguments', async function() {
      // return foo(\n  bar(x)\n);
      const code = `'use strict';
function foo(a, b) { return a + b; }
function process(x) {
    return foo(
        'prefix',
        int(x)
    );
}
print(process(null));
`;
      const tmpFile = `/tmp/test-qf-call-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      if (matching.length > 0) {
        const diag = matching[0];
        const diagLine = diag.range.start.line;
        const actions = await getCodeActions(tmpFile, [diag], diagLine, diag.range.start.character);
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable') && !a.title.includes('default'));
        if (guard && guard.edit && guard.edit.changes) {
          const edits = Object.values(guard.edit.changes)[0];
          for (const e of edits) {
            if (e.range.start.line !== undefined && e.newText.includes('return;')) {
              assert(e.range.start.line < diagLine,
                `Guard should be before diagnostic line ${diagLine}, got line ${e.range.start.line}`);
            }
          }
        }
      }
    });

    it('should place guard on same line for single-line return with object', async function() {
      // When the object is on the same line as return, no redirect is needed
      const code = `'use strict';
function process(x) {
    return { val: int(x) };
}
print(process(null));
`;
      const tmpFile = `/tmp/test-qf-sameline-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      if (matching.length > 0) {
        const diag = matching[0];
        const diagLine = diag.range.start.line;
        const actions = await getCodeActions(tmpFile, [diag], diagLine, diag.range.start.character);
        // Guard should be on the same line or the line before (not redirected further)
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable') && !a.title.includes('default'));
        if (guard && guard.edit && guard.edit.changes) {
          const edits = Object.values(guard.edit.changes)[0];
          for (const e of edits) {
            if (e.range.start.line !== undefined && e.newText.includes('return;')) {
              // Should be on the same line or one before (not redirected to function start)
              assert(e.range.start.line >= diagLine - 1,
                `Guard should be near diagnostic line ${diagLine}, got ${e.range.start.line}`);
            }
          }
        }
      }
    });

    it('should redirect guard before lambda assignment', async function() {
      // let fn = (x) =>\n  int(x);
      const code = `'use strict';
function make_fn() {
    let fn = (x) =>
        int(x);
    return fn;
}
print(make_fn()(null));
`;
      const tmpFile = `/tmp/test-qf-arrow-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      // Arrow function body is its own context — guard should go inside the arrow
      // or before the arrow declaration, depending on whether it's an expression body
      if (matching.length > 0) {
        const diag = matching[0];
        const actions = await getCodeActions(tmpFile, [diag], diag.range.start.line, diag.range.start.character);
        // Should have some guard action available
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Disable'));
        assert(guard, `Should offer a guard action for arrow body, got: ${actions.map(a => a.title).join(', ')}`);
      }
    });

    it('should redirect guard before multi-line expression statement', async function() {
      // print(\n  int(x)\n);
      const code = `'use strict';
function process(x) {
    print(
        int(x),
        'done'
    );
}
print(process(null));
`;
      const tmpFile = `/tmp/test-qf-expr-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      if (matching.length > 0) {
        const diag = matching[0];
        const diagLine = diag.range.start.line;
        const actions = await getCodeActions(tmpFile, [diag], diagLine, diag.range.start.character);
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable') && !a.title.includes('default'));
        if (guard && guard.edit && guard.edit.changes) {
          const edits = Object.values(guard.edit.changes)[0];
          for (const e of edits) {
            if (e.newText.includes('return;')) {
              assert(e.range.start.line < diagLine,
                `Guard should be before diagnostic line ${diagLine}, got ${e.range.start.line}`);
            }
          }
        }
      }
    });

    it('should not redirect when diagnostic is on same line as statement', async function() {
      // Normal case: let x = int(y); — no redirect needed
      const code = `'use strict';
function process(x) {
    let n = int(x);
    return n;
}
print(process(null));
`;
      const tmpFile = `/tmp/test-qf-normal-${Date.now()}.uc`;
      const diagnostics = await getDiagnostics(code, tmpFile);
      const matching = diagnostics.filter(d =>
        d.code === 'nullable-argument' || d.code === 'incompatible-function-argument'
      );
      if (matching.length > 0) {
        const diag = matching[0];
        const diagLine = diag.range.start.line;
        const actions = await getCodeActions(tmpFile, [diag], diagLine, diag.range.start.character);
        const guard = actions.find(a => a.title.includes('guard') && !a.title.includes('Wrap') && !a.title.includes('Disable') && !a.title.includes('default'));
        if (guard && guard.edit && guard.edit.changes) {
          const edits = Object.values(guard.edit.changes)[0];
          for (const e of edits) {
            if (e.newText.includes('return;')) {
              // Should be on same line (insert-before) — no redirect
              assert(e.range.start.line === diagLine,
                `Guard should be on diagnostic line ${diagLine}, got ${e.range.start.line}`);
            }
          }
        }
      }
    });

    it('should trace through nested calls: length(keys(env.x))', async function() {
      const code = `
function process(env) {
    if (type(env) != "object") return;
    let has_netifd = length(keys(env.netifd_mark)) > 0;
    return has_netifd;
}
print(process({}));
`;
      // The diagnostic on keys(env.netifd_mark) as arg to length() is nullable-argument.
      // The quick fix should trace through the AST to find env.netifd_mark (the arg to
      // keys()) and offer a type guard on it — guarding the inner variable fixes everything.
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        const guard = findAction(actions, 'Add type guard');
        assert(guard, `Should offer type guard via inner tracing, got: ${actions.map(a => a.title).join(', ')}`);
        const text = getEditText(guard);
        assert(text.includes('type(env.netifd_mark)'), `Guard should reference env.netifd_mark, got: ${text}`);
        assert(text.includes('"object"'), `Guard should check for object type, got: ${text}`);
      }
    });
  });

  describe('Extract-to-variable for nested call in sort()', function() {
    it('should not include comma in extracted expression from sort(slice(cpus), ...)', async function() {
      const code = `
function get_next_cpu(weight, prev_cpu) {
    if (disable)
        return 0;
    let sort_cpus = sort(slice(cpus), (a, b) => a.load - b.load);
    let idx = 0;
    let cpu = sort_cpus[idx].id;
    return cpu;
}
`;
      const { actions, matching, diag } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        // Diagnostic range should NOT include the comma
        const diagText = code.split('\n')[diag.range.start.line];
        const rangeText = diagText.substring(diag.range.start.character, diag.range.end.character);
        assert(!rangeText.includes(','), `Diagnostic range should not include comma, got: ${JSON.stringify(rangeText)}`);

        // Quick fix should extract slice(cpus) to a variable, not suggest type(cpus)
        const extract = findAction(actions, 'Extract to variable');
        assert(extract, `Should offer extract-to-variable, got: ${actions.map(a => a.title).join(', ')}`);
        const text = getEditText(extract);
        assert(text.includes('slice(cpus)'), `Should extract slice(cpus), got: ${text}`);
        assert(!text.includes('slice(cpus),'), `Should NOT include comma in extraction, got: ${text}`);

        // "Disable" action should be last
        const lastAction = actions[actions.length - 1];
        assert(lastAction.title.includes('Disable'), `Last action should be Disable, got: ${lastAction.title}`);
      }
    });
  });
});
