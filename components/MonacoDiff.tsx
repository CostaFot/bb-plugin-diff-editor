// Monaco's diff editor, mounted where bb's renderer was.
//
// Read-only on both sides for now — making the modified side editable is the
// same piece of work as wiring the save, and neither is here yet. What this
// settles is everything that has to be right before typing into it could mean
// anything: the props honoured live, the theme taken from bb's own theme
// document, and the two ways Monaco and bb's diff card disagree about layout.
import { useEffect, useRef, useState } from "react";
import {
  experimental_useCodeTheme,
  useRpc,
  type CodeOverflowMode,
  type DiffViewMode,
} from "@get-bb/plugin-sdk/app";
import type * as MonacoNs from "monaco-editor";

import type { rpcContract } from "../server.ts";
import type { DiffContent, LineNumbers } from "../lib/diff-content.ts";
import {
  DIFF_EDITOR_LINE_HEIGHT,
  diffEditorHeight,
  estimatedDiffEditorHeight,
} from "../lib/diff-height.ts";
import {
  loadMonaco,
  overflowWidgetsNode,
  setOverflowWidgetsTheme,
} from "../lib/monaco-loader.ts";
import { applyCodeTheme, editorBackground } from "../lib/monaco-theme.ts";
import { EditIcon } from "./EditIcon.tsx";
import { Button } from "./ui/button.tsx";

export interface MonacoDiffProps {
  content: DiffContent;
  path: string;
  view: DiffViewMode;
  overflow: CodeOverflowMode;
  showLineNumbers: boolean;
  /** Leave the editor and go back to bb's renderer. */
  onClose: () => void;
  /** The editor could not be opened at all; show the diff the other way. */
  onFailed: (message: string) => void;
}

/**
 * Model URIs have to be unique — Monaco throws on a second model for a URI it
 * already has — and two diffs of one file are on screen together often enough
 * that the path alone will not do. The path stays the last segment so Monaco
 * can still work out the language from it.
 */
let modelCounter = 0;

function modelUri(
  monaco: typeof MonacoNs,
  instance: number,
  side: string,
  path: string,
): MonacoNs.Uri {
  return monaco.Uri.from({
    scheme: "bb-diff-editor",
    path: `/${instance}/${side}/${path.replace(/^\/+/, "")}`,
  });
}

function lineNumberOption(
  show: boolean,
  numbers: LineNumbers | null,
): MonacoNs.editor.LineNumbersType {
  if (!show) return "off";
  if (numbers === null) return "on";
  return (lineNumber) => String(numbers[lineNumber - 1] ?? "");
}

/**
 * Per side rather than on the diff editor, because one function cannot know
 * which of the two sides it is numbering — and the patch's lines are called
 * different things on each.
 */
function applyLineNumbers(
  editor: MonacoNs.editor.IStandaloneDiffEditor,
  content: DiffContent,
  showLineNumbers: boolean,
): void {
  editor.getOriginalEditor().updateOptions({
    lineNumbers: lineNumberOption(showLineNumbers, content.originalLineNumbers),
  });
  editor.getModifiedEditor().updateOptions({
    lineNumbers: lineNumberOption(showLineNumbers, content.modifiedLineNumbers),
  });
}

