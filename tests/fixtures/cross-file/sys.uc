// Minimal fixture mimicking pbr/sys.uc factory pattern
function create_sys(fs_mod, pkg) {
	function quote(s) {
		return "'" + s + "'";
	}

	function exec(cmd) {
		return '';
	}

	function run(cmd) {
		return 0;
	}

	return { quote, exec, run };
}

export default create_sys;
