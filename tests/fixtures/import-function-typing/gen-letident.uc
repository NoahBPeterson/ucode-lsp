'use strict';

// `return output` with `let output = "hello"` is the simple identifier case.
// 0.6.79: collectReturnTypes consults local var inits and resolves this to STRING.
export function gen_letident() {
    let output = "hello";
    return output;
}
