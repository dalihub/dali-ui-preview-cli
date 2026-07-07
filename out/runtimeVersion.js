"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNKNOWN_VERSION = void 0;
exports.versionFromTag = versionFromTag;
exports.dockerDaliVersion = dockerDaliVersion;
exports.localDaliVersion = localDaliVersion;
/*
 * runtimeVersion.ts — report WHICH dali-ui version actually rendered a preview, for both
 * runtimes, so it shows up in the render log (stderr; stdout stays the JSON contract).
 *
 *  - docker: read the `io.dalihub.dali.version` image LABEL (baked at build time in
 *    docker/Dockerfile.runtime) via `docker image inspect` — offline, no container run.
 *    Falls back to parsing a `dali_x.y.z` tag, else "unknown".
 *  - local: `pkg-config --modversion` of the DALi UI module against the native prefix.
 *
 * The pure {@link versionFromTag} parser is unit-tested; the async probes are exercised
 * by the real render e2e (the log line prints the resolved version).
 */
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** OCI-style label baked into the runtime image (docker/Dockerfile.runtime). */
const DALI_VERSION_LABEL = 'io.dalihub.dali.version';
/** pkg-config module carrying the dali-ui version (present in every DALi prefix). */
const DALI_UI_PC_MODULES = ['dali2-ui-foundation', 'dali2-core'];
exports.UNKNOWN_VERSION = 'unknown';
/** Extract `x.y.z` from a runtime image tag like `dali_2.5.28` / `dali-v2.5.28`. Pure. */
function versionFromTag(tag) {
    const m = /^dali[_-]?v?(\d+\.\d+\.\d+)/i.exec(tag);
    return m ? m[1] : null;
}
/** dali-ui version baked into the docker runtime image (label → tag parse → unknown). */
async function dockerDaliVersion(image, tag) {
    try {
        const { stdout } = await execFileAsync('docker', ['image', 'inspect', '--format', `{{ index .Config.Labels "${DALI_VERSION_LABEL}" }}`, `${image}:${tag}`], { timeout: 5000 });
        const label = stdout.trim();
        if (label && label !== '<no value>') {
            return label;
        }
    }
    catch {
        /* image not present locally / docker down — fall back to the tag */
    }
    return versionFromTag(tag) ?? exports.UNKNOWN_VERSION;
}
/** dali-ui version of a native DALi prefix via `pkg-config --modversion`. */
async function localDaliVersion(prefix) {
    const pcPath = `${prefix}/lib/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig`;
    for (const mod of DALI_UI_PC_MODULES) {
        try {
            const { stdout } = await execFileAsync('pkg-config', ['--modversion', mod], {
                timeout: 5000,
                env: { ...process.env, PKG_CONFIG_PATH: pcPath },
            });
            const v = stdout.trim();
            if (v) {
                return v;
            }
        }
        catch {
            /* try the next module */
        }
    }
    return exports.UNKNOWN_VERSION;
}
