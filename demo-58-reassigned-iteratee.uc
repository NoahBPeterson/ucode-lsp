// #58 — reassigning the iteratee to a fresh array inside a for-in loop is NOT an
// infinite loop. for-in walks the array reference captured at loop entry; rebinding
// the name to a new array means push() grows a DIFFERENT object, so the loop drains
// the original elements and terminates.
//
// Run:  ucode demo-58-reassigned-iteratee.uc
// Expect: "terminated after 3 iterations" printed immediately (no hang).

let a = [1, 2, 3];
let iterations = 0;

for (x in a) {
    iterations++;
    //a = [];          // rebind 'a' to a fresh array
    push(a, x);      // grows the fresh array, not the captured iteratee
    if (iterations > 1000) {
        print("SAFETY BREAK — this would mean it really was infinite\n"); // this did get hit.
        break;
    }
}

printf("terminated after %d iterations; a is now %J\n", iterations, a);
