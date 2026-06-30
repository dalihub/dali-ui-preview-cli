/*
 * sliceSources.ts — gather the project source files a preview entry #include's,
 * so sliceBuilder can collect cross-file helper/type/const definitions (ADR-006:
 * defs are inlined into the harness, no headers are mounted).
 *
 * Vendored from the VS Code extension's `previewOrchestrator.resolveProjectIncludes`,
 * minus vscode: the entry is a FILE on disk (path + text) instead of a TextDocument,
 * and the containment root is found by walking up to the nearest `.git`/`package.json`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { SourceFile } from './sliceBuilder';

/** Walk up from `startDir` to the nearest project root (`.git` or `package.json`),
 *  used to contain which files an `#include "..."` is allowed to read. */
export function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/**
 * Read the project sources `entryText` #include's by relative path (`"..."`) —
 * each header and, if present, its same-stem `.cpp` — so cross-file definitions
 * (helpers / types / consts) can be collected. Followed TRANSITIVELY (BFS,
 * header → header) up to `MAX_HOPS`. Only project-local quoted includes are
 * followed (system `<...>` come from the harness template); reads are contained
 * to the project root; missing/unreadable files are skipped.
 *
 * @param entryPath  Absolute path of the preview entry file.
 * @param entryText  Full text of the entry file.
 */
export function resolveProjectIncludes(entryPath: string, entryText: string): SourceFile[] {
  const sources: SourceFile[] = [];
  const root = findProjectRoot(path.dirname(entryPath));
  const seen = new Set<string>();
  const MAX_HOPS = 4;
  let frontier: { dir: string; text: string }[] = [{ dir: path.dirname(entryPath), text: entryText }];

  for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
    const next: { dir: string; text: string }[] = [];
    for (const cur of frontier) {
      const includeRe = /^[ \t]*#include\s+"([^"]+)"/gm;
      let m: RegExpExecArray | null;
      while ((m = includeRe.exec(cur.text)) !== null) {
        const hdr = path.resolve(cur.dir, m[1]);
        // the header AND its same-stem .cpp (definitions often live in the .cpp)
        for (const p of [hdr, hdr.replace(/\.(h|hpp)$/, '.cpp')]) {
          if (seen.has(p)) continue;
          seen.add(p);
          // containment guard: never read outside the project root
          if (!(p === root || p.startsWith(root + path.sep))) continue;
          try {
            if (fs.existsSync(p)) {
              const text = fs.readFileSync(p, 'utf8');
              sources.push({ path: p, text });
              next.push({ dir: path.dirname(p), text }); // recurse into ITS includes
            }
          } catch {
            /* unreadable include — skip */
          }
        }
      }
    }
    frontier = next;
  }
  return sources;
}
