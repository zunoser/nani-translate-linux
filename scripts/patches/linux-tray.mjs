import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const TRAY_MARKER = "/* nani-linux:linux-tray */";
export const TRAY_ANCHOR = 'function Ls(e){if(!it()&&process.platform==="win32"){const t=new c.Tray(S.join(__dirname,"../../resources/tray-icon-win.ico"));Kn(t),Ce(t,e);return}Ce(null,e)}';
const TRAY_REPLACEMENT = `function Ls(e){${TRAY_MARKER}if(!it()&&(process.platform==="win32"||process.platform==="linux")){const t=new c.Tray(process.platform==="linux"?c.nativeImage.createFromPath(S.join(__dirname,"../../resources/icon.png")).resize({width:24,height:24}):S.join(__dirname,"../../resources/tray-icon-win.ico"));Kn(t),Ce(t,e);return}Ce(null,e)}`;

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
