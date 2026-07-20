# Git Hooks Install、Link 與狀態提醒實作計畫

> For agentic workers: REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Goal: 為目前 VS Code 視窗的第一個 opened folder 提供 Git hook 模板安裝、repository-local 連結，以及 `.githooks/` 存在但 `core.hooksPath` 無值時的左側 Status Bar 提醒。

Architecture: 保留既有 `gitPlugin` 作為 UI orchestration layer，在 `src/git/gitHooks.ts` 建立不依賴 `vscode` 的 filesystem 與 Git process helpers。所有 extension 靜態資源搬到 `pkg/resources/`，Git hook 模板置於 `pkg/resources/git/githooks/`；Install 採 copy-if-missing 並在成功後呼叫 Link，Status Bar 僅呼叫 Link。

Tech Stack: TypeScript 5、Node.js `fs/promises` / `child_process.execFile`、VS Code Extension API `^1.93.0`、Vitest 4、Bash、VSIX。

## Global Constraints

- opened folder 的唯一來源是 `vscode.workspace.workspaceFolders?.[0]`。
- Multi-root 視窗只處理第一個 folder；沒有 folder 時不使用 fallback。
- 僅支援本機 `file:` URI。
- 模板來源固定為 `pkg/resources/git/githooks/`；workspace 目標固定為 `.githooks/`。
- Install 只補缺少的檔案，絕不覆寫、合併或刪除既有內容。
- Install 全部複製成功後才 Link；複製失敗不 rollback 已新增檔案。
- Link 固定寫入 `git config --local core.hooksPath .githooks`，不建立 `.githooks/`。
- local `core.hooksPath` trim 後只要有任意非空值，就視為已連結。
- Status Bar 只在 activation、Install 完成與 Link 完成後更新；不監聽、不輪詢。
- Status Bar 點擊只執行 Link，不執行 Install。
- 整個根 `resources/` 搬至 `pkg/resources/`；Git hooks 額外按 domain 放在 `pkg/resources/git/githooks/`。
- 實作時將當下 package version 做 patch bump；目前工作樹為 `0.14.1`，若執行前未再變動則更新為 `0.14.2`。
- 保護使用者既有工作樹變更，尤其 `package.json`、`package-lock.json` 與 `pkg/sessiond/**`；每次編輯只改本計畫指定區塊。
- `.githooks/` 樣本目前已不在工作樹；以已批准 spec 與原樣本內容建立 `pkg/resources/git/githooks/scripts/sync-plugin-version.sh`。
- 本計畫所有 commit step 均停用；使用者明確要求 `no commit`。

---

## File Structure

- Create `src/git/gitHooks.ts`: copy-if-missing、Git repository/config helpers，以及可注入的 Git runner。
- Create `test/gitHooks.test.ts`: 純 filesystem 與 Git helper 測試。
- Create `test/gitHooksCommand.test.ts`: commands、第一個 opened folder、Status Bar 與錯誤通知 orchestration 測試。
- Modify `src/git/index.ts`: 註冊 Install/Link commands、建立 Status Bar、activation/command 後刷新狀態。
- Move `resources/config/**` → `pkg/resources/config/**`: default-project template。
- Move `resources/icon.png` 與 `resources/*.svg` → `pkg/resources/`: extension 與 TreeView icons。
- Create `pkg/resources/git/githooks/scripts/sync-plugin-version.sh`: Git hook template sample。
- Modify `src/installCommands.ts`: default-project template extension-relative path。
- Modify `src/todoEngine/labelRenderer.ts`: priority icon extension-relative path。
- Modify `package.json`: command contributions、所有 resource paths、patch version。
- Modify `package-lock.json`: root package version only，保留其他既有改動。
- Modify `test/installCommands.test.ts`: 新 config resource path assertion。
- Modify `test/todoTreeProvider.test.ts`: 新 icon resource path assertions。
- Modify `test/packageManifest.test.ts`: Git hooks commands 與新 manifest resource paths。
- Modify `scripts/verify-vsix.sh`: assert required `pkg/resources/` payload and reject legacy root resource paths。
- Modify `README.md`: feature overview、使用流程、command table、troubleshooting。
- Modify `CLAUDE.md`: `src/git/` responsibility、resource layout、spec index、Git hooks invariant。

---

### Task 1: Pure Git Hooks Filesystem and Git Helpers

Files:

- Create: `src/git/gitHooks.ts`
- Create: `test/gitHooks.test.ts`

Interfaces:

- Produces: `interface CopyMissingResult { readonly copied: number; readonly skipped: number }`
- Produces: `type GitRunner = (args: readonly string[], cwd: string) => Promise<string>`
- Produces: `copyMissingTree(sourceRoot: string, targetRoot: string): Promise<CopyMissingResult>`
- Produces: `isGitRepository(repoRoot: string, runGit?: GitRunner): Promise<boolean>`
- Produces: `readLocalHooksPath(repoRoot: string, runGit?: GitRunner): Promise<string | null>`
- Produces: `hasLocalHooksPath(repoRoot: string, runGit?: GitRunner): Promise<boolean>`
- Produces: `linkGitHooks(repoRoot: string, runGit?: GitRunner): Promise<void>`

- [ ] Step 1: Write failing copy-if-missing tests

Create `test/gitHooks.test.ts` with temporary directories and explicit file modes:

