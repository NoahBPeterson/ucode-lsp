/**
 * @param {string} sid
 * @returns {object|null}
 */
export function get(sid) {
    if (type(sid) != "string") return null;
    let raw = readfile(sid);
    if (!raw) return null;
    return json(raw);
};

// No JSDoc — body inference should still carry a return type across the namespace.
export function tally(n) {
    if (!n) return null;
    return 42;
}

// Function-valued const export (arrow) — return type carried too.
export const fetch = (k) => { if (!k) return null; return json(k); };

// Plain string-returning function, no JSDoc.
export function name_of(x) { return sprintf("%s", x); }
