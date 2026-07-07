"use strict";
/*
 * reportFormatter.ts — self-contained HTML / Markdown render report
 * (M3/WU-2: F3.2).
 *
 * From one render, produce a single shareable file combining the rendered PNG,
 * the box-drawing tree (WU-1), and a flat node table. The output format is chosen
 * by the destination file extension:
 *
 *   - `.html` : the PNG embedded as a base64 `data:` URI `<img>`, the box-tree in
 *               a `<pre>`, and a `<table>` of nodes (mark / id / type / role /
 *               bounds). Fully self-contained — no external assets.
 *   - `.md`   : the PNG embedded as a base64 data-URI image, the box-tree in a
 *               fenced code block, and a Markdown node table.
 *
 * The only inputs are the rendered PNG path (`RenderResult.pngPath`) and the
 * canonical tree (carrying `mark`/`id`/`bounds`). `writeReport` reads the PNG and
 * writes the report file; everything else (the two render functions) is pure and
 * unit-testable without fs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderHtmlReport = renderHtmlReport;
exports.renderMarkdownReport = renderMarkdownReport;
exports.writeReport = writeReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const treeFormatter_1 = require("./treeFormatter");
const treeQuery_1 = require("../treeQuery");
/** Numeric `{x,y,w,h}` lifted off a node, or null when missing/non-numeric. */
function boundsText(node) {
    const b = node.bounds;
    if (b === null || typeof b !== 'object') {
        return '—';
    }
    const { x, y, w, h } = b;
    if (typeof x !== 'number' || typeof y !== 'number' ||
        typeof w !== 'number' || typeof h !== 'number') {
        return '—';
    }
    return `${w}x${h} @ ${x},${y}`;
}
/** Flatten the tree to table rows in pre-order (the same order the tree prints). */
function nodeRows(root) {
    const rows = [];
    (0, treeQuery_1.forEachNode)(root, (node) => {
        rows.push({
            mark: typeof node.mark === 'number' ? String(node.mark) : '',
            id: typeof node.id === 'string' ? node.id : '',
            type: typeof node.type === 'string' ? node.type : '',
            role: typeof node.role === 'string' ? node.role : '',
            bounds: boundsText(node),
        });
    });
    return rows;
}
/** Escape the five XML/HTML metacharacters so node text can't break the markup. */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Escape the Markdown table cell separator so a value can't split a column. */
function escapeMdCell(text) {
    return text.replace(/\|/g, '\\|');
}
/** A `data:` URI for a PNG buffer, embeddable in both HTML and Markdown. */
function pngDataUri(png) {
    return `data:image/png;base64,${png.toString('base64')}`;
}
/**
 * Render a self-contained HTML report: an embedded PNG `<img>`, the box-tree in a
 * `<pre>`, and a node `<table>`. `title` labels the document; `png` is the raw
 * PNG bytes. Pure — takes the bytes, returns the HTML string.
 */
function renderHtmlReport(root, png, title) {
    const rows = nodeRows(root)
        .map((r) => `      <tr><td>${escapeHtml(r.mark)}</td><td>${escapeHtml(r.id)}</td>` +
        `<td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.role)}</td>` +
        `<td>${escapeHtml(r.bounds)}</td></tr>`)
        .join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 1.5rem; }
    pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; line-height: 1.3; }
    table { border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #ccc; padding: 0.25rem 0.6rem; text-align: left; font-size: 0.9rem; }
    th { background: #eee; }
    img { max-width: 100%; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <h2>Render</h2>
  <img alt="rendered preview" src="${pngDataUri(png)}">
  <h2>Scene tree</h2>
  <pre>${escapeHtml((0, treeFormatter_1.formatTree)(root))}</pre>
  <h2>Nodes</h2>
  <table>
    <thead>
      <tr><th>#</th><th>id</th><th>type</th><th>role</th><th>bounds</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}
/**
 * Render a self-contained Markdown report: an embedded PNG image (base64 data
 * URI), the box-tree in a fenced block, and a Markdown node table. Pure.
 */
function renderMarkdownReport(root, png, title) {
    const header = '| # | id | type | role | bounds |';
    const sep = '| --- | --- | --- | --- | --- |';
    const body = nodeRows(root)
        .map((r) => `| ${escapeMdCell(r.mark)} | ${escapeMdCell(r.id)} | ${escapeMdCell(r.type)} ` +
        `| ${escapeMdCell(r.role)} | ${escapeMdCell(r.bounds)} |`)
        .join('\n');
    return `# ${title}

## Render

![rendered preview](${pngDataUri(png)})

## Scene tree

\`\`\`
${(0, treeFormatter_1.formatTree)(root)}
\`\`\`

## Nodes

${header}
${sep}
${body}
`;
}
/**
 * Write a render report for `root` + the PNG at `pngPath` to `outPath`, choosing
 * HTML or Markdown by the `outPath` extension (`.md`/`.markdown` ⇒ Markdown,
 * anything else ⇒ HTML). Reads the PNG, embeds it self-contained, and writes the
 * file (creating parent dirs). The title is derived from the output basename.
 *
 * @param root     The canonical tree (carries mark/id/bounds).
 * @param pngPath  The rendered PNG to embed (e.g. `RenderResult.pngPath`).
 * @param outPath  Destination report file; extension selects the format.
 */
async function writeReport(root, pngPath, outPath) {
    const png = await fs.promises.readFile(pngPath);
    const ext = path.extname(outPath).toLowerCase();
    const title = path.basename(outPath, path.extname(outPath)) || 'dali-ui-preview';
    const content = ext === '.md' || ext === '.markdown'
        ? renderMarkdownReport(root, png, title)
        : renderHtmlReport(root, png, title);
    await fs.promises.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.promises.writeFile(outPath, content, 'utf8');
}
