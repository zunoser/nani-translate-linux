import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const TRAY_MARKER = "/* nani-linux:linux-tray */";
export const TRAY_ANCHOR = 'function Xs(e){if(!ft()&&process.platform==="win32"){const t=new c.Tray(k.join(__dirname,"../../resources/tray-icon-win.ico"));rr(t),Fe(t,e);return}Fe(null,e)}';
const TRAY_REPLACEMENT = `function Xs(e){${TRAY_MARKER}if(!ft()&&(process.platform==="win32"||process.platform==="linux")){const t=new c.Tray(process.platform==="linux"?c.nativeImage.createFromPath(k.join(__dirname,"../../resources/icon.png")).resize({width:24,height:24}):k.join(__dirname,"../../resources/tray-icon-win.ico"));rr(t),Fe(t,e);return}Fe(null,e)}`;

export default definePatch({
  id: "linux-tray",
  phase: PHASE_MAIN_BUNDLE,
  order: 10,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, TRAY_MARKER);
    if (status) return { source, status };
    return {
      source: replaceExactly(source, TRAY_ANCHOR, TRAY_REPLACEMENT, "Linux tray"),
      status: "applied",
    };
  },
});
