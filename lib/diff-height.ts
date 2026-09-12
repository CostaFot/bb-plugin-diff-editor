// How tall to make the editor.
//
// bb's diffs grow to their content and stop; Monaco fills the box it is given
// and scrolls inside it. Neither is negotiable, so the box is measured from
// Monaco's own content height and clamped, which is the standard auto-grow
// recipe and the only one that keeps a three-line diff three lines tall.
//
// It has to be remeasured rather than set once: the diff arrives from a web
// worker after the editor mounts, the view and wrap modes change the number of
// rendered rows, and typing changes it again.
import type { CodeOverflowMode, DiffViewMode } from "@get-bb/plugin-sdk/app";

/** Matches the `lineHeight` the editors are created with. */
export const DIFF_EDITOR_LINE_HEIGHT = 20;

/** Three lines: a one-line change with a line of context either side. */
export const MIN_DIFF_EDITOR_HEIGHT = 3 * DIFF_EDITOR_LINE_HEIGHT;

/**
 * The same 600px bb reserves for a diff card it has not rendered yet
 * (`contain-intrinsic-size: 0 600px`), so an editor that hits the ceiling is
 * the size the surrounding layout already expected.
 */
export const MAX_DIFF_EDITOR_HEIGHT = 600;

/**
 * Monaco lays the horizontal scrollbar over the last line rather than below
 * it, so a diff measured exactly to its content hides its own last line
 * behind the scrollbar. There is no scrollbar to leave room for when lines
 * wrap.
 */
const HORIZONTAL_SCROLLBAR_HEIGHT = 12;

export interface DiffPresentation {
  view: DiffViewMode;
  overflow: CodeOverflowMode;
}

/** What `getContentHeight()` reports on each of the two inner editors. */
export interface DiffContentHeight {
  original: number;
  modified: number;
}

/**
 * In split view the two sides are padded with view zones until they line up,
 * so either one answers for both and the taller is the safe one to believe
 * mid-layout. In unified view the original editor is hidden and its content
 * height is whatever its model happens to be — not what is on screen.
 */
export function diffEditorHeight(
  content: DiffContentHeight,
  presentation: DiffPresentation,
): number {
  const measured =
    presentation.view === "unified"
      ? content.modified
      : Math.max(content.original, content.modified);
  const withScrollbar =
    presentation.overflow === "wrap"
      ? measured
      : measured + HORIZONTAL_SCROLLBAR_HEIGHT;
  return Math.min(
    MAX_DIFF_EDITOR_HEIGHT,
    Math.max(MIN_DIFF_EDITOR_HEIGHT, Math.ceil(withScrollbar)),
  );
}

/**
 * A first height from the text alone, for the frame between the container
 * being laid out and Monaco reporting a content height. It is a guess — view
 * zones and wrapped lines both add rows — but it is close enough that the
 * editor does not visibly resize itself on arrival.
 */
export function estimatedDiffEditorHeight(
  content: { original: string; modified: string },
  presentation: DiffPresentation,
): number {
  return diffEditorHeight(
    {
      original: lineCount(content.original) * DIFF_EDITOR_LINE_HEIGHT,
      modified: lineCount(content.modified) * DIFF_EDITOR_LINE_HEIGHT,
    },
    presentation,
  );
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const breaks = text.match(/\r\n|\n|\r/g)?.length ?? 0;
  return text.endsWith("\n") || text.endsWith("\r") ? breaks : breaks + 1;
}
