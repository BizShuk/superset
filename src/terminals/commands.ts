import * as vscode from "vscode";
import { TerminalRegistry } from "./terminalRegistry";
import { stripUnseenPrefix } from "./treeSpec";
import { GroupStore, UNGROUPED_ID, type Group, type GroupColor } from "./groupStore";
import { buildQuickPickItems } from "./jumpToTerminal";
import { getTreeViewRegistry } from "../plugin/treeViewRegistry";

const GROUP_COLORS: GroupColor[] = [
    "red",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "magenta",
    "gray",
];

export interface TerminalCommandDeps {
    readonly registry: TerminalRegistry;
    readonly treeProvider: { refresh(): void };
    /** Spawn a PTY-backed terminal (delegates to PtyTerminalFactory). */
    readonly spawnPty: (name: string, cwd: string) => vscode.Terminal;
    /** Resolve the workspace cwd for newly spawned terminals. */
    readonly getCwd: () => string;
}

/** Per-terminal commands: focus / delete / copy name / rename / new. */
export function registerTerminalCommands(
    deps: TerminalCommandDeps
): vscode.Disposable[] {
    const { registry, treeProvider, spawnPty, getCwd } = deps;
    const guarded = (
        terminal: vscode.Terminal | undefined
    ): terminal is vscode.Terminal => !!terminal && registry.has(terminal);

    return [
        vscode.commands.registerCommand(
            "superset.focus",
            (terminal: vscode.Terminal | undefined) => {
                if (guarded(terminal)) terminal.show();
            }
        ),
        vscode.commands.registerCommand(
            "superset.delete",
            (terminal: vscode.Terminal | undefined) => {
                if (guarded(terminal)) terminal.dispose();
            }
        ),
        vscode.commands.registerCommand(
            "superset.copyName",
            async (terminal: vscode.Terminal | undefined) => {
                if (!guarded(terminal)) return;
                await vscode.env.clipboard.writeText(
                    stripUnseenPrefix(terminal.name)
                );
            }
        ),
        vscode.commands.registerCommand(
            "superset.rename",
            async (terminal: vscode.Terminal | undefined) => {
                if (!guarded(terminal)) return;
                terminal.show();
                await vscode.commands.executeCommand(
                    "workbench.action.terminal.rename"
                );
                treeProvider.refresh();
            }
        ),
        vscode.commands.registerCommand("superset.openTuiTerminal", () => {
            spawnPty("Superset TUI", getCwd()).show();
        }),
        // Cross-panel shortcut for revealing a specific `vscode.Terminal`
        // in the terminals TreeView. The full version is
        // `superset.revealInTree` (in globalCommandsPlugin), which takes
        // a generic predicate; this one accepts the terminal object
        // directly and uses reference equality — `vscode.Terminal`
        // structurally satisfies `TerminalHandle` (name/show/dispose),
        // and the tree's terminal items are the same `vscode.Terminal`
        // instances stored in the registry, so identity match is sound.
        // Logs through `log` are not available in this signature, so
        // failures (registry missing, terminal not tracked) are silent
        // and just return `false` — same contract as `revealInTree`.
        vscode.commands.registerCommand(
            "superset.revealTerminal",
            async (terminal: vscode.Terminal | undefined): Promise<boolean> => {
                if (!guarded(terminal)) return false;
                const reg = getTreeViewRegistry();
                if (!reg) return false;
                return reg.reveal(
                    "superset.terminals",
                    (item) => item === terminal,
                    // No `log` channel wired into `TerminalCommandDeps`;
                    // pass a no-op so the registry can still log
                    // (BFS debug, double-register warnings) without
                    // throwing — and without changing the command
                    // surface area for callers.
                    () => {}
                );
            }
        ),
        vscode.commands.registerCommand("superset.newTerminal", () => {
            spawnPty("bash", getCwd()).show();
        }),
        vscode.commands.registerCommand("superset.jumpToTerminal", async () => {
            const all = registry.getAll();
            const items = await Promise.all(
                all.map(async (e) => {
                    const t = e.terminal as any;
                    let pid: number | undefined = undefined;
                    if (t.processId) {
                        if (typeof t.processId === "function") {
                            pid = await t.processId();
                        } else if (t.processId instanceof Promise || (t.processId && typeof t.processId.then === "function")) {
                            pid = await t.processId;
                        } else {
                            pid = t.processId;
                        }
                    }
                    const opts = t.creationOptions as any;
                    const cwd = opts?.cwd ? (typeof opts.cwd === "string" ? opts.cwd : opts.cwd.fsPath) : undefined;
                    return {
                        name: e.terminal.name,
                        pid: pid,
                        cwd: cwd,
                        show: () => e.terminal.show(),
                        terminal: e.terminal,
                    };
                })
            );
            const picked = await vscode.window.showQuickPick(
                buildQuickPickItems(items, ""),
                { placeHolder: "輸入 terminal 名稱過濾" }
            );
            if (!picked) return;
            picked.terminal.show();
        }),
    ];
}

/** Group commands: create / rename / set color / delete / toggle collapse. */
export function registerGroupCommands(
    groupStore: GroupStore
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand("superset.newGroup", async () => {
            const name = await vscode.window.showInputBox({
                prompt: "群組名稱",
                value: "",
            });
            if (!name) return;
            groupStore.createGroup(name);
        }),
        vscode.commands.registerCommand(
            "superset.renameGroup",
            async (group: Group | undefined) => {
                if (!group) return;
                const name = await vscode.window.showInputBox({
                    prompt: "新名稱",
                    value: group.name,
                });
                if (!name) return;
                groupStore.renameGroup(group.id, name);
            }
        ),
        vscode.commands.registerCommand(
            "superset.setGroupColor",
            async (group: Group | undefined) => {
                if (!group) return;
                const color = await vscode.window.showQuickPick(GROUP_COLORS, {
                    placeHolder: "選擇顏色",
                });
                if (!color) return;
                groupStore.setGroupColor(group.id, color as GroupColor);
            }
        ),
        vscode.commands.registerCommand(
            "superset.deleteGroup",
            (group: Group | undefined) => {
                if (!group || group.id === UNGROUPED_ID) return;
                groupStore.deleteGroup(group.id);
            }
        ),
        vscode.commands.registerCommand(
            "superset.toggleGroupCollapsed",
            (group: Group | undefined) => {
                if (!group) return;
                groupStore.toggleGroupCollapsed(group.id);
            }
        ),
    ];
}
