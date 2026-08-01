import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { definePatch, PHASE_EXTRACTED_APP } from "./descriptor.mjs";
import { replaceExactly, walkFiles } from "./lib.mjs";

export const ONBOARDING_MARKER = "/* nani-linux:onboarding */";
export const ONBOARDING_ANCHOR =
  'window.constants.os==="win32"?e("welcomeToWinApp"):e("welcomeToMacApp")';
const ONBOARDING_REPLACEMENT =
  `window.constants.os==="linux"?e("welcomeToLinuxApp")${ONBOARDING_MARKER}:` +
  ONBOARDING_ANCHOR;

const TRANSLATIONS = {
  en: "Welcome to Nani for Linux!",
  ja: "NaniのLinuxアプリへようこそ！",
  ko: "Nani Linux 앱에 오신 걸 환영해요!",
  zh: "欢迎来到 Nani 的 Linux 应用！",
};

function dictionaryPath(root, language) {
  return path.join(
    root,
    "node_modules/repo-lib/dist/dictionaries/default",
    `${language}.mjs`,
  );
}

export function verifyLinuxOnboarding(root) {
  const rendererMatches = walkFiles(path.join(root, "out/renderer/assets"))
    .filter((file) => file.endsWith(".js"))
    .filter((file) => readFileSync(file, "utf8").includes(ONBOARDING_MARKER));
  if (rendererMatches.length !== 1) {
    throw new Error(`Expected one Linux onboarding renderer marker, found ${rendererMatches.length}`);
  }
  for (const [language, translation] of Object.entries(TRANSLATIONS)) {
    const source = readFileSync(dictionaryPath(root, language), "utf8");
    if (!source.includes(`welcomeToLinuxApp:\`${translation}\``)) {
      throw new Error(`Linux onboarding translation is missing: ${language}`);
    }
  }
}

export default definePatch({
  id: "linux-onboarding",
  phase: PHASE_EXTRACTED_APP,
  order: 20,
  required: true,
  apply({ extractedDir }) {
    const rendererFiles = walkFiles(path.join(extractedDir, "out/renderer/assets"))
      .filter((file) => file.endsWith(".js"));
    const marked = rendererFiles.filter((file) =>
      readFileSync(file, "utf8").includes(ONBOARDING_MARKER));
    if (marked.length === 1) {
      verifyLinuxOnboarding(extractedDir);
      return { status: "already-applied" };
    }
    if (marked.length > 0) throw new Error("Linux onboarding patch is partially applied");

    const matches = rendererFiles.filter((file) =>
      readFileSync(file, "utf8").includes(ONBOARDING_ANCHOR));
    if (matches.length !== 1) {
      throw new Error(`Expected one Linux onboarding anchor, found ${matches.length}`);
    }
    const rendererSource = readFileSync(matches[0], "utf8");
    writeFileSync(
      matches[0],
      replaceExactly(rendererSource, ONBOARDING_ANCHOR, ONBOARDING_REPLACEMENT, "Linux onboarding"),
    );

    for (const [language, translation] of Object.entries(TRANSLATIONS)) {
      const file = dictionaryPath(extractedDir, language);
      const source = readFileSync(file, "utf8");
      const anchor = "welcomeToWinApp:";
      writeFileSync(
        file,
        replaceExactly(
          source,
          anchor,
          `welcomeToLinuxApp:\`${translation}\`,${anchor}`,
          `Linux onboarding dictionary (${language})`,
        ),
      );
    }
    verifyLinuxOnboarding(extractedDir);
    return { status: "applied" };
  },
});
