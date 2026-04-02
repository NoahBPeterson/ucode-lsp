// Tests for module return type corrections based on C source audit.
// These modules don't yet have full return-type inference through semantic analysis
// (only fs does), so we test the registry values directly.

const { ubusTypeRegistry } = require('../src/analysis/ubusTypes');
const { debugTypeRegistry } = require('../src/analysis/debugTypes');
const { resolvTypeRegistry } = require('../src/analysis/resolvTypes');
const { structTypeRegistry } = require('../src/analysis/structTypes');
const { rtnlTypeRegistry } = require('../src/analysis/rtnlTypes');
const { nl80211TypeRegistry } = require('../src/analysis/nl80211Types');

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

function getReturnType(registry, funcName) {
    const sig = registry.getFunction(funcName);
    return sig ? sig.returnType : 'NOT FOUND';
}

// ============================================================================
// ubus module — connect, open_channel need | null; guard needs | null
// C source: connect returns NULL on connection failure (runtime)
//           open_channel returns NULL on channel creation failure (runtime)
//           guard returns NULL when no handler set
// ============================================================================
check('ubus.connect returnType', getReturnType(ubusTypeRegistry, 'connect'), 'object | null');
check('ubus.open_channel returnType', getReturnType(ubusTypeRegistry, 'open_channel'), 'object | null');
check('ubus.guard returnType', getReturnType(ubusTypeRegistry, 'guard'), 'function | boolean | null');

// ============================================================================
// debug module — traceback needs | null
// C source: returns NULL when level arg is invalid (non-integer)
// ============================================================================
check('debug.traceback returnType includes null',
    getReturnType(debugTypeRegistry, 'traceback').includes('null'), true);

// ============================================================================
// resolv module — query needs | null
// C source: returns NULL when parse_options fails
// ============================================================================
check('resolv.query returnType', getReturnType(resolvTypeRegistry, 'query'), 'object | null');

// ============================================================================
// struct module — pack, unpack, new, buffer need | null
// C source: pack returns NULL on bad format/pack failure
//           unpack returns NULL on bad format, non-string buffer, bad offset
//           new returns NULL on bad format string
//           buffer returns NULL on alloc failure
// ============================================================================
check('struct.pack returnType', getReturnType(structTypeRegistry, 'pack'), 'string | null');
check('struct.unpack returnType', getReturnType(structTypeRegistry, 'unpack'), 'array | null');
check('struct.new returnType', getReturnType(structTypeRegistry, 'new'), 'struct.instance | null');
check('struct.buffer returnType', getReturnType(structTypeRegistry, 'buffer'), 'struct.buffer | null');

// ============================================================================
// rtnl module — request needs boolean in union; listener needs | null
// C source: request returns true (ack/unreplied), false (error), object/array (data), null
//           listener returns NULL on invalid callback or init failure
// ============================================================================
{
    const rt = getReturnType(rtnlTypeRegistry, 'request');
    check('rtnl.request includes boolean', rt.includes('boolean'), true);
    check('rtnl.request includes object', rt.includes('object'), true);
    check('rtnl.request includes null', rt.includes('null'), true);
}
check('rtnl.listener returnType', getReturnType(rtnlTypeRegistry, 'listener'), 'rtnl.listener | null');

// ============================================================================
// nl80211 module — request needs boolean in union; listener needs | null
// C source: same pattern as rtnl
// ============================================================================
{
    const rt = getReturnType(nl80211TypeRegistry, 'request');
    check('nl80211.request includes boolean', rt.includes('boolean'), true);
    check('nl80211.request includes object', rt.includes('object'), true);
    check('nl80211.request includes null', rt.includes('null'), true);
}
check('nl80211.listener returnType', getReturnType(nl80211TypeRegistry, 'listener'), 'nl80211.listener | null');

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
