// bb-plugin-diff-editor — backend entry.
//
// So far the server does one thing: lease the browser the Monaco bundle that
// `dist/app.js` deliberately does not contain. The resolve/read/write RPC
// arrives once there is something to save.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const ASSET_LEASE_TTL_MS = 60 * 60 * 1000;

// Re-lease early rather than hand out a lease that expires mid-import. A
// 4 MB module fetch on a slow disk is not instant, and the failure would be
// a 404 partway through loading the editor.
const ASSET_LEASE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const rpcContract = defineRpcContract({
  assets: {
    input: z.null(),
    output: z.object({ baseUrl: z.string(), expiresAtMs: z.number() }),
  },
});

/**
 * `dist/monaco/` is committed, not built here.
 *
 * bb installs a git plugin's dependencies with `--ignore-scripts
 * --omit=dev --omit=optional`, and esbuild resolves its native binary
 * through an optional dependency plus a postinstall — so esbuild is not
 * merely likely to be absent on someone else's machine, it cannot be there.
 * `npm run build:monaco` is a maintainer's job and its output ships in git
 * and in the npm tarball.
 *
 * `bb plugin build` writes three named artifacts into `dist/` and deletes
 * only its own temp directory, so the committed bundle survives alongside
 * them.
 */
function monacoBundleDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // Built, this file is `dist/server.js`; unbundled it is `server.ts` at the
  // root. Either way the bundle is `<plugin root>/dist/monaco`.
  const pluginRoot = existsSync(path.join(moduleDir, "package.json"))
    ? moduleDir
    : path.dirname(moduleDir);
  return path.join(pluginRoot, "dist", "monaco");
}

export default async function plugin(bb: BbPluginApi) {
  let lease: { baseUrl: string; expiresAtMs: number } | null = null;

  bb.rpc.register(rpcContract, {
    async assets() {
      if (
        lease !== null &&
        lease.expiresAtMs - Date.now() > ASSET_LEASE_REFRESH_MARGIN_MS
      ) {
        return lease;
      }
      const rootPath = monacoBundleDir();
      if (!existsSync(path.join(rootPath, "editor.js"))) {
        throw new Error(
          `this install of diff-editor has no Monaco bundle at ${rootPath} — ` +
            "it is committed, so an install missing it is a packaging bug " +
            "(from a source checkout, run `npm run build:monaco`)",
        );
      }
      lease = await bb.sdk.files.createPreview({
        rootPath,
        ttlMs: ASSET_LEASE_TTL_MS,
      });
      return lease;
    },
  });
}