```ts
import { constants } from "node:fs";
import { access, chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    copyMissingTree,
    hasLocalHooksPath,
    isGitRepository,
    linkGitHooks,
    readLocalHooksPath,
    type GitRunner,
} from "../src/git/gitHooks";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "superset-githooks-"));
    roots.push(root);
    return root;
}

afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("copyMissingTree", () => {
    it("copies nested missing files and preserves executable mode", async () => {
        const root = await tempRoot();
        const source = path.join(root, "source");
        const target = path.join(root, "target");
        await mkdir(path.join(source, "scripts"), { recursive: true });
        const script = path.join(source, "scripts", "check.sh");
        await writeFile(script, "#!/bin/sh\necho ok\n");
        await chmod(script, 0o755);

        await expect(copyMissingTree(source, target)).resolves.toEqual({ copied: 1, skipped: 0 });
        expect(await readFile(path.join(target, "scripts", "check.sh"), "utf8"))
            .toBe("#!/bin/sh\necho ok\n");
        expect((await stat(path.join(target, "scripts", "check.sh"))).mode & 0o111)
            .toBe(0o111);
    });

    it("keeps existing files and fills only missing siblings", async () => {
        const root = await tempRoot();
        const source = path.join(root, "source");
        const target = path.join(root, "target");
        await mkdir(source, { recursive: true });
        await mkdir(target, { recursive: true });
        await writeFile(path.join(source, "existing"), "template");
        await writeFile(path.join(source, "missing"), "new");
        await writeFile(path.join(target, "existing"), "custom");

        await expect(copyMissingTree(source, target)).resolves.toEqual({ copied: 1, skipped: 1 });
        expect(await readFile(path.join(target, "existing"), "utf8")).toBe("custom");
        expect(await readFile(path.join(target, "missing"), "utf8")).toBe("new");
    });
});
```

- [ ] Step 2: Run the focused tests and verify the expected failure

Run:

```bash
npx vitest run test/gitHooks.test.ts
```

Expected: FAIL because `src/git/gitHooks.ts` does not exist.

- [ ] Step 3: Implement recursive copy-if-missing with mode preservation

Create `src/git/gitHooks.ts` with these filesystem primitives and result type:

```ts
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export interface CopyMissingResult {
    readonly copied: number;
    readonly skipped: number;
}

export type GitRunner = (
    args: readonly string[],
    cwd: string
) => Promise<string>;

const execFileAsync = promisify(execFile);

const defaultGitRunner: GitRunner = async (args, cwd) => {
    const { stdout } = await execFileAsync("git", [...args], { cwd, encoding: "utf8" });
    return stdout;
};

export async function copyMissingTree(
    sourceRoot: string,
    targetRoot: string
): Promise<CopyMissingResult> {
    const sourceInfo = await stat(sourceRoot);
    if (!sourceInfo.isDirectory()) {
        throw new Error(`Git hooks template is not a directory: ${sourceRoot}`);
    }

    let copied = 0;
    let skipped = 0;

    async function visit(sourceDir: string, targetDir: string): Promise<void> {
        await mkdir(targetDir, { recursive: true });
        const entries = await readdir(sourceDir, { withFileTypes: true });
        for (const entry of entries) {
            const sourcePath = path.join(sourceDir, entry.name);
            const targetPath = path.join(targetDir, entry.name);
            if (entry.isDirectory()) {
                await visit(sourcePath, targetPath);
                continue;
            }
            if (!entry.isFile()) continue;

            try {
                await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
                await chmod(targetPath, (await stat(sourcePath)).mode);
                copied += 1;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                    skipped += 1;
                    continue;
                }
                throw error;
            }
        }
    }

    await visit(sourceRoot, targetRoot);
    return { copied, skipped };
}
```

- [ ] Step 4: Run focused tests and verify copy behavior passes

Run: `npx vitest run test/gitHooks.test.ts`

Expected: the two `copyMissingTree` cases PASS.

- [ ] Step 5: Add failing Git repository and config tests

Append to `test/gitHooks.test.ts`:

```ts
function runnerResult(result: string): GitRunner {
    return vi.fn(async () => result);
}

describe("Git hooks config helpers", () => {
    it("recognizes only a successful inside-work-tree response", async () => {
        await expect(isGitRepository("/repo", runnerResult("true\n"))).resolves.toBe(true);
        await expect(isGitRepository("/repo", runnerResult("false\n"))).resolves.toBe(false);
        const failing = vi.fn(async () => { throw new Error("not a repository"); });
        await expect(isGitRepository("/repo", failing)).resolves.toBe(false);
    });

    it("returns null only for git-config exit code 1", async () => {
        const unset = vi.fn(async () => { throw Object.assign(new Error("unset"), { code: 1 }); });
        await expect(readLocalHooksPath("/repo", unset)).resolves.toBeNull();

        const broken = vi.fn(async () => { throw Object.assign(new Error("broken"), { code: 128 }); });
        await expect(readLocalHooksPath("/repo", broken)).rejects.toThrow("broken");
    });

    it.each([".githooks\n", "./custom-hooks\n", "/absolute/hooks\n"])(
        "treats any non-empty local hooks path as linked: %s",
        async value => {
            await expect(hasLocalHooksPath("/repo", runnerResult(value))).resolves.toBe(true);
        }
    );

    it.each(["", " \n"])("treats an empty local hooks path as unlinked", async value => {
        await expect(hasLocalHooksPath("/repo", runnerResult(value))).resolves.toBe(false);
    });

    it("writes the fixed repository-local hooks path", async () => {
        const runGit = runnerResult("");
        await linkGitHooks("/repo", runGit);
        expect(runGit).toHaveBeenCalledWith(
            ["config", "--local", "core.hooksPath", ".githooks"],
            "/repo"
        );
    });
});
```

