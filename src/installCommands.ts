// Install commands — three install/setup commands that all need to
// spawn a fresh terminal and run a shell command in it, plus the
// offline license-file install. Extracted from
// `globalCommandsPlugin.ts` as Plan 2 Stage B.
//
// Exposes a single `registerInstallCommands(ctx)` that wires all
// commands and returns when done; `globalCommandsPlugin`'s
// `activate()` calls it alongside its own chrome-command registration.

import * as fs from "node:fs";
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

type SkillRepositoryPickItem = vscode.QuickPickItem & {
    repo: string;
};

const DEFAULT_TOOLS: readonly InstallToolsSpec[] = [
    {
        label: "pm2",
        cmd: "go install github.com/bizshuk/pm2@master",
    },
    {
        label: "skills",
        cmd: "go install github.com/bizshuk/skills@master",
    },
] as const;

const SKILL_REPOSITORIES: readonly SkillRepositoryPickItem[] = [
    {
        label: "bizshuk/cc-plugin",
        description: "預設",
        repo: "bizshuk/cc-plugin",
    },
    {
        label: "anthropics/claude-plugins-official",
        repo: "anthropics/claude-plugins-official",
    },
    {
        label: "anthropics/skills",
        repo: "anthropics/skills",
    },
] as const;

const IGNORE_TARGETS: Record<string, string> = {
    git: ".gitignore",
    gemini: ".geminiignore",
    claude: ".claudeignore",
};

/**
 * Install pm2 + skills CLI binaries at HEAD. Each runs in its own
 * terminal so the user can see both install logs side-by-side and
 * `&& exit` closes the shell on success.
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
        "globalCommands: installDefaultTools dispatched (pm2 + skills @master, two terminals)"
    );
}

/**
 * Install a Claude Code skill from a GitHub repo via the `skills`
 * CLI. Interactive invocation shows a QuickPick whose first (default)
 * item is the user's cc-plugin fork, followed by the two Anthropic
 * repositories. A trusted programmatic caller can skip the picker via
 * the command's `args.repo` parameter (e.g. a future TreeView menu).
 */
async function skillInstall(
    ctx: PluginContext,
    args?: { repo?: string }
): Promise<void> {
    let repo = args?.repo?.trim();
    if (!repo) {
        const picked = await vscode.window.showQuickPick(
            SKILL_REPOSITORIES,
            {
                title: "Superset: Skill Install",
                placeHolder: "選擇要安裝的 skill repository",
                matchOnDescription: true,
            }
        );
        if (!picked) {
            ctx.log(
                "globalCommands: skillInstall cancelled by user (quickpick dismissed)"
            );
            return;
        }
        repo = picked.repo;
    }

    await spawnRunTerminal(
        `Superset: Skill Install (${repo})`,
        `skills add ${repo}`,
        { closeOnSuccess: true }
    );
    ctx.log(`globalCommands: skillInstall dispatched (${repo})`);
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

    // Safety: same pattern as installIgnoreTemplate — if the file
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
