// Ported from the first-party monaco-editor plugin's test, which is where the
// conversion came from. The cases are the ones that cost something to get
// wrong: Monaco's rule parser throws on a colour it cannot read, and
// `Color.fromHex` does not — it returns red.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";

import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";

import {
  applyCodeTheme,
  editorBackground,
  monacoThemeName,
  toMonacoTheme,
} from "./monaco-theme.ts";

function theme(
  overrides: Partial<PluginCodeThemeData> = {},
): PluginCodeThemeData {
  return {
    name: "bb:nord:light:1f4c9a2b",
    type: "light",
    fg: "#2e3440",
    bg: "#eceff4",
    colors: {},
    tokenColors: [],
    ...overrides,
  };
}

/** `assert.deepEqual`, but against any one of the rules rather than all. */
function has(rules: readonly unknown[], rule: Record<string, string>): void {
  assert.ok(
    rules.some((candidate) => isDeepStrictEqual(candidate, rule)),
    `expected a rule ${JSON.stringify(rule)} in ${JSON.stringify(rules)}`,
  );
}

const MONACO_THEME_NAME = /^[a-zA-Z0-9-]+$/;

test("bb's namespaced, fingerprinted names become names Monaco accepts", () => {
  assert.match(monacoThemeName("bb:nord:light:1f4c9a2b"), MONACO_THEME_NAME);
  assert.match(monacoThemeName("catppuccin-mocha"), MONACO_THEME_NAME);
  assert.notEqual(
    monacoThemeName("bb:nord:light"),
    monacoThemeName("bb:nord:dark"),
  );
});

test("the base comes from the theme's own type", () => {
  assert.equal(toMonacoTheme(theme({ type: "dark" })).base, "vs-dark");
  assert.equal(toMonacoTheme(theme({ type: "light" })).base, "vs");
});

test("a default rule keeps unmatched tokens off the stock foreground", () => {
  assert.deepEqual(toMonacoTheme(theme()).rules[0], {
    token: "",
    foreground: "2e3440",
  });
});

test("short hex expands and unreadable colours are dropped, not passed on", () => {
  const { rules } = toMonacoTheme(
    theme({
      tokenColors: [
        { scope: "comment", settings: { foreground: "#abc" } },
        { scope: "keyword", settings: { foreground: "not-a-color" } },
        { scope: "string", settings: { foreground: "#11223344" } },
      ],
    }),
  );
  has(rules, { token: "comment", foreground: "aabbcc" });
  has(rules, { token: "string", foreground: "11223344" });
  assert.ok(!rules.some((rule) => rule.token === "keyword"));
});

test("both spellings of a multi-scope rule split into one rule each", () => {
  const { rules } = toMonacoTheme(
    theme({
      tokenColors: [
        {
          scope: ["variable", "entity.name"],
          settings: { foreground: "#111111" },
        },
        { scope: "constant, support.type", settings: { foreground: "#222222" } },
      ],
    }),
  );
  has(rules, { token: "variable", foreground: "111111" });
  has(rules, { token: "entity.name", foreground: "111111" });
  has(rules, { token: "constant", foreground: "222222" });
  has(rules, { token: "support.type", foreground: "222222" });
});

test("only the font styles Monaco understands survive", () => {
  const { rules } = toMonacoTheme(
    theme({
      tokenColors: [
        {
          scope: "comment",
          settings: { foreground: "#111111", fontStyle: "italic strikethrough" },
        },
        { scope: "keyword", settings: { fontStyle: "bold underline" } },
      ],
    }),
  );
  has(rules, { token: "comment", foreground: "111111", fontStyle: "italic" });
  has(rules, { token: "keyword", fontStyle: "bold underline" });
});

test("a theme with no workbench colours still paints the editor surface", () => {
  assert.deepEqual(toMonacoTheme(theme()).colors, {
    "editor.background": "#eceff4",
    "editor.foreground": "#2e3440",
  });
});

test("declared workbench colours win, and ones Color.fromHex would read as red are dropped", () => {
  assert.deepEqual(
    toMonacoTheme(
      theme({
        colors: {
          "editor.background": "#1e1e1e",
          "diffEditor.insertedTextBackground": "#9ccc2c33",
          "editor.selectionBackground": "rgba(0,0,0,0.2)",
        },
      }),
    ).colors,
    {
      "editor.background": "#1e1e1e",
      "diffEditor.insertedTextBackground": "#9ccc2c33",
      "editor.foreground": "#2e3440",
    },
  );
});

test("the stock pair covers the one frame before a theme document resolves", () => {
  const defined: string[] = [];
  const monaco = {
    editor: { defineTheme: (name: string) => defined.push(name) },
  } as unknown as Parameters<typeof applyCodeTheme>[0];

  assert.deepEqual(applyCodeTheme(monaco, { mode: "dark", theme: null }), {
    name: "vs-dark",
    base: "vs-dark",
  });
  assert.deepEqual(defined, []);

  // The widget base keys off the applied document, not `mode`, so a frame
  // taken mid-switch does not put a dark popup over a light editor.
  assert.equal(
    applyCodeTheme(monaco, { mode: "dark", theme: theme() }).base,
    "vs",
  );
  assert.deepEqual(defined, ["bb-bb-nord-light-1f4c9a2b"]);
});

test("the editor background prefers the workbench colour, then the theme's own", () => {
  assert.equal(
    editorBackground(theme({ colors: { "editor.background": "#1e1e2e" } })),
    "#1e1e2e",
  );
  assert.equal(editorBackground(theme()), "#eceff4");
  assert.equal(editorBackground(null), null);
  assert.equal(
    editorBackground(
      theme({ bg: "not-a-color", colors: { "editor.background": "red" } }),
    ),
    null,
  );
});
