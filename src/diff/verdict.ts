/*
 * verdict.ts — fold the image-diff and/or tree-diff results into ONE machine
 * verdict (M4/WU-3: F4.3), the object the CLI prints to stdout when verifying and
 * the basis for its exit code. Lets an agent branch on a single `match` boolean.
 *
 *   match = (image === undefined OR image.pass)
 *         AND (tree  === undefined OR tree has no added/removed/changed)
 *
 * i.e. an absent dimension can never fail the match; a present one must pass. The
 * CLI maps the verdict to an exit code: 0 = match, 20 = diverged (a value distinct
 * from 0/1 so callers can tell "tool error" (1) from "rendered, but differs" (20)).
 *
 * Pure compute: no fs, no process state. The included sub-results are passed
 * through verbatim so the printed verdict is self-describing.
 */

import { ImageDiffResult } from './imageDiff';
import { TreeDiffResult } from './treeDiff';

/** Inputs to {@link buildVerdict}: either/both diff results (each optional). */
export interface VerdictInput {
    /** The image-diff result, when `--baseline` was given. */
    image?: ImageDiffResult;
    /** The tree-diff result, when `--baseline-tree` was given. */
    tree?: TreeDiffResult;
}

/** The combined verdict printed to stdout (and the source of the exit code). */
export interface Verdict {
    /** Overall pass: image passes (or absent) AND tree is unchanged (or absent). */
    match: boolean;
    /** Echoed image-diff result, when one was computed. */
    image?: ImageDiffResult;
    /** Echoed tree-diff result, when one was computed. */
    tree?: TreeDiffResult;
}

/** Exit code when the render matches the baseline(s). */
export const EXIT_MATCH = 0;
/** Exit code when the render diverges from a baseline (image and/or tree). */
export const EXIT_DIVERGED = 20;

/** True iff a tree diff found no structural change at all. */
function treeUnchanged(tree: TreeDiffResult): boolean {
    return tree.added.length + tree.removed.length + tree.changed.length === 0;
}

/**
 * Combine the supplied diff result(s) into a {@link Verdict}.
 *
 * @param input  `{image?, tree?}` — whichever diffs were run.
 * @returns      `{match, image?, tree?}` — `match` per the rule above; the
 *               sub-results echoed for a self-describing stdout payload.
 */
export function buildVerdict(input: VerdictInput): Verdict {
    const imageOk = input.image === undefined || input.image.pass;
    const treeOk = input.tree === undefined || treeUnchanged(input.tree);
    const verdict: Verdict = { match: imageOk && treeOk };
    if (input.image !== undefined) {
        verdict.image = input.image;
    }
    if (input.tree !== undefined) {
        verdict.tree = input.tree;
    }
    return verdict;
}

/** Map a {@link Verdict} to its process exit code (0 match / 20 diverged). */
export function verdictExitCode(verdict: Verdict): number {
    return verdict.match ? EXIT_MATCH : EXIT_DIVERGED;
}
