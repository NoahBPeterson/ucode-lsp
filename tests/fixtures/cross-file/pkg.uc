// Minimal fixture mimicking pbr/pkg.uc export pattern
let pkg = {
	name: 'test-pkg',
	version: '1.0.0',
};

let sym = {
	ok: '✅',
	fail: '❌',
};

function get_text(code) {
	return 'text for ' + code;
}

export default { pkg, sym, get_text };