- [ ] Step 6: Run focused tests and verify the expected export failures

Run: `npx vitest run test/gitHooks.test.ts`

Expected: FAIL because repository/config helpers are not exported yet.

- [ ] Step 7: Implement Git repository and local config helpers

Append to `src/git/gitHooks.ts`:

```ts
export async function isGitRepository(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<boolean> {
    try {
        return (await runGit(["rev-parse", "--is-inside-work-tree"], repoRoot)).trim() === "true";
    } catch {
        return false;
    }
}

export async function readLocalHooksPath(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<string | null> {
    try {
        return (await runGit(["config", "--local", "--get", "core.hooksPath"], repoRoot)).trim();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 1) return null;
        throw error;
    }
}

export async function hasLocalHooksPath(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<boolean> {
    const hooksPath = await readLocalHooksPath(repoRoot, runGit);
    return hooksPath !== null && hooksPath.trim().length > 0;
}

export async function linkGitHooks(
    repoRoot: string,
    runGit: GitRunner = defaultGitRunner
): Promise<void> {
    await runGit(["config", "--local", "core.hooksPath", ".githooks"], repoRoot);
}
```

- [ ] Step 8: Run focused tests and TypeScript compile

Run:

```bash
npx vitest run test/gitHooks.test.ts
npx tsc --noEmit
```

Expected: all `gitHooks` tests PASS and TypeScript reports no errors.

- [ ] Step 9: Review Task 1 diff without committing

Run:

```bash
git diff --check -- src/git/gitHooks.ts test/gitHooks.test.ts
git diff -- src/git/gitHooks.ts test/gitHooks.test.ts
```

Expected: no whitespace errors; only Task 1 files appear. Do not commit.

---

### Task 2: Resource Relocation and Git Hook Template

Files:

- Move: `resources/config/.ignore` → `pkg/resources/config/.ignore`
- Move: `resources/config/install-default-project.sh` → `pkg/resources/config/install-default-project.sh`
- Move: `resources/icon.png` → `pkg/resources/icon.png`
- Move: `resources/p0_dim.svg` → `pkg/resources/p0_dim.svg`
- Move: `resources/p0.svg` → `pkg/resources/p0.svg`
- Move: `resources/p1_dim.svg` → `pkg/resources/p1_dim.svg`
- Move: `resources/p1.svg` → `pkg/resources/p1.svg`
- Move: `resources/p2_dim.svg` → `pkg/resources/p2_dim.svg`
- Move: `resources/p2.svg` → `pkg/resources/p2.svg`
- Move: `resources/view_file.svg` → `pkg/resources/view_file.svg`
- Move: `resources/view_px.svg` → `pkg/resources/view_px.svg`
- Move: `resources/view_sec.svg` → `pkg/resources/view_sec.svg`
- Create: `pkg/resources/git/githooks/scripts/sync-plugin-version.sh`
- Modify: `src/installCommands.ts:121-135`
- Modify: `src/todoEngine/labelRenderer.ts` at its `resources` path builder
- Modify: `test/installCommands.test.ts` resource-path assertions
- Modify: `test/todoTreeProvider.test.ts` icon-path assertions

Interfaces:

- Consumes: extension root `ctx.extensionUri.fsPath` and existing `extensionUri` icon resolver.
- Produces: runtime paths under `pkg/resources/` and template root consumed by Task 3.

- [ ] Step 1: Add failing path expectations before moving files

Update `test/installCommands.test.ts` expected terminal command from:

```ts
"'bash' '/fake/resources/config/install-default-project.sh'"
```

to:

```ts
"'bash' '/fake/pkg/resources/config/install-default-project.sh'"
```

Update every `/extension/resources/<icon>` expectation in `test/todoTreeProvider.test.ts` to `/extension/pkg/resources/<icon>`.

- [ ] Step 2: Run focused tests and verify old paths fail

Run:

```bash
npx vitest run test/installCommands.test.ts test/todoTreeProvider.test.ts
```

Expected: FAIL because source still builds paths under root `resources/`.

- [ ] Step 3: Move the existing resources without rewriting their contents

Run:

```bash
mkdir -p pkg/resources/config pkg/resources/git/githooks/scripts
mv resources/config/.ignore pkg/resources/config/.ignore
mv resources/config/install-default-project.sh pkg/resources/config/install-default-project.sh
mv resources/icon.png resources/*.svg pkg/resources/
rmdir resources/config resources
```

Expected: root `resources/` no longer exists; all original assets exist under `pkg/resources/`.

- [ ] Step 4: Create the Git hook template from the previously supplied sample

Create `pkg/resources/git/githooks/scripts/sync-plugin-version.sh`:

