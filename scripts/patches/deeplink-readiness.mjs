import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const DEEPLINK_MARKER = "/* nani-linux:deeplink-readiness */";
export const DEEPLINK_ANCHOR =
  'if(t&&e){o.info(`Handling initial deeplink: ${t}`);const n=t;e.webContents.once("did-finish-load",()=>{He(n)})}';
const DEEPLINK_REPLACEMENT =
  'if(t&&e){o.info(`Handling initial deeplink: ${t}`);const n=t;e.webContents.isLoading()?e.webContents.once("did-finish-load",()=>{He(n)}):He(n)}' +
  DEEPLINK_MARKER;

export default definePatch({
  id: "deeplink-readiness",
  phase: PHASE_MAIN_BUNDLE,
  order: 12,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, DEEPLINK_MARKER);
    if (status) return { source, status };
    return {
      source: replaceExactly(
        source,
        DEEPLINK_ANCHOR,
        DEEPLINK_REPLACEMENT,
        "initial deep link readiness",
      ),
      status: "applied",
    };
  },
});
