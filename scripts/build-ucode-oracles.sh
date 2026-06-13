#!/usr/bin/env bash
# Build per-OpenWrt-release ucode "oracle" binaries from the vendored ucode/ tree
# and install them on PATH as ucode_main / ucode24_10 / ucode23_05 / ucode22_03.
#
# These let us verify version-divergent syntax (see src/analysis/ucodeVersions.ts)
# against the exact ucode each OpenWrt release pins — instead of the system `ucode`,
# which is an arbitrary (often older) build. The hashes below are the
# PKG_SOURCE_VERSION from package/utils/ucode/Makefile on each OpenWrt branch.
#
# Usage:  scripts/build-ucode-oracles.sh
# Requires: cmake, a C compiler, and json-c (e.g. `brew install json-c`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UCODE_DIR="$REPO_ROOT/ucode"
BINDIR="${UCODE_ORACLE_BINDIR:-$HOME/.local/bin}"
JSONC="$(brew --prefix json-c 2>/dev/null || echo /usr/local)"

# name<TAB>git-hash (PKG_SOURCE_VERSION per OpenWrt release branch)
ORACLES=(
  "_main 3ec4e5c238353067e4b58fb9bb9938d85d59e7c2"   # main / snapshot  (2026-06-03)
  "24_10 3f64c8089bf3ea4847c96b91df09fbfcaec19e1d"   # openwrt-24.10    (2025-07-18)
  "23_05 1a8a0bcf725520820802ad433db22d8f64fbed6c"   # openwrt-23.05    (2024-07-11)
  "22_03 46d93c9cc5da6fce581df86159bd0fc4357de41c"   # openwrt-22.03    (2022-12-02)
)

# Modules needing OpenWrt-only libs (ubus/uci/libnl/...) are off; the json-c-backed
# core + fs/io/math is enough to exercise the parser/compiler (our oracle's job).
CMAKE_FLAGS=(
  -DCMAKE_PREFIX_PATH="$JSONC"
  -DUBUS_SUPPORT=OFF -DUCI_SUPPORT=OFF -DRTNL_SUPPORT=OFF -DNL80211_SUPPORT=OFF
  -DULOOP_SUPPORT=OFF -DZLIB_SUPPORT=OFF -DDIGEST_SUPPORT=OFF -DSOCKET_SUPPORT=OFF
  -DLOG_SUPPORT=OFF -DRESOLV_SUPPORT=OFF
)

mkdir -p "$BINDIR"
for entry in "${ORACLES[@]}"; do
  name="${entry%% *}"; hash="${entry##* }"
  wt="/tmp/uc-oracle-wt-$name"; bd="/tmp/uc-oracle-bd-$name"
  echo ">> building ucode$name (${hash:0:8})"
  git -C "$UCODE_DIR" worktree remove --force "$wt" 2>/dev/null || true
  rm -rf "$wt" "$bd"
  git -C "$UCODE_DIR" worktree add --detach "$wt" "$hash" >/dev/null
  cmake -S "$wt" -B "$bd" "${CMAKE_FLAGS[@]}" >/dev/null
  cmake --build "$bd" -j4 >/dev/null
  cp "$bd/ucode" "$BINDIR/ucode$name"
  git -C "$UCODE_DIR" worktree remove --force "$wt" 2>/dev/null || true
  echo "   installed $BINDIR/ucode$name"
done
echo "Done. Ensure $BINDIR is on your PATH."
