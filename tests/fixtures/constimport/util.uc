export const E = {
    NONE:                  0,
    PARSE_ERROR:           -32700,
    INVALID_REQUEST:       -32600,
    METHOD_NOT_FOUND:      -32601,
    INVALID_PARAMS:        -32602,
    INTERNAL_ERROR:        -32603,
    ACCESS:                -32000,
    NOT_FOUND:             -32001
};

export const NAMES = {
    OK: "ok",
    BAD: "bad"
};

export function shadow_entry(username) { return { alg: "sha256", salt: "s" }; }
export function generate_id() { return "id"; }
