/**
 * Monaco's base editor worker, and the reason this issue exists.
 *
 * For a plain editor the worker is a nicety: it backs link detection and
 * word-based suggestions, and an editor whose worker never answers still
 * opens and still types. For a diff editor it is the whole feature —
 * `computeDiff` runs here — so a diff editor without a worker is two panes of
 * text with no change decorations and no error explaining why.
 *
 * Which is exactly what `editor.worker.start.js` gives you. That module only
 * *exports* `start`; importing it for its side effects installs nothing, so
 * the worker boots, receives Monaco's first message and ignores it forever.
 * `editor.worker.js` is the entry that calls `start` and wires up
 * `self.onmessage`.
 */
import "monaco-editor/editor/editor.worker.js";
