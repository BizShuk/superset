// CLI Change item → VS Code Diff Editor adapter。
//
// HEAD 與 empty side 使用 read-only virtual documents；working side 直接使用 file URI，
// 讓 VS Code 保留語言辨識與既有 Diff Editor 行為。

import { access } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { resolveRepositoryPath } from "./scmPath";
import type { GitSCMRepository } from "./scmRepository";
import type { GitChange } from "./scmStatus";

export const SCM_DIFF_SCHEME = "superset-cli-scm";

type VirtualSource =
    | { readonly kind: "empty" }
    | {
          readonly kind: "head";
          readonly repoPath: string;
          readonly relativePath: string;
      }
    | {
          readonly kind: "index";
          readonly repoPath: string;
          readonly relativePath: string;
      };

async function exists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function displayPath(change: GitChange): string {
    return change.originalPath
        ? `${change.originalPath} → ${change.path}`
        : change.path;
}

export class SCMDiffProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly sources = new Map<string, VirtualSource>();
    private nextToken = 0;
    private disposed = false;

    constructor(private readonly repository: GitSCMRepository) {}

    provideTextDocumentContent(uri: vscode.Uri): Promise<string> | string {
        const source = this.sources.get(uri.query);
        if (!source) {
            throw new Error("SCM diff source has expired.");
        }
        if (source.kind === "empty") {
            return "";
        }
        return source.kind === "head"
            ? this.repository.readHeadFile(source.repoPath, source.relativePath)
            : this.repository.readIndexFile(source.repoPath, source.relativePath);
    }

    async open(repoPath: string, change: GitChange): Promise<void> {
        if (this.disposed) {
            throw new Error("SCM diff provider has been disposed.");
        }

        const workingPath = resolveRepositoryPath(repoPath, change.path);
        const headPath = change.originalPath ?? change.path;
        resolveRepositoryPath(repoPath, headPath);

        const [left, right] = await this.diffSides(
            repoPath,
            workingPath,
            headPath,
            change
        );

        await vscode.commands.executeCommand(
            "vscode.diff",
            left,
            right,
            `${change.marker} ${displayPath(change)}`,
            { preview: true }
        );
    }

    private async diffSides(
        repoPath: string,
        workingPath: string,
        headPath: string,
        change: GitChange
    ): Promise<[vscode.Uri, vscode.Uri]> {
        if (change.group === "staged") {
            const left =
                change.marker === "A" && !change.originalPath
                    ? this.virtualUri(change.path, { kind: "empty" })
                    : this.virtualUri(headPath, {
                          kind: "head",
                          repoPath,
                          relativePath: headPath,
                      });
            const right =
                change.marker === "D"
                    ? this.virtualUri(change.path, { kind: "empty" })
                    : this.virtualUri(change.path, {
                          kind: "index",
                          repoPath,
                          relativePath: change.path,
                      });
            return [left, right];
        }

        if (change.group === "untracked") {
            return [
                this.virtualUri(change.path, { kind: "empty" }),
                (await exists(workingPath))
                    ? vscode.Uri.file(workingPath)
                    : this.virtualUri(change.path, { kind: "empty" }),
            ];
        }

        const left =
            change.marker === "!"
                ? this.virtualUri(headPath, {
                      kind: "head",
                      repoPath,
                      relativePath: headPath,
                  })
                : this.virtualUri(headPath, {
                      kind: "index",
                      repoPath,
                      relativePath: headPath,
                  });
        const right =
            change.marker === "D" || !(await exists(workingPath))
                ? this.virtualUri(change.path, { kind: "empty" })
                : vscode.Uri.file(workingPath);
        return [left, right];
    }

    dispose(): void {
        this.disposed = true;
        this.sources.clear();
    }

    private virtualUri(relativePath: string, source: VirtualSource): vscode.Uri {
        this.nextToken += 1;
        const token = String(this.nextToken);
        this.sources.set(token, source);
        return vscode.Uri.from({
            scheme: SCM_DIFF_SCHEME,
            path: `/${path.basename(relativePath) || "change"}`,
            query: token,
        });
    }
}
