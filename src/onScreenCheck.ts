// On-screen bounds check for the CLI's rich semantic tree — the invariant
// behind click-to-code overlays. dali-ui coordinate-convention regressions
// leave the render correct but push exported bounds off-screen (a class the
// non-blank-PNG check cannot see). vscode-free so the e2e harness can require it.
export interface TreeNode {
    bounds?: { x?: number; y?: number; w?: number; h?: number };
    visible?: boolean;
    opacity?: number;
    type?: string;
    name?: string;
    children?: TreeNode[];
}

export function checkTreeOnScreen(
    tree: { root?: TreeNode } | TreeNode,
    windowWidth: number,
    windowHeight: number,
): string | null {
    const root: TreeNode | undefined = (tree as { root?: TreeNode }).root ?? (tree as TreeNode);
    if (!root) {
        return 'tree has no root node';
    }
    const NEG_TOL = 2;
    const EDGE_TOL = 1;
    const offenders: string[] = [];

    const walk = (n: TreeNode | undefined): void => {
        if (!n) { return; }
        const b = n.bounds ?? {};
        const w = b.w ?? 0;
        const h = b.h ?? 0;
        const visible = n.visible !== false;
        const opacity = typeof n.opacity === 'number' ? n.opacity : 1;
        // Only drawn (visible, non-transparent, sized) nodes must be on-screen.
        // Off the RIGHT/BOTTOM is allowed (scroll content); a NEGATIVE position or
        // being entirely off the LEFT/TOP is the coordinate-bug signature.
        if (visible && opacity > 0.01 && w > 1 && h > 1) {
            const x = b.x ?? 0;
            const y = b.y ?? 0;
            const negative = x < -NEG_TOL || y < -NEG_TOL;
            const offLeftTop = x + w <= EDGE_TOL || y + h <= EDGE_TOL;
            if (negative || offLeftTop) {
                offenders.push(`${n.type ?? 'Actor'} "${n.name ?? ''}" @ (${x},${y},${w}x${h})`);
            }
        }
        (n.children ?? []).forEach(walk);
    };
    walk(root);

    if (offenders.length > 0) {
        return (
            `${offenders.length} visible node(s) at negative/off-screen bounds — click-to-code ` +
            `overlays will not match the render (window ${windowWidth}x${windowHeight}): ` +
            offenders.slice(0, 5).join('; ')
        );
    }
    return null;
}
