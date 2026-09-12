// bb-plugin-diff-editor — backend entry.
//
// Nothing here yet. The plugin's first job is to claim the diff renderer slot
// and change nothing, which is entirely a frontend concern (see app.tsx). The
// server grows a resolve/read/write RPC once there is something to save.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("diff-editor loaded");
}
