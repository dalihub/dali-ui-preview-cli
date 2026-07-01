/*
 * runtime/xvfb.ts — one-shot virtual display for a single native render. Claims a
 * free display in :99..:114 (a wide band so leftover servers can't force us onto
 * the real :0), starts Xvfb, waits until it answers, and hands back a stop().
 * Ported from the extension's XvfbManager, simplified for a short-lived CLI.
 */
import { spawn, execSync, ChildProcess } from 'child_process';
import * as fs from 'fs';

const CANDIDATES = Array.from({ length: 16 }, (_, i) => 99 + i); // :99 … :114

export interface XvfbSession { display: string; stop(): void }

/** Whether the Xvfb binary is on PATH. */
export function isXvfbInstalled(): boolean {
  try { execSync('which Xvfb', { stdio: 'ignore' }); return true; } catch { return false; }
}

/** True iff a display number is held by a live X server (via its lock file). */
function inUse(n: number): boolean {
  try {
    const lock = `/tmp/.X${n}-lock`;
    if (!fs.existsSync(lock)) { return false; }
    const pid = parseInt(String(fs.readFileSync(lock, 'utf8')).trim(), 10);
    if (Number.isNaN(pid)) { return false; }
    try { process.kill(pid, 0); return true; } catch { return false; }
  } catch { return false; }
}

/** True iff `xdpyinfo` can reach the display (i.e. Xvfb is ready). */
function ready(display: string): boolean {
  try { execSync(`xdpyinfo -display ${display}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

async function tryStart(display: string, width: number, height: number): Promise<ChildProcess | null> {
  const child = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-ac', '-nolisten', 'tcp'],
    { stdio: 'ignore', detached: true });
  child.unref();
  let died = false;
  child.on('error', () => { died = true; });
  child.on('exit', () => { died = true; });
  for (let i = 0; i < 50; i++) {                 // up to ~5s
    if (died) { return null; }
    if (ready(display)) { return child; }
    await new Promise((r) => setTimeout(r, 100));
  }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  return null;
}

/**
 * Start a virtual display sized to the render. Tries :99..:114 and returns the
 * first that comes up; returns null if none could start (caller MUST then refuse
 * to render — it never returns the inherited/real display).
 */
export async function startXvfb(width: number, height: number): Promise<XvfbSession | null> {
  if (!isXvfbInstalled()) { return null; }
  const w = Math.max(1, Math.min(Math.round(width) || 1, 8192));
  const h = Math.max(1, Math.min(Math.round(height) || 1, 8192));
  for (const n of CANDIDATES) {
    const display = `:${n}`;
    if (inUse(n)) { continue; }
    const child = await tryStart(display, w, h);
    if (child) {
      return {
        display,
        stop() { try { child.kill('SIGTERM'); } catch { /* already gone */ } },
      };
    }
  }
  return null;
}