```bash
#!/bin/bash
#
# 把 .claude-plugin/plugin.json 的 version 欄位對齊 git tag。
#
# 版本的單一事實來源是 git tag（Go module 語意）；plugin.json 需要明文字串是因為
# Claude Code 的 plugin loader 讀不懂 git tag，所以由本腳本在 release 時反向寫入。
#
# 用法：
#   scripts/sync-plugin-version.sh              # 對齊目前可達的最新 tag
#   scripts/sync-plugin-version.sh patch        # 寫入下一個 patch 版本（commit 前用）
#   scripts/sync-plugin-version.sh minor|major  # 同上，遞增對應欄位

set -euo pipefail

readonly PLUGIN_FILE=".claude-plugin/plugin.json"
readonly TAG_GLOB="v[0-9]*"

die() {
    echo "sync-plugin-version: $1" >&2
    exit 1
}

cd "$(git rev-parse --show-toplevel)" || die "不在 git repo 內"
[[ -f "$PLUGIN_FILE" ]] || die "找不到 ${PLUGIN_FILE}"

bump="${1:-none}"
case "$bump" in
none | patch | minor | major) ;;
*) die "未知參數 '${bump}'（可用：patch / minor / major，或不帶參數）" ;;
esac

tag="$(git describe --tags --abbrev=0 --match "$TAG_GLOB" 2>/dev/null || echo "v0.0.0")"
[[ "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "最新 tag 格式錯誤：${tag}"

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"

case "$bump" in
patch) patch=$((patch + 1)) ;;
minor)
    minor=$((minor + 1))
    patch=0
    ;;
major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
esac

version="${major}.${minor}.${patch}"
current="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_FILE" | head -1)"

if [[ "$current" == "$version" ]]; then
    echo "${PLUGIN_FILE} 已是 ${version}，無需變更"
    exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
sed "1,/\"version\"/s/\(\"version\"[[:space:]]*:[[:space:]]*\"\)[^\"]*\"/\1${version}\"/" \
    "$PLUGIN_FILE" >"$tmp"
cat "$tmp" >"$PLUGIN_FILE"

updated="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_FILE" | head -1)"
[[ "$updated" == "$version" ]] || die "寫入失敗，${PLUGIN_FILE} 仍是 ${updated}"

echo "${PLUGIN_FILE}: ${current:-（空）} → ${version}（基準 tag ${tag}）"
```

Restore executable mode:

```bash
chmod 755 pkg/resources/git/githooks/scripts/sync-plugin-version.sh
```

- [ ] Step 5: Update source runtime paths

In `src/installCommands.ts`, change the documentation and path segments to:

```ts
/**
 * Install the default project template (`pkg/resources/config/install-default-project.sh`)
 */
const scriptPath = path.join(
    ctx.extensionUri.fsPath,
    "pkg",
    "resources",
    "config",
    "install-default-project.sh"
);
```

In `src/todoEngine/labelRenderer.ts`, keep the existing URI construction pattern but insert `"pkg"` before `"resources"`, producing:

```ts
vscode.Uri.joinPath(extensionUri, "pkg", "resources", iconName)
```

Use the exact existing local variable and return shape; do not refactor unrelated label rendering.

- [ ] Step 6: Run focused tests and inspect file modes

Run:

```bash
npx vitest run test/installCommands.test.ts test/todoTreeProvider.test.ts
find pkg/resources -type f -maxdepth 6 -print | sort
test -x pkg/resources/git/githooks/scripts/sync-plugin-version.sh
```

Expected: both test files PASS, the complete resource tree is listed, and executable check exits 0.

- [ ] Step 7: Search for remaining runtime root-resource references

Run:

```bash
rg -n 'resources/' package.json src test scripts .vscodeignore README.md CLAUDE.md \
  --glob '!docs/specs/**' --glob '!plans/**'
```

Expected at this stage: remaining matches are manifest, VSIX verification, README/CLAUDE text, and tests intentionally deferred to later tasks; no source match except comments already updated.

- [ ] Step 8: Review Task 2 diff without committing

Run:

```bash
git diff --check -- pkg/resources src/installCommands.ts src/todoEngine/labelRenderer.ts test/installCommands.test.ts test/todoTreeProvider.test.ts
git status --short
```

Expected: resource moves plus focused path updates are visible; pre-existing `pkg/sessiond/**` and other user changes remain untouched. Do not commit.

---

### Task 3: Git Hooks Commands and Status Bar Orchestration

Files:

- Modify: `src/git/index.ts`
- Create: `test/gitHooksCommand.test.ts`

Interfaces:

- Consumes: `copyMissingTree`, `hasLocalHooksPath`, `isGitRepository`, `linkGitHooks` from Task 1.
- Produces: commands `superset.installGitHooks` and `superset.linkGitHooks`.
- Produces: left-aligned `StatusBarItem` whose `command` is `superset.linkGitHooks`.

- [ ] Step 1: Write the failing registration and opened-folder tests

Create `test/gitHooksCommand.test.ts` with a hoisted VS Code mock. The mock must expose:

```ts
const mocks = vi.hoisted(() => ({
    commands: new Map<string, (...args: unknown[]) => unknown>(),
    workspaceFolders: [] as Array<{ uri: { scheme: string; fsPath: string } }>,
    statusBar: {
        text: "",
        tooltip: "",
        command: "",
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
    },
    showInformationMessage: vi.fn(async (_message: string) => undefined),
    showErrorMessage: vi.fn(async (_message: string) => undefined),
}));
```

Mock `vscode.workspace.workspaceFolders`, `vscode.StatusBarAlignment.Left`, `window.createStatusBarItem`, command registration, and existing Git command dependencies used by `src/git/index.ts`. Mock `../src/git/gitHooks` exports with `vi.fn()` implementations. Then assert:

