# UC4005 false negative: mutating an array through an alias while iterating it is missed

**Severity: low (false negative / soundness boundary).** UC4005 matches the iteratee and the mutated array by *name*, so mutating the same underlying array through a different variable name is not detected.

## Reproduction

```ucode
let a = [1, 2, 3];
let c = a;               // c aliases the same array
for (x in c) {
    push(a, x);          // real infinite loop — but no UC4005 (iteratee is 'c', mutated name is 'a')
}
```

Verified: this loops forever in `/usr/local/bin/ucode` (`for-in` over `c` sees the elements `push`ed onto the shared array via `a`).

## Discussion

This is the soundness boundary opposite to finding 58: the name-only match both over-reports (reassigned name, finding 58) and under-reports (aliased name, here). Full correctness needs object-identity / alias tracking. Documented as a known limitation of the name-based heuristic; a precise fix would track array aliases (`let c = a` makes `c` and `a` the same object).

## Fix (optional)

Track simple aliases (`let c = a;`) so UC4005 recognizes that mutating `a` affects iteration over `c`. Lower priority than 58 (under-reporting is less harmful than a false Error).
