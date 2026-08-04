// cliLauncherPlugin — adapter for the CLI Launcher feature (legacy
// `register` shape). Heavy lifting lives in `./index.ts`; the plugin
// shim is a one-line `legacyPlugin(...)` call.

import { legacyPlugin } from "../plugin";
import { register as registerCLILauncherModule } from "./index";

export const CLI_LAUNCHER_PLUGIN_ID = "cliLauncher";

export const cliLauncherPlugin = legacyPlugin({
    id: CLI_LAUNCHER_PLUGIN_ID,
    name: "CLI Launcher",
    register: registerCLILauncherModule,
});
