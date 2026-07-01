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

# Image-asset staging: a preview referencing a RELATIVE local image must actually
# render the image (not a blank frame) in this runtime. A single ImageView is the
# root so the check is independent of the container/View children API.
echo "· image-asset staging [$MODE]"
IMGDIR="$TMP/imgproj/assets"; mkdir -p "$IMGDIR"
node -e 'const fs=require("fs");const {PNG}=require("pngjs");const p=new PNG({width:256,height:256});for(let i=0;i<p.data.length;i+=4){p.data[i]=255;p.data[i+3]=255;}fs.writeFileSync(process.argv[1],PNG.sync.write(p));' "$IMGDIR/red.png"
cat > "$TMP/imgproj/img.preview.dali.cpp" <<'EOF'
ImageView pic = ImageView::New("assets/red.png");
pic.SetRequestedWidth(1200.0f);
pic.SetRequestedHeight(1000.0f);
return pic;
EOF
node "$CLI" "$TMP/imgproj/img.preview.dali.cpp" --runtime "$MODE" --image "$TMP/img.png" >/dev/null 2>"$TMP/imgerr.txt" \
  || { cat "$TMP/imgerr.txt" >&2; fail "image-render non-zero exit"; }
node -e '
const fs=require("fs");const {PNG}=require("pngjs");
const p=PNG.sync.read(fs.readFileSync(process.argv[1]));let red=0;
for(let i=0;i<p.data.length;i+=4){if(p.data[i]>200&&p.data[i+1]<60&&p.data[i+2]<60)red++;}
if(red<1000){console.error("staged image did not render (red_pixels="+red+")");process.exit(7);}
console.log("  ✓ relative-path image rendered (red_pixels="+red+")");
' "$TMP/img.png" || fail "image asset was not staged/rendered"

# Broken-image placeholder: an ImageView with an UNRESOLVABLE URL must render the
# gray placeholder (not an empty frame) so the layout is preserved.
echo "· broken-image placeholder [$MODE]"
cat > "$TMP/imgproj/broken.preview.dali.cpp" <<'EOF'
ImageView pic = ImageView::New("assets/does_not_exist.png");
pic.SetRequestedWidth(1200.0f);
pic.SetRequestedHeight(1000.0f);
return pic;
EOF
node "$CLI" "$TMP/imgproj/broken.preview.dali.cpp" --runtime "$MODE" --image "$TMP/broken.png" >/dev/null 2>"$TMP/brerr.txt" \
  || { cat "$TMP/brerr.txt" >&2; fail "broken-image render non-zero exit"; }
node -e '
const fs=require("fs");const {PNG}=require("pngjs");
const p=PNG.sync.read(fs.readFileSync(process.argv[1]));let gray=0;
for(let i=0;i<p.data.length;i+=4){const R=p.data[i],G=p.data[i+1],B=p.data[i+2],A=p.data[i+3];
  if(A>10 && R>40 && R<210 && Math.abs(R-G)<22 && Math.abs(G-B)<22 && Math.abs(R-B)<22)gray++;}
if(gray<1000){console.error("broken-image placeholder did not render (gray_pixels="+gray+")");process.exit(8);}
console.log("  ✓ broken-image placeholder rendered (gray_pixels="+gray+")");
' "$TMP/broken.png" || fail "broken-image placeholder was not rendered"

echo "E2E PASS ($MODE): ${#SAMPLES[@]} sample(s) + image staging + placeholder"
