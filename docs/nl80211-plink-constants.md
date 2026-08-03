# nl80211: 10 new mesh peer link constants (`NL80211_PLINK_*`)

Status: **NOT STARTED — 🟢 LOW PRIORITY** (additive constants; missing them only means no
completion/hover — no false positives, because `nl80211.const` is an `openMembers`-style dict
namespace: constants are `mod.const.X`, not importable, see memory note
`nl80211-rtnl-const-namespace`). Found 2026-08-01 reviewing upstream `3ec4e5c..81205a2`.

## TL;DR

Upstream `7d9febd` ("nl80211: add mesh peer link enum macros to constants list", merge
`aeb9d3c` "plink-const") adds to `register_constants` in `lib/nl80211.c`:

Mesh peer link **states**:
`NL80211_PLINK_LISTEN`, `NL80211_PLINK_OPN_SNT`, `NL80211_PLINK_OPN_RCVD`,
`NL80211_PLINK_CNF_RCVD`, `NL80211_PLINK_ESTAB`, `NL80211_PLINK_HOLDING`,
`NL80211_PLINK_BLOCKED`

Mesh peer link **actions**:
`NL80211_PLINK_ACTION_NO_ACTION`, `NL80211_PLINK_ACTION_OPEN`, `NL80211_PLINK_ACTION_BLOCK`

(Each has upstream JSDoc `@property` docs in the C source — reuse those descriptions.)

`grep -rn NL80211_PLINK src/` → nothing; our constant list predates this.

## Verification note

Source-verified only: nl80211 needs libnl-tiny (module doesn't build/load on macOS or plain
debian). `ADD_CONST` entries are compile-time unconditional, so `lib/nl80211.c` at `81205a2` is
the ground truth. **Updated 2026-08-01:** OpenWrt main's ucode pin is now `b885dd0` (2026-07-09),
which CONTAINS `7d9febd` — a freshly rebuilt owrt-main container (the existing local image
predates the bump) can verify `nl80211.const.NL80211_PLINK_ESTAB` live
(daemon-global-introspection memory has the container recipe).

## What to update

Wherever the nl80211 `const` member list is defined (getConstantNames() / the nl80211 registry) —
add the 10 names with the upstream doc strings, **per-member `introducedIn` version-gated**
(0.7.66 infra) to the newest/master tier, since no release pin ships them.
