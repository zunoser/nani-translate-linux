import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const TRAY_MARKER = "/* nani-linux:linux-tray */";
export const TRAY_ANCHOR = 'function Is(e){if(!lt()&&process.platform==="win32"){const t=new c.Tray(v.join(__dirname,"../../resources/tray-icon-win.ico"));Jn(t),xe(t,e);return}xe(null,e)}';
const TRAY_REPLACEMENT = `function Is(e){${TRAY_MARKER}if(!lt()&&(process.platform==="win32"||process.platform==="linux")){const t=new c.Tray(process.platform==="linux"?c.nativeImage.createFromPath(v.join(__dirname,"../../resources/icon.png")).resize({width:24,height:24}):v.join(__dirname,"../../resources/tray-icon-win.ico"));Jn(t),xe(t,e);return}xe(null,e)}`;

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
