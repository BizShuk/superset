// TODO plugin declaration. Runtime wiring lives in `./index.ts`.

import type { ExtensionPlugin } from "../plugin";
import { register as registerTodoModule } from "./index";

export const TODO_PLUGIN_ID = "todo";

export const todoPlugin: ExtensionPlugin = {
    id: TODO_PLUGIN_ID,
    name: "TODO",
    activate: registerTodoModule,
};
