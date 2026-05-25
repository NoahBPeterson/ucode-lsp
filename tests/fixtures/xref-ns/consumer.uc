'use strict';

import * as m from 'mod';   // namespace import — not a reference

m.thing();                  // reference via namespace

function run() {
	return m.thing();       // reference via namespace
}
