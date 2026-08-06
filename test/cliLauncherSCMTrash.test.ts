vi.mock("vscode", () => ({
    Uri: {
        file: vi.fn((path: string) => ({ scheme: "file", fsPath: path })),
    },
    workspace: {
        fs: {
            delete: vi.fn(async () => undefined),
        },
    },
}));

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { trashSCMFile } from "../src/cliLauncher/scmTrash";

describe("trashSCMFile", () => {
    it("moves an untracked SCM path to the operating-system Trash", async () => {
        await trashSCMFile("/repo/new.txt");

        expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(
            expect.objectContaining({ scheme: "file", fsPath: "/repo/new.txt" }),
            { recursive: true, useTrash: true }
        );
    });
});
