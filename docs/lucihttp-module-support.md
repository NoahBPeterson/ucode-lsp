# lucihttp: typed module support (the LuCI HTTP C binding)

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (every `import ... from 'lucihttp'`
in a LuCI codebase is UC1001/untyped today; luci-base's own http.uc uses it).

## What it is (investigated 2026-08-03, vendored lucihttp/ checkout)

lucihttp is jow's C HTTP-parsing library. It has a **ucode binding**
(lib/ucode.c, added cc85183 2022-02-13) built as the `liblucihttp-ucode`
package, installing a `lucihttp` **importable module** (a normal `.so` module
like socket/zlib — NOT an injected ambient global like uhttpd/netifd, so the
right model is the module registry + feed gating, not handler detection).

Availability: `liblucihttp-ucode` is a hard dependency of **luci-base**
(luci/modules/luci-base/Makefile:28), so it is present exactly where LuCI's
ucode runtime is — which is not every OpenWrt install. The binding predates the
22.03 branch point (Feb 2022), so per the feed-availability rule the floor is
likely **22.03**; VERIFY per pin via the reference containers
(`opkg info liblucihttp-ucode` / `apk info` in owrt-2203/2305/2410/2512 —
rebuild owrt-main first, see openwrt-ucode-pins memory) before setting
`introducedIn`.

## API surface (from lib/ucode.c, uc_module_init)

Top-level functions (uc_function_list_register):
- `multipart_parser(callback?)` → `lucihttp.parser.multipart` handle
- `urlencoded_parser(callback?)` → `lucihttp.parser.urldec` handle
- `urlencode(str, flags?)` → string | null
- `urldecode(str, flags?)` → string | null
- `header_attribute(header, attr)` → string | null
  (VERIFY each arity/nullability against the lh_uc_* implementations while
  building — same discipline as docs/ord-two-args-and-libc-signature-audit.md,
  which should fold this module in.)

Top-level integer constants (importable directly — unlike nl80211, whose
constants hide under `mod.const`): `ENCODE_FULL`, `ENCODE_IF_NEEDED`,
`ENCODE_SPACE_PLUS`, `DECODE_STRICT`, `DECODE_IF_NEEDED`, `DECODE_KEEP_PLUS`,
`DECODE_PLUS`, plus the mpart/urldec CALLBACK constants registered via
add_const_mpart/add_const_urldec (enumerate from the source).

Handle types (uc_type_declare): `lucihttp.parser.multipart` and
`lucihttp.parser.urldec`, each with a `parse(chunk)` method (mpart_fns /
urldec_fns) — two new KnownObjectTypes via the
[add-module-object-type recipe](../docs/) (registryFactory 4-step; see the
add-module-object-type memory: KnownObjectType → ObjectTypeDefinition →
returnType string → OBJECT_REGISTRIES).

Real-world usage to validate against: luci/modules/luci-base/ucode/http.uc
imports urlencode/urldecode (aliased), both parsers, header_attribute, and 4
of the constants. The luci/ checkout is a ready-made corpus for the
differential.

## Build shape

Standard module bring-up (socket/zlib precedent):
1. Module type definition (lucihttpTypes.ts) from lib/ucode.c signatures.
2. Register in OBJECT_REGISTRIES + module resolution so
   `import { urldecode } from 'lucihttp'` types and completes; constants typed
   integer; parsers return their handle types; `parse` methods on handles.
3. Version gate via module-version-gating (feed availability floor from the
   container check above). Note the extra wrinkle vs socket/zlib: availability
   depends on the liblucihttp-ucode PACKAGE (a LuCI dependency), not the ucode
   version — the gate text should say "requires liblucihttp-ucode (ships with
   LuCI)" rather than implying an OpenWrt-release floor alone.
4. Tests: import/typing/completion/hover for every export, handle-method
   resolution, constant typing, and the http.uc corpus staying clean of
   UC1001 for lucihttp names.

Related, NOT this ticket: `luci.http` / `luciplugins` / `luci.*` dotted imports
are LuCI's own ucode files — those resolve via deploy-layout mirror roots when
the luci checkout is in the workspace, no registry needed. The `_`/
`entityencode` template-scope globals seen in .ut files are the
call-scope-injection family (docs/call-scope-injection.md), also separate.
