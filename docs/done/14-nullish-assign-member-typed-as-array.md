# `(obj.k ||= {})[key] = v` mis-infers `obj.k` as an array → `keys(obj.k)` false-errors

**Severity: low (narrow).** The "initialize-and-index in one expression" idiom on an object *member* mis-types the member as an array, so a later `keys()` (or other object-only operation) on it raises `Function 'keys' expects object for argument 1, but got <array>`.

## Reproduction

Real corpus: `firewall4/root/usr/share/ucode/fw4.uc:1393`:

```ucode
(rv.days ||= {})[day] = true;     // rv.days is initialized to {} (an object)
...
rv.days = keys(rv.days);          // "Function 'keys' expects object for argument 1, but got array"
```

`rv.days` is unambiguously an object (`||= {}`), so `keys(rv.days)` is valid. The LSP has inferred it as an array.

## Scope

This is **narrow** — it did not reproduce when the pieces were separated:

```ucode
let o; o ||= {}; o['k'] = true; keys(o);              // clean
let rv = {}; rv.days ||= {}; rv.days['m'] = true; keys(rv.days);   // clean
let rv = {}; (rv.days ||= {})['m'] = true; type(rv.days);          // clean
```

The mis-inference appears only in the combination present in fw4: a *member* target, the parenthesized `(member ||= {})[key] = val` form, **and** a self-referential `member = keys(member)` reassignment in the same statement. Likely the index-assignment on the parenthesized `||=` result is being treated as array-element assignment, stamping the member's type as `array`.

## Verified

`/usr/local/bin/ucode`: `keys({})` works; `keys([1,2,3])` returns null (arrays are not valid `keys()` input) — so the LSP's complaint is real *if* `rv.days` were an array, which it is not. False positive.
