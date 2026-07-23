// Install commands — install/setup commands that need to
// spawn a fresh terminal and run a shell command in it, plus the
// offline license-file install. Extracted from
// `globalCommandsPlugin.ts` as Plan 2 Stage B.
//
// Exposes a single `registerInstallCommands(ctx)` that wires all
// commands and returns when done; `globalCommandsPlugin`'s
// `activate()` calls it alongside its own chrome-command registration.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { PluginContext } from "./plugin";
import { getTerminalSpawner } from "./crossModuleState";
import { quoteShellArg, spawnRunTerminal } from "./spawnRunTerminal";
import {
    LICENSE_TEMPLATES,
    findLicenseTemplate,
    type LicenseId,
} from "./licenseTemplates";

const LICENSE_FILE_NAME = "LICENSE";

/** QuickPick row shape — `license` carries the chosen template back to the handler. */
type LicensePickItem = vscode.QuickPickItem & {
    license: (typeof LICENSE_TEMPLATES)[number];
};

interface InstallToolsSpec {
    label: string;
    cmd: string;
}

type CuratedSkillRepositoryPickItem = vscode.QuickPickItem & {
    repo: string;
};

type CustomSkillRepositoryPickItem = vscode.QuickPickItem & {
    custom: true;
};

type SkillRepositoryPickItem =
    | CuratedSkillRepositoryPickItem
    | CustomSkillRepositoryPickItem;

const DEFAULT_TOOLS: readonly InstallToolsSpec[] = [
    {
        label: "pm2",
        cmd: "go install github.com/bizshuk/pm2@master",
    },
    {
        label: "skills",
        cmd: "go install github.com/bizshuk/skills@master",
    },
    {
        label: "dux",
        cmd: "go install github.com/bizshuk/dux@master",
    },
    {
        label: "port",
        cmd: "go install github.com/bizshuk/port@master",
    },
    {
        label: "sessiond",
        cmd: "go install github.com/bizshuk/sessiond@master",
    },
] as const;

const SKILL_REPOSITORIES: readonly CuratedSkillRepositoryPickItem[] = [
    {
        label: "bizshuk/cc-plugin",
        description:
            "預設 · AI 編碼代理的全域設定、Skills、Agents 與記憶工具",
        detail: "GitHub · bizshuk/cc-plugin",
        repo: "bizshuk/cc-plugin",
    },
    {
        label: "anthropics/claude-plugins-official",
        description:
            "Anthropic 維護的 Claude Code 高品質 Plugin 目錄",
        detail: "GitHub · anthropics/claude-plugins-official",
        repo: "anthropics/claude-plugins-official",
    },
    {
        label: "anthropics/skills",
        description:
            "Anthropic 的 Agent Skills 範例、規格與文件處理技能",
        detail: "GitHub · anthropics/skills",
        repo: "anthropics/skills",
    },
    {
        label: "awesome-claude-code-subagents",
        description:
            "涵蓋多種開發任務的 Claude Code 專用 Subagents 合集",
        detail: "GitHub · VoltAgent/awesome-claude-code-subagents",
        repo: "VoltAgent/awesome-claude-code-subagents",
    },
    {
        label: "superpowers",
        description:
            "以 Skills 驅動規劃、TDD、除錯與協作的開發方法",
        detail: "GitHub · obra/superpowers",
        repo: "obra/superpowers",
    },
    {
        label: "understand-anything",
        description:
            "把程式碼與文件轉成可搜尋、可提問的互動知識圖譜",
        detail: "GitHub · Egonex-AI/Understand-Anything",
        repo: "Egonex-AI/Understand-Anything",
    },
    {
        label: "last30days",
        description:
            "彙整近 30 天社群與網路討論，產出有來源的研究摘要",
        detail: "GitHub · mvanhorn/last30days-skill",
        repo: "mvanhorn/last30days-skill",
    },
    {
        label: "ui-ux-pro-max-skill",
        description:
            "為多平台 UI/UX 產生設計系統、樣式與實作建議",
        detail: "GitHub · nextlevelbuilder/ui-ux-pro-max-skill",
        repo: "nextlevelbuilder/ui-ux-pro-max-skill",
    },
] as const;

const CUSTOM_SKILL_REPOSITORY: CustomSkillRepositoryPickItem = {
    label: "$(edit) 自訂 repository…",
    description: "輸入未列出的 GitHub repository",
    detail: "例如：owner/repository",
    alwaysShow: true,
    custom: true,
};

const IGNORE_TARGETS: Record<string, string> = {
    git: ".gitignore",
    gemini: ".geminiignore",
    claude: ".claudeignore",
};

/**
 * Install the default Go CLI binaries at HEAD. Each runs in its own
 * terminal so the user can see install logs side-by-side and `&& exit`
 * closes the shell on success.
 */