```ts
expect(mocks.commands.has("superset.installGitHooks")).toBe(true);
expect(mocks.commands.has("superset.linkGitHooks")).toBe(true);
expect(mocks.statusBar.command).toBe("superset.linkGitHooks");
expect(mocks.statusBar.text).toBe("$(link) Git hooks not linked");
```

Add a case with two folders and assert helper calls receive only `/first`, never `/second`.

- [ ] Step 2: Run focused command tests and verify failure

Run: `npx vitest run test/gitHooksCommand.test.ts`

Expected: FAIL because commands and Status Bar are not registered.

- [ ] Step 3: Add constants, opened-folder resolver, and Status Bar setup

In `src/git/index.ts`, import Node path/fs and Task 1 helpers:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import {
    copyMissingTree,
    hasLocalHooksPath,
    isGitRepository,
    linkGitHooks,
} from "./gitHooks";

const INSTALL_GIT_HOOKS_COMMAND = "superset.installGitHooks";
const LINK_GIT_HOOKS_COMMAND = "superset.linkGitHooks";

function firstOpenedFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
}
```

Inside `register(ctx)`, create and configure the item before registering commands:

```ts
const hookStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left
);
hookStatusBar.text = "$(link) Git hooks not linked";
hookStatusBar.tooltip =
    "This opened folder contains .githooks, but local core.hooksPath is not set.";
hookStatusBar.command = LINK_GIT_HOOKS_COMMAND;
hookStatusBar.hide();
ctx.subscriptions.push(hookStatusBar);
```

- [ ] Step 4: Implement folder validation and status refresh

Add these orchestration helpers to `src/git/index.ts`:

```ts
async function requireOpenedGitFolder(): Promise<vscode.WorkspaceFolder | null> {
    const folder = firstOpenedFolder();
    if (!folder) {
        await vscode.window.showErrorMessage("Superset: No opened folder in this VS Code window");
        return null;
    }
    if (folder.uri.scheme !== "file") {
        await vscode.window.showErrorMessage("Superset: Git hooks require a local opened folder");
        return null;
    }
    if (!(await isGitRepository(folder.uri.fsPath))) {
        await vscode.window.showErrorMessage("Superset: Opened folder is not a Git repository");
        return null;
    }
    return folder;
}

async function refreshGitHooksStatus(
    statusBar: vscode.StatusBarItem,
    ctx: FeatureContext
): Promise<void> {
    const folder = firstOpenedFolder();
    if (!folder || folder.uri.scheme !== "file") {
        statusBar.hide();
        return;
    }
    const root = folder.uri.fsPath;
    if (!fs.existsSync(path.join(root, ".githooks")) || !(await isGitRepository(root))) {
        statusBar.hide();
        return;
    }
    try {
        if (await hasLocalHooksPath(root)) statusBar.hide();
        else statusBar.show();
    } catch (error) {
        ctx.shared.log(`git: failed to inspect local core.hooksPath: ${error}`);
    }
}
```

On read failure, leave previous visibility unchanged; this avoids falsely declaring either linked or unlinked.

- [ ] Step 5: Implement Link and Install handlers

Add handlers to `src/git/index.ts`:

```ts
async function linkOpenedFolderGitHooks(
    statusBar: vscode.StatusBarItem,
    ctx: FeatureContext
): Promise<void> {
    const folder = await requireOpenedGitFolder();
    if (!folder) return;
    try {
        await linkGitHooks(folder.uri.fsPath);
        await refreshGitHooksStatus(statusBar, ctx);
        await vscode.window.showInformationMessage(
            "Superset: Linked Git hooks with local core.hooksPath=.githooks"
        );
    } catch (error) {
        ctx.shared.log(`git: link hooks failed: ${error}`);
        await vscode.window.showErrorMessage(`Superset: Failed to link Git hooks: ${error}`);
    }
}

async function installOpenedFolderGitHooks(
    statusBar: vscode.StatusBarItem,
    ctx: FeatureContext
): Promise<void> {
    const folder = await requireOpenedGitFolder();
    if (!folder) return;
    const templateRoot = path.join(
        ctx.context.extensionUri.fsPath,
        "pkg",
        "resources",
        "git",
        "githooks"
    );
    const targetRoot = path.join(folder.uri.fsPath, ".githooks");
    try {
        const result = await copyMissingTree(templateRoot, targetRoot);
        await linkGitHooks(folder.uri.fsPath);
        await refreshGitHooksStatus(statusBar, ctx);
        await vscode.window.showInformationMessage(
            `Superset: Git hooks installed (${result.copied} added, ${result.skipped} kept) and linked`
        );
    } catch (error) {
        ctx.shared.log(`git: install hooks failed: ${error}`);
        await vscode.window.showErrorMessage(`Superset: Failed to install Git hooks: ${error}`);
    }
}
```

Use `ctx.context.extensionUri` because `FeatureContext` exposes the VS Code `ExtensionContext` there; do not derive extension resources from process CWD.

- [ ] Step 6: Register commands and trigger activation refresh

Extend the existing `ctx.subscriptions.push(...)` command list:

```ts
vscode.commands.registerCommand(INSTALL_GIT_HOOKS_COMMAND, () =>
    installOpenedFolderGitHooks(hookStatusBar, ctx)
),
vscode.commands.registerCommand(LINK_GIT_HOOKS_COMMAND, () =>
    linkOpenedFolderGitHooks(hookStatusBar, ctx)
)
```

After registration, trigger the non-blocking activation check:

```ts
void refreshGitHooksStatus(hookStatusBar, ctx);
```

Keep reset and Copy GitHub URL registrations unchanged.

- [ ] Step 7: Add Status Bar matrix and command-boundary tests

In `test/gitHooksCommand.test.ts`, add these concrete cases after importing mocked helpers as `gitHooks`:

```ts
it("shows only when .githooks exists and local hooksPath is empty", async () => {
    mocks.workspaceFolders.splice(0, mocks.workspaceFolders.length, {
        uri: { scheme: "file", fsPath: "/first" },
    });
    vi.mocked(gitHooks.isGitRepository).mockResolvedValue(true);
    vi.mocked(gitHooks.hasLocalHooksPath).mockResolvedValue(false);
    existsSync.mockImplementation(value => String(value) === "/first/.githooks");

    register(featureContext());
    await vi.waitFor(() => expect(mocks.statusBar.show).toHaveBeenCalled());
});

