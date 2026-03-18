// Minimal fixture mimicking pbr/config.uc factory pattern
function create_config(uci_mod, ubus_mod, pkg) {
	let cfg = {};

	function uci_ctx(config_name) {
		return uci_mod.cursor();
	}

	function ubus_call(path, method, args) {
		return {};
	}

	function load(sh) {
		return true;
	}

	function parse_options(raw, schema) {
		return {};
	}

	return { cfg, uci_ctx, ubus_call, load, parse_options };
}

export default create_config;
