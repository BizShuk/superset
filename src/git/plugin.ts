// gitPlugin — adapter for the Git feature (legacy `register` shape).
// Heavy lifting lives in `./index.ts`; the shim is a one-line
// `legacyPlugin(...)` call, identical to `src/todo/plugin.ts` etc.

import { legacyPlugin } from "../plugin";
import { register as registerGitModule } from "./index";

export const GIT_PLUGIN_ID = "git";

export const gitPlugin = legacyPlugin({
    id: GIT_PLUGIN_ID,
    name: "Git",
    register: registerGitModule,
});
