// projectsPlugin — adapter for the Projects feature (legacy `register`
// shape). Heavy lifting lives in `./index.ts`; the plugin shim is a
// one-line `legacyPlugin(...)` call.

import { legacyPlugin } from "../plugin";
import { register as registerProjectsModule } from "./index";

export const PROJECTS_PLUGIN_ID = "projects";

export const projectsPlugin = legacyPlugin({
    id: PROJECTS_PLUGIN_ID,
    name: "Projects",
    register: registerProjectsModule,
});
