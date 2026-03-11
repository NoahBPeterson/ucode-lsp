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

    it('should offer extract-to-variable in function', async function() {
      const code = `
function process(line) {
    let parts = split(trim(line), ",");
    return parts;
}
print(process("hello"));
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        const extract = findAction(actions, 'Extract to variable');
        assert(extract, 'Should offer extract-to-variable');
        const text = getEditText(extract);
        assert(text.includes('let _val'), `Should declare _val, got: ${text}`);
        assert(text.includes('return;'), `Should use return in function, got: ${text}`);
      }
    });

    it('should use continue for extract-to-variable in loop', async function() {
      const code = `
function process() {
    let items = ["a", "b", "c"];
    for (let i in items) {
        let parts = split(trim(i), ",");
    }
}
print(process());
`;
      const { actions, matching } = await getActionsForCode(code, 'nullable-argument');
      if (matching.length > 0) {
        const extract = findAction(actions, 'Extract to variable');
        assert(extract, 'Should offer extract-to-variable');
        const text = getEditText(extract);
        assert(text.includes('continue;'), `Should use continue in loop, got: ${text}`);
        assert(!text.includes('return;'), `Should NOT use return in loop, got: ${text}`);
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

    it('insert-before action should insert at line start', async function() {
      const { actions } = await getActionsForCode(funcCode, 'nullable-argument');
      const guard = findAction(actions, 'Add null guard');
      assert(guard, 'Should have guard');
      const edits = guard.edit.changes[Object.keys(guard.edit.changes)[0]];
      const edit = edits[0];
      assert.strictEqual(edit.range.start.character, 0, 'Should insert at character 0');
      assert.strictEqual(edit.range.start.line, edit.range.end.line, 'Should be an insertion');
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
});
