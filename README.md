# bb-plugin-diff-editor

Cancelled, unfinished. It put Monaco's diff editor behind an Edit button on every diff bb renders, and never got as far as editing.

The idea was that bb renders every diff read-only — the agent timeline, the environment diff panel, the commit panel's preview — so correcting the one line an agent got slightly wrong means leaving the diff, opening the file, and finding the line again. Typing the fix into the diff would have saved that.

## How far it got

The plugin claims the SDK's `experimental_diffRenderer` slot, renders bb's own diff unchanged, and adds an Edit button over it. Pressing the button swaps in Monaco's diff editor in place, with bb's theme and whatever split or inline mode the surrounding surface asked for. `Done` puts bb's renderer back. Monaco loads only when the button is pressed.

When bb hands over the whole file, the editor shows the whole file. When it does not, it shows only the lines the patch carries and says `patch only`. A patch it cannot parse gets bb's renderer and no button.

Both sides are read-only and there is no save, which was the whole point.

## Why it stopped where it did

`experimental_diffRenderer` is experimental and had already moved once: `experimental_Original` became `Original` in SDK 0.4.16 and is removed in bb 0.42.

The slot is exclusive. Installing this takes over every diff in the app, and it will not coexist with another plugin claiming the same slot.

No language server, so no go-to-definition, no find-references, no type checking. It was for small corrections, not for writing code.
