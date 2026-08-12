import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const UPDATER_MARKER = "/* nani-linux:disable-updater */";
export const UPDATER_ENABLE_ANCHOR = 'const ge=process.platform!=="win32"';
export const UPDATER_HANDLERS_ANCHOR = ",so=qe,oo=Ia,io=Un,co=Ea,lo=";

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
      `const ge=process.platform==="darwin"${UPDATER_MARKER}`,
      "updater platform predicate",
    );
    patched = replaceExactly(
      patched,
      UPDATER_HANDLERS_ANCHOR,
      ',so=process.platform==="linux"?async()=>void 0:qe,oo=Ia,io=Un,co=Ea,lo=',
      "updater IPC handlers",
    );
    return { source: patched, status: "applied" };
  },
});
