// Minimal fixture mimicking pbr/platform.uc factory pattern
function create_platform(fs_mod, config, sh, pkg) {
	let env = {
		nft_installed: false,
		dnsmasq_installed: false,
	};

	function detect() {
		return true;
	}

	return { env, detect };
}

export default create_platform;