export function MonacoDiff({
  content,
  path,
  view,
  overflow,
  showLineNumbers,
  onClose,
  onFailed,
}: MonacoDiffProps) {
  const rpc = useRpc<typeof rpcContract>();
  const codeTheme = experimental_useCodeTheme();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<typeof MonacoNs | null>(null);
  const editorRef = useRef<MonacoNs.editor.IStandaloneDiffEditor | null>(null);
  const remeasureRef = useRef<(() => void) | null>(null);

  // Read inside the mount effect, which must not re-run when they change:
  // every one of them has a live update path of its own below.
  const latest = useRef({ codeTheme, view, overflow, showLineNumbers, onFailed });
  latest.current = { codeTheme, view, overflow, showLineNumbers, onFailed };

  const [height, setHeight] = useState(() =>
    estimatedDiffEditorHeight(content, { view, overflow }),
  );
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    setIsReady(false);
    setHeight(
      estimatedDiffEditorHeight(content, {
        view: latest.current.view,
        overflow: latest.current.overflow,
      }),
    );

    void (async () => {
      try {
        const { baseUrl } = await rpc.call("assets", null);
        const monaco = await loadMonaco(baseUrl);
        if (disposed) return;
        const container = containerRef.current;
        if (container === null) return;
        monacoRef.current = monaco;

        const applied = applyCodeTheme(monaco, latest.current.codeTheme);
        setOverflowWidgetsTheme(applied.base);

        const editor = monaco.editor.createDiffEditor(container, {
          theme: applied.name,
          automaticLayout: true,
          // A viewer until there is a save path to put behind it. `readOnly`
          // also stops Monaco offering edit affordances of its own in a diff
          // that has nowhere to write.
          readOnly: true,
          originalEditable: false,
          renderSideBySide: latest.current.view === "split",
          // bb resolved `view` already — from the user's setting or the
          // surface's own choice — so a narrow pane is not grounds to render
          // the other one. Left on, this silently overrides the prop.
          useInlineViewWhenSpaceIsLimited: false,
          wordWrap: latest.current.overflow === "wrap" ? "on" : "off",
          diffWordWrap: latest.current.overflow === "wrap" ? "on" : "off",
          // Both of these write a hunk straight into the model. There is no
          // save path behind them, and once there is one they would bypass
          // it, so a revert would look like it took and then be lost.
          renderMarginRevertIcon: false,
          renderGutterMenu: false,
          // The overview ruler is a scrollbar-width map of a file. This shows
          // a few hunks in a card, so it maps almost nothing and costs a
          // column of it.
          renderOverviewRuler: false,
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          fontSize: 12,
          lineHeight: DIFF_EDITOR_LINE_HEIGHT,
          fontFamily:
            getComputedStyle(document.documentElement).getPropertyValue(
              "--font-mono",
            ) || undefined,
          // A diff taller than the ceiling scrolls inside the card. Consuming
          // the wheel would then trap a timeline scroll in it; this hands the
          // wheel back once the editor has nowhere left to go.
          scrollbar: { alwaysConsumeMouseWheel: false },
          fixedOverflowWidgets: true,
          overflowWidgetsDomNode: overflowWidgetsNode(),
        });
        editorRef.current = editor;

        const instance = (modelCounter += 1);
        editor.setModel({
          original: monaco.editor.createModel(
            content.original,
            undefined,
            modelUri(monaco, instance, "original", path),
          ),
          modified: monaco.editor.createModel(
            content.modified,
            undefined,
            modelUri(monaco, instance, "modified", path),
          ),
        });
        applyLineNumbers(editor, content, latest.current.showLineNumbers);

        const remeasure = () => {
          if (disposed) return;
          setHeight(
            diffEditorHeight(
              {
                original: editor.getOriginalEditor().getContentHeight(),
                modified: editor.getModifiedEditor().getContentHeight(),
              },
              {
                view: latest.current.view,
                overflow: latest.current.overflow,
              },
            ),
          );
        };
        remeasureRef.current = remeasure;
        // The diff itself is computed in the web worker and lands after the
        // editor has already laid itself out, and view zones for the other
        // side's lines are part of what it lands with. Measuring only at
        // mount gets the height of a diff that has not been computed yet.
        editor.onDidUpdateDiff(remeasure);
        editor.getOriginalEditor().onDidContentSizeChange(remeasure);
        editor.getModifiedEditor().onDidContentSizeChange(remeasure);
        remeasure();

        setIsReady(true);
      } catch (error) {
        if (disposed) return;
        latest.current.onFailed(
          error instanceof Error ? error.message : "the editor did not open",
        );
      }
    })();

    return () => {
      disposed = true;
      remeasureRef.current = null;
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor === null) return;
      const model = editor.getModel();
      editor.dispose();
      model?.original.dispose();
      model?.modified.dispose();
    };
  }, [content, path, rpc]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    editor.updateOptions({
      renderSideBySide: view === "split",
      wordWrap: overflow === "wrap" ? "on" : "off",
      // Without the pair, the wrapped side sits next to the scrolling one and
      // the two stop lining up.
      diffWordWrap: overflow === "wrap" ? "on" : "off",
    });
    // After the shared update, so the per-side numbering is the last word on
    // an option the diff editor also pushes down to both of its children.
    applyLineNumbers(editor, content, showLineNumbers);
    remeasureRef.current?.();
  }, [content, isReady, overflow, showLineNumbers, view]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (monaco === null || editor === null) return;
    // `setTheme` rather than an option on this editor: a standalone diff
    // editor has no `theme` in `updateOptions`, and bb's code theme is one
    // app-wide setting anyway, so every editor open on this Monaco should
    // follow it at once.
    const applied = applyCodeTheme(monaco, codeTheme);
    monaco.editor.setTheme(applied.name);
    setOverflowWidgetsTheme(applied.base);
  }, [codeTheme, isReady]);

  const background = editorBackground(codeTheme.theme);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-surface-recessed px-2 py-1 text-xs">
        <EditIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {path}
        </span>
        {content.whole ? null : (
          <span
            className="shrink-0 text-muted-foreground"
            title="Only the lines the patch carries are here; the gutter shows where they sit in the file."
          >
            patch only
          </span>
        )}
        <span className="shrink-0 text-muted-foreground">read-only</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={onClose}
        >
          Done
        </Button>
      </div>
      <div
        ref={containerRef}
        style={{
          height,
          ...(background === null ? {} : { background }),
        }}
      />
      {isReady ? null : (
        <div
          role="status"
          className="border-t border-border px-2 py-1 text-xs text-muted-foreground"
        >
          Opening the editor…
        </div>
      )}
    </div>
  );
}
