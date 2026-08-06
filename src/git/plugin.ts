// Git plugin declaration. Runtime wiring lives in `./index.ts`.

import type { ExtensionPlugin } from "../plugin";
import { register as registerGitModule } from "./index";

export const GIT_PLUGIN_ID = "git";

export const gitPlugin: ExtensionPlugin = {
    id: GIT_PLUGIN_ID,
    name: "Git",
    activate: registerGitModule,
};
