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

import * as fs from 'fs';

/** Tuning knobs for {@link runWatch} (defaulted for the CLI). */
export interface WatchOptions {
    /** Debounce window in ms for coalescing change events (default 150). */
    debounceMs?: number;
    /** Sink for diagnostics; defaults to `console.error` (stderr). */
    log?: (message: string) => void;
}

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
export function runWatch(
    filePath: string,
    renderOnce: () => Promise<void>,
    opts: WatchOptions = {},
): Promise<void> {
    const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const log = opts.log ?? ((m: string) => console.error(m));

    return new Promise<void>((resolve, reject) => {
        let watcher: fs.FSWatcher | undefined;
        let timer: NodeJS.Timeout | undefined;
        let rendering = false;
        let pending = false;
        let stopped = false;

        // Run a render, serializing concurrent triggers: a request that arrives
        // while a render is in flight sets `pending`, replayed when this one ends.
        const runRender = async (): Promise<void> => {
            if (rendering) {
                pending = true;
                return;
            }
            rendering = true;
            try {
                await renderOnce();
            } catch (err) {
                log(
                    `dali-ui-preview: re-render failed: ` +
                    `${err instanceof Error ? err.message : String(err)}`,
                );
            } finally {
                rendering = false;
                if (pending && !stopped) {
                    pending = false;
                    void runRender();
                }
            }
        };

        const onChange = (): void => {
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

        const cleanup = (): void => {
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

        const onSignal = (): void => {
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
                        log(
                            `dali-ui-preview: watch error: ` +
                            `${err instanceof Error ? err.message : String(err)}`,
                        );
                    });
                } catch (err) {
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
