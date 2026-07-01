/*
 * render.ts — runtime-mode resolution + the single render dispatcher. Owns the
 * temp workDir and harness templating, then branches to the Docker or native
 * runner. Both return the identical RenderResult, so callers stay mode-agnostic.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { templateHarness } from './harnessTemplater';
import { renderInContainerAt, RenderResult } from './dockerRunner';
import { renderNatively, escapeCppString } from './runtime/localRunner';
import { readConfig } from './runtime/config';
import { stageImageAssets, stageBrokenImagePlaceholder } from './runtime/imageAssets';

export type RuntimeMode = 'docker' | 'local';

/**
 * Resolve the runtime mode by precedence: an explicit flag → the
 * `DALI_PREVIEW_RUNTIME` env var → the persisted `.dali/config.json` → default
 * `docker`. Unknown env/config values are ignored (fall through to the default),
 * so a typo can never silently disable Docker.
 */
export function resolveRuntimeMode(opts: { flag?: RuntimeMode; baseDir?: string } = {}): RuntimeMode {
  if (opts.flag === 'docker' || opts.flag === 'local') { return opts.flag; }
  const env = process.env.DALI_PREVIEW_RUNTIME;
  if (env === 'docker' || env === 'local') { return env; }
  const cfg = readConfig(opts.baseDir ?? process.cwd()).runtime;
  if (cfg === 'docker' || cfg === 'local') { return cfg; }
  return 'docker';
}

export interface DispatchTemplateOpts {
  width: number;
  height: number;
  backgroundColor: string;
  globals?: string;
}

export interface DispatchRenderOpts {
  image?: string;
  tag?: string;
  width: number;
  height: number;
  timeoutMs?: number;
  daliPrefix?: string;
  baseDir?: string;
}

/**
 * Create a temp workDir, template the harness with the mode-appropriate output
 * paths (container `/work/...` for docker, escaped host paths for local), then
 * dispatch to the matching runner. Returns the shared {@link RenderResult}; the
 * caller cleans up `workDir` (via `cleanupWorkDir`).
 */
export async function render(mode: RuntimeMode, userCode: string, t: DispatchTemplateOpts, r: DispatchRenderOpts): Promise<RenderResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dali-ui-preview-'));
  const pngHost = path.join(workDir, 'preview.png');
  const metaHost = path.join(workDir, 'tree.json');

  // Stage local-file image assets into the workDir so relative/absolute image
  // URLs actually resolve at render time (docker: /work/<name>; local: host path).
  // A no-op when the code references no local images (byte-identical source).
  const { code: stagedCode, referenced } = stageImageAssets(userCode, {
    workDir,
    sourceDir: r.baseDir ?? process.cwd(),
    mode,
  });

  // Only when the preview references images: stage the gray placeholder and
  // register it via SetBrokenImageUrl, so an unresolvable/remote image renders
  // the placeholder at its size instead of nothing. Image-free previews keep the
  // byte-identical `UiConfig::New().Apply();` harness (brokenImageUrl stays undefined).
  const brokenImageUrl = referenced > 0 ? stageBrokenImagePlaceholder(workDir, mode) : undefined;

  if (mode === 'local') {
    const source = templateHarness(stagedCode, {
      width: t.width, height: t.height, backgroundColor: t.backgroundColor, globals: t.globals,
      outputPath: escapeCppString(pngHost), metadataPath: escapeCppString(metaHost),
      brokenImageUrl,
    });
    return renderNatively(source, workDir, pngHost, metaHost, {
      width: t.width, height: t.height, timeoutMs: r.timeoutMs, daliPrefix: r.daliPrefix, baseDir: r.baseDir,
    });
  }

  // docker: harness bakes the container /work paths; workDir is bind-mounted at /work.
  const source = templateHarness(stagedCode, {
    width: t.width, height: t.height, backgroundColor: t.backgroundColor, globals: t.globals,
    outputPath: '/work/preview.png', metadataPath: '/work/tree.json',
    brokenImageUrl,
  });
  return renderInContainerAt(source, workDir, {
    image: r.image, tag: r.tag, width: r.width, height: r.height, timeoutMs: r.timeoutMs,
  });
}
