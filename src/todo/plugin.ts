// todoPlugin — adapter for the TODO feature (legacy `register` shape).
// Heavy lifting lives in `./index.ts`; the plugin shim is a one-line
// `legacyPlugin(...)` call.

import { legacyPlugin } from "../plugin";
import { register as registerTodoModule } from "./index";

export const TODO_PLUGIN_ID = "todo";

export const todoPlugin = legacyPlugin({
    id: TODO_PLUGIN_ID,
    name: "TODO",
    register: registerTodoModule,
});