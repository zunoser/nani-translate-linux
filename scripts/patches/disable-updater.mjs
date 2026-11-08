import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus } from "./lib.mjs";

import { pattern, uniqueMatch, replaceMatch } from "./semantic.mjs";

export const UPDATER_MARKER = "/* nani-linux:disable-updater */";

export default definePatch({
  id: "disable-updater",
  phase: PHASE_MAIN_BUNDLE,
  order: 20,
  required: true,
  apply({ source }) {
    const status = markerStatus(source, UPDATER_MARKER);
    if (status) return { source, status };
    const enabled = uniqueMatch(source, pattern('const {{flag}}=process.platform!=="win32",{{session}}={{factory}}({checkForUpdates:async()=>{const {{result}}=await {{updater}}.autoUpdater.checkForUpdates();'), "updater platform predicate");
    let patched = replaceMatch(source, enabled,
      enabled[0].replace('process.platform!=="win32"', 'process.platform==="darwin"' + UPDATER_MARKER));
    const handlers = uniqueMatch(patched, pattern('checkForUpdates:{{check}},checkForUpdatesSilent:{{silent}},quitAndInstall:{{quit}},ensureUpdateDownloaded:{{download}},'), "updater IPC handlers");
    // Keep the upstream return contracts for silent/download/quit. Their
    // existing platform predicate now excludes Linux too.
    patched = replaceMatch(patched, handlers, handlers[0].replace(
      `checkForUpdates:${handlers.groups.check},`,
      `checkForUpdates:process.platform==="linux"?async()=>void 0:${handlers.groups.check},`,
    ));
    return { source: patched, status: "applied" };
  },
});
