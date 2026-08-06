// Terminals plugin declaration. It owns the activity Status Bar item;
// all remaining runtime resources are registered by `./index.ts`.

import * as vscode from "vscode";
import type { ExtensionPlugin } from "../plugin";
import { register as registerTerminalsModule } from "./index";

export const TERMINALS_PLUGIN_ID = "terminals";

export const terminalsPlugin: ExtensionPlugin = {
    id: TERMINALS_PLUGIN_ID,
    name: "Terminals",
    activate(ctx): void {
        const statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        ctx.registerDisposable(statusBar);
        registerTerminalsModule(ctx, statusBar);
    },
};
