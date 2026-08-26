// editorLayout/grid — pure domain for the editor grid. No `vscode`
// import, so every rule here is unit-testable in plain Node.
//
// The sizing rule is FIXED, not a user-selectable mode:
//
//     horizontal: even   |   vertical: max
//
// Columns always share the width equally; inside a column, the active
// row takes the larger share. The direction — not the nesting depth —
// decides which rule applies to a level, because `orientation`
// alternates on every level of the tree, which is what `directionAt`
// walks.
//
// The grid SHAPE (NxM) and the root ORIENTATION are orthogonal to the
// sizing rule. Two consequences:
//
//  - `restyleLayout` is the default path: it takes the tree returned by
//    `vscode.getEditorLayout`, keeps the topology AND the orientation,
//    and only rewrites every `size`. Because the leaf count never
//    changes, VS Code can neither create empty groups nor merge
//    existing ones.
//  - `buildLayout` is the only path that reshapes the grid, and it is
//    reachable exclusively from the explicit "Pick Editor Grid Shape"
//    command.
//
// Two platform facts this module encodes (both verified against the
// workbench implementation of `vscode.setEditorLayout`):
//
//  1. `orientation` exists ONLY on the root. Nested levels are always
//     perpendicular to their parent ("The orientation of subsequent
//     groups is the opposite of the orientation of the group that
//     contains it"). That alternation is what `directionAt` walks, and
//     it is also why flipping the root orientation transposes an NxM
//     grid without touching the tree.
//  2. `size` is relative to the sibling set. A sibling that gets a tiny
//     share is clamped to VS Code's minimum group size and reads as
//     "collapsed" on screen — see `activeShare` for the floor that
//     keeps every sibling visible.

/** Screen direction a tree level splits along. */
export type LayoutAxis = "horizontal" | "vertical";

/**
 * The one direction whose active sibling is enlarged. Levels splitting
 * the other way always divide evenly.
 */
export const MAX_AXIS: LayoutAxis = "vertical";

/** Root orientation: `0` = groups run left->right, `1` = top->bottom. */
export type LayoutOrientation = 0 | 1;

/**
 * One node of the `vscode.setEditorLayout` / `vscode.getEditorLayout`
 * tree. A node with a non-empty `groups` array is a branch; anything
 * else is a leaf (one editor group).
 */
export interface GroupLayoutNode {
    size?: number;
    groups?: GroupLayoutNode[];
}

/** Root of the layout tree. `orientation` is meaningful only here. */
export interface EditorLayoutDescriptor {
    orientation: LayoutOrientation;
    groups: GroupLayoutNode[];
}

/**
 * How many leaf groups each slot along the root axis holds.
 * `[1,1,1]` is a plain three-way split; `[2,2]` is a 2x2 grid;
 * `[2,2,1]` is a ragged five-group grid. `sum(shape)` MUST equal the
 * real group count — see `reconcileShape`.
 */
export type LayoutShape = readonly number[];

/** Strategy used when no shape is known (see `defaultShape`). */
export type ShapePolicy = "flat" | "balanced";

export const MIN_MAX_RATIO = 0.5;
export const MAX_MAX_RATIO = 0.9;
export const DEFAULT_MAX_RATIO = 0.8;

/**
 * Smallest share a non-active sibling may keep. Below roughly this much
 * VS Code clamps the group to its minimum size and the grid reads as
 * collapsed — a 2x2 that visually became a single editor. The floor
 * costs nothing at the common counts (two or three siblings at the
 * default ratio are unaffected) and only bites when many siblings would
 * have to share the leftovers.
 */
export const MIN_SIBLING_SHARE = 0.1;

/**
 * Size total used for a sibling set whose current sizes are unusable
 * (a freshly built tree, or a layout that came back without sizes).
 *
 * Sizes MUST be emitted in the same magnitude `vscode.getEditorLayout`
 * hands back, which is real pixels. `createSerializedGrid` derives the
 * virtual grid dimensions by summing the sizes, so fractions that add
 * up to 1 build a 1x1 grid — every editor group then sits far below its
 * minimum width, the split view clamps them all at that virtual stage,
 * and the proportions it later scales by are whatever survived the
 * clamp. That is what makes a sibling disappear while still existing.
 */
export const FALLBACK_SET_TOTAL = 1000;

/** Current pixel extent of a sibling set, or the fallback if unusable. */
function setTotal(nodes: readonly GroupLayoutNode[]): number {
    let total = 0;
    for (const node of nodes) {
        const size = node.size;
        if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
            return FALLBACK_SET_TOTAL;
        }
        total += size;
    }
    return total >= nodes.length ? Math.round(total) : FALLBACK_SET_TOTAL;
}

