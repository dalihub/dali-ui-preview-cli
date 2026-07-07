"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXIT_DIVERGED = exports.EXIT_MATCH = void 0;
exports.buildVerdict = buildVerdict;
exports.verdictExitCode = verdictExitCode;
/** Exit code when the render matches the baseline(s). */
exports.EXIT_MATCH = 0;
/** Exit code when the render diverges from a baseline (image and/or tree). */
exports.EXIT_DIVERGED = 20;
/** True iff a tree diff found no structural change at all. */
function treeUnchanged(tree) {
    return tree.added.length + tree.removed.length + tree.changed.length === 0;
}
/**
 * Combine the supplied diff result(s) into a {@link Verdict}.
 *
 * @param input  `{image?, tree?}` — whichever diffs were run.
 * @returns      `{match, image?, tree?}` — `match` per the rule above; the
 *               sub-results echoed for a self-describing stdout payload.
 */
function buildVerdict(input) {
    const imageOk = input.image === undefined || input.image.pass;
    const treeOk = input.tree === undefined || treeUnchanged(input.tree);
    const verdict = { match: imageOk && treeOk };
    if (input.image !== undefined) {
        verdict.image = input.image;
    }
    if (input.tree !== undefined) {
        verdict.tree = input.tree;
    }
    return verdict;
}
/** Map a {@link Verdict} to its process exit code (0 match / 20 diverged). */
function verdictExitCode(verdict) {
    return verdict.match ? exports.EXIT_MATCH : exports.EXIT_DIVERGED;
}
