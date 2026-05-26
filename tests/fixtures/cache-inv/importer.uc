'use strict';
import { run_command } from './commands.uc';

let out = run_command("x");
let i = index(out, "ok");
print(i);
