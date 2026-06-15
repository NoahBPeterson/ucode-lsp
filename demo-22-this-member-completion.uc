// #22 — inside an object method, `this.` completes the enclosing object's properties (the
// analyzer already resolves `this` for hover/diagnostics; completion is now wired to it too).
// Put the cursor right after `this.` and trigger completion -> [name, port, greet, describe].

let server = {
    name: "router",
    port: 80,

    greet: function() {
        return "hi from " + this.;     // this.  -> name, port, greet, describe
    },

    describe: function() {
        return this.name + ":" + this.port;   // also resolves on this.name / this.port
    }
};

print(server.describe(), "\n");
