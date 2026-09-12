/**
 * The Monaco we ship.
 *
 * `editor.main` is Monaco's own standalone entry: the API, its contribution
 * modules (find, folding, word navigation, bracket matching, …) and the
 * Monarch grammars for every language it knows. `editor.api` alone is 1.3 MB
 * smaller and still opens, still types, still diffs — while find, word
 * navigation and folding silently do not exist. The contributions are the
 * editor.
 *
 * The language *services* (completion and type checking for CSS, HTML, JSON
 * and TypeScript) are the part worth dropping, and this entry does not pull
 * them in. There is no language server behind this plugin, and Monaco's
 * TypeScript checker sees only the one side of one diff, so every "cannot
 * find module" it reported would be wrong.
 */
export * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/editor.main.js";
