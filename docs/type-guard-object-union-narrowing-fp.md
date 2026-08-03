# `type(x) == "object"` fails to narrow a string|object|null function-return union

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (hard-error UC5003 FPs inside a correct guard).
Found 2026-08-01 via the glinet audit
([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md),
cloud.uc:112-113,137).

## The bug

```ucode
function switch_server_format(server, src_format) {
    if (!server) return null;
    let valid_url = { "a": { api: "…", url: "…" }, … };
    for (let k in valid_url) {
        let v = valid_url[k];
        if (src_format == 1) { if (server == k) return v; }   // object shape {api,url}
        else if (server == v.url) return k;                   // string (for-in key)
    }
    return null;
}

let cloud_info = switch_server_format(server, 1);
if (type(cloud_info) == "object") {
    res.cloud_url = cloud_info.url;     // ← UC5003: Property 'url' does not exist on string
    res.api_url   = cloud_info.api;     // ← UC5003
}
…
return (type(cloud_info) == "object") ? cloud_info.api : null;   // ← UC5003 (cloud.uc:137)
```

The inferred return union is `null | {api,url}-shape | string`. Inside the
`type(…) == "object"` guard the member accesses error with "does not exist on STRING type" —
the guard kept (or fell back to) the string arm instead of selecting the object arm. Both the
if-branch and ternary-consequent forms misbehave.

Notes for the fix: type()=="object" narrowing exists and works in simpler cases (0.6.11
transitive narrowing, 0.6.158 member-path narrowing) — suspect the failure needs this
SPECIFIC union: a rich object SHAPE arm (not plain `object`) + `string` + `null`, coming from
a cross-statement function-return inference. Check whether the union is a real UnionType or a
display string at the guard site (memory: reference_union_type_representations — use
singleTypeToBase/real unions, never `===` on rich results); a string-typed union would make
the narrowing engine no-op and the member check then reports against an arbitrary arm.

## Tests

Repro above → 0 diagnostics, hover inside the guard shows the object shape (with .url/.api
completions); ternary form; `type(x) == "string"` guard narrows to string (control);
`else` edge gets string|null; a genuine `.url` on the string arm OUTSIDE the guard still
errors (true positive control).
