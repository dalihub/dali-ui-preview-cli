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
  /** How many image URLs the code referenced at all (staged + remote + unresolvable). */
  referenced: number;
}

/** Bundled gray broken-image placeholder, shipped at `<package>/media/`. */
const BROKEN_IMAGE_ASSET = 'broken-image-placeholder.png';

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
  const referenced = new Set<string>();       // every distinct image URL seen
  let m: RegExpExecArray | null;
  IMAGE_URL_RE.lastIndex = 0;
  while ((m = IMAGE_URL_RE.exec(code)) !== null) {
    const url = m[2];
    if (!url) { continue; }
    referenced.add(url);
    if (rewrites.has(url) || isRemoteScheme(url)) { continue; }
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

  if (rewrites.size === 0) { return { code, staged: 0, referenced: referenced.size }; }

  IMAGE_URL_RE.lastIndex = 0;
  const out = code.replace(IMAGE_URL_RE, (full, _call, url) => {
    const staged = rewrites.get(url);
    // Replace only the URL literal inside the matched segment, preserving the
    // call name / parens / spacing.
    return staged ? full.replace(`"${url}"`, `"${staged}"`) : full;
  });
  return { code: out, staged: rewrites.size, referenced: referenced.size };
}

/**
 * Stage the bundled gray broken-image placeholder into `workDir` and return the
 * path the rendered binary should pass to `SetBrokenImageUrl` — `/work/<asset>`
 * for docker (workDir is bind-mounted at /work), the staged host path for local.
 * Returns undefined if the bundled asset is missing or the copy fails (the caller
 * then omits SetBrokenImageUrl — graceful, byte-identical to the no-placeholder
 * harness).
 */
export function stageBrokenImagePlaceholder(workDir: string, mode: 'docker' | 'local'): string | undefined {
  // Compiled module lives at out/runtime/imageAssets.js, so the package root
  // (which holds media/) is two directories up.
  const src = path.join(__dirname, '..', '..', 'media', BROKEN_IMAGE_ASSET);
  try {
    if (!fs.existsSync(src)) { return undefined; }
    const dst = path.join(workDir, BROKEN_IMAGE_ASSET);
    fs.copyFileSync(src, dst);
    return mode === 'docker' ? `/work/${BROKEN_IMAGE_ASSET}` : dst;
  } catch {
    return undefined;
  }
}
