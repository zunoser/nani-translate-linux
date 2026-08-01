import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { definePatch, PHASE_EXTRACTED_APP } from "./descriptor.mjs";
import { copyTreeContents, relativeFileHashes } from "./lib.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const OCR_STUB_SOURCE = path.resolve(
  moduleDir,
  "../../stubs/@napi-rs/system-ocr-linux-x64-gnu",
);
export const OCR_STUB_RELATIVE = "node_modules/@napi-rs/system-ocr-linux-x64-gnu";

export function verifyOcrStub(extractedDir) {
  const destination = path.join(extractedDir, OCR_STUB_RELATIVE);
  if (!existsSync(destination)) throw new Error("Linux OCR stub is missing after repack");
  const expected = relativeFileHashes(OCR_STUB_SOURCE);
  const actual = relativeFileHashes(destination);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Linux OCR stub differs from the repository stub");
  }
  const packageJson = JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"));
  if (packageJson.name !== "@napi-rs/system-ocr-linux-x64-gnu") {
    throw new Error("Linux OCR stub package name is invalid");
  }
}

export default definePatch({
  id: "ocr-stub",
  phase: PHASE_EXTRACTED_APP,
  order: 10,
  required: true,
  apply({ extractedDir }) {
    const destination = path.join(extractedDir, OCR_STUB_RELATIVE);
    if (existsSync(destination)) {
      verifyOcrStub(extractedDir);
      return { status: "already-applied", detail: OCR_STUB_RELATIVE };
    }
    copyTreeContents(OCR_STUB_SOURCE, destination);
    verifyOcrStub(extractedDir);
    return { status: "applied", detail: OCR_STUB_RELATIVE };
  },
});
