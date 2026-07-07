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
exports.isXvfbInstalled = isXvfbInstalled;
exports.startXvfb = startXvfb;
/*
 * runtime/xvfb.ts — one-shot virtual display for a single native render. Claims a
 * free display in :99..:114 (a wide band so leftover servers can't force us onto
 * the real :0), starts Xvfb, waits until it answers, and hands back a stop().
 * Ported from the extension's XvfbManager, simplified for a short-lived CLI.
 */
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const CANDIDATES = Array.from({ length: 16 }, (_, i) => 99 + i); // :99 … :114
/** Whether the Xvfb binary is on PATH. */
function isXvfbInstalled() {
    try {
        (0, child_process_1.execSync)('which Xvfb', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/** True iff a display number is held by a live X server (via its lock file). */
function inUse(n) {
    try {
        const lock = `/tmp/.X${n}-lock`;
        if (!fs.existsSync(lock)) {
            return false;
        }
        const pid = parseInt(String(fs.readFileSync(lock, 'utf8')).trim(), 10);
        if (Number.isNaN(pid)) {
            return false;
        }
        try {
            process.kill(pid, 0);
            return true;
        }
        catch {
            return false;
        }
    }
    catch {
        return false;
    }
}
/** True iff `xdpyinfo` can reach the display (i.e. Xvfb is ready). */
function ready(display) {
    try {
        (0, child_process_1.execSync)(`xdpyinfo -display ${display}`, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
async function tryStart(display, width, height) {
    const child = (0, child_process_1.spawn)('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-ac', '-nolisten', 'tcp'], { stdio: 'ignore', detached: true });
    child.unref();
    let died = false;
    child.on('error', () => { died = true; });
    child.on('exit', () => { died = true; });
    for (let i = 0; i < 50; i++) { // up to ~5s
        if (died) {
            return null;
        }
        if (ready(display)) {
            return child;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    try {
        child.kill('SIGTERM');
    }
    catch { /* already gone */ }
    return null;
}
/**
 * Start a virtual display sized to the render. Tries :99..:114 and returns the
 * first that comes up; returns null if none could start (caller MUST then refuse
 * to render — it never returns the inherited/real display).
 */
async function startXvfb(width, height) {
    if (!isXvfbInstalled()) {
        return null;
    }
    const w = Math.max(1, Math.min(Math.round(width) || 1, 8192));
    const h = Math.max(1, Math.min(Math.round(height) || 1, 8192));
    for (const n of CANDIDATES) {
        const display = `:${n}`;
        if (inUse(n)) {
            continue;
        }
        const child = await tryStart(display, w, h);
        if (child) {
            return {
                display,
                stop() { try {
                    child.kill('SIGTERM');
                }
                catch { /* already gone */ } },
            };
        }
    }
    return null;
}
