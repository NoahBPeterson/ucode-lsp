// Minimal fixture mimicking pbr/validators.uc factory pattern
function create_validators(stat_fn) {
	function is_ipv4(s) {
		return match(s, /^\d+\.\d+\.\d+\.\d+/) != null;
	}

	function is_ipv6(s) {
		return match(s, /:/) != null;
	}

	function str_contains(haystack, needle) {
		return index(haystack, needle) >= 0;
	}

	return { is_ipv4, is_ipv6, str_contains };
}

export default create_validators;
