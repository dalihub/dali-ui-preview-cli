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
exports.validateDaliPrefix = validateDaliPrefix;
exports.resolveDaliPrefix = resolveDaliPrefix;
exports.checkDependencies = checkDependencies;
exports.resolvePrefix = resolvePrefix;
/*
 * runtime/daliEnvironment.ts — locate + validate a native DALi install for local
 * rendering, and probe host build tools. Ported from the VS Code extension's
 * daliEnvironment.ts, minus the `vscode`/ConfigurationService dependency: the CLI
 * gets its override from a flag/env/config instead of a workspace setting.
 */
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_1 = require("./config");
const UI_FOUNDATION_PC = path.join('lib', 'pkgconfig', 'dali2-ui-foundation.pc');
const CORE_LIB = path.join('lib', 'libdali2-core.so');
/** True iff `prefix` has both libdali2-core.so and the dali2-ui-foundation .pc. */
function validateDaliPrefix(prefix) {
    try {
        return fs.existsSync(path.join(prefix, CORE_LIB)) && fs.existsSync(path.join(prefix, UI_FOUNDATION_PC));
    }
    catch {
        return false;
    }
}
/**
 * Resolve the actual DALi prefix at or just below a folder. Accepts the prefix
 * directly, a parent containing `dali-env/opt` or `opt`, or one directory level
 * down — so picking a project/home folder still works. Returns null if none found.
 */
function resolveDaliPrefix(candidate) {
    for (const c of [candidate, path.join(candidate, 'dali-env', 'opt'), path.join(candidate, 'opt')]) {
        if (validateDaliPrefix(c)) {
            return c;
        }
    }
    try {
        for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }
            for (const sub of [
                path.join(candidate, entry.name, 'dali-env', 'opt'),
                path.join(candidate, entry.name, 'opt'),
            ]) {
                if (validateDaliPrefix(sub)) {
                    return sub;
                }
            }
        }
    }
    catch { /* not a readable dir */ }
    return null;
}
function has(cmd) {
    try {
        (0, child_process_1.execSync)(`which ${cmd}`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/** Probe the host for the tools a native compile+render needs. */
function checkDependencies() {
    return { gcc: has('g++'), xvfb: has('Xvfb'), pkgconfig: has('pkg-config'), ccache: has('ccache') };
}
function parseSetenv(file) {
    try {
        if (!fs.existsSync(file)) {
            return null;
        }
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            const m = line.trim().match(/^(?:export\s+)?DESKTOP_PREFIX\s*=\s*["']?([^"'\s#]+)["']?/);
            if (m && m[1]) {
                let v = m[1];
                if (v.startsWith('~')) {
                    v = path.join(process.env.HOME || '', v.slice(1));
                }
                return v;
            }
        }
    }
    catch { /* unreadable */ }
    return null;
}
function pkgConfigPrefix() {
    try {
        const out = (0, child_process_1.execSync)('pkg-config --variable=prefix dali2-ui-foundation', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
        return out.length > 0 ? out : null;
    }
    catch {
        return null;
    }
}
/**
 * Resolve a native DALi prefix by precedence, returning the first that validates:
 *   override → DALI_PREVIEW_PREFIX env → .dali/config.json → DESKTOP_PREFIX env →
 *   <baseDir>/setenv → pkg-config system prefix → common paths.
 * Each candidate is passed through {@link resolveDaliPrefix}. Returns null if none.
 */
function resolvePrefix(opts = {}) {
    const baseDir = opts.baseDir ?? process.cwd();
    const candidates = [
        opts.override,
        process.env.DALI_PREVIEW_PREFIX,
        (0, config_1.readConfig)(baseDir).daliPrefix,
        process.env.DESKTOP_PREFIX,
        parseSetenv(path.join(baseDir, 'setenv')),
        pkgConfigPrefix(),
        '/opt/dali', '/opt/dali/opt', '/usr/local', '/usr',
    ];
    for (const c of candidates) {
        if (!c || c.trim().length === 0) {
            continue;
        }
        const resolved = resolveDaliPrefix(c.trim());
        if (resolved) {
            return resolved;
        }
    }
    return null;
}
