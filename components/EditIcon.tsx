// The one icon this plugin draws.
//
// Not `components/ui/icon.tsx`: that module carries a map of every icon bb
// uses, and bb shims its own copy of it to a runtime global only for plugins
// that live in its repo. Vendored into a plugin and imported, it is ~110 kB of
// icon paths in `dist/app.js`, parsed at app boot by everyone — including
// everyone who only ever reads diffs, which is the same argument that keeps
// Monaco out of the bundle.
import { HugeiconsIcon } from "@hugeicons/react";
import { Edit02Icon } from "@hugeicons/core-free-icons";

export function EditIcon({ className }: { className?: string }) {
  return (
    <HugeiconsIcon
      icon={Edit02Icon}
      className={className}
      strokeWidth={1.5}
      aria-hidden
    />
  );
}
