"use strict";
/*
 * watch.ts — file-watching re-render loop for the CLI (M3/WU-4: F3.4).
 *
 * `runWatch(filePath, renderOnce, opts)` renders + prints once, then `fs.watch`es
 * the input file and re-runs `renderOnce` on every change, debounced (~150ms) so a
 * burst of editor save events collapses into a single re-render. Renders are
 * SERIALIZED — a change arriving mid-render is coalesced and replayed once the
 * current render finishes — so emissions never interleave. The promise resolves on
 * SIGINT / SIGTERM, restoring the signal handlers and closing the watcher.
 *
 * This module owns only the timing / watching / signal plumbing; `renderOnce` (the
 * actual render→print pipeline, including its own error handling) is injected by
 * the CLI so watch.ts stays free of docker / tree / stdout specifics. Each
 * `renderOnce` is expected to print exactly one emission (one line of JSON, per the
 * stdout contract); watch.ts adds nothing to stdout itself — diagnostics go to
 * stderr.
 */
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
exports.runWatch = runWatch;
const fs = __importStar(require("fs"));
const DEFAULT_DEBOUNCE_MS = 150;
/**
 * Watch `filePath` and re-run `renderOnce` on change until interrupted.
 *
 * Lifecycle:
 *   1. Run `renderOnce` once (initial emission).
 *   2. `fs.watch(filePath)`; on each event, (re)arm a debounce timer.
 *   3. When the timer fires, run `renderOnce`. If a render is already in flight,
 *      mark "pending" and re-run once it completes (coalescing the burst).
 *   4. On SIGINT/SIGTERM: detach handlers, close the watcher, clear any timer, and
 *      resolve. The initial render's failure rejects; later failures are reported
 *      via `log` and the loop keeps watching (so a transient bad edit is recoverable).
 *
 * @param filePath    The file to watch (must be a real path; the CLI rejects stdin).
 * @param renderOnce  Render + print one emission; should handle its own errors but
 *                    may throw — the initial throw rejects, later throws are logged.
 * @param opts        Optional debounce / log overrides.
 * @returns           Resolves when a termination signal is received.
 */
function runWatch(filePath, renderOnce, opts = {}) {
    const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const log = opts.log ?? ((m) => console.error(m));
    return new Promise((resolve, reject) => {
        let watcher;
        let timer;
        let rendering = false;
        let pending = false;
        let stopped = false;
        // Run a render, serializing concurrent triggers: a request that arrives
        // while a render is in flight sets `pending`, replayed when this one ends.
        const runRender = async () => {
            if (rendering) {
                pending = true;
                return;
            }
            rendering = true;
            try {
                await renderOnce();
            }
            catch (err) {
                log(`dali-ui-preview: re-render failed: ` +
                    `${err instanceof Error ? err.message : String(err)}`);
            }
            finally {
                rendering = false;
                if (pending && !stopped) {
                    pending = false;
                    void runRender();
                }
            }
        };
        const onChange = () => {
            if (stopped) {
                return;
            }
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                timer = undefined;
                void runRender();
            }, debounceMs);
        };
        const cleanup = () => {
            if (stopped) {
                return;
            }
            stopped = true;
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            if (watcher !== undefined) {
                watcher.close();
                watcher = undefined;
            }
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
        };
        const onSignal = () => {
            cleanup();
            resolve();
        };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
        // Initial render first; only start watching once it succeeds. A failed
        // FIRST render is fatal (mirrors a one-shot run), so reject after cleanup.
        renderOnce()
            .then(() => {
            if (stopped) {
                return;
            }
            try {
                watcher = fs.watch(filePath, onChange);
                watcher.on('error', (err) => {
                    log(`dali-ui-preview: watch error: ` +
                        `${err instanceof Error ? err.message : String(err)}`);
                });
            }
            catch (err) {
                cleanup();
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        })
            .catch((err) => {
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
}
