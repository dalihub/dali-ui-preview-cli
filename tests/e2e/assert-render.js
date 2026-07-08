/*
 * assert-render.js <png> <tree.json> — verify a real render produced a NON-BLANK
 * PNG and a valid scene tree with a non-trivial node count. Exits 0 on success,
 * non-zero with a message on failure. Used by tests/e2e/render-modes.sh for both
 * the docker and local runtimes (a render must produce visible content, not a flat
 * frame — the regression that a blank PNG would otherwise pass silently).
 */
const fs = require('fs');
const { PNG } = require('pngjs');

const [, , pngPath, treePath] = process.argv;
if (!pngPath || !treePath) {
  console.error('usage: assert-render.js <png> <tree.json>');
  process.exit(2);
}

// 1) PNG exists and is non-blank (more than one distinct pixel color).
let png;
try {
  png = PNG.sync.read(fs.readFileSync(pngPath));
} catch (e) {
  console.error(`PNG unreadable (${pngPath}): ${e.message}`);
  process.exit(3);
}
const { data, width, height } = png;
let distinct = 0;
const seen = new Set();
for (let i = 0; i < data.length && distinct < 2; i += 4) {
  const key = (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
  if (!seen.has(key)) { seen.add(key); distinct = seen.size; }
}
if (distinct < 2) {
  console.error(`PNG is a single flat color (${width}x${height}) — render is blank.`);
  process.exit(4);
}

// 2) Tree JSON is valid and has a non-trivial node count.
let tree;
try {
  tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
} catch (e) {
  console.error(`tree JSON invalid (${treePath}): ${e.message}`);
  process.exit(5);
}
const count = (n) => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
const n = count(tree);
if (n < 2) {
  console.error(`tree has too few nodes (${n}).`);
  process.exit(6);
}

// 3) All drawn nodes are on-screen (click-to-code bounds correctness). Use the
//    root's own bounds as the window rect — the exporter reports the window at
//    root, so this is self-describing regardless of the configured size.
const { checkTreeOnScreen } = require('../../out/onScreenCheck.js');
const root = tree.root || tree;
const W = (root.bounds && root.bounds.w) || width;
const H = (root.bounds && root.bounds.h) || height;
const onScreenErr = checkTreeOnScreen(tree, W, H);
if (onScreenErr) {
  console.error(onScreenErr);
  process.exit(9);
}

console.log(`  ✓ non-blank PNG ${width}x${height} (${seen.size >= 2 ? '≥2' : seen.size} colors), tree ${n} nodes`);
