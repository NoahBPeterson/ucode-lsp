'use strict';

// Default-exported factory returning an object of methods (mirrors create_sys).
function make(dep) {
	function do_thing(x) {
		return x;
	}
	function unused_method() {
		return 0;
	}
	return { do_thing, unused_method };
}

export default make;
