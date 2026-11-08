import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus } from "./lib.mjs";

import { pattern, uniqueMatch, replaceMatch } from "./semantic.mjs";

export const TRAY_MARKER = "/* nani-linux:linux-tray */";
const TRAY_TEMPLATE = 'function {{fn}}({{arg}}){if(!{{disabled}}()&&process.platform==="win32"){const {{tray}}=new {{electron}}.Tray({{path}}.join(__dirname,"../../resources/tray-icon-win.ico"));{{setup}}({{tray}}),{{menu}}({{tray}},{{arg}});return}{{menu}}(null,{{arg}})}';

export default definePatch({
  id: "linux-tray",
  phase: PHASE_MAIN_BUNDLE,
  order: 10,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, TRAY_MARKER);
    if (status) return { source, status };
    const match = uniqueMatch(source, pattern(TRAY_TEMPLATE), "Linux tray");
    const { electron, path: pathAlias } = match.groups;
    const replacement = match[0]
      .replace('process.platform==="win32"', '(process.platform==="win32"||process.platform==="linux")')
      .replace(`${pathAlias}.join(__dirname,"../../resources/tray-icon-win.ico")`,
        `process.platform==="linux"?${electron}.nativeImage.createFromPath(${pathAlias}.join(__dirname,"../../resources/icon.png")).resize({width:24,height:24}):${pathAlias}.join(__dirname,"../../resources/tray-icon-win.ico")`);
    return {
      source: replaceMatch(source, match, replacement + TRAY_MARKER),
      status: "applied",
    };
  },
});
