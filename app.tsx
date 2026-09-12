// bb-plugin-diff-editor — frontend entry.
//
// `experimental_diffRenderer` is exclusive and global: claiming it replaces
// bb's renderer in the agent timeline, the diff panel, the commit preview and
// every plugin that calls `experimental_Diff`. The first crash disables it for
// the rest of the session, app-wide, with only a console warning.
//
// So the default is still to delegate. `Original` is bb's own renderer bound
// to this request — complete with the selection-to-chat handler bb does not
// pass us directly — so rendering it is genuinely indistinguishable from not
// having claimed the slot at all. What this adds is an Edit affordance over
// it, and Monaco only once someone asks for it: a three-line timeline diff
// never loads a 4 MB editor, and the editor's crash surface exists only while
// it is open.
import { useMemo, useState } from "react";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { PluginDiffRendererProps } from "@get-bb/plugin-sdk/app";

import { EditIcon } from "./components/EditIcon.tsx";
import { MonacoDiff } from "./components/MonacoDiff.tsx";
import { Button } from "./components/ui/button.tsx";
import { diffContent } from "./lib/diff-content.ts";
import { parseFilePatch } from "./lib/patch.ts";

function DiffEditorSlot({
  patch,
  path,
  view,
  overflow,
  showLineNumbers,
  experimental_fullFileContents,
  Original,
}: PluginDiffRendererProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Only the after-side is read, and it is read as a string rather than as
  // the object it came in: bb resolves those contents asynchronously and a
  // fresh wrapper on every render would remount the editor under the cursor.
  const afterSide = experimental_fullFileContents?.new.content ?? null;
  const parsed = useMemo(() => parseFilePatch(patch, path), [patch, path]);
  const editable = useMemo(
    () =>
      parsed === null
        ? null
        : {
            content: diffContent(
              parsed.file,
              afterSide === null ? null : { new: { content: afterSide } },
            ),
            // bb takes the slot's `path` from its own parse of the patch, and
            // hands over an empty one for any header it could not read. The
            // patch names the file too, and by here it has been through a
            // parse that agrees with git about what a header looks like.
            path: path === "" ? parsed.file.name : path,
          },
    [afterSide, parsed, path],
  );

  if (editable === null) return <Original />;

  if (failure !== null) {
    return (
      <div>
        <Original />
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
          The editor could not be opened: {failure}
        </p>
      </div>
    );
  }

  if (isEditing) {
    return (
      <MonacoDiff
        content={editable.content}
        path={editable.path}
        view={view}
        overflow={overflow}
        showLineNumbers={showLineNumbers}
        onClose={() => setIsEditing(false)}
        onFailed={setFailure}
      />
    );
  }

  return (
    <div className="group/diff-editor relative">
      <Original />
      {/*
        Inert as well as invisible until it is wanted, so an unhovered diff
        has nothing sitting over its first line taking clicks. `pointer-events`
        does not stop the tab key, so the button can still be reached and
        reveals itself with `focus-within` when it is.
      */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/diff-editor:pointer-events-auto group-hover/diff-editor:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 bg-surface-raised-solid px-2 text-xs shadow-sm"
          // Several diffs share a screen, and bb names its own per-file
          // controls the same way ("Expand lib/patch.ts").
          aria-label={`Edit ${editable.path}`}
          onClick={() => setIsEditing(true)}
        >
          <EditIcon />
          Edit
        </Button>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_diffRenderer({
    id: "monaco",
    title: "Editable diffs",
    description: "Edit the modified side of a diff and save it back to disk.",
    component: DiffEditorSlot,
  });
});
