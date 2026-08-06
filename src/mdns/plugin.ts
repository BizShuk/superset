// mDNS plugin declaration. Runtime wiring lives in `./index.ts`.

import type { ExtensionPlugin } from "../plugin";
import { register as registerMdnsModule } from "./index";

export const MDNS_PLUGIN_ID = "mdns";

export const mdnsPlugin: ExtensionPlugin = {
    id: MDNS_PLUGIN_ID,
    name: "mDNS",
    activate: registerMdnsModule,
};