/**
 * Spread `total` across `ratios` as integers whose sum is exactly
 * `total`, giving every entry at least 1. Largest-remainder allocation,
 * so the rounding error lands on the entries that deserve it rather
 * than accumulating on the last one.
 */
export function allocateSizes(
    ratios: readonly number[],
    total: number
): number[] {
    const count = ratios.length;
    if (count === 0) return [];

    const budget = Math.max(count, Math.round(total));
    const weightSum = ratios.reduce((sum, r) => sum + Math.max(0, r), 0);
    const exact = ratios.map((r) =>
        weightSum > 0 ? (Math.max(0, r) / weightSum) * budget : budget / count
    );

    const sizes = exact.map((value) => Math.max(1, Math.floor(value)));
    let remainder = budget - sizes.reduce((sum, size) => sum + size, 0);

    const order = exact
        .map((value, index) => ({ index, frac: value - Math.floor(value) }))
        .sort((a, b) => b.frac - a.frac || a.index - b.index);

    for (let i = 0; remainder > 0 && count > 0; i = (i + 1) % count) {
        sizes[order[i].index] += 1;
        remainder--;
    }
    // Overshoot only happens when the `>= 1` floor kicked in; take the
    // excess back off the largest entries so the sum still matches.
    while (remainder < 0) {
        let largest = 0;
        for (let i = 1; i < count; i++) {
            if (sizes[i] > sizes[largest]) largest = i;
        }
        if (sizes[largest] <= 1) break;
        sizes[largest] -= 1;
        remainder++;
    }

    return sizes;
}

/** Flip the root orientation — the transpose of an NxM grid. */
export function flipOrientation(
    orientation: LayoutOrientation
): LayoutOrientation {
    return orientation === 0 ? 1 : 0;
}

/**
 * Direction a given tree level splits along. Level 0 follows the root
 * `orientation`; every level below alternates, which is exactly how
 * VS Code interprets a nested descriptor.
 */
export function directionAt(
    level: number,
    orientation: LayoutOrientation
): LayoutAxis {
    const rootIsHorizontal = orientation === 0;
    const evenLevel = level % 2 === 0;
    return rootIsHorizontal === evenLevel ? "horizontal" : "vertical";
}

export function clampMaxRatio(raw: unknown): number {
    const value =
        typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_MAX_RATIO;
    return Math.min(MAX_MAX_RATIO, Math.max(MIN_MAX_RATIO, value));
}

/**
 * Share the active sibling takes among `count` siblings.
 *
 * Capped so every other sibling keeps at least `MIN_SIBLING_SHARE`, and
 * floored at the even split so a crowded level degrades to "even"
 * instead of making the active group the smallest one.
 */
export function activeShare(maxRatio: number, count: number): number {
    if (count <= 1) return 1;
    const even = 1 / count;
    const capped = Math.min(
        clampMaxRatio(maxRatio),
        1 - MIN_SIBLING_SHARE * (count - 1)
    );
    return Math.max(even, capped);
}

/** Non-empty `groups` marks a branch; everything else is a leaf. */
function childrenOf(node: GroupLayoutNode): GroupLayoutNode[] | undefined {
    return Array.isArray(node.groups) && node.groups.length > 0
        ? node.groups
        : undefined;
}

/** Leaf (editor group) count of a sibling list. */
export function countLeaves(nodes: readonly GroupLayoutNode[]): number {
    let total = 0;
    for (const node of nodes) {
        const kids = childrenOf(node);
        total += kids ? countLeaves(kids) : 1;
    }
    return total;
}

/** Structural check for the untyped `vscode.getEditorLayout` result. */
export function isLayoutDescriptor(raw: unknown): raw is EditorLayoutDescriptor {
    if (typeof raw !== "object" || raw === null) return false;
    const candidate = raw as { orientation?: unknown; groups?: unknown };
    if (candidate.orientation !== 0 && candidate.orientation !== 1) return false;
    return Array.isArray(candidate.groups);
}

/**
 * Index path from the root to the `target`-th leaf, where leaves are
 * numbered in depth-first order. That order is exactly VS Code's
 * `GRID_APPEARANCE` order, i.e. `viewColumn - 1` — see
 * `applyLayout.readActiveIndex` for why no other index works.
 * Returns `[]` when the target is out of range.
 */