it("hides for any non-empty local hooksPath", async () => {
    mocks.workspaceFolders.splice(0, mocks.workspaceFolders.length, {
        uri: { scheme: "file", fsPath: "/first" },
    });
    vi.mocked(gitHooks.isGitRepository).mockResolvedValue(true);
    vi.mocked(gitHooks.hasLocalHooksPath).mockResolvedValue(true);
    existsSync.mockReturnValue(true);

    register(featureContext());
    await vi.waitFor(() => expect(mocks.statusBar.hide).toHaveBeenCalled());
    expect(mocks.statusBar.show).not.toHaveBeenCalled();
});

it("links from the link command without installing", async () => {
    register(featureContext());
    await mocks.commands.get("superset.linkGitHooks")!();
    expect(gitHooks.linkGitHooks).toHaveBeenCalledWith("/first");
    expect(gitHooks.copyMissingTree).not.toHaveBeenCalled();
});

it("installs missing templates before linking", async () => {
    vi.mocked(gitHooks.copyMissingTree).mockResolvedValue({ copied: 1, skipped: 2 });
    register(featureContext());
    await mocks.commands.get("superset.installGitHooks")!();
    expect(gitHooks.copyMissingTree).toHaveBeenCalledWith(
        "/extension/pkg/resources/git/githooks",
        "/first/.githooks"
    );
    expect(gitHooks.linkGitHooks).toHaveBeenCalledWith("/first");
    expect(vi.mocked(gitHooks.copyMissingTree).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(gitHooks.linkGitHooks).mock.invocationCallOrder[0]);
});

it("does not link after a copy failure", async () => {
    vi.mocked(gitHooks.copyMissingTree).mockRejectedValue(new Error("copy failed"));
    register(featureContext());
    await mocks.commands.get("superset.installGitHooks")!();
    expect(gitHooks.linkGitHooks).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("copy failed")
    );
});
```

Add equivalent hide assertions for no folder, non-`file:` folder, missing `.githooks`, and non-Git repository. In `beforeEach`, reset every mock, set `/first` as the first folder, and resolve `isGitRepository=true` so each case controls only its stated condition.

- [ ] Step 8: Run command, existing Git, and compile checks

Run:

```bash
npx vitest run test/gitHooksCommand.test.ts test/gitCopyGithubUrlCommand.test.ts test/gitPlugin.test.ts test/gitReset.test.ts
npx tsc --noEmit
```

Expected: all focused Git tests PASS and TypeScript reports no errors. If existing Git mocks lack `workspace`, `StatusBarAlignment`, `createStatusBarItem`, or `context.extensionUri`, minimally extend those mocks; do not weaken existing assertions.

- [ ] Step 9: Review Task 3 diff without committing

Run:

```bash
git diff --check -- src/git/index.ts test/gitHooksCommand.test.ts test/gitCopyGithubUrlCommand.test.ts test/gitPlugin.test.ts
git diff -- src/git/index.ts test/gitHooksCommand.test.ts
```

Expected: no whitespace errors and no unrelated Git reset/GitHub URL behavior changes. Do not commit.

---

### Task 4: Manifest, Package Version, and Resource Contract

Files:

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/packageManifest.test.ts`

Interfaces:

- Consumes: commands registered in Task 3 and assets moved in Task 2.
- Produces: public Command Palette entries and all manifest asset references under `pkg/resources/`.

- [ ] Step 1: Add failing manifest assertions

Extend `SupersetManifest` in `test/packageManifest.test.ts` with root `icon?: string`. Add:

```ts
describe("Git hooks manifest contributions", () => {
    it("publishes separate install and link commands", () => {
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.installGitHooks",
            title: "Superset: Install Git Hooks",
        });
        expect(manifest.contributes.commands).toContainEqual({
            command: "superset.linkGitHooks",
            title: "Superset: Link Git Hooks",
        });
    });

    it("uses only pkg/resources manifest assets", () => {
        expect(manifest.icon).toBe("pkg/resources/icon.png");
        for (const command of manifest.contributes.commands) {
            if (command.icon && !command.icon.startsWith("$(")) {
                expect(command.icon).toMatch(/^pkg\/resources\//);
            }
        }
    });
});
```

- [ ] Step 2: Run manifest tests and verify failure

Run: `npx vitest run test/packageManifest.test.ts`

Expected: FAIL because commands are absent and asset paths still start with `resources/`.

- [ ] Step 3: Update `package.json` command and asset contributions

Add adjacent to existing Git commands:

