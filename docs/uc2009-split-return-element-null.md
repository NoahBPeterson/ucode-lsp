# UC2009 FP: helper-return element reads typed as provable `null` (vpn-client.uc:567)

Status: **NOT STARTED - 🟢 NEEDS INVESTIGATION** (2 hard-error FPs on glinet vpn-client.uc).
Third distinct class left standing after the 0.7.81 identifier fix and the member-prewrite
ticket (docs/uc2009-member-prewrite-read-fallback.md).

## The FP

```ucode
let hp = split_host_port(item);            // user helper, returns an array
let domain = hp[0], port = (hp[1] != null) ? int(hp[1]) : null;
if (domain && domain != "" && !seen[domain]) { ... }   // UC2009: `null` can never be != ""
```

`domain != ""` (twice, vpn-client.uc:567-568) claims `domain` is provably `null`. `domain`
is `hp[0]` where `hp` is the return of a same-file helper - the return-type/element
inference is presumably typing the element as null (maybe from one `return null`-ish path
in split_host_port, or an element-type collapse on the inferred array).

Note the guard: the read sits behind `domain &&` - even IF the type were null-able, the
`&&` chain narrows it non-null before the `!= ""`; so there may be TWO stacked issues
(inferred element type too narrow AND truthiness narrowing not applied inside the `&&`
chain for this shape).

## To do

1. Extract split_host_port from vpn-client.uc, build the minimal repro, and find whether
   the bad type comes from return inference, element indexing, or the `&&`-chain narrowing.
2. Fix whichever layer; the `&&`-narrowing angle overlaps with
   docs/type-alias-early-return-inverted-narrowing.md's machinery.
