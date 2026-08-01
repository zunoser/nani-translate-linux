import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const resolver = path.resolve("scripts/lib/resolve-upstream.mjs");

function withManifest(content, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "nani-manifest-test-"));
  try {
    const manifest = path.join(directory, "latest-mac.yml");
    writeFileSync(manifest, content);
    return callback(manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("selects the DMG entry instead of the updater primary zip", () => {
  withManifest(
    [
      "version: 1.1.0",
      "files:",
      "  - url: Nani-1.1.0-arm64-mac.zip",
      "    sha512: zip-hash",
      "  - url: nani-1.1.0.dmg",
      "    sha512: dmg-hash",
      "path: Nani-1.1.0-arm64-mac.zip",
      "sha512: zip-hash",
      "",
    ].join("\n"),
    (manifest) => {
      const result = spawnSync(process.execPath, [resolver, manifest, "https://cdn.example/artifacts/latest-mac.yml"], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.stdout,
        "1.1.0\thttps://cdn.example/artifacts/nani-1.1.0.dmg\tdmg-hash\tnani-1.1.0.dmg\n",
      );
    },
  );
});

test("rejects ambiguous DMG entries", () => {
  withManifest(
    "version: 1\nfiles:\n  - {url: one.dmg, sha512: a}\n  - {url: two.dmg, sha512: b}\n",
    (manifest) => {
      const result = spawnSync(process.execPath, [resolver, manifest, "https://cdn.example/latest.yml"], {
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /expected exactly one DMG/);
    },
  );
});

test("rejects a non-HTTPS resolved URL", () => {
  withManifest(
    "version: '1'\nfiles:\n  - {url: http://cdn.example/nani.dmg, sha512: a}\n",
    (manifest) => {
      const result = spawnSync(process.execPath, [resolver, manifest, "https://cdn.example/latest.yml"], {
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must use HTTPS/);
    },
  );
});