async function installDefaultTools(ctx: PluginContext): Promise<void> {
    if (!getTerminalSpawner()) {
        vscode.window.showErrorMessage(
            "Superset: Terminals 模組尚未啟用,請稍候再試"
        );
        return;
    }
    for (const tool of DEFAULT_TOOLS) {
        // `spawnRunTerminal` adds its own `(<HH:MM:SS>)` timestamp
        // suffix; we keep the base name clean so the final terminal
        // name doesn't carry a duplicate. The helper appends
        // `&& exit` so the shell self-closes on success.
        await spawnRunTerminal(
            `Superset: Install ${tool.label}`,
            tool.cmd,
            { closeOnSuccess: true }
        );
    }
    ctx.log(
        `globalCommands: installDefaultTools dispatched (${DEFAULT_TOOLS.map(
            (tool) => tool.label
        ).join(", ")} @master, ${DEFAULT_TOOLS.length} terminals)`
    );
}

/**
 * Install a Claude Code skill from a GitHub repo via the `skills`
 * CLI. Interactive invocation shows a QuickPick whose first (default)
 * item is the user's cc-plugin fork, followed by the curated repository
 * catalog and a custom-input action. A trusted programmatic caller can
 * skip the picker via the command's `args.repo` parameter (e.g. a future
 * TreeView menu).
 */
async function skillInstall(
    ctx: PluginContext,
    args?: { repo?: string }
): Promise<void> {
    let repo = args?.repo?.trim();
    if (!repo) {
        const pickItems: readonly SkillRepositoryPickItem[] = [
            ...SKILL_REPOSITORIES,
            CUSTOM_SKILL_REPOSITORY,
        ];
        const picked = await vscode.window.showQuickPick(
            pickItems,
            {
                title: "Superset: Install Skills",
                placeHolder: "選擇或自訂要安裝的 skill repository",
                matchOnDescription: true,
                matchOnDetail: true,
            }
        );
        if (!picked) {
            ctx.log(
                "globalCommands: skillInstall cancelled by user (quickpick dismissed)"
            );
            return;
        }
        if ("custom" in picked) {
            const input = await vscode.window.showInputBox({
                title: "Superset: Install Skills",
                prompt: "輸入要傳給 skills add 的 GitHub repository",
                placeHolder: "owner/repository",
                ignoreFocusOut: true,
                validateInput: (value) =>
                    value.trim()
                        ? undefined
                        : "請輸入 GitHub repository",
            });
            repo = input?.trim();
            if (!repo) {
                ctx.log(
                    "globalCommands: skillInstall cancelled by user (custom repository input dismissed)"
                );
                return;
            }
        } else {
            repo = picked.repo;
        }
    }

    await spawnRunTerminal(
        `Superset: Install Skills (${repo})`,
        `skills add ${quoteShellArg(repo)}`,
        { closeOnSuccess: true }
    );
    ctx.log(`globalCommands: skillInstall dispatched (${repo})`);
}

/**
 * Create the conventional `~/projects` root and clone the standard BizShuk
 * project repositories into it. The bundled script is intentionally
 * idempotent: missing repositories are cloned with all submodules, while
 * existing Git repositories only have their recursive submodules initialized.
 */
async function projectsSetup(ctx: PluginContext): Promise<void> {
    const scriptPath = path.join(
        ctx.extensionUri.fsPath,
        "pkg",
        "resources",
        "config",
        "setup-projects.sh"
    );
    const homeDir = os.homedir();
    const projectsRoot = path.join(homeDir, "projects");

    await spawnRunTerminal(
        "Superset: Projects Setup",
        ["bash", scriptPath, projectsRoot].map(quoteShellArg).join(" "),
        { closeOnSuccess: true, cwd: homeDir }
    );
    ctx.log(
        `globalCommands: projectsSetup dispatched (root=${projectsRoot})`
    );
}

/**
 * Install the default project template (`pkg/resources/config/install-default-project.sh`)
 * into the workspace, initializing directories, standard ignore files, and the AGENTS.md
 * symbolic link.
 */
async function installDefaultProject(
    ctx: PluginContext,
    args?: { targets?: string[]; force?: boolean }
): Promise<void> {
    const scriptPath = path.join(
        ctx.extensionUri.fsPath,
        "pkg",
        "resources",
        "config",
        "install-default-project.sh"
    );

    // Decide which targets to act on. When the user invokes from the
    // command palette (no args), default to all three.
    const requested = args?.targets ?? ["git", "gemini", "claude"];

    // Safety: if any requested target file already exists, ask the
    // user before overwriting. Hand-rolled .gitignore in this repo
    // is exactly the case the user might want to *keep* if they
    // customised it — don't silently clobber.
    let force = args?.force ?? false;
    if (!force) {
        const existing = requested
            .map((t) => IGNORE_TARGETS[t])
            .filter((n) =>
                fs.existsSync(path.join(ctx.workspaceFolder, n))
            );

        if (existing.length > 0) {
            const choice = await vscode.window.showWarningMessage(
                `Superset: 以下檔案已存在,將被模板覆蓋:\n  ${existing.join(
                    ", "
                )}\n\n繼續?`,
                { modal: true },
                "Overwrite",
                "Cancel"
            );
            if (choice !== "Overwrite") {
                ctx.log(
                    "globalCommands: installDefaultProject cancelled by user"
                );
                return;
            }
            force = true;
        }
    }

    const argv = ["bash", scriptPath];
    for (const t of requested) argv.push(t);
    if (force) argv.push("--force");

    await spawnRunTerminal(
        "Superset: Install Default Project",
        argv.map(quoteShellArg).join(" "),
        { closeOnSuccess: true, cwd: ctx.workspaceFolder }
    );
    ctx.log(
        `globalCommands: installDefaultProject ${argv.join(" ")}`
    );
}

