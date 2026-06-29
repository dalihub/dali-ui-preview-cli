/*
 * MCP (Model Context Protocol) server for dali-ui-preview-cli.
 *
 * Exposes the CLI's render engine as MCP tools so an AI coding agent can render
 * DALi (Tizen) UI C++ and SEE the resulting PNG *inline* (an image content block)
 * alongside the JSON scene tree — without shelling out or Read-ing a file path.
 *
 * Launched via `dali-ui-preview-cli mcp` (stdio transport). It is a thin wrapper:
 * it shells out to THIS package's own CLI (`out/cli.js`), so it always honors the
 * exact, tested render contract and stays in sync with the CLI automatically.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** This package's CLI entry, next to the compiled mcp.js (out/cli.js). */
const CLI_JS = path.join(__dirname, 'cli.js');

type CliResult = { code: number; stdout: string; stderr: string };

/** Run our own CLI as a child process and capture its contract (stdout tree / exit code). */
function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_JS, ...args],
      { maxBuffer: 128 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
            ? ((err as unknown as { code: number }).code)
            : err
              ? 1
              : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}

function readVersion(): string {
  try {
    return require(path.join(__dirname, '..', 'package.json')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** One-line human summary of a rendered scene tree (node count + root type + size). */
function summarize(treeJson: string, w?: number, h?: number, theme?: string): string {
  let nodes = 0;
  let rootType = 'scene';
  try {
    const tree = JSON.parse(treeJson);
    const meta = tree?.meta?.resolution;
    if (meta) { w = meta.w; h = meta.h; }
    theme = tree?.meta?.theme ?? theme;
    const walk = (n: any): void => {
      if (!n || typeof n !== 'object') return;
      nodes++;
      for (const c of n.children ?? []) walk(c);
    };
    // skip the synthetic root Layer in the count headline but keep its first real child's type
    walk(tree);
    rootType = tree?.children?.find((c: any) => c?.role === 'container' || c?.role === 'label')?.type ?? tree?.type ?? rootType;
  } catch {
    /* non-JSON stdout — leave defaults */
  }
  const size = w && h ? `${w}x${h}` : 'default size';
  return `Rendered DALi preview (${size}, ${theme ?? 'dark'} theme): ${nodes} node(s), root ${rootType}. PNG shown below.`;
}

const TREE_CAP = 16000;

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'dali-ui-preview', version: readVersion() });

  server.registerTool(
    'render_dali_preview',
    {
      title: 'Render DALi UI preview',
      description:
        'Compile and render DALi (Tizen) C++ UI code to a PNG screenshot AND a JSON scene tree, ' +
        'returning the image INLINE so you can see the layout you wrote. Use this whenever you write or ' +
        'edit DALi UI code, the user asks to preview/screenshot a DALi layout, or you want to verify a ' +
        '.preview.dali.cpp file looks right. dali-ui is non-fluent: declare a named local, call setters as ' +
        'separate statements (they return void), add children with AddChildren({ ... }), then `return` the root. ' +
        'Renders headlessly in a Docker container; run dali_preview_setup once first if the runtime is missing.',
      inputSchema: {
        code: z
          .string()
          .optional()
          .describe('Inline DALi UI C++ — a builder body that ends in `return <root>;`. Provide this OR `file`.'),
        file: z
          .string()
          .optional()
          .describe('Path to a .preview.dali.cpp file to render. Provide this OR `code`.'),
        width: z.number().int().positive().optional().describe('Render width in px (default 1920).'),
        height: z.number().int().positive().optional().describe('Render height in px (default 1080).'),
        theme: z.enum(['dark', 'light']).optional().describe('Background theme (default dark).'),
      },
    },
    async ({ code, file, width, height, theme }) => {
      if (!code && !file) {
        return {
          content: [{ type: 'text' as const, text: 'Provide either `code` (inline DALi C++) or `file` (a path).' }],
          isError: true,
        };
      }
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-mcp-'));
      const png = path.join(work, 'preview.png');
      try {
        const args: string[] = [];
        if (file) {
          args.push(file);
        } else {
          const f = path.join(work, 'snippet.preview.dali.cpp');
          fs.writeFileSync(f, code as string);
          args.push(f);
        }
        args.push('--image', png);
        if (width && height) args.push('--resolution', `${width}x${height}`);
        if (theme) args.push('--theme', theme);

        const { code: ec, stdout, stderr } = await runCli(args);
        if (ec !== 0 || !fs.existsSync(png)) {
          const msg = (stderr.trim() || stdout.trim() || `render failed (exit ${ec})`).slice(0, 4000);
          const hint =
            ec === 12
              ? '\n\nThe Docker runtime is unavailable — run the dali_preview_setup tool, or ensure Docker is running.'
              : '';
          return {
            content: [{ type: 'text' as const, text: `DALi render failed (exit ${ec}):\n${msg}${hint}` }],
            isError: true,
          };
        }
        const b64 = fs.readFileSync(png).toString('base64');
        let tree = stdout.trim();
        if (tree.length > TREE_CAP) tree = tree.slice(0, TREE_CAP) + '\n…(scene tree truncated; re-run the CLI for the full JSON)';
        return {
          content: [
            { type: 'text' as const, text: `${summarize(stdout, width, height, theme)}\n\nScene tree (JSON):\n${tree}` },
            { type: 'image' as const, data: b64, mimeType: 'image/png' },
          ],
        };
      } finally {
        try {
          fs.rmSync(work, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
    },
  );

  server.registerTool(
    'dali_preview_setup',
    {
      title: 'Set up the DALi preview runtime',
      description:
        'One-time environment setup: verify Docker is available and download the DALi runtime container ' +
        'image (~290 MB, cached after first pull). Run once before the first render, or whenever a render ' +
        'reports the runtime is unavailable (exit 12).',
      inputSchema: {
        tag: z.string().optional().describe('Runtime image tag to pull (default: latest).'),
      },
    },
    async ({ tag }) => {
      const args = tag ? ['--pull', tag] : ['--pull'];
      const { code: ec, stdout, stderr } = await runCli(args);
      const out = `${stdout}\n${stderr}`.trim().slice(0, 4000);
      return {
        content: [
          {
            type: 'text' as const,
            text:
              (ec === 0 ? '✅ DALi runtime ready (image pulled / already cached).\n' : `⚠️ Setup exited ${ec}.\n`) +
              out,
          },
        ],
        isError: ec !== 0,
      };
    },
  );

  await server.connect(new StdioServerTransport());
}
