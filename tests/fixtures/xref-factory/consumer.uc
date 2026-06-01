'use strict';

import make from 'factory';        // import — NOT a reference

let inst = make(1);                // factory call — receiver binding
inst.do_thing(10);                 // reference to do_thing
inst.do_thing(20);                 // reference to do_thing

function run() {
	return inst.do_thing(30);      // reference to do_thing
}
