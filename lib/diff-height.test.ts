import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DIFF_EDITOR_LINE_HEIGHT,
  MAX_DIFF_EDITOR_HEIGHT,
  MIN_DIFF_EDITOR_HEIGHT,
  diffEditorHeight,
  estimatedDiffEditorHeight,
} from "./diff-height.ts";

const SPLIT = { view: "split", overflow: "wrap" } as const;
const UNIFIED = { view: "unified", overflow: "wrap" } as const;

test("split view believes the taller of the two sides", () => {
  assert.equal(diffEditorHeight({ original: 400, modified: 200 }, SPLIT), 400);
  assert.equal(diffEditorHeight({ original: 200, modified: 400 }, SPLIT), 400);
});

test("unified view believes the modified side, the only one on screen", () => {
  assert.equal(diffEditorHeight({ original: 400, modified: 200 }, UNIFIED), 200);
});

test("room is left for the horizontal scrollbar, which overlays the last line", () => {
  assert.equal(
    diffEditorHeight({ original: 0, modified: 200 }, { ...UNIFIED, overflow: "scroll" }) -
      diffEditorHeight({ original: 0, modified: 200 }, UNIFIED),
    12,
  );
});

test("an empty or enormous diff still gets a box between the two limits", () => {
  assert.equal(
    diffEditorHeight({ original: 0, modified: 0 }, SPLIT),
    MIN_DIFF_EDITOR_HEIGHT,
  );
  assert.equal(
    diffEditorHeight({ original: 100_000, modified: 100_000 }, SPLIT),
    MAX_DIFF_EDITOR_HEIGHT,
  );
});

test("a fractional content height rounds up, so nothing is cropped", () => {
  assert.equal(diffEditorHeight({ original: 0, modified: 200.5 }, UNIFIED), 201);
});

test("the first guess counts lines the way a file with no final newline has them", () => {
  const lines = (text: string) =>
    estimatedDiffEditorHeight({ original: "", modified: text }, UNIFIED) /
    DIFF_EDITOR_LINE_HEIGHT;

  // Under the floor these all clamp, so compare above it: ten lines either
  // way round, with and without the last newline.
  const ten = "a\n".repeat(10);
  assert.equal(lines(ten), 10);
  assert.equal(lines(`${ten}k`), 11);
  assert.equal(lines(""), MIN_DIFF_EDITOR_HEIGHT / DIFF_EDITOR_LINE_HEIGHT);
});
