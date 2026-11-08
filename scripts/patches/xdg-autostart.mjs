import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus } from "./lib.mjs";

import { pattern, uniqueMatch, replaceMatch } from "./semantic.mjs";

export const AUTOSTART_MARKER = "/* nani-linux:xdg-autostart */";

const autostartHelpers = (electron) => String.raw`,$naniAutostartPath=()=>require("node:path").join(process.env.XDG_CONFIG_HOME||require("node:path").join(${electron}.app.getPath("home"),".config"),"autostart","nani.desktop"),$naniDesktopQuote=e=>'"'+e.replace(/(["\u0060$])/g,"\\$1")+'"',$naniGetAutostart=async()=>require("node:fs/promises").access($naniAutostartPath()).then(()=>!0,()=>!1),$naniSetAutostart=async e=>{const t=$naniAutostartPath();if(!e)return await require("node:fs/promises").rm(t,{force:!0}),{ok:!0};const n=process.env.NANI_LAUNCHER_PATH;if(!n||!require("node:path").isAbsolute(n)||/[\r\n]/.test(n))return{ok:!1,message:"NANI_LAUNCHER_PATH must be an absolute path"};await require("node:fs/promises").mkdir(require("node:path").dirname(t),{recursive:!0});const r=t+".tmp-"+process.pid+"-"+Date.now(),a="[Desktop Entry]\nType=Application\nName=Nani Translate\nExec="+$naniDesktopQuote(n)+" --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n";try{return await require("node:fs/promises").writeFile(r,a,{mode:420}),await require("node:fs/promises").rename(r,t),{ok:!0}}finally{await require("node:fs/promises").rm(r,{force:!0}).catch(()=>{})}},$naniSyncAutostart=async()=>{await $naniGetAutostart()&&await $naniSetAutostart(!0)}`;


export default definePatch({
  id: "xdg-autostart",
  phase: PHASE_MAIN_BUNDLE,
  order: 30,
  required: false,
  apply({ source }) {
    const status = markerStatus(source, AUTOSTART_MARKER);
    if (status) return { source, status };
    const getter = uniqueMatch(source, pattern(',{{getter}}=(async()=>({autoLaunchEnabled:{{electron}}.app.getLoginItemSettings().openAtLogin})),{{settings}}="ms-settings:startupapps";'), "XDG autostart getter");
    const setter = uniqueMatch(source, pattern('const {{setter}}=(async({{event}},{{enabled}})=>{if(process.platform==="win32")return await {{openSettings}}();try{return {{electron}}.app.setLoginItemSettings({openAtLogin:{{enabled}}}),{ok:!0}}catch({{error}}){return{ok:!1,message:{{error}} instanceof Error?{{error}}.message:"Unknown error"}}})'), "XDG autostart setter");
    if (getter.groups.electron !== setter.groups.electron) throw new Error("Autostart Electron aliases differ");
    const helpers = autostartHelpers(getter.groups.electron);
    const getReplacement = helpers + getter[0].replace('async()=>({',
      'async()=>process.platform==="linux"?({autoLaunchEnabled:await $naniGetAutostart()}):({');
    let patched = replaceMatch(source, getter, getReplacement + AUTOSTART_MARKER);
    // Re-find after inserting helper code, so offsets refer to the updated source.
    const setMatch = uniqueMatch(patched, pattern('const {{setter}}=(async({{event}},{{enabled}})=>{if(process.platform==="win32")return await {{openSettings}}();try{return {{electron}}.app.setLoginItemSettings({openAtLogin:{{enabled}}}),{ok:!0}}catch({{error}}){return{ok:!1,message:{{error}} instanceof Error?{{error}}.message:"Unknown error"}}})'), "XDG autostart setter");
    const { electron, enabled } = setMatch.groups;
    const native = `${electron}.app.setLoginItemSettings({openAtLogin:${enabled}}),{ok:!0}`;
    patched = replaceMatch(patched, setMatch, setMatch[0].replace(native,
      `process.platform==="linux"?await $naniSetAutostart(${enabled}):(${native})`));
    const sync = uniqueMatch(patched, pattern('{{first}}(),{{second}}(),{{third}}(),{{electron}}.app.on("browser-window-created"'), "XDG autostart launcher sync");
    if (sync.groups.electron !== electron) throw new Error("Autostart lifecycle Electron alias differs");
    patched = replaceMatch(patched, sync, sync[0].replace(`${electron}.app.on(`,
      `process.platform==="linux"&&await $naniSyncAutostart(),${electron}.app.on(`));
    return { source: patched, status: "applied" };
  },
});
