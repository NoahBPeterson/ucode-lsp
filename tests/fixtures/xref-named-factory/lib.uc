'use strict';

// NAMED-export factory returning an object of methods.
export function create_widget(dep) {
	function do_thing(x) {
		return x;
	}
	return { do_thing };
}
