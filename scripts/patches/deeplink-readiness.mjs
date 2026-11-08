import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus } from "./lib.mjs";

import { pattern, uniqueMatch, replaceMatch } from "./semantic.mjs";

export const DEEPLINK_MARKER = "/* nani-linux:deeplink-readiness */";
const TEMPLATE = 'if({{link}}&&{{window}}){{{logger}}.info(`Handling initial deeplink: ${{{link}}}`);const {{local}}={{link}};{{window}}.webContents.once("did-finish-load",()=>{{{handler}}({{local}})})}';

export default definePatch({
  id: "deeplink-readiness",
  phase: PHASE_MAIN_BUNDLE,
  order: 12,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, DEEPLINK_MARKER);
    if (status) return { source, status };
    const match = uniqueMatch(source, pattern(TEMPLATE), "initial deep link readiness");
    const { window, local, handler } = match.groups;
    const original = `${window}.webContents.once("did-finish-load",()=>{${handler}(${local})})`;
    return {
      source: replaceMatch(source, match, match[0].replace(original,
        `${window}.webContents.isLoading()?${original}:${handler}(${local})`) + DEEPLINK_MARKER),
      status: "applied",
    };
  },
});
