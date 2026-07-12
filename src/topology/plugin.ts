// topologyPlugin — adapter for the Topology feature (legacy `register`
// shape). Heavy lifting lives in `./index.ts`; the plugin shim is a
// one-line `legacyPlugin(...)` call.

import { legacyPlugin } from "../plugin";
import { register as registerTopologyModule } from "./index";

export const TOPOLOGY_PLUGIN_ID = "topology";

export const topologyPlugin = legacyPlugin({
    id: TOPOLOGY_PLUGIN_ID,
    name: "Topology",
    register: registerTopologyModule,
});