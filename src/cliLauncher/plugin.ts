// CLI Launcher plugin declaration. Runtime wiring lives in `./index.ts`.

import type { ExtensionPlugin } from "../plugin";
import { register as registerCLILauncherModule } from "./index";

export const CLI_LAUNCHER_PLUGIN_ID = "cliLauncher";

export const cliLauncherPlugin: ExtensionPlugin = {
    id: CLI_LAUNCHER_PLUGIN_ID,
    name: "CLI Launcher",
    activate: registerCLILauncherModule,
};
