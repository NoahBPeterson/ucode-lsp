'use strict';

import { create_widget } from 'lib';   // named import — NOT a reference

let w = create_widget(1);               // factory call — receiver
w.do_thing(10);                         // direct receiver — reference
let w2 = w;                             // alias of the receiver
w2.do_thing(20);                        // via alias — reference (dataflow)
let w3 = w2;                            // alias chain
w3.do_thing(30);                        // via chained alias — reference
