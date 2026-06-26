// Exhaustive module completeness test: verifies every module's function and
// constant lists match expected values. If a function or constant is added or
// removed from a module type file, this test will catch it.

const { MODULE_REGISTRIES } = require('../../src/analysis/moduleDispatch');

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// Expected functions per module — must match the registry exactly.
// If you add a function to a module, add it here too.
const EXPECTED_FUNCTIONS = {
    debug: ['memdump', 'traceback', 'sourcepos', 'getinfo', 'getlocal', 'setlocal', 'getupval', 'setupval'],
    digest: [
        'md5', 'sha1', 'sha256', 'md5_file', 'sha1_file', 'sha256_file',
        'md2', 'md4', 'sha384', 'sha512', 'md2_file', 'md4_file', 'sha384_file', 'sha512_file',
        'fnv1a64', 'fnv1a64_file', // upstream eff52f0
    ],
    fs: [
        'error', 'open', 'opendir', 'popen', 'readlink', 'stat', 'lstat', 'mkdir', 'rmdir',
        'symlink', 'unlink', 'getcwd', 'chdir', 'chmod', 'chown', 'rename', 'glob', 'dirname',
        'basename', 'lsdir', 'mkstemp', 'mkdtemp', 'access', 'readfile', 'writefile', 'realpath',
        'pipe', 'dup2', 'statvfs', 'fdopen',
    ],
    io: ['error', 'new', 'open', 'from', 'pipe'],
    log: ['openlog', 'syslog', 'closelog', 'ulog_open', 'ulog', 'ulog_close', 'ulog_threshold', 'INFO', 'NOTE', 'WARN', 'ERR'],
    math: ['abs', 'atan2', 'cos', 'exp', 'log', 'sin', 'sqrt', 'pow', 'rand', 'srand', 'isnan', 'deg2rad', 'rad2deg', // upstream 81066c5
      'acos', 'asin', 'atan', 'tan', 'cosh', 'sinh', 'tanh', 'expm1', 'log1p', 'log10', 'log2', 'cbrt', 'hypot', 'copysign', 'fmin', 'fmax', 'clamp', 'sign', 'signbit', 'signnz', 'isinf', 'floor', 'ceil', 'round', 'trunc'], // ext_maths 0beaa9d..3ec4e5c
    nl80211: ['error', 'request', 'waitfor', 'listener'],
    resolv: ['query', 'error'],
    rtnl: ['request', 'listener', 'error'],
    socket: ['create', 'connect', 'listen', 'sockaddr', 'nameinfo', 'addrinfo', 'poll', 'error', 'strerror', 'pair', 'open'],
    struct: ['pack', 'unpack', 'new', 'buffer'],
    // ubus.c registers BOTH global_fns AND conn_fns into the module scope (auto-docs/03)
    ubus: ['error', 'connect', 'open_channel', 'guard',                                  // global_fns
      'list', 'call', 'defer', 'publish', 'remove', 'listener', 'subscriber', 'event', 'disconnect'], // conn_fns

    uci: ['error', 'cursor'],
    uloop: [
        'error', 'init', 'run', 'timer', 'handle', 'process', 'task', 'guard',
        'done', 'end', 'cancelling', 'running', 'interval', 'signal',
    ],
    zlib: ['deflate', 'inflate', 'deflater', 'inflater'],
    // OpenWrt feed modules (ucode-mod-*) — names introspection-authoritative.
    bpf: ['open_module', 'open_map', 'open_program', 'tc_detach', 'set_debug_handler', 'error'],
    html: ['entityencode', 'entitydecode', 'striptags', 'tokenize'],
    lua: ['create'],
    uclient: ['new'],
    udebug: ['init', 'create_ring', 'get_ring', 'trace_ring', 'foreach_packet', 'pcap_file', 'pcap_udp'],
    uline: ['new', 'arg_parser', 'getpass'],
    pkgen: ['generate_key', 'load_key', 'generate_cert', 'cert_info', 'generate_pkcs12', 'error', 'errno'],
    // LuCI library binding (liblucihttp-ucode) — names introspection-authoritative,
    // identical across 22.03→main (same pinned source rev), so not version-gated.
    lucihttp: ['urlencode', 'urldecode', 'urlencoded_parser', 'multipart_parser', 'header_attribute'],
};

// Verify every module
for (const [mod, expectedFuncs] of Object.entries(EXPECTED_FUNCTIONS)) {
    const registry = MODULE_REGISTRIES[mod];
    if (!registry) {
        failed++;
        console.log(`FAIL: module "${mod}" not in MODULE_REGISTRIES`);
        continue;
    }

    const actualFuncs = registry.getFunctionNames();

    // Check no expected functions are missing from registry
    for (const fn of expectedFuncs) {
        check(`${mod}.${fn} exists in registry`, actualFuncs.includes(fn), true);
    }

    // Check no extra functions in registry that aren't in expected list
    for (const fn of actualFuncs) {
        check(`${mod}.${fn} listed in expected`, expectedFuncs.includes(fn), true);
    }

    // Check count matches
    check(`${mod} function count`, actualFuncs.length, expectedFuncs.length);
}

// Verify we tested all modules in MODULE_REGISTRIES
const testedModules = Object.keys(EXPECTED_FUNCTIONS).sort();
const allModules = Object.keys(MODULE_REGISTRIES).sort();
check('all modules tested', JSON.stringify(testedModules), JSON.stringify(allModules));

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
