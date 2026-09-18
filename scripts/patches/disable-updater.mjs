import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const UPDATER_MARKER = "/* nani-linux:disable-updater */";
export const UPDATER_ENABLE_ANCHOR = 'const fe=process.platform!=="win32"';
export const UPDATER_HANDLERS_ANCHOR = ",xo=We,_o=Qa,Fo=Kn,Po=Xa,Lo=";

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
      `const fe=process.platform==="darwin"${UPDATER_MARKER}`,
      "updater platform predicate",
    );
    patched = replaceExactly(
      patched,
      UPDATER_HANDLERS_ANCHOR,
      ',xo=process.platform==="linux"?async()=>void 0:We,_o=Qa,Fo=Kn,Po=Xa,Lo=',
      "updater IPC handlers",
    );
    return { source: patched, status: "applied" };
  },
});
