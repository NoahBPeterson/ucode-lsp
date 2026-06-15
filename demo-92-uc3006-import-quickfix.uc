// #92 — UC3006 "add import" quick fix for a `module.method()` use. Put the cursor on `fs`
// below and open the Quick Fix menu (Cmd+. / lightbulb). Two fixes, both producing WORKING
// code (the old preferred fix left `fs` unbound):
//
//   1. (preferred) "Add import * as fs from 'fs';"
//        -> inserts the namespace import; `fs.open(...)` works as-is, and so does every other
//           `fs.X` use in the file.
//
//   2. "Add import { open } from 'fs' and use open()"
//        -> inserts `import { open } from 'fs';` AND rewrites this call to `open("/tmp/a")`,
//           so it isn't left referencing an unbound `fs`.

let x = fs.open("/tmp/a");   // UC3006 on `fs`
