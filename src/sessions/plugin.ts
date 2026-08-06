// Sessions plugin declaration. Runtime wiring lives in `./index.ts`.

import type { ExtensionPlugin } from "../plugin";
import { register as registerSessionsModule } from "./index";

export const SESSIONS_PLUGIN_ID = "sessions";

export const sessionsPlugin: ExtensionPlugin = {
    id: SESSIONS_PLUGIN_ID,
    name: "Sessions",
    activate: registerSessionsModule,
};
