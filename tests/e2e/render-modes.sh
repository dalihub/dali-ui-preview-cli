#!/usr/bin/env bash
# tests/e2e/render-modes.sh <docker|local> — real render of the bundled samples in
# the given runtime. Asserts exit 0, a non-blank PNG, and a valid tree JSON with a
# non-trivial node count. NOT run in github CI (needs a real runtime); run locally.
#
# Local runtime needs a native DALi prefix: pass one via DALI_PREVIEW_PREFIX or
# --dali-prefix. Docker runtime needs the daemon + the runtime image.
set -euo pipefail
MODE="${1:?usage: render-modes.sh <docker|local>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/out/cli.js"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "E2E FAIL ($MODE): $*" >&2; exit 1; }

SAMPLES=("$ROOT/samples/hello-dali.preview.dali.cpp")
# Include a richer showcase sample when present (more nodes → stronger assertion).
for extra in "$ROOT"/samples/showcase/*.preview.dali.cpp; do
  [ -e "$extra" ] && SAMPLES+=("$extra")
done

for sample in "${SAMPLES[@]}"; do
  png="$TMP/$(basename "$sample").png"
  tree="$TMP/$(basename "$sample").json"
  echo "· rendering $(basename "$sample") [$MODE]"
  node "$CLI" "$sample" --runtime "$MODE" --image "$png" > "$tree" 2> "$TMP/err.txt" \
    || { cat "$TMP/err.txt" >&2; fail "non-zero exit for $(basename "$sample")"; }
  node "$ROOT/tests/e2e/assert-render.js" "$png" "$tree" || fail "assertion failed for $(basename "$sample")"
done
echo "E2E PASS ($MODE): ${#SAMPLES[@]} sample(s)"
