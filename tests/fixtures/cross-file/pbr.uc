// Minimal fixture mimicking pbr/pbr.uc factory pattern
import create_config from 'config';
import create_sys from 'sys';
import _pkg_mod from 'pkg';

let pkg = _pkg_mod.pkg;

function create_pbr(fs_mod, uci_mod, ubus_mod) {
	let config = create_config(uci_mod, ubus_mod, pkg);
	let sh = create_sys(fs_mod, pkg);

	function start_service() {
		config.load(sh);
		return 0;
	}

	function stop_service() {
		return 0;
	}

	function netifd() {
		return {};
	}

	return { start_service, stop_service, netifd, pkg };
}

export default create_pbr;
