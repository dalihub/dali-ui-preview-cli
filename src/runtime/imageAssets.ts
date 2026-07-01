/*
 * runtime/imageAssets.ts — stage local-file image assets referenced by
 * `ImageView::New("…")` / `SetResourceUrl("…")` so they actually resolve at
 * render time, in BOTH runtimes. Ported from the VS Code extension's
 * BuildRunner.stageImageAssets.
 *
 * Why: docker only bind-mounts the workDir at `/work`, so a host path or a path
 * relative to the preview file does NOT exist inside the container — the
 * ImageView would silently render nothing. Local mode runs the binary on the
 * host, but a RELATIVE URL resolves against the process CWD, not the preview
 * file, so it also fails. For each LOCAL (non-remote-scheme) URL we can resolve —
 * absolute-and-exists, or relative to the preview file's directory — copy the
 * file into the workDir and rewrite the literal to a path the binary can read:
 * `/work/<name>` for docker, the staged host path for local.
 *
 * Remote/custom-scheme URLs (`http://`, `https://`, `foo://`) and paths that
 * cannot be resolved are left untouched — never throws; pure upside.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Matches an `ImageView::New("<url>")` or `SetResourceUrl("<url>")` call and captures the URL. */
const IMAGE_URL_RE = /(ImageView\s*::\s*New|SetResourceUrl)\s*\(\s*"([^"]*)"/g;

export interface StageImageOptions {
  /** The render working directory (docker bind-mounts it at /work; local reads it directly). */
  workDir: string;
  /** Directory to resolve relative URLs against — the preview file's dir (or cwd for stdin/inline). */
  sourceDir: string;
  /** Runtime mode: decides the rewritten in-binary path (`/work/<name>` vs the host path). */
  mode: 'docker' | 'local';
}

export interface StageImageResult {
  /** The (possibly rewritten) preview code. */
  code: string;
  /** How many distinct URLs were staged + rewritten. */
  staged: number;
}

/** True for `scheme://…` URLs (remote or custom) that can't be staged from disk. */
function isRemoteScheme(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
}

/**
 * Resolve a URL to a readable host file: an absolute path that exists, or a path
 * relative to `sourceDir` that exists. Returns undefined when neither resolves.
 */
function resolveHostPath(url: string, sourceDir: string): string | undefined {
  if (path.isAbsolute(url) && fs.existsSync(url)) { return url; }
  const rel = path.resolve(sourceDir, url);
  return fs.existsSync(rel) ? rel : undefined;
}

/**
 * Copy every resolvable local image asset into `workDir` and rewrite its URL in
 * `code` to a path the rendered binary can read. Distinct URLs are staged once.
 */
export function stageImageAssets(code: string, opts: StageImageOptions): StageImageResult {
  const rewrites = new Map<string, string>(); // original URL → in-binary path
  let m: RegExpExecArray | null;
  IMAGE_URL_RE.lastIndex = 0;
  while ((m = IMAGE_URL_RE.exec(code)) !== null) {
    const url = m[2];
    if (!url || rewrites.has(url) || isRemoteScheme(url)) { continue; }
    const srcPath = resolveHostPath(url, opts.sourceDir);
    if (!srcPath) { continue; } // unresolvable → leave it (placeholder shows)
    try {
      const name = path.basename(srcPath);
      const dst = path.join(opts.workDir, name);
      fs.copyFileSync(srcPath, dst);
      rewrites.set(url, opts.mode === 'docker' ? `/work/${name}` : dst);
    } catch {
      /* best-effort: a copy failure just leaves the URL untouched */
    }
  }

  if (rewrites.size === 0) { return { code, staged: 0 }; }

  IMAGE_URL_RE.lastIndex = 0;
  const out = code.replace(IMAGE_URL_RE, (full, _call, url) => {
    const staged = rewrites.get(url);
    // Replace only the URL literal inside the matched segment, preserving the
    // call name / parens / spacing.
    return staged ? full.replace(`"${url}"`, `"${staged}"`) : full;
  });
  return { code: out, staged: rewrites.size };
}
