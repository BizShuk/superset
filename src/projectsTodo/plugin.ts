// projectsTodoPlugin — adapter for the Projects TODO feature (legacy
// `register` shape). Heavy lifting lives in `./index.ts`; the plugin
// shim is a one-line `legacyPlugin(...)` call.

import { legacyPlugin } from "../plugin";
import { register as registerProjectsTodoModule } from "./index";

export const PROJECTS_TODO_PLUGIN_ID = "projectsTodo";

export const projectsTodoPlugin = legacyPlugin({
    id: PROJECTS_TODO_PLUGIN_ID,
    name: "Projects TODO",
    register: registerProjectsTodoModule,
});