// Turns bb's active code theme into Monaco's.
//
// `experimental_useCodeTheme()` hands over the VS Code theme document bb's own
// highlighter renders from — the same file, not a summary of it. Approximating
// it from bb's CSS variables would not work: those carry the app chrome, and
// the syntax colours are not in them.
//
// This is a port of the first-party monaco-editor plugin's conversion, kept
// close to it on purpose. A diff rendered by this plugin and a file opened by
// that one sit in the same window, and two readings of one theme document
// would show as two palettes.
//
// The workbench colours are copied wholesale rather than picked from a list,
// so the diff-specific keys — `diffEditor.insertedTextBackground` and the rest
// — come along without being named here.
import type * as MonacoNs from "monaco-editor";
import type { PluginCodeThemeData } from "@get-bb/plugin-sdk/app";

/** What Monaco's rule parser accepts: six or eight hex digits, no `#`. */
const TOKEN_COLOR = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

/** What `Color.fromHex` accepts. Anything else it silently reads as red. */
const WORKBENCH_COLOR = /^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

/** bb's names are namespaced and fingerprinted; Monaco's are `[a-z0-9-]`. */
export function monacoThemeName(name: string): string {
  return `bb-${name.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

function tokenColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const hex = value.startsWith("#") ? value.slice(1) : value;
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex;
  return TOKEN_COLOR.test(expanded) ? expanded : undefined;
}

function fontStyleFor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const styles = value
    .split(/\s+/)
    .filter(
      (style) =>
        style === "italic" || style === "bold" || style === "underline",
    );
  return styles.join(" ");
}

function tokenRules(
  theme: PluginCodeThemeData,
): MonacoNs.editor.ITokenThemeRule[] {
  const rules: MonacoNs.editor.ITokenThemeRule[] = [];
  // Without a default rule, anything the theme does not name falls through to
  // the stock vs/vs-dark foreground, which is a different colour to the rest.
  const base = tokenColor(theme.fg);
  if (base !== undefined) rules.push({ token: "", foreground: base });

  for (const rule of theme.tokenColors) {
    const foreground = tokenColor(rule.settings.foreground);
    const background = tokenColor(rule.settings.background);
    const fontStyle = fontStyleFor(rule.settings.fontStyle);
    if (
      foreground === undefined &&
      background === undefined &&
      fontStyle === undefined
    ) {
      continue;
    }
    // A TextMate rule carries either a list of scopes or one comma-separated
    // string of them; Monaco wants one rule per scope either way.
    const scopes =
      rule.scope === undefined
        ? [""]
        : typeof rule.scope === "string"
          ? rule.scope.split(",")
          : rule.scope;
    for (const scope of scopes) {
      const token = scope.trim();
      if (rule.scope !== undefined && token === "") continue;
      rules.push({
        token,
        ...(foreground === undefined ? {} : { foreground }),
        ...(background === undefined ? {} : { background }),
        ...(fontStyle === undefined ? {} : { fontStyle }),
      });
    }
  }
  return rules;
}

function workbenchColors(theme: PluginCodeThemeData): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [id, value] of Object.entries(theme.colors)) {
    if (typeof value === "string" && WORKBENCH_COLOR.test(value)) {
      colors[id] = value;
    }
  }
  if (
    colors["editor.background"] === undefined &&
    WORKBENCH_COLOR.test(theme.bg)
  ) {
    colors["editor.background"] = theme.bg;
  }
  if (
    colors["editor.foreground"] === undefined &&
    WORKBENCH_COLOR.test(theme.fg)
  ) {
    colors["editor.foreground"] = theme.fg;
  }
  return colors;
}

/** The surface colour to paint behind the editor, so its frame matches it. */
export function editorBackground(
  theme: PluginCodeThemeData | null,
): string | null {
  if (theme === null) return null;
  return workbenchColors(theme)["editor.background"] ?? null;
}

export function toMonacoTheme(
  theme: PluginCodeThemeData,
): MonacoNs.editor.IStandaloneThemeData {
  return {
    base: theme.type === "light" ? "vs" : "vs-dark",
    inherit: true,
    rules: tokenRules(theme),
    colors: workbenchColors(theme),
  };
}

export interface AppliedMonacoTheme {
  /** Pass to `updateOptions({ theme })`. */
  name: string;
  /** The class the overflow widgets node needs to match this theme. */
  base: "vs" | "vs-dark";
}

/**
 * Defines the theme with Monaco and says what to call it.
 *
 * `theme` is null only before the first theme file resolves, and bb keeps the
 * previous document until the next one lands — so the stock pair is the very
 * first frame of an app session and nothing else. The widget base follows the
 * document that was actually applied rather than `mode`, so a frame taken
 * mid-switch is coherent instead of a dark popup over a light editor.
 */
export function applyCodeTheme(
  monaco: typeof MonacoNs,
  state: { mode: "light" | "dark"; theme: PluginCodeThemeData | null },
): AppliedMonacoTheme {
  if (state.theme === null) {
    const base = state.mode === "dark" ? "vs-dark" : "vs";
    return { name: base, base };
  }
  const name = monacoThemeName(state.theme.name);
  monaco.editor.defineTheme(name, toMonacoTheme(state.theme));
  return { name, base: state.theme.type === "light" ? "vs" : "vs-dark" };
}
