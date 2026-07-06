/*
 * runtime/config.ts — read/write the project's .dali/config.json, the persisted
 * runtime choice (docker|local), DALi prefix, and default image tag. Located by
 * walking up to the project root (.git/package.json) like the slicer.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findProjectRoot } from '../sliceSources';

export interface DaliConfig {
  runtime?: 'docker' | 'local';
  daliPrefix?: string;
  imageTag?: string;
  /** Runtime image name (no tag), persisted by `init` after registry auto-detection. */
  image?: string;
}

const CONFIG_REL = path.join('.dali', 'config.json');

/** Read `.dali/config.json` from the project root at/above `baseDir`. Never throws;
 *  returns `{}` when the file is absent or malformed, and ignores unknown/ill-typed
 *  fields so a hand-edited config can't break a render. */
export function readConfig(baseDir: string): DaliConfig {
  try {
    const root = findProjectRoot(baseDir);
    const file = path.join(root, CONFIG_REL);
    if (!fs.existsSync(file)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      const out: DaliConfig = {};
      if (parsed.runtime === 'docker' || parsed.runtime === 'local') { out.runtime = parsed.runtime; }
      if (typeof parsed.daliPrefix === 'string') { out.daliPrefix = parsed.daliPrefix; }
      if (typeof parsed.imageTag === 'string') { out.imageTag = parsed.imageTag; }
      if (typeof parsed.image === 'string') { out.image = parsed.image; }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/** Write `.dali/config.json` under `projectRoot` (mkdir -p). Returns the file path. */
export function writeConfig(projectRoot: string, cfg: DaliConfig): string {
  const dir = path.join(projectRoot, '.dali');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return file;
}
