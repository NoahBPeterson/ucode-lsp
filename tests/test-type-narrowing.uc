// Test file for type narrowing functionality

// Test case 1: Null union type with 'in' operator
function null_or_object(test) {
    if (type(test) == 'string') {
        return null;
    }
    if (type(test) == 'int') {
        return [5];
    }
    return {"a": 5};
}

let a = null_or_object(1); // a's type: null | array | object

if (5 in a) // Should show diagnostic: Object is possibly 'null'. Use a guard or the optional-in operator.
{
    print("found");
}

// Test case 2: Function argument with union type mismatch
function array_or_object(test) {
    if (type(test) == 'int') {
        return {"a": 5};
    }
    return [5];
}

arrtoip(array_or_object("lol")); // Should show diagnostic: Argument is possibly 'object', expected 'array'. Use a guard or assertion.

// Test case 3: Proper null guard should work
let b = null_or_object(2);
if (b != null) {
    // Inside this block, b should be narrowed to array | object
    if (5 in b) { // This should NOT show a diagnostic
        print("found in b");
    }
}

// Test case 4: Proper type guard should work
let c = array_or_object("test");
if (type(c) == 'array') {
    // Inside this block, c should be narrowed to array
    arrtoip(c); // This should NOT show a diagnostic
}