'use strict';
// Loaded via loadfile("./injector.uc")() — runs in the shared global scope, so this
// global.X assignment leaks into the caller (verified vs the interpreter).
global.uhttpd = {
    docroot: "/www",
    port: 80,
    send: function(s) { return length(s); }
};
