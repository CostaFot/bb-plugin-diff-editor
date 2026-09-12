// bb-plugin-diff-editor — frontend entry.
//
// `experimental_diffRenderer` is exclusive and global: claiming it replaces
// bb's renderer in the agent timeline, the diff panel, the commit preview and
// every plugin that calls `experimental_Diff`. The first crash disables it for
// the rest of the session, app-wide, with only a console warning.
//
// So this starts as a pass-through. `Original` is bb's own renderer bound to
// this request — complete with the selection-to-chat handler bb does not pass
// us directly — so rendering it is genuinely indistinguishable from not having
// claimed the slot at all. Everything the plugin learns to do gets added by
// narrowing when it declines to delegate.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { PluginDiffRendererProps } from "@get-bb/plugin-sdk/app";

function DiffEditorSlot({ Original }: PluginDiffRendererProps) {
  return <Original />;
}

export default definePluginApp((app) => {
  app.slots.experimental_diffRenderer({
    id: "monaco",
    title: "Editable diffs",
    description: "Edit the modified side of a diff and save it back to disk.",
    component: DiffEditorSlot,
  });
});
