import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const UPDATER_MARKER = "/* nani-linux:disable-updater */";
export const UPDATER_ENABLE_ANCHOR = 'const ue=process.platform!=="win32"';
export const UPDATER_HANDLERS_ANCHOR = ",ro=Ue,ao=Ca,so=In,oo=xa,io=";

export default definePatch({
  id: "disable-updater",
  phase: PHASE_MAIN_BUNDLE,
  order: 20,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, UPDATER_MARKER);
    if (status) return { source, status };
    let patched = replaceExactly(
      source,
      UPDATER_ENABLE_ANCHOR,
      `const ue=process.platform==="darwin"${UPDATER_MARKER}`,
      "updater platform predicate",
    );
    patched = replaceExactly(
      patched,
      UPDATER_HANDLERS_ANCHOR,
      ',ro=process.platform==="linux"?async()=>void 0:Ue,ao=Ca,so=process.platform==="linux"?()=>void 0:In,oo=process.platform==="linux"?async()=>!1:xa,io=',
      "updater IPC handlers",
    );
    return { source: patched, status: "applied" };
  },
});
