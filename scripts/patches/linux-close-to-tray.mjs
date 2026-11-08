import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus } from "./lib.mjs";

import { pattern, uniqueMatch, replaceMatch, escapeRegex } from "./semantic.mjs";

export const CLOSE_TO_TRAY_MARKER = "/* nani-linux:linux-close-to-tray */";


export default definePatch({
  id: "linux-close-to-tray",
  phase: PHASE_MAIN_BUNDLE,
  order: 11,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, CLOSE_TO_TRAY_MARKER);
    if (status) return { source, status };
    const owner = uniqueMatch(source, pattern('function {{fn}}({{window}}){{{window}}.on("close",{{event}}=>{{{quitting}}()||({{event}}.preventDefault(),{{window}}.hide())})}'), "close-to-tray handler");
    const call = uniqueMatch(source, new RegExp(`process\\.platform==="darwin"&&${escapeRegex(owner.groups.fn)}\\([A-Za-z_$][\\w$]*\\)`, "g"), "close-to-tray platform gate");
    return {
      source: replaceMatch(source, call, call[0].replace('process.platform==="darwin"', '(process.platform==="darwin"||process.platform==="linux")') + CLOSE_TO_TRAY_MARKER),
      status: "applied",
    };
  },
});
