// editorLayout/controller — orchestration between the pure layout
// domain and whatever host owns the real editor grid. No `vscode`
// import: the host is injected, so every decision below (which path
// runs, when a write is skipped) is unit-testable.

import {
    buildLayout,
    describeShape,
    enumerateShapes,
    flipOrientation,
    isLayoutDescriptor,
    reconcileShape,
    restyleLayout,
    type EditorLayoutDescriptor,
    type EditorLayoutMode,
    type LayoutOrientation,
    type LayoutShape,
    type ShapePolicy,
} from "./layoutModes";

/** Everything the controller needs from the editor host. */
export interface LayoutHost {
    /** Raw `vscode.getEditorLayout` result, or `undefined` on failure. */
    readLayout(): Promise<unknown>;
    /** `vscode.setEditorLayout`. */
    writeLayout(descriptor: EditorLayoutDescriptor): Promise<void>;
    /**
     * Depth-first index of the active group. MUST come from
     * `viewColumn - 1` — see `applyLayout.ts` for why the tab-group
     * array order is the wrong source.
     */
    activeIndex(): number;
    /** Number of live editor groups. */
    groupCount(): number;
    /** `superset.editorLayout.maxRatio`. */
    maxRatio(): number;
    /** `superset.editorLayout.defaultShape`. */
    shapePolicy(): ShapePolicy;
    log(message: string): void;
}

/**
 * Stable string for a descriptor.
 *
 * Sizes are compared as SHARES of their sibling set, not as raw pixels:
 * the emitted sizes are pixel counts scaled to whatever extent the set
 * currently occupies, so resizing the window or a one-pixel rounding
 * difference would otherwise read as a pending layout change and make
 * the follow-active-group listener write on every event.
 */
export function layoutSignature(descriptor: EditorLayoutDescriptor): string {
    const round = (nodes: EditorLayoutDescriptor["groups"]): unknown[] => {
        const total = nodes.reduce((sum, node) => sum + (node.size ?? 0), 0);
        return nodes.map((node) => ({
            size:
                total > 0
                    ? Math.round(((node.size ?? 0) / total) * 1e3) / 1e3
                    : 0,
            groups: node.groups ? round(node.groups) : undefined,
        }));
    };
    return JSON.stringify({
        orientation: descriptor.orientation,
        groups: round(descriptor.groups),
    });
}

export class LayoutController {
    private lastAppliedSignature: string | undefined;

    constructor(private readonly host: LayoutHost) {}

    /** Drop the memo so the next apply always writes. */
    reset(): void {
        this.lastAppliedSignature = undefined;
    }

    /**
     * Topology-preserving apply — the path taken by all four modes.
     * The live orientation is preserved unless `orientation` is given,
     * which only the transpose command does.
     *
     * `force` is set by every explicit user command. Event-driven
     * re-applies leave it off so the signature guard can suppress them:
     * `vscode.setEditorLayout` itself fires the tab-group change event,
     * so an unguarded listener would loop forever.
     *
     * The guard compares against what this controller last WROTE, never
     * against the live layout. VS Code clamps groups to a minimum size,
     * so a requested ratio and the resulting one legitimately differ —
     * comparing against the live layout would make every event look
     * like a pending change and reintroduce the loop.
     */
    async applyMode(
        mode: EditorLayoutMode,
        options: { force?: boolean; orientation?: LayoutOrientation } = {}
    ): Promise<boolean> {
        if (this.host.groupCount() < 1) return false;

        const current = await this.host.readLayout();
        const desired = restyleLayout(
            current,
            mode,
            this.host.activeIndex(),
            this.host.maxRatio(),
            options.orientation
        );
        if (!desired) {
            this.host.log(
                "editorLayout: skipped apply — no usable layout from vscode.getEditorLayout"
            );
            return false;
        }

        const signature = layoutSignature(desired);
        if (!options.force && signature === this.lastAppliedSignature) {
            return false;
        }

        await this.host.writeLayout(desired);
        this.lastAppliedSignature = signature;
        return true;
    }

    /**
     * Flip the root orientation, which transposes an NxM grid without
     * touching the tree: nested levels are always perpendicular to
     * their parent, so `[2,2]` laid out as 2 columns of 2 rows becomes
     * 2 rows of 2 columns. Sizing follows the direction, so the mode's
     * horizontal and vertical rules swap levels with it.
     */
    async transpose(mode: EditorLayoutMode): Promise<boolean> {
        const current = await this.host.readLayout();
        if (!isLayoutDescriptor(current)) {
            this.host.log(
                "editorLayout: cannot transpose — no usable layout from vscode.getEditorLayout"
            );
            return false;
        }
        return this.applyMode(mode, {
            force: true,
            orientation: flipOrientation(current.orientation),
        });
    }

    /**
     * Reshaping apply — the ONLY path that changes the number of leaves,
     * reachable exclusively from the shape picker. `reconcileShape` is
     * the second line of defence behind the picker's own filtering: a
     * shape whose sum differs from the live group count would make
     * VS Code spawn empty groups or merge existing ones.
     */
    async applyShape(
        mode: EditorLayoutMode,
        shape: LayoutShape
    ): Promise<boolean> {
        const count = this.host.groupCount();
        if (count < 1) return false;

        const current = await this.host.readLayout();
        const orientation = isLayoutDescriptor(current)
            ? current.orientation
            : 0;
        const reconciled = reconcileShape(shape, count, this.host.shapePolicy());
        const desired = buildLayout(
            mode,
            reconciled,
            orientation,
            this.host.activeIndex(),
            this.host.maxRatio()
        );
        if (!desired) return false;

        await this.host.writeLayout(desired);
        this.lastAppliedSignature = layoutSignature(desired);
        return true;
    }

    /** Live grid shape, for the status bar and the picker check-mark. */
    async currentShape(): Promise<LayoutShape> {
        return describeShape(await this.host.readLayout());
    }

    /** Live root orientation, for the status bar. Defaults to horizontal. */
    async currentOrientation(): Promise<LayoutOrientation> {
        const current = await this.host.readLayout();
        return isLayoutDescriptor(current) ? current.orientation : 0;
    }

    /** Candidate shapes for the live group count. Every entry is safe. */
    candidateShapes(): LayoutShape[] {
        return enumerateShapes(this.host.groupCount());
    }
}
