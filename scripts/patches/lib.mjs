import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export function countOccurrences(source, needle) {
  if (needle.length === 0) throw new Error("Patch needle must not be empty");
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

export function replaceExactly(source, needle, replacement, label) {
  const matches = countOccurrences(source, needle);
  if (matches !== 1) {
    throw new Error(`${label}: expected exactly one semantic anchor, found ${matches}`);
  }
  return source.replace(needle, replacement);
}

export function markerStatus(source, marker) {
  const matches = countOccurrences(source, marker);
  if (matches > 1) throw new Error(`Patch marker '${marker}' occurs ${matches} times`);
  return matches === 1 ? "already-applied" : null;
}

export function copyTreeContents(sourceDir, destinationDir) {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`Replacement tree is not a directory: ${sourceDir}`);
  }
  mkdirSync(destinationDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    cpSync(path.join(sourceDir, entry.name), path.join(destinationDir, entry.name), {
      recursive: true,
      force: true,
      dereference: false,
    });
  }
}

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export function relativeFileHashes(root) {
  return Object.fromEntries(
    walkFiles(root).map((filePath) => [path.relative(root, filePath), sha256File(filePath)]),
  );
}
