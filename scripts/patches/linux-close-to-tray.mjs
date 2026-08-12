import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const CLOSE_TO_TRAY_MARKER = "/* nani-linux:linux-close-to-tray */";
export const CLOSE_TO_TRAY_ANCHOR = 'process.platform==="darwin"&&Ls(d)';
const CLOSE_TO_TRAY_REPLACEMENT =
  '(process.platform==="darwin"||process.platform==="linux")&&Ls(d)' +
  CLOSE_TO_TRAY_MARKER;

export default definePatch({
  id: "linux-close-to-tray",
  phase: PHASE_MAIN_BUNDLE,
  order: 11,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, CLOSE_TO_TRAY_MARKER);
    if (status) return { source, status };
    return {
      source: replaceExactly(
        source,
        CLOSE_TO_TRAY_ANCHOR,
        CLOSE_TO_TRAY_REPLACEMENT,
        "Linux close-to-tray",
      ),
      status: "applied",
    };
  },
});