```json
{
    "command": "superset.installGitHooks",
    "title": "Superset: Install Git Hooks"
},
{
    "command": "superset.linkGitHooks",
    "title": "Superset: Link Git Hooks"
}
```

Replace every manifest path `resources/...` with `pkg/resources/...`, including root icon, TODO view icons, filter icons, and walkthrough icon. Do not add menus: commands automatically appear in Command Palette, while the Status Bar command is assigned at runtime.

- [ ] Step 4: Apply the semantic patch bump while preserving concurrent changes

First inspect only current root versions:

```bash
node -e 'const p=require("./package.json"), l=require("./package-lock.json"); console.log(p.version, l.version, l.packages[""].version)'
```

If all are still `0.14.1`, update exactly these three values to `0.14.2`. If another actor has raised them, compute the next patch from that new value and update the same three fields only. Do not regenerate the lockfile and do not alter dependency entries.

- [ ] Step 5: Run manifest and JSON consistency checks

Run:

```bash
npx vitest run test/packageManifest.test.ts
node -e 'const p=require("./package.json"), l=require("./package-lock.json"); if (p.version!==l.version || p.version!==l.packages[""].version) process.exit(1); console.log(p.version)'
rg -n '"resources/' package.json
```

Expected: tests PASS, three root versions match, and `rg` returns no matches.

- [ ] Step 6: Review only intended package changes without committing

Run:

```bash
git diff --check -- package.json package-lock.json test/packageManifest.test.ts
git diff -- package.json package-lock.json test/packageManifest.test.ts
```

Expected: preserve all pre-existing package edits; only commands, resource paths, root versions, and tests are newly added. Do not commit.

---

### Task 5: VSIX Resource Verification

Files:

- Modify: `scripts/verify-vsix.sh`
- Test indirectly: generated `superset-<version>.vsix`

Interfaces:

- Consumes: packaged assets under `pkg/resources/`.
- Produces: build failure when required Git hook/config/icon assets are missing or a legacy `extension/resources/` path is present.

- [ ] Step 1: Add required resource checks to `scripts/verify-vsix.sh`

After the existing `extension/package.json` assertion, add:

```bash
required_resources=(
    "extension/pkg/resources/icon.png"
    "extension/pkg/resources/config/.ignore"
    "extension/pkg/resources/config/install-default-project.sh"
    "extension/pkg/resources/git/githooks/scripts/sync-plugin-version.sh"
)

for required in "${required_resources[@]}"; do
    if ! grep -qF "$required" "$VSIX_LISTING"; then
        echo "✗ Required resource $required missing in $VSIX" >&2
        exit 1
    fi
done

if grep -qE "extension/resources/" "$VSIX_LISTING"; then
    echo "✗ Legacy extension/resources/ path leaked into $VSIX" >&2
    exit 1
fi
```

Update the script header comments to describe this fourth check.

- [ ] Step 2: Package once and run the verifier directly

Run:

```bash
npm run clean
npx tsc
npx @vscode/vsce package
bash scripts/verify-vsix.sh
```

Expected: verifier reports success and all four required resources exist. This step may expose `.vscodeignore` exclusions; if so, adjust only rules that exclude `pkg/resources/**`, then rerun the same commands.

- [ ] Step 3: Inspect the generated archive paths

Run:

```bash
unzip -l superset-*.vsix | rg 'extension/(pkg/resources|resources)/'
```

Expected: all matches begin with `extension/pkg/resources/`; no `extension/resources/` match.

- [ ] Step 4: Review verifier diff without committing

Run:

```bash
git diff --check -- scripts/verify-vsix.sh .vscodeignore
git diff -- scripts/verify-vsix.sh .vscodeignore
```

Expected: deterministic resource assertions only. Do not commit.

---

### Task 6: User and Maintainer Documentation

Files:

- Modify: `README.md`
- Modify: `CLAUDE.md`
- Reference: `docs/specs/2026-07-20-git-hooks-install-link.md`

Interfaces:

- Consumes: final command names and runtime behavior.
- Produces: user workflow, troubleshooting, architecture map, invariant, and spec index.

- [ ] Step 1: Update README feature overview and usage section

Add a feature overview row:

```md
| Git Hooks 管理 | 從內建模板補齊 `.githooks/`、設定 local `core.hooksPath`，並在未連結時顯示 Status Bar | 使用 repository-local hooks 的開發者 |
```

After the Explorer GitHub URL section, add:

```md
### 10. Git Hooks 安裝與連結

`Superset: Install Git Hooks` 只在手動執行時，從 extension 內建模板補齊目前 VS Code 視窗第一個 opened folder 的 `.githooks/`。既有同名檔案不會被覆蓋；補齊成功後會設定 repository-local `core.hooksPath=.githooks`。

只需要重新設定 Git config 時，執行 `Superset: Link Git Hooks`。若 opened folder 已有 `.githooks/`，但 local `core.hooksPath` 沒有值，左側 Status Bar 會顯示 `Git hooks not linked`；點擊只執行 Link，不安裝模板。

Multi-root 視窗只處理第一個 folder。任何非空 local `core.hooksPath` 都視為已連結，Superset 不驗證它是否指向 `.githooks/`。
```

Add both commands to the command table with the separate Install/Link descriptions.

- [ ] Step 2: Add README troubleshooting entries

Add concise rows:

