import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { normalizeDescriptors, PHASE_EXTRACTED_APP, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";

function reportEntry(descriptor, status, detail = null) {
  return {
    id: descriptor.id,
    phase: descriptor.phase,
    order: descriptor.order,
    required: descriptor.required,
    status,
    ...(detail ? { detail } : {}),
  };
}

function validateResult(descriptor, result) {
  if (result == null || typeof result !== "object") {
    throw new Error(`Patch '${descriptor.id}' returned no result`);
  }
  if (result.status !== "applied" && result.status !== "already-applied") {
    throw new Error(`Patch '${descriptor.id}' returned invalid status '${result.status}'`);
  }
  if (descriptor.phase === PHASE_MAIN_BUNDLE && typeof result.source !== "string") {
    throw new Error(`Main-bundle patch '${descriptor.id}' must return source`);
  }
  return result;
}

export function runPatchDescriptors({ extractedDir, mainBundlePath, descriptors }) {
  const ordered = normalizeDescriptors(descriptors);
  const entries = [];
  let mainSource = readFileSync(mainBundlePath, "utf8");
  let hasRequiredFailure = false;
  let hasIntegrityFailure = false;

  for (const descriptor of ordered) {
    const snapshot = descriptor.phase === PHASE_EXTRACTED_APP
      ? `${extractedDir}.rollback-${descriptor.id}`
      : mainSource;

    try {
      if (descriptor.phase === PHASE_EXTRACTED_APP) {
        rmSync(snapshot, { recursive: true, force: true });
        cpSync(extractedDir, snapshot, { recursive: true, dereference: false });
      }

      const result = validateResult(
        descriptor,
        descriptor.apply(
          descriptor.phase === PHASE_MAIN_BUNDLE
            ? { extractedDir, mainBundlePath, source: mainSource }
            : { extractedDir, mainBundlePath },
        ),
      );
      if (descriptor.phase === PHASE_MAIN_BUNDLE) mainSource = result.source;
      entries.push(reportEntry(descriptor, result.status, result.detail));
    } catch (error) {
      try {
        if (descriptor.phase === PHASE_EXTRACTED_APP && existsSync(snapshot)) {
          rmSync(extractedDir, { recursive: true, force: true });
          cpSync(snapshot, extractedDir, { recursive: true, dereference: false });
        }
      } catch (rollbackError) {
        hasIntegrityFailure = true;
        entries.push(reportEntry(
          descriptor,
          "failed-integrity",
          `${error.message}; rollback failed: ${rollbackError.message}`,
        ));
        continue;
      }

      const status = descriptor.required ? "failed-required" : "skipped-optional";
      if (descriptor.required) hasRequiredFailure = true;
      entries.push(reportEntry(descriptor, status, error instanceof Error ? error.message : String(error)));
    } finally {
      if (descriptor.phase === PHASE_EXTRACTED_APP) {
        rmSync(snapshot, { recursive: true, force: true });
      }
    }
  }

  if (!hasRequiredFailure && !hasIntegrityFailure) {
    writeFileSync(mainBundlePath, mainSource);
  }

  return { entries, hasRequiredFailure, hasIntegrityFailure, mainSource };
}

export function addIntegrityFailure(entries, id, detail) {
  entries.push({
    id,
    phase: "post-repack",
    order: 0,
    required: true,
    status: "failed-integrity",
    detail,
  });
}
