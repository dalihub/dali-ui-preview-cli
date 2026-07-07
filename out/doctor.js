"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDoctorReport = buildDoctorReport;
exports.parseDoctorArgs = parseDoctorArgs;
exports.runDoctor = runDoctor;
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
const dockerRunner_1 = require("./dockerRunner");
const imageManager_1 = require("./imageManager");
const localRunner_1 = require("./runtime/localRunner");
const config_1 = require("./runtime/config");
/** Exit code when no runtime is usable — shared meaning with the render path's
 *  RUNTIME_UNAVAILABLE (13): "you have no runtime you can use." */
const EXIT_NOT_READY = 13;
/** Actionable, human-relayable guidance when the Docker daemon is unreachable. */
const DOCKER_UNAVAILABLE_ISSUE = 'Docker daemon not reachable (`docker info` failed). Install Docker and start the ' +
    'daemon (that needs sudo — ask the human), or use a native runtime with `--runtime local`.';
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
function buildDoctorReport(inputs) {
    const docker = {
        available: inputs.dockerOk,
        imagePulled: inputs.dockerImagePulled,
        image: `${inputs.image}:${inputs.tag}`,
        issues: inputs.dockerOk ? [] : [DOCKER_UNAVAILABLE_ISSUE],
    };
    const local = {
        available: inputs.local.ready,
        prefix: inputs.local.prefix,
        issues: inputs.local.ready ? [] : inputs.local.issues,
    };
    const ready = docker.available || local.available;
    let recommended;
    if (inputs.configured === 'docker' && docker.available) {
        recommended = 'docker';
    }
    else if (inputs.configured === 'local' && local.available) {
        recommended = 'local';
    }
    else if (docker.available) {
        recommended = 'docker';
    }
    else if (local.available) {
        recommended = 'local';
    }
    else {
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
/**
 * Parse doctor's argv. It takes NO input and honors only `--dali-prefix`,
 * `--image-tag`, `--runtime-image` (the overrides that change what a render would
 * probe). Any other token — a positional, or a render/verify flag — is a usage
 * error so the caller surfaces a clear diagnostic (exit 1).
 */
function parseDoctorArgs(argv) {
    let daliPrefix;
    let imageTag;
    let image;
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
        }
        else if (arg === '--image-tag') {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('-')) {
                throw new Error('--image-tag requires a tag argument (e.g. latest, dali_2.5.26).');
            }
            if (imageTag !== undefined) {
                throw new Error('--image-tag was specified more than once.');
            }
            imageTag = value;
            i++;
        }
        else if (arg === '--runtime-image') {
            const value = argv[i + 1];
            if (value === undefined || value.startsWith('-')) {
                throw new Error('--runtime-image requires an image-name argument.');
            }
            if (image !== undefined) {
                throw new Error('--runtime-image was specified more than once.');
            }
            image = value;
            i++;
        }
        else if (arg.startsWith('-')) {
            throw new Error(`unrecognized option for doctor: ${arg}`);
        }
        else {
            throw new Error(`doctor takes no input; unexpected argument: ${arg}`);
        }
    }
    return {
        daliPrefix,
        imageTag: imageTag ?? dockerRunner_1.DEFAULT_IMAGE_TAG,
        // Mirror the render path's precedence (resolveImageRef) so doctor probes the SAME
        // image a render would — otherwise, on the corp network, a BART-proxy-pulled image
        // would be reported not-pulled under its GHCR name.
        image: image ?? process.env.DALI_PREVIEW_IMAGE ?? (0, config_1.readConfig)(process.cwd()).image ?? dockerRunner_1.DEFAULT_DOCKER_IMAGE,
    };
}
/**
 * The `doctor` dispatch: probe BOTH runtimes (no network), assemble the report, print
 * it as one JSON line to stdout, and return the exit code (0 ready / 13 not ready).
 * A genuine tool error while probing surfaces on stderr with exit 1 (like the other
 * commands). Probing runs from the current working directory (doctor takes no input).
 */
async function runDoctor(argv) {
    let args;
    try {
        args = parseDoctorArgs(argv);
    }
    catch (err) {
        console.error(`dali-ui-preview-cli: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    const baseDir = process.cwd();
    const dockerOk = await (0, dockerRunner_1.isDockerAvailable)();
    // The image-tag presence lookup is best-effort: when the daemon is down localTags
    // rejects, so treat that as "not pulled" rather than failing the whole doctor run.
    let dockerImagePulled = false;
    if (dockerOk) {
        try {
            const tags = await (0, imageManager_1.localTags)(args.image);
            dockerImagePulled = tags.includes(args.imageTag);
        }
        catch {
            dockerImagePulled = false;
        }
    }
    const local = (0, localRunner_1.checkLocalReadiness)({ daliPrefix: args.daliPrefix, baseDir });
    const configured = (0, config_1.readConfig)(baseDir).runtime ?? null;
    const report = buildDoctorReport({
        dockerOk,
        dockerImagePulled,
        image: args.image,
        tag: args.imageTag,
        local,
        configured,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.ready ? 0 : EXIT_NOT_READY;
}