```md
| `Git hooks not linked` 一直顯示 | local `core.hooksPath` 未設定或 Link 失敗 | 點 Status Bar 或執行 `Superset: Link Git Hooks`；再用 `git config --local --get core.hooksPath` 檢查 |
| Install 沒處理預期的 folder | Multi-root 視窗只處理第一個 opened folder | 將目標 folder 移到第一位，或在單一 folder 視窗執行 |
```

- [ ] Step 3: Update CLAUDE maintainer context

Change the architecture row to:

```md
| `src/git/` | SCM reset、Explorer GitHub URL、Git hooks Install/Link 與 Status Bar | `gitPlugin` |
```

Add the invariant:

```md
- Git hooks 只處理 `workspaceFolders[0]`；模板來源為 `pkg/resources/git/githooks/`。Install 採 copy-if-missing 後 Link，Status Bar 只做 Link；local `core.hooksPath` 只要非空即視為已連結。
```

Add to the spec index:

```md
- Git Hooks Install / Link：[`docs/specs/2026-07-20-git-hooks-install-link.md`](docs/specs/2026-07-20-git-hooks-install-link.md)
```

Also mention that packaged extension assets live under `pkg/resources/`, with Git-domain templates under `pkg/resources/git/`.

- [ ] Step 4: Check documentation style and links

Run:

```bash
rg -n '\*\*' README.md CLAUDE.md docs/specs/2026-07-20-git-hooks-install-link.md
for f in docs/specs/2026-07-20-git-hooks-install-link.md; do test -f "$f"; done
git diff --check -- README.md CLAUDE.md docs/specs/2026-07-20-git-hooks-install-link.md
```

Expected: no newly introduced bold syntax, linked spec exists, and no whitespace errors. Existing bold matches, if any, must not be expanded or rewritten outside this feature.

- [ ] Step 5: Review documentation diff without committing

Run:

```bash
git diff -- README.md CLAUDE.md docs/specs/2026-07-20-git-hooks-install-link.md
```

Expected: only Git hooks/resource structure documentation changes. Do not commit.

---

### Task 7: Full Regression, Build, and Manual Smoke Verification

Files:

- Verify all files from Tasks 1–6.
- Do not modify `pkg/sessiond/**`, `plans/serialized-wishing-sketch.md`, or unrelated user files.

Interfaces:

- Consumes: complete feature implementation.
- Produces: green unit suite, TypeScript compile, valid VSIX, and recorded manual behavior checks.

- [ ] Step 1: Run the complete unit suite

Run:

```bash
npm test
```

Expected: all Vitest files PASS. If an existing mock fails because Git activation now creates a Status Bar, extend only that mock with the minimal `workspace.workspaceFolders`, `StatusBarAlignment.Left`, and `window.createStatusBarItem` surface; preserve its existing assertions.

- [ ] Step 2: Run the mandatory full build

Run:

```bash
npm run build
```

Expected: clean, install, TypeScript compile, VSIX package, and `scripts/verify-vsix.sh` all succeed. The build may update `package-lock.json`; inspect and retain only changes required by the already chosen root package version or dependency resolution already present before this task.

- [ ] Step 3: Verify no legacy resource references remain in active code/config

Run:

```bash
rg -n '(^|["`(])resources/' package.json src test scripts .vscodeignore README.md CLAUDE.md \
  --glob '!docs/specs/**' --glob '!plans/**'
test ! -d resources
```

Expected: no active root `resources/` path remains and root directory is absent. Historical specs are intentionally not rewritten.

- [ ] Step 4: Perform a disposable-repository manual smoke test in Extension Development Host

Use `F5` with the project's normal extension launch. In the new VS Code window:

```text
1. Open a disposable local Git folder as the only opened folder.
2. Confirm no `.githooks/` exists; Status Bar must be hidden.
3. Run `Superset: Install Git Hooks` from Command Palette.
4. Confirm `.githooks/scripts/sync-plugin-version.sh` exists and is executable.
5. Run `git config --local --get core.hooksPath`; output must be `.githooks`.
6. Confirm Status Bar is hidden.
7. Run `git config --local --unset core.hooksPath`, then reload the Extension Development Host window.
8. Confirm `$(link) Git hooks not linked` appears on the left.
9. Click the item; confirm config becomes `.githooks` and the item hides.
10. Edit the installed script, rerun Install, and confirm custom content remains unchanged.
```

Expected: Install/Link boundary, copy-if-missing, activation-only refresh, and Status Bar behavior match the spec.

- [ ] Step 5: Audit final working tree and protect unrelated changes

Run:

```bash
git status --short
git diff --check
git diff --stat
git diff -- package.json package-lock.json pkg/sessiond/README.md pkg/sessiond/cmd/root.go pkg/sessiond/pkg/install/install.go pkg/sessiond/pkg/install/install_test.go
```

Expected:

- Feature files and approved spec are present.
- Existing `pkg/sessiond/**`, `plans/serialized-wishing-sketch.md`, and `scripts/seed-sessions.sh` work is not overwritten.
- `package.json`/`package-lock.json` preserve pre-existing edits in addition to this feature's targeted version/manifest changes.
- No whitespace errors.

- [ ] Step 6: Report verified outcomes without committing

Report:

```text
- npm test: pass/fail with exact failing test names if any
- npm run build: pass/fail and generated VSIX filename
- VSIX required resources: present/missing
- Manual smoke: completed/skipped with reason
- Package version: before → after
- Unrelated working-tree changes: preserved
- Commit: intentionally not created
```

Do not run `git add`, `git commit`, `git reset`, `git clean`, or delete unrelated untracked files.
