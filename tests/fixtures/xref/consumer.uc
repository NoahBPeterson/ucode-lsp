'use strict';

import widget_make from 'mod';        // import — NOT a reference
import { widget_help } from 'mod';     // import — NOT a reference

let a = widget_make(1);                // reference
let b = widget_make(2);                // reference

function run() {
	return widget_help();              // reference
}
