/*
 * `dali-ui-preview-cli doctor` — machine-readable environment preflight.
 *
 * An agent (or MCP wrapper, or shell) runs this BEFORE rendering to learn whether a
 * runtime is ready and which one a bare render will use — instead of discovering it
 * reactively by hitting an exit-12/13 render failure. It prints a single JSON line
 *   { schemaVersion, ready, recommended, configured, runtimes:{docker,local} }
 * to STDOUT (in BOTH the ready and not-ready cases — the report is the successful
 * output of a diagnosis), and exits 0 when ready or 13 when no runtime is usable, so
 * a caller can gate a render with `doctor && render`.
 *
 * No network: Docker daemon check + a local `docker images` tag lookup + filesystem
 * readiness checks only, so it is cheap to run at the top of every session.
 *
 * The readiness LOGIC is the pure {@link buildDoctorReport} (unit-tested with a
 * truth-table like `chooseRuntime`); {@link runDoctor} is the thin async probe that
 * feeds it real environment data.
 */
import {
  isDockerAvailable,
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_IMAGE_TAG,
} from './dockerRunner';
import { localTags } from './imageManager';
import { checkLocalReadiness, LocalReadiness } from './runtime/localRunner';
import { readConfig } from './runtime/config';
import { RuntimeMode } from './render';
import { describeRegistry, GHCR_HOST } from './registry';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** True iff the Docker DAEMON has an HTTP(S) proxy configured (what actually pulls —
 *  distinct from this CLI's own env). Empty `docker info` proxy fields ⇒ no daemon proxy,
 *  which means direct egress to external registries (ghcr.io) is likely throttled/blocked. */
async function daemonProxyConfigured(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'docker', ['info', '--format', '{{.HTTPProxy}}{{.HTTPSProxy}}'], { timeout: 10_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Exit code when no runtime is usable — shared meaning with the render path's
 *  RUNTIME_UNAVAILABLE (13): "you have no runtime you can use." */
const EXIT_NOT_READY = 13;

/** Actionable, human-relayable guidance when the Docker daemon is unreachable. */
const DOCKER_UNAVAILABLE_ISSUE =
  'Docker daemon not reachable (`docker info` failed). Install Docker and start the ' +
  'daemon (that needs sudo — ask the human), or use a native runtime with `--runtime local`.';

/** Per-runtime readiness in the report. `issues` are blockers; empty when available. */
export interface DockerStatus {
  /** Docker daemon reachable. */
  available: boolean;
  /** The resolved `<image>:<tag>` tag is already present locally (else the first
   *  render triggers a one-time ~290 MB pull). Best-effort; false when the daemon is down. */
  imagePulled: boolean;
  /** Full runtime image reference (`<image>:<tag>`). */
  image: string;
  /** Blocking issues, actionable + human-relayable; empty when available. */
  issues: string[];
  /** Non-blocking pre-pull warning: the selected registry is unlikely to be reachable
   *  by the Docker DAEMON (e.g. ghcr.io while the daemon has no corporate proxy), so a
   *  first-render ~290 MB pull would probably time out. Absent when no such risk. */
  dockerPullWarning?: string;
}

export interface LocalStatus {
  /** Host has a valid DALi prefix + g++/pkg-config/Xvfb. */
  available: boolean;
  /** Resolved native DALi prefix, or null when none was found. */
  prefix: string | null;
  /** Blocking issues (from checkLocalReadiness); empty when available. */
  issues: string[];
}

/** The `doctor` stdout contract (a single JSON line). */
export interface DoctorReport {
  /** Report schema version (bumped on any breaking shape change). */
  schemaVersion: 1;
  /** At least one runtime is usable right now (safe to render). */
  ready: boolean;
  /** The runtime a no-flag render will actually succeed with, or null when none. */
  recommended: RuntimeMode | null;
  /** The runtime persisted in `.dali/config.json`, or null (reported for transparency). */
  configured: RuntimeMode | null;
  runtimes: { docker: DockerStatus; local: LocalStatus };
}

/** Already-probed environment facts handed to the pure report builder. */
export interface DoctorInputs {
  /** Docker daemon reachable. */
  dockerOk: boolean;
  /** The runtime image tag is present in the local `docker images` list. */
  dockerImagePulled: boolean;
  /** Runtime image base name (without tag). */
  image: string;
  /** Runtime image tag. */
  tag: string;
  /** Native-runtime readiness (from checkLocalReadiness). */
  local: LocalReadiness;
  /** Persisted runtime choice from `.dali/config.json`, or null. */
  configured: RuntimeMode | null;
  /** Host of the selected registry (ghcr.io or the BART proxy) — for pull-risk detection.
   *  Optional so existing callers/tests are unaffected. */
  registryHost?: string;
  /** Whether the Docker DAEMON has an HTTP proxy configured (from `docker info`). */
  daemonHasProxy?: boolean;
}

/**
 * Build the {@link DoctorReport} from already-probed facts. PURE — no I/O — so the
 * readiness logic is unit-tested exhaustively without spawning docker or touching
 * the filesystem.
 *
 * `ready` = at least one runtime is available. Docker counts as available when the
 * daemon is up even if the image is not pulled (the first render auto-pulls);
 * `imagePulled:false` is surfaced so a caller can warn about the one-time download.
 *
 * `recommended` = the runtime a no-flag render will actually SUCCEED with: the
 * persisted `configured` choice when it is available, else Docker, else local, else
 * null. (Availability-aware refinement of the docker-preferred `chooseRuntime`.)
 */
export function buildDoctorReport(inputs: DoctorInputs): DoctorReport {
  const docker: DockerStatus = {
    available: inputs.dockerOk,
    imagePulled: inputs.dockerImagePulled,
    image: `${inputs.image}:${inputs.tag}`,
    issues: inputs.dockerOk ? [] : [DOCKER_UNAVAILABLE_ISSUE],
  };
  // Pre-pull risk (non-blocking): a proxy-less daemon cannot reliably reach ghcr.io, so
  // the first render's pull would likely time out. Surface it in the status BEFORE that
  // happens. The internal BART mirror needs no proxy, so no warning there.
  if (docker.available && !docker.imagePulled
      && inputs.registryHost === GHCR_HOST && inputs.daemonHasProxy === false) {
    docker.dockerPullWarning =
      'Runtime image not downloaded and the selected registry is ghcr.io, but the Docker daemon has NO proxy configured — a pull will likely time out (the daemon, not this CLI, does the pull). Fix: connect to the Samsung corp network (the extension/CLI then use the internal BART mirror, which needs no proxy), OR configure the daemon proxy (systemd drop-in http-proxy.conf with NO_PROXY=".samsung.net,localhost,127.0.0.1") and restart docker.';
  }
  const local: LocalStatus = {
    available: inputs.local.ready,
    prefix: inputs.local.prefix,
    issues: inputs.local.ready ? [] : inputs.local.issues,
  };

  const ready = docker.available || local.available;

  let recommended: RuntimeMode | null;
  if (inputs.configured === 'docker' && docker.available) {
    recommended = 'docker';
  } else if (inputs.configured === 'local' && local.available) {
    recommended = 'local';
  } else if (docker.available) {
    recommended = 'docker';
  } else if (local.available) {
    recommended = 'local';
  } else {
    recommended = null;
  }

  return {
    schemaVersion: 1,
    ready,
    recommended,
    configured: inputs.configured,
    runtimes: { docker, local },
  };
}

/** The three flags `doctor` honors (they refine WHAT is probed), resolved with defaults. */
interface DoctorArgs {
  /** Native DALi install prefix from `--dali-prefix <path>` (refines the local probe). */
  daliPrefix?: string;
  /** Runtime image tag from `--image-tag <tag>` (default `latest`). */
  imageTag: string;
  /** Runtime image name from `--runtime-image <name>` (default DEFAULT_DOCKER_IMAGE). */
  image: string;
}

/**
 * Parse doctor's argv. It takes NO input and honors only `--dali-prefix`,
 * `--image-tag`, `--runtime-image` (the overrides that change what a render would
 * probe). Any other token — a positional, or a render/verify flag — is a usage
 * error so the caller surfaces a clear diagnostic (exit 1).
 */
export function parseDoctorArgs(argv: string[]): DoctorArgs {
  let daliPrefix: string | undefined;
  let imageTag: string | undefined;
  let image: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dali-prefix') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--dali-prefix requires a path argument.');
      }
      if (daliPrefix !== undefined) {
        throw new Error('--dali-prefix was specified more than once.');
      }
      daliPrefix = value;
      i++;
    } else if (arg === '--image-tag') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--image-tag requires a tag argument (e.g. latest, dali_2.5.26).');
      }
      if (imageTag !== undefined) {
        throw new Error('--image-tag was specified more than once.');
      }
      imageTag = value;
      i++;
    } else if (arg === '--runtime-image') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--runtime-image requires an image-name argument.');
      }
      if (image !== undefined) {
        throw new Error('--runtime-image was specified more than once.');
      }
      image = value;
      i++;
    } else if (arg.startsWith('-')) {
      throw new Error(`unrecognized option for doctor: ${arg}`);
    } else {
      throw new Error(`doctor takes no input; unexpected argument: ${arg}`);
    }
  }

  return {
    daliPrefix,
    imageTag: imageTag ?? DEFAULT_IMAGE_TAG,
    // Mirror the render path's precedence (resolveImageRef) so doctor probes the SAME
    // image a render would — otherwise, on the corp network, a BART-proxy-pulled image
    // would be reported not-pulled under its GHCR name.
    image: image ?? process.env.DALI_PREVIEW_IMAGE ?? readConfig(process.cwd()).image ?? DEFAULT_DOCKER_IMAGE,
  };
}

