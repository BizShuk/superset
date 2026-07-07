import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectStore } from "../src/projects/projectStore";
import * as fs from "fs";
import * as os from "os";

function createMockDirent(name: string, isDirectory: boolean) {
    return {
        name,
        isDirectory: () => isDirectory,
        isFile: () => !isDirectory,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false
    };
}

vi.mock("os", () => ({
    homedir: () => "/mock-home"
}));

vi.mock("fs", () => ({
    promises: {
        readdir: vi.fn()
    }
}));

describe("ProjectStore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("scans and groups projects correctly", async () => {
        const readdirMock = vi.mocked(fs.promises.readdir);
        
        // Setup readdir mock returns
        readdirMock.mockImplementation(async (dirPath: any) => {
            const p = String(dirPath);
            if (p.replace(/\\/g, "/").endsWith("/mock-home/projects")) {
                return [
                    createMockDirent("cc-plugin", true),
                    createMockDirent("product", true),
                    createMockDirent("gosdk", true),
                    createMockDirent("macnotesapp", true),
                    createMockDirent("playground", true),
                    createMockDirent("tmp", true),
                    createMockDirent(".hidden-dir", true),
                    createMockDirent("some-file.txt", false)
                ] as any;
            } else if (p.replace(/\\/g, "/").endsWith("/mock-home/projects/tmp")) {
                return [
                    createMockDirent("Project-Shuk", true),
                    createMockDirent("superset", true),
                    createMockDirent("temp-file.log", false)
                ] as any;
            }
            return [];
        });

        const store = new ProjectStore();
        
        let changeTriggered = false;
        store.onDidChange(() => {
            changeTriggered = true;
        });

        await store.scan();

        expect(changeTriggered).toBe(true);

        const projects = store.getProjects();
        // Aggregation: product
        // Framework: cc-plugin, gosdk
        // Tool: macnotesapp
        // Application: playground
        // Temporary: Project-Shuk, superset
        // Total: 7 projects (tmp skip, .hidden-dir skip, files skip)
        expect(projects).toHaveLength(7);

        const roots = store.getRoots();
        expect(roots).toHaveLength(5);

        // Verify pre-defined order: aggregation, application, framework, tool, temporary
        expect(roots[0].id).toBe("aggregation");
        expect(roots[0].children).toHaveLength(1);
        expect(roots[0].children[0].name).toBe("product");

        expect(roots[1].id).toBe("application");
        expect(roots[1].children).toHaveLength(1);
        expect(roots[1].children[0].name).toBe("playground");

        expect(roots[2].id).toBe("framework");
        expect(roots[2].children).toHaveLength(2);
        expect(roots[2].children[0].name).toBe("cc-plugin");
        expect(roots[2].children[1].name).toBe("gosdk");

        expect(roots[3].id).toBe("tool");
        expect(roots[3].children).toHaveLength(1);
        expect(roots[3].children[0].name).toBe("macnotesapp");

        expect(roots[4].id).toBe("temporary");
        expect(roots[4].children).toHaveLength(2);
        expect(roots[4].children[0].name).toBe("Project-Shuk");
        expect(roots[4].children[1].name).toBe("superset");
    });

    it("handles readdir errors gracefully", async () => {
        const readdirMock = vi.mocked(fs.promises.readdir);
        readdirMock.mockRejectedValue(new Error("Permission denied"));

        const store = new ProjectStore();
        await store.scan();

        const projects = store.getProjects();
        expect(projects).toHaveLength(0);

        const roots = store.getRoots();
        expect(roots).toHaveLength(5);
        expect(roots.every(r => r.children.length === 0)).toBe(true);
    });
});