export function findLeafPath(
    nodes: readonly GroupLayoutNode[],
    target: number
): number[] {
    let seen = 0;

    const walk = (
        list: readonly GroupLayoutNode[],
        prefix: readonly number[]
    ): number[] | undefined => {
        for (let i = 0; i < list.length; i++) {
            const kids = childrenOf(list[i]);
            if (kids) {
                const hit = walk(kids, [...prefix, i]);
                if (hit) return hit;
                continue;
            }
            if (seen === target) return [...prefix, i];
            seen++;
        }
        return undefined;
    };

    return walk(nodes, []) ?? [];
}

/**
 * Rewrite the sizes of one sibling list, recursing into children.
 *
 * `path` is the root->leaf index path of the active group. A level is
 * enlarged only when it sits on that path AND splits along `MAX_AXIS`
 * — which is what keeps the enlarged row from squeezing the columns
 * that contain it.
 */
function styleNodes(
    nodes: readonly GroupLayoutNode[],
    path: readonly number[],
    level: number,
    orientation: LayoutOrientation,
    maxRatio: number
): GroupLayoutNode[] {
    const count = nodes.length;
    const onPath = level < path.length ? path[level] : -1;
    const wantsMax = directionAt(level, orientation) === MAX_AXIS;
    const useMax = wantsMax && onPath >= 0 && count > 1;
    const ratio = useMax ? activeShare(maxRatio, count) : 0;
    const others = useMax ? (1 - ratio) / (count - 1) : 1 / count;

    // Ratios are the decision; the emitted sizes are those ratios
    // spread over the pixel extent this set already occupies, because
    // `setEditorLayout` reads sizes in the same units `getEditorLayout`
    // wrote them. See `FALLBACK_SET_TOTAL`.
    const sizes = allocateSizes(
        nodes.map((_, i) =>
            count === 1 ? 1 : useMax && i === onPath ? ratio : others
        ),
        setTotal(nodes)
    );

    return nodes.map((node, i) => {
        const size = sizes[i];
        const kids = childrenOf(node);
        if (!kids) return { size };
        // Off-path subtrees hold no active group, so they always split
        // evenly — passing an empty path down expresses exactly that.
        return {
            size,
            groups: styleNodes(
                kids,
                i === onPath ? path : [],
                level + 1,
                orientation,
                maxRatio
            ),
        };
    });
}

function styleTree(
    nodes: readonly GroupLayoutNode[],
    orientation: LayoutOrientation,
    activeIndex: number,
    maxRatio: number
): EditorLayoutDescriptor {
    return {
        orientation,
        groups: styleNodes(
            nodes,
            findLeafPath(nodes, activeIndex),
            0,
            orientation,
            maxRatio
        ),
    };
}

function clampIndex(index: unknown, leafCount: number): number {
    if (typeof index !== "number" || !Number.isFinite(index)) return 0;
    return Math.min(leafCount - 1, Math.max(0, Math.trunc(index)));
}

/**
 * Topology-preserving restyle — the default path.
 *
 * `current` is the raw `vscode.getEditorLayout` result. The returned
 * descriptor keeps the identical tree shape and leaf count, and keeps
 * the live orientation unless `orientationOverride` is given (only the
 * transpose command does that). Returns `undefined` when `current` is
 * malformed or holds no groups, in which case the caller must no-op.
 */
export function restyleLayout(
    current: unknown,
    activeIndex: number,
    maxRatio: number,
    orientationOverride?: LayoutOrientation
): EditorLayoutDescriptor | undefined {
    if (!isLayoutDescriptor(current)) return undefined;
    const leafCount = countLeaves(current.groups);
    if (leafCount < 1) return undefined;
    return styleTree(
        current.groups,
        orientationOverride ?? current.orientation,
        clampIndex(activeIndex, leafCount),
        maxRatio
    );
}

/**
 * Build a fresh tree from a partition list. This is the ONLY function
 * that can change the number of leaves, so callers must pass a shape
 * that already went through `reconcileShape` — a mismatch makes VS Code
 * create empty groups or merge existing ones.
 */
export function buildLayout(
    shape: LayoutShape,
    orientation: LayoutOrientation,
    activeIndex: number,
    maxRatio: number
): EditorLayoutDescriptor | undefined {
    const leafCount = shape.reduce((sum, slot) => sum + slot, 0);
    if (!shape.length || leafCount < 1) return undefined;

    const skeleton: GroupLayoutNode[] = shape.map((slot) =>
        slot <= 1
            ? {}
            : {
                  groups: Array.from(
                      { length: slot },
                      () => ({}) as GroupLayoutNode
                  ),
              }
    );

    return styleTree(
        skeleton,
        orientation,
        clampIndex(activeIndex, leafCount),
        maxRatio
    );
}