/**
 * The `doctor` dispatch: probe BOTH runtimes (no network), assemble the report, print
 * it as one JSON line to stdout, and return the exit code (0 ready / 13 not ready).
 * A genuine tool error while probing surfaces on stderr with exit 1 (like the other
 * commands). Probing runs from the current working directory (doctor takes no input).
 */
export async function runDoctor(argv: string[]): Promise<number> {
  let args: DoctorArgs;
  try {
    args = parseDoctorArgs(argv);
  } catch (err) {
    console.error(`dali-ui-preview-cli: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const baseDir = process.cwd();
  const dockerOk = await isDockerAvailable();
  // The image-tag presence lookup is best-effort: when the daemon is down localTags
  // rejects, so treat that as "not pulled" rather than failing the whole doctor run.
  let dockerImagePulled = false;
  if (dockerOk) {
    try {
      const tags = await localTags(args.image);
      dockerImagePulled = tags.includes(args.imageTag);
    } catch {
      dockerImagePulled = false;
    }
  }
  // Daemon-reality probe for pull-risk: which registry is selected + does the DAEMON
  // (not this CLI) have a proxy? A proxy-less daemon can't reliably reach ghcr.io.
  const registryHost = describeRegistry(args.image).host;
  const daemonHasProxy = dockerOk ? await daemonProxyConfigured() : undefined;

  const local = checkLocalReadiness({ daliPrefix: args.daliPrefix, baseDir });
  const configured = readConfig(baseDir).runtime ?? null;

  const report = buildDoctorReport({
    dockerOk,
    dockerImagePulled,
    image: args.image,
    tag: args.imageTag,
    local,
    configured,
    registryHost,
    daemonHasProxy,
  });

  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ready ? 0 : EXIT_NOT_READY;
}
