import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { definePatch, PHASE_EXTRACTED_APP } from "./descriptor.mjs";

export const NON_LINUX_PAYLOADS = [
  "native/build/Release/maccopy.node",
  "native/build/Release/macos26_window_corner.node",
  "node_modules/@napi-rs/system-ocr-darwin-arm64",
  "node_modules/@nut-tree-fork/libnut-darwin",
  "node_modules/@nut-tree-fork/libnut-win32",
  "node_modules/@nut-tree-fork/node-mac-permissions",
  "bin/language-helper",
];

export function verifyNonLinuxPayloadsAbsent(root) {
  const remaining = NON_LINUX_PAYLOADS.filter((relativePath) =>
    existsSync(path.join(root, relativePath)),
  );
  if (remaining.length > 0) {
    throw new Error(`Non-Linux payloads remain: ${remaining.join(", ")}`);
  }
}

export function verifyNonLinuxHeaderEntries(entries) {
  const normalized = entries.map((entry) => entry.replace(/^\//, ""));
  const remaining = NON_LINUX_PAYLOADS.filter((forbidden) =>
    normalized.some((entry) => entry === forbidden || entry.startsWith(`${forbidden}/`)),
  );
  if (remaining.length > 0) {
    throw new Error(`Non-Linux payloads remain in ASAR header: ${remaining.join(", ")}`);
  }
}

export default definePatch({
  id: "prune-non-linux",
  phase: PHASE_EXTRACTED_APP,
  order: 5,
  required: true,
  apply({ extractedDir }) {
    const removed = [];
    for (const relativePath of NON_LINUX_PAYLOADS) {
      const target = path.join(extractedDir, relativePath);
      if (!existsSync(target)) continue;
      rmSync(target, { recursive: true, force: true });
      removed.push(relativePath);
    }
    verifyNonLinuxPayloadsAbsent(extractedDir);
    return {
      status: removed.length > 0 ? "applied" : "already-applied",
      detail: removed.length > 0 ? `removed ${removed.length} non-Linux payloads` : undefined,
    };
  },
});
