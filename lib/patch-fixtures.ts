// Patches to test and to compare parsers against.
//
// The git-shaped ones came out of `git diff` rather than being typed, so the
// cases here are what git actually emits — `+N,0` for a deletion, `\ No newline
// at end of file`, CRLF content lines inside an LF-framed patch, trailing
// spaces on a changed line. The rest are shapes that reach the slot from
// somewhere other than git.
//
// `lib/patch.test.ts` asserts what the plugin makes of them, and
// `scripts/verify-patch-parser.mjs` checks that bb's shimmed `@pierre/diffs`
// and the one in devDependencies read them the same way.

export const PATCH_FIXTURES = {
  /** A rename with an edit. The slot only passes the after-side path. */
  rename: `diff --git a/ren.txt b/ren2.txt
similarity index 66%
rename from ren.txt
rename to ren2.txt
index d4e91f6..9a295bf 100644
--- a/ren.txt
+++ b/ren2.txt
@@ -1,3 +1,3 @@
 old1
-old2
+OLD2
 old3
`,

  /** Two hunks, far enough apart that splicing one must not move the other. */
  twoHunks: `diff --git a/multi.txt b/multi.txt
index b64b08c..6f9d749 100644
--- a/multi.txt
+++ b/multi.txt
@@ -1,5 +1,5 @@
 a
-b
+B
 c
 d
 e
@@ -15,6 +15,6 @@ n
 o
 p
 q
-r
+R
 s
 t
`,

  /** The second hunk on its own, for a file that is too short for it. */
  secondHunkOnly: `diff --git a/multi.txt b/multi.txt
--- a/multi.txt
+++ b/multi.txt
@@ -15,6 +15,6 @@
 o
 p
 q
-r
+R
 s
 t
`,

  added: `diff --git a/added.txt b/added.txt
new file mode 100644
index 0000000..b77b4eb
--- /dev/null
+++ b/added.txt
@@ -0,0 +1,2 @@
+x
+y
`,

  /** `@@ -1,3 +0,0 @@` — after-side start 0, count 0. */
  deleted: `diff --git a/del.txt b/del.txt
deleted file mode 100644
index de98044..0000000
--- a/del.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-a
-b
-c
`,

  /** `git diff -U0`: `@@ -5,3 +4,0 @@` removes index 4, not index 3. */
  zeroContextDeletion: `diff --git a/mid.txt b/mid.txt
index 01f84f8..4de8f57 100644
--- a/mid.txt
+++ b/mid.txt
@@ -5,3 +4,0 @@ l4
-l5
-l6
-l7
`,

  noTrailingNewline: `diff --git a/noeol.txt b/noeol.txt
index 3b73b16..304943c 100644
--- a/noeol.txt
+++ b/noeol.txt
@@ -1,2 +1,2 @@
 keep
-was
+now
\\ No newline at end of file
`,

  /**
   * Trailing spaces on the last line, which bb's own `trimEnd()` would eat.
   *
   * Written with escapes rather than as a template literal on purpose: the
   * significant characters are spaces at the ends of lines, and anything that
   * trims trailing whitespace — an editor, a formatter, a patch that went
   * through email — would quietly turn this fixture into a different one that
   * passes for the wrong reason.
   */
  trailingSpaces:
    "diff --git a/space.txt b/space.txt\nindex 4675391..cfd370d 100644\n" +
    "--- a/space.txt\n+++ b/space.txt\n@@ -1,2 +1,2 @@\n x\n-y  \n+z  \n",

  /** As git emits it: CRLF content lines, LF structural lines. */
  crlf:
    "diff --git a/crlf.txt b/crlf.txt\nindex df0aae8..d80977d 100644\n" +
    "--- a/crlf.txt\n+++ b/crlf.txt\n@@ -1,3 +1,3 @@\n c1\r\n-c2\r\n+C2\r\n c3\r\n",

  /** The same diff after bb replaced every CRLF on the way here. */
  crlfFlattened: `diff --git a/crlf.txt b/crlf.txt
--- a/crlf.txt
+++ b/crlf.txt
@@ -1,3 +1,3 @@
 c1
-c2
+C2
 c3
`,

  /** A diff whose only change is the line endings. */
  crlfToLf:
    "diff --git a/crlf.txt b/crlf.txt\n--- a/crlf.txt\n+++ b/crlf.txt\n" +
    "@@ -1,2 +1,2 @@\n-c1\r\n-c2\r\n+c1\n+c2\n",

  /** The shape GitHub's REST patches arrive in. */
  bareHunk: `@@ -1,3 +1,3 @@
 old1
-old2
+OLD2
 old3
`,

  /** A hunk header with no counts, which means one line a side. */
  singleLine: `diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-was
+now
`,

  /**
   * An empty context line that lost its leading space — what a patch looks like
   * after a mail client or a whitespace-trimming editor has been through it.
   * git itself always emits the space, so no ordinary diff lands here.
   */
  malformed:
    "diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n" +
    "@@ -1,3 +1,3 @@\n-was\n+now\n keep\n\n",

  /** A pure rename: no hunks, so it says nothing about the file's contents. */
  pureRename: `diff --git a/a.txt b/b.txt
similarity index 100%
rename from a.txt
rename to b.txt
`,

  twoFiles: `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-b
+B
`,

  notAPatch: "not a patch at all\n",
} as const;
