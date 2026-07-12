// mdnsPlugin — adapter for the mDNS feature (legacy `register` shape).
// Heavy lifting lives in `./index.ts`; the plugin shim is a one-line
// `legacyPlugin(...)` call. Stage 6 will replace `registerMdnsModule`
// with a direct `PluginContext` consumer and drop this shim entirely.

import { legacyPlugin } from "../plugin";
import { register as registerMdnsModule } from "./index";

export const MDNS_PLUGIN_ID = "mdns";

export const mdnsPlugin = legacyPlugin({
    id: MDNS_PLUGIN_ID,
    name: "mDNS",
    register: registerMdnsModule,
});
