import { describe, it, expect } from "vitest";
import { buildExplorerTreeItemSpec } from "../src/explorerTreeSpec";
import type { ExplorerNode } from "../src/types";

function dirNode(
    uri: string,
    name: string,
    children?: ExplorerNode[]
): ExplorerNode {
    return { uri, name, isDirectory: true, children };
}

function fileNode(uri: string, name: string): ExplorerNode {
    return { uri, name, isDirectory: false };
}

describe("buildExplorerTreeItemSpec", () => {
    it("directory node has folder icon and contextValue explorerDir", () => {
        const node = dirNode("/root", "root");
        const spec = buildExplorerTreeItemSpec(node);
        expect(spec.iconKind).toBe("folder");
        expect(spec.contextValue).toBe("explorerDir");
        expect(spec.label).toBe("root");
        expect(spec.command).toBeUndefined();
    });

    it("file node has file icon, contextValue explorerFile, and open command", () => {
        const node = fileNode("/root/index.ts", "index.ts");
        const spec = buildExplorerTreeItemSpec(node);
        expect(spec.iconKind).toBe("file");
        expect(spec.contextValue).toBe("explorerFile");
        expect(spec.label).toBe("index.ts");
        expect(spec.command).toBeDefined();
        expect(spec.command!.command).toBe("superset.exploreOpen");
        expect(spec.command!.arguments).toEqual([node]);
    });

    it("directory with enumerated children shows count in description", () => {
        const node = dirNode("/root/src", "src", [
            fileNode("/root/src/a.ts", "a.ts"),
            fileNode("/root/src/b.ts", "b.ts"),
        ]);
        const spec = buildExplorerTreeItemSpec(node);
        expect(spec.description).toBe("(2)");
    });

    it("directory without enumerated children has no description", () => {
        const node = dirNode("/root/src", "src");
        const spec = buildExplorerTreeItemSpec(node);
        expect(spec.description).toBeUndefined();
    });
});