# bb-plugin-diff-editor

Makes bb's diff view editable. Type the fix straight into the diff, `Ctrl+S`, done.

bb renders every diff read-only — the agent timeline, the environment diff panel, the commit panel's preview. Correcting the one line an agent got slightly wrong means leaving the diff, opening the file, and finding the line again.

## How it works

The plugin claims the SDK's `experimental_diffRenderer` slot and puts Monaco's diff editor in place of bb's renderer, with the modified side editable.

Saves are guarded by the hash the file had when the diff opened. If an agent wrote to it in the meantime the save stops and offers Reload or Overwrite, rather than quietly dropping the agent's work.

The slot is global, so this applies everywhere bb shows a diff — not just in one panel.

## Notes and limitations

`experimental_diffRenderer` is experimental and has already moved once: `experimental_Original` became `Original` in SDK 0.4.16 and is removed in bb 0.42. Expect more of that.

The slot is exclusive. Installing this takes over every diff in the app, and it will not coexist with another plugin claiming the same slot.

No language server, so no go-to-definition, no find-references, no type checking. It is for small corrections, not for writing code.

## Status

Nothing works yet.
