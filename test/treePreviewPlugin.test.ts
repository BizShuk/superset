import { describe, it, expect } from "vitest";
import { treePreviewPlugin, TREE_PREVIEW_PLUGIN_ID } from "../src/treePreview/plugin";
import { PluginManager } from "../src/plugin";
import type * as vscode from "vscode";

function fakeExtCtx(): vscode.ExtensionContext {
    return {
        extensionUri: { fsPath: "/fake" } as vscode.Uri,
        globalState: { get: () => undefined, update: async () => {} } as unknown as vscode.Memento,
        workspaceState: {
            get: () => undefined,
            update: async () => {},
        } as unknown as vscode.Memento,
    } as unknown as vscode.ExtensionContext;
}

describe("treePreviewPlugin", () => {
    it("exposes a stable id and name", () => {
        expect(treePreviewPlugin.id).toBe(TREE_PREVIEW_PLUGIN_ID);
        expect(treePreviewPlugin.name).toBe("Tree Preview");
    });

    it("activates without error and registers no disposables", async () => {
        const mgr = new PluginManager({
            extensionContext: fakeExtCtx(),
            workspaceFolder: "/ws",
            log: () => {},
            showStatus: () => {},
        });
        await mgr.activateAll([treePreviewPlugin], fakeExtCtx());
        expect(mgr.has(TREE_PREVIEW_PLUGIN_ID)).toBe(true);
        expect(mgr.getDisposables(TREE_PREVIEW_PLUGIN_ID)).toEqual([]);
    });

    it("contributes a fence rule that renders ```tree blocks", () => {
        const fenceCalls: Array<{ info: string; content: string }> = [];
        const md = {
            renderer: {
                rules: {
                    fence: (tokens: unknown[], idx: number) => {
                        const t = tokens[idx] as { info: string; content: string };
                        fenceCalls.push(t);
                        return `<default>${t.content}</default>`;
                    },
                },
            },
            utils: { escapeHtml: (s: string) => s },
        };

        const contribute = treePreviewPlugin.contributeMarkdownIt!;
        const result = contribute(md as never);

        // Hook installed and chained.
        expect(result).toBe(md);
        const tokens = [
            { info: "tree", content: "src\n├── a.ts\n" },
            { info: "js", content: "console.log(1)\n" },
        ];
        const out1 = (md.renderer.rules.fence as Function)(tokens, 0, {}, {}, {});
        const out2 = (md.renderer.rules.fence as Function)(tokens, 1, {}, {}, {});

        expect(out1).toContain('class="tree-block"');
        expect(out1).toContain("a.ts");
        // Non-tree fences fall through to the previous default.
        expect(out2).toBe("<default>console.log(1)\n</default>");
        // Original default was captured before our hook replaced it.
        expect(fenceCalls).toHaveLength(1);
        expect(fenceCalls[0]!.info).toBe("js");
    });
});
