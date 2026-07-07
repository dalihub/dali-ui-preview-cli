"use strict";
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
exports.ensureGitignore = ensureGitignore;
exports.chooseRuntime = chooseRuntime;
exports.runInit = runInit;
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
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const localRunner_1 = require("./runtime/localRunner");
const config_1 = require("./runtime/config");
const sliceSources_1 = require("./sliceSources");
const registry_1 = require("./registry");
/** Package root (out/init.js -> ..). Bundled `templates/`, `skills/`, `samples/` live here. */
const PKG_ROOT = path.join(__dirname, '..');
const CLI_JS = path.join(__dirname, 'cli.js');
const BEGIN = '<!-- dali-ui-preview:begin -->';
const END = '<!-- dali-ui-preview:end -->';
function run(cmd, args) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
            const code = err && typeof err.code === 'number'
                ? err.code
                : err
                    ? 1
                    : 0;
            resolve({ code, out: `${stdout ?? ''}${stderr ?? ''}` });
        });
    });
}
function readPkg(rel) {
    return fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8');
}
/** Create/refresh AGENTS.md, keeping any existing content outside our marked block. */
function writeAgentsMd(dir) {
    const file = path.join(dir, 'AGENTS.md');
    const body = readPkg('templates/agent-verification-loop.md').trim();
    const block = `${BEGIN}\n${body}\n${END}\n`;
    if (fs.existsSync(file)) {
        let cur = fs.readFileSync(file, 'utf8');
        if (cur.includes(BEGIN) && cur.includes(END)) {
            cur = cur.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`), block);
        }
        else {
            cur = `${cur.trimEnd()}\n\n${block}`;
        }
        fs.writeFileSync(file, cur);
        return 'updated';
    }
    fs.writeFileSync(file, block);
    return 'created';
}
/** Copy the bundled skill into the project's Claude skills dir. */
function writeSkill(dir) {
    const destDir = path.join(dir, '.claude', 'skills', 'dali-preview');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(path.join(PKG_ROOT, 'skills', 'dali-preview', 'SKILL.md'), path.join(destDir, 'SKILL.md'));
    return path.join('.claude', 'skills', 'dali-preview', 'SKILL.md');
}
/**
 * Ensure the project's `.gitignore` ignores the `.dali/` scratch dir so render PNGs and the
 * machine/network-specific `config.json` don't get committed. Idempotent: skips if already
 * ignored, creates the file if absent. Pure filesystem, so it is unit-tested with a tmp dir.
 */
function ensureGitignore(root) {
    const file = path.join(root, '.gitignore');
    const entry = '.dali/';
    const comment = '# DALi UI preview render scratch (PNGs + machine-specific config)';
    if (fs.existsSync(file)) {
        const cur = fs.readFileSync(file, 'utf8');
        const ignored = cur.split(/\r?\n/).some((l) => {
            const t = l.trim();
            return t === '.dali' || t === '.dali/' || t === '/.dali' || t === '/.dali/';
        });
        if (ignored) {
            return 'present';
        }
        const sep = cur.length === 0 || cur.endsWith('\n') ? '' : '\n';
        fs.writeFileSync(file, `${cur}${sep}\n${comment}\n${entry}\n`);
        return 'updated';
    }
    fs.writeFileSync(file, `${comment}\n${entry}\n`);
    return 'created';
}
/**
 * Pick the runtime for `init`: an explicit flag wins; else docker if the daemon is
 * up; else local if the host is ready; else null (neither usable — write the docs
 * and skip the render). Pure so it is unit-tested without spawning anything.
 */
function chooseRuntime(opts) {
    if (opts.flagged === 'docker' || opts.flagged === 'local') {
        return opts.flagged;
    }
    if (opts.dockerOk) {
        return 'docker';
    }
    if (opts.localReady) {
        return 'local';
    }
    return null;
}
async function runInit(argv) {
    const dir = path.resolve(argv.find((a) => !a.startsWith('-')) ?? '.');
    const skipRender = argv.includes('--no-render');
    if (!fs.existsSync(dir)) {
        console.error(`dali-ui-preview-cli init: directory not found: ${dir}`);
        return 1;
    }
    const root = (0, sliceSources_1.findProjectRoot)(dir);
    console.log(`Initializing DALi UI preview in ${dir}`);
    console.log(`  ${writeAgentsMd(dir)} AGENTS.md  (verification-loop instruction)`);
    console.log(`  wrote ${writeSkill(dir)}  (Claude Code skill)`);
    console.log(`  ${ensureGitignore(root)} .gitignore  (ignores .dali/ render scratch)`);
    // Detect BOTH runtimes and choose. An explicit --docker/--local overrides; else
    // docker is preferred (reproducible), else a ready native runtime is used.
    const flagged = argv.includes('--local') ? 'local'
        : (argv.includes('--docker') ? 'docker' : undefined);
    const dockerOk = (await run('docker', ['info'])).code === 0;
    const local = (0, localRunner_1.checkLocalReadiness)({ baseDir: dir });
    const mode = chooseRuntime({ flagged, dockerOk, localReady: local.ready });
    if (mode === null) {
        console.log('');
        console.log('⚠️  No runtime ready yet. Either:');
        console.log('   • install Docker, then:  dali-ui-preview-cli --pull');
        console.log('   • or install a native DALi prefix + g++/Xvfb/pkg-config and re-run with --local.');
        if (local.issues.length) {
            console.log(`   local checks: ${local.issues.join(' ')}`);
        }
        console.log('   The instruction files are in place — your agent can render once a runtime is ready.');
        return 0;
    }
    // In docker mode, auto-detect which registry to pull from: the BART GHCR proxy on
    // the Samsung corp network (avoids the intermittent GHCR blob-pull drops), else
    // GHCR directly. Persisted to config so subsequent renders reuse it (no re-probe),
    // and passed explicitly to the pull/smoke-render children below so they don't depend
    // on cwd-relative config discovery.
    const detectedImage = mode === 'docker' ? await (0, registry_1.detectDefaultImage)() : undefined;
    // Persist the choice so subsequent renders default to it with no flag.
    const cfg = { runtime: mode };
    if (mode === 'local' && local.prefix) {
        cfg.daliPrefix = local.prefix;
    }
    if (detectedImage) {
        cfg.image = detectedImage;
    }
    const cfgPath = (0, config_1.writeConfig)(root, cfg);
    console.log(`  wrote ${path.relative(dir, cfgPath) || cfgPath}  (runtime: ${mode}${mode === 'local' && local.prefix ? `, prefix ${local.prefix}` : ''})`);
    if (detectedImage) {
        const via = detectedImage.startsWith(`${registry_1.GHCR_HOST}/`) ? 'GHCR' : 'BART proxy (corp network)';
        console.log(`  runtime image: ${detectedImage}  (via ${via})`);
    }
    const runtimeImageArgs = detectedImage ? ['--runtime-image', detectedImage] : [];
    if (mode === 'docker') {
        console.log('');
        console.log('Pulling the runtime image (first time ~290 MB, cached after)…');
        const pull = await run(process.execPath, [CLI_JS, '--pull', ...runtimeImageArgs]);
        if (pull.code !== 0) {
            console.log(`⚠️  image pull failed (you can retry with --pull):\n${pull.out.trim().slice(0, 1200)}`);
            return 0;
        }
        console.log('  ✓ runtime image ready');
    }
    if (!skipRender) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-init-'));
        const png = path.join(tmp, 'hello.png');
        const sample = path.join(PKG_ROOT, 'samples', 'hello-dali.preview.dali.cpp');
        console.log(`Smoke-rendering the hello sample (${mode})…`);
        const r = await run(process.execPath, [CLI_JS, sample, '--runtime', mode, '--image', png, ...runtimeImageArgs]);
        if (r.code === 0 && fs.existsSync(png)) {
            console.log('  ✓ render OK');
        }
        else {
            console.log(`  ⚠️ smoke render failed:\n${r.out.trim().slice(0, 1200)}`);
        }
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
        catch {
            /* best-effort */
        }
    }
    console.log('');
    console.log(`✅ ${path.basename(dir)} is agent-ready. When you (or your coding agent) write DALi UI here,`);
    console.log('   the agent will render it, view the PNG, and fix it in a loop. See AGENTS.md.');
    console.log('   Tip: install the CLI once so the loop runs the fast bare command (no re-clone):');
    console.log('        npm i -g github:dalihub/dali-ui-preview-cli');
    return 0;
}
