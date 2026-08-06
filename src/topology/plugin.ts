// Topology plugin declaration. Runtime wiring lives in `./index.ts`.

import type { ExtensionPlugin } from "../plugin";
import { register as registerTopologyModule } from "./index";

export const TOPOLOGY_PLUGIN_ID = "topology";

export const topologyPlugin: ExtensionPlugin = {
    id: TOPOLOGY_PLUGIN_ID,
    name: "Topology",
    activate: registerTopologyModule,
};
