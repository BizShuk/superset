// sessionsPlugin — adapter for the Sessions feature (legacy `register` shape).
// Heavy lifting lives in `./index.ts`.

import { legacyPlugin } from "../plugin";
import { register as registerSessionsModule } from "./index";

export const SESSIONS_PLUGIN_ID = "sessions";

export const sessionsPlugin = legacyPlugin({
    id: SESSIONS_PLUGIN_ID,
    name: "Sessions",
    register: registerSessionsModule,
});
