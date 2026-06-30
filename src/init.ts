/*
 * `dali-ui-preview-cli init` — one-command project onboarding.
 *
 * Seeds the *current project* so any coding agent (Codex, Cursor, Claude Code, …)
 * verifies the DALi UI it writes in a render -> look -> fix loop:
 *   1. write/refresh AGENTS.md with the verification-loop instruction (universal),
 *   2. write .claude/skills/dali-preview/SKILL.md (Claude Code auto-activates it),
 *   3. (best-effort) verify Docker + pull the runtime image + smoke-render a sample.
 *
 * Run as: `npx -y dali-ui-preview-cli init [dir]`  (or github:dalihub/... before npm publish)
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Package root (out/init.js -> ..). Bundled `templates/`, `skills/`, `samples/` live here. */
const PKG_ROOT = path.join(__dirname, '..');
const CLI_JS = path.join(__dirname, 'cli.js');
const BEGIN = '<!-- dali-ui-preview:begin -->';
const END = '<!-- dali-ui-preview:end -->';

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as { code?: number }).code === 'number'
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
      resolve({ code, out: `${stdout ?? ''}${stderr ?? ''}` });
    });
  });
}

function readPkg(rel: string): string {
  return fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8');
}

/** Create/refresh AGENTS.md, keeping any existing content outside our marked block. */
function writeAgentsMd(dir: string): 'created' | 'updated' {
  const file = path.join(dir, 'AGENTS.md');
  const body = readPkg('templates/agent-verification-loop.md').trim();
  const block = `${BEGIN}\n${body}\n${END}\n`;
  if (fs.existsSync(file)) {
    let cur = fs.readFileSync(file, 'utf8');
    if (cur.includes(BEGIN) && cur.includes(END)) {
      cur = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`), block);
    } else {
      cur = `${cur.trimEnd()}\n\n${block}`;
    }
    fs.writeFileSync(file, cur);
    return 'updated';
  }
  fs.writeFileSync(file, block);
  return 'created';
}

/** Copy the bundled skill into the project's Claude skills dir. */
function writeSkill(dir: string): string {
  const destDir = path.join(dir, '.claude', 'skills', 'dali-preview');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(PKG_ROOT, 'skills', 'dali-preview', 'SKILL.md'), path.join(destDir, 'SKILL.md'));
  return path.join('.claude', 'skills', 'dali-preview', 'SKILL.md');
}

export async function runInit(argv: string[]): Promise<number> {
  const dir = path.resolve(argv.find((a) => !a.startsWith('-')) ?? '.');
  const skipRender = argv.includes('--no-render');
  if (!fs.existsSync(dir)) {
    console.error(`dali-ui-preview-cli init: directory not found: ${dir}`);
    return 1;
  }

  console.log(`Initializing DALi UI preview in ${dir}`);
  console.log(`  ${writeAgentsMd(dir)} AGENTS.md  (verification-loop instruction)`);
  console.log(`  wrote ${writeSkill(dir)}  (Claude Code skill)`);

  // Best-effort runtime setup — never fail init just because Docker isn't ready yet.
  const docker = await run('docker', ['info']);
  if (docker.code !== 0) {
    console.log('');
    console.log('⚠️  Docker not available yet. Install Docker, then run:  dali-ui-preview-cli --pull');
    console.log('   The instruction files are in place — your agent can render once Docker is ready.');
    return 0;
  }

  console.log('');
  console.log('Pulling the runtime image (first time ~290 MB, cached after)…');
  const pull = await run(process.execPath, [CLI_JS, '--pull']);
  if (pull.code !== 0) {
    console.log(`⚠️  image pull failed (you can retry with --pull):\n${pull.out.trim().slice(0, 1200)}`);
    return 0;
  }
  console.log('  ✓ runtime image ready');

  if (!skipRender) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-init-'));
    const png = path.join(tmp, 'hello.png');
    const sample = path.join(PKG_ROOT, 'samples', 'hello-dali.preview.dali.cpp');
    console.log('Smoke-rendering the hello sample…');
    const r = await run(process.execPath, [CLI_JS, sample, '--image', png]);
    if (r.code === 0 && fs.existsSync(png)) {
      console.log('  ✓ render OK');
    } else {
      console.log(`  ⚠️ smoke render failed:\n${r.out.trim().slice(0, 1200)}`);
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  console.log('');
  console.log(`✅ ${path.basename(dir)} is agent-ready. When you (or your coding agent) write DALi UI here,`);
  console.log('   the agent will render it, view the PNG, and fix it in a loop. See AGENTS.md.');
  return 0;
}