/**
 * Derive the partition list of an existing tree, for the shape picker
 * check-mark. Nested depth beyond two levels collapses into the leaf
 * count of each root slot, which is exactly what the NxM label needs.
 */
export function describeShape(current: unknown): LayoutShape {
    if (!isLayoutDescriptor(current)) return [];
    return current.groups.map((node) => {
        const kids = childrenOf(node);
        return kids ? countLeaves(kids) : 1;
    });
}

/** `[1,1,...]` — every group on the root axis, no nesting. */
export function flatShape(groupCount: number): LayoutShape {
    return groupCount > 0 ? Array.from({ length: groupCount }, () => 1) : [];
}

/** Near-square shape: `ceil(sqrt(n))` slots, filled as evenly as possible. */
export function balancedShape(groupCount: number): LayoutShape {
    if (groupCount <= 0) return [];
    const major = Math.ceil(Math.sqrt(groupCount));
    const base = Math.floor(groupCount / major);
    const extra = groupCount % major;
    return Array.from({ length: major }, (_, i) => base + (i < extra ? 1 : 0));
}

export function defaultShape(
    groupCount: number,
    policy: ShapePolicy
): LayoutShape {
    return policy === "balanced"
        ? balancedShape(groupCount)
        : flatShape(groupCount);
}

function isValidShape(shape: unknown): shape is number[] {
    return (
        Array.isArray(shape) &&
        shape.length > 0 &&
        shape.every((slot) => Number.isInteger(slot) && (slot as number) > 0)
    );
}

/**
 * Force `sum(shape) === groupCount` — the invariant that keeps the
 * reshape path from creating empty groups or merging existing ones.
 *
 * Growth adds to the smallest slot (first one on ties) so grids stay
 * balanced; shrink removes from the largest slot (again first on ties)
 * and drops slots that reach zero. Junk input falls back to `policy`.
 */
export function reconcileShape(
    shape: LayoutShape | undefined,
    groupCount: number,
    policy: ShapePolicy
): LayoutShape {
    if (groupCount <= 0) return [];
    if (!isValidShape(shape)) return defaultShape(groupCount, policy);

    const slots = [...shape];
    let total = slots.reduce((sum, slot) => sum + slot, 0);

    while (total > groupCount) {
        let target = 0;
        for (let i = 1; i < slots.length; i++) {
            if (slots[i] > slots[target]) target = i;
        }
        slots[target] -= 1;
        if (slots[target] === 0) slots.splice(target, 1);
        total -= 1;
    }

    while (total < groupCount) {
        let target = 0;
        for (let i = 1; i < slots.length; i++) {
            if (slots[i] < slots[target]) target = i;
        }
        slots[target] += 1;
        total += 1;
    }

    return slots;
}

/**
 * Candidate shapes offered by the shape picker for `groupCount` groups:
 * the flat split, every rectangular factorisation, and the balanced
 * (possibly ragged) shape. Every entry sums to `groupCount` by
 * construction, so the picker cannot offer a destructive option.
 */
export function enumerateShapes(groupCount: number): LayoutShape[] {
    if (groupCount <= 0) return [];
    if (groupCount === 1) return [[1]];

    const seen = new Set<string>();
    const out: LayoutShape[] = [];
    const push = (shape: LayoutShape) => {
        const key = shape.join(",");
        if (shape.length && !seen.has(key)) {
            seen.add(key);
            out.push(shape);
        }
    };

    push(flatShape(groupCount));
    for (let slot = 2; slot < groupCount; slot++) {
        if (groupCount % slot === 0) {
            push(Array.from({ length: groupCount / slot }, () => slot));
        }
    }
    push(balancedShape(groupCount));

    return out;
}

/** `2x2`, `3x2`, or `2+2+1` for ragged shapes. Empty when flat. */
export function formatShape(shape: LayoutShape): string {
    if (shape.length <= 1) return "";
    if (shape.every((slot) => slot === 1)) return "";
    const [first] = shape;
    return shape.every((slot) => slot === first)
        ? `${shape.length}×${first}`
        : shape.join("+");
}

/**
 * Human-readable label for one candidate shape. Falls back to `N × 1`
 * for a flat split, where `formatShape` deliberately says nothing.
 */
export function renderShapeLabel(shape: LayoutShape): string {
    const formatted = formatShape(shape);
    return formatted || `${shape.length} × 1`;
}