/**
 * Install a license file (`LICENSE`) into the workspace root from an
 * embedded template. Shows a QuickPick with Apache-2.0 / MIT / BSD-3,
 * asks for confirmation if `LICENSE` already exists, then writes the
 * chosen template verbatim. Year placeholder is filled at write-time
 * with `new Date().getFullYear()`; copyright-holder span stays as
 * `[name of copyright owner]` for the user to replace.
 *
 * `args.licenseId` (optional) skips the QuickPick for programmatic
 * invocation (e.g. wired from a future TreeView menu). `args.force`
 * suppresses the overwrite-confirmation modal — caller is then
 * responsible for the user-facing safety guarantee.
 */
async function installLicense(
    ctx: PluginContext,
    args?: { licenseId?: LicenseId; force?: boolean }
): Promise<void> {
    const targetPath = path.join(ctx.workspaceFolder, LICENSE_FILE_NAME);

    // Pick the template. Programmatic callers can short-circuit the
    // QuickPick via args.licenseId; the rest of the flow is shared.
    let licenseId: LicenseId | undefined = args?.licenseId;
    if (!licenseId) {
        const pickItems: LicensePickItem[] = LICENSE_TEMPLATES.map(
            (license) => ({
                label: license.label,
                description: license.description,
                // Multi-line preview of permissions / conditions /
                // limitations. VS Code renders `detail` as a gray
                // sub-panel below the focused row, so the user can
                // arrow through the three options and compare without
                // opening the full text.
                detail: license.summary,
                license,
            })
        );
        const picked = await vscode.window.showQuickPick(pickItems, {
            title: "Superset: Install License",
            placeHolder: "選擇要安裝的 license",
            matchOnDescription: true,
        });
        if (!picked) {
            ctx.log(
                "globalCommands: installLicense cancelled by user (quickpick dismissed)"
            );
            return;
        }
        licenseId = picked.license.id;
    }

    const template = findLicenseTemplate(licenseId);

    // Safety: same pattern as installDefaultProject — if the file
    // already exists, ask before overwriting. A hand-rolled LICENSE
    // is exactly the kind of file the user might want to *keep* if
    // they customised it. `args.force` skips the gate for tests
    // and trusted programmatic callers.
    if (!args?.force && fs.existsSync(targetPath)) {
        const choice = await vscode.window.showWarningMessage(
            `Superset: ${LICENSE_FILE_NAME} 已存在於 workspace 根目錄,將被 ${template.label} 覆蓋。\n\n繼續?`,
            { modal: true },
            "Overwrite",
            "Cancel"
        );
        if (choice !== "Overwrite") {
            ctx.log(
                `globalCommands: installLicense cancelled by user (overwrite declined for ${licenseId})`
            );
            return;
        }
    }

    await fs.promises.writeFile(
        targetPath,
        template.build(new Date().getFullYear()),
        "utf8"
    );

    vscode.window.showInformationMessage(
        `Superset: 已安裝 ${template.label} 至 ${targetPath}`
    );
    ctx.log(
        `globalCommands: installLicense wrote ${licenseId} to ${targetPath}`
    );
}

/**
 * Register all install commands against the given `PluginContext`.
 * Each is registered via `ctx.registerDisposable` so the manager
 * owns disposal. Idempotent — call once from
 * `globalCommandsPlugin.activate()`.
 */
export function registerInstallCommands(ctx: PluginContext): void {
    ctx.registerDisposable(
        vscode.commands.registerCommand(
            "superset.installDefaultTools",
            () => installDefaultTools(ctx)
        )
    );
    ctx.registerDisposable(
        vscode.commands.registerCommand(
            "superset.skillInstall",
            (args?: { repo?: string }) => skillInstall(ctx, args)
        )
    );
    ctx.registerDisposable(
        vscode.commands.registerCommand("superset.projectsSetup", () =>
            projectsSetup(ctx)
        )
    );
    ctx.registerDisposable(
        vscode.commands.registerCommand(
            "superset.installDefaultProject",
            (args?: { targets?: string[]; force?: boolean }) =>
                installDefaultProject(ctx, args)
        )
    );
    ctx.registerDisposable(
        vscode.commands.registerCommand(
            "superset.installLicense",
            (args?: { licenseId?: LicenseId; force?: boolean }) =>
                installLicense(ctx, args)
        )
    );
}
