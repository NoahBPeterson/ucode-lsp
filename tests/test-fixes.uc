// Test the parser fixes
let x = a + b;
let result = (c + d) * e;

function outer(x) {
    function inner(y) {
        return x + y;
    }
    return inner;
}