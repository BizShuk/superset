import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
    class EventEmitter<T> {
        event = vi.fn();
        fire = vi.fn((_value?: T) => undefined);
        dispose = vi.fn();
    }
    class TreeItem {
        description?: string;
        tooltip?: string;
        iconPath?: unknown;
        contextValue?: string;
        command?: unknown;
        constructor(
            readonly label: string,
            readonly collapsibleState: number
        ) {}
    }
    return {
        EventEmitter,
        TreeItem,
        ThemeIcon: class ThemeIcon {
            constructor(readonly id: string) {}
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    };
});

import { SessionsTreeProvider } from "../src/sessions/sessionsTreeProvider";
import { workspaceSessionsDir } from "../src/sessions/store";

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function writeSession(dataRoot: string, projectPath: string, id: string): void {
    const dir = workspaceSessionsDir(projectPath, dataRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        path.join(dir, `${id}.jsonl`),
        [
            JSON.stringify({
                type: "meta",
                agent: "claude",
                session_id: id,
                workspace_path: projectPath,
                title: id,
                created_at: "2026-07-20T10:00:00.000Z",
                schema_version: 1,
            }),
            JSON.stringify({
                type: "turn",
                index: 1,
                event: "Stop",
                user: "prompt",
                summary: "summary",
                source: "llm",
                status: "ok",
                at: "2026-07-20T10:01:00.000Z",
            }),
        ].join("\n") + "\n"
    );
}

describe("SessionsTreeProvider project grouping", () => {
    it("renders project groups with session children", () => {
        const dataRoot = mkdtempSync(path.join(tmpdir(), "sessions-tree-"));
        roots.push(dataRoot);
        const workspace = "/workspace/utils";
        writeSession(dataRoot, workspace, "root-session");
        writeSession(dataRoot, path.join(workspace, "apps", "api"), "api-session");
        writeSession(dataRoot, path.join(workspace, "packages", "api"), "pkg-session");

        const provider = new SessionsTreeProvider(workspace, () => dataRoot);
        provider.refresh();
        const projects = provider.getChildren();

        expect(projects.map((element) => element.kind)).toEqual([
            "project",
            "project",
            "project",
        ]);
        expect(projects.map((element) => provider.getTreeItem(element).label)).toEqual([
            "utils",
            "apps/api",
            "packages/api",
        ]);
        expect(provider.getChildren(projects[1])).toHaveLength(1);
        expect(provider.getChildren(projects[1])[0].kind).toBe("session");
        expect(provider.getTreeItem(projects[1]).description).toBe("1 session");
    });

    it("keeps the global empty placeholder when no project has sessions", () => {
        const dataRoot = mkdtempSync(path.join(tmpdir(), "sessions-tree-empty-"));
        roots.push(dataRoot);
        const provider = new SessionsTreeProvider("/workspace/utils", () => dataRoot);

        provider.refresh();

        expect(provider.getChildren()).toEqual([{ kind: "empty" }]);
    });
});
