import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const AUTOSTART_MARKER = "/* nani-linux:xdg-autostart */";
export const AUTOSTART_GET_ANCHOR = ',uc=(async()=>({autoLaunchEnabled:c.app.getLoginItemSettings().openAtLogin})),dc="ms-settings:startupapps";';
export const AUTOSTART_SET_ANCHOR = 'const fc=(async(e,t)=>{if(process.platform==="win32")return await pc();try{return c.app.setLoginItemSettings({openAtLogin:t}),{ok:!0}}catch(n){return{ok:!1,message:n instanceof Error?n.message:"Unknown error"}}})';
export const AUTOSTART_SYNC_ANCHOR = 'al(),Sc(),ko(),c.app.on("browser-window-created"';

const AUTOSTART_GET_REPLACEMENT = String.raw`,$naniAutostartPath=()=>k.join(process.env.XDG_CONFIG_HOME||k.join(c.app.getPath("home"),".config"),"autostart","nani.desktop"),$naniDesktopQuote=e=>'"'+e.replace(/(["\u0060$])/g,"\\$1")+'"',$naniGetAutostart=async()=>re.access($naniAutostartPath()).then(()=>!0,()=>!1),$naniSetAutostart=async e=>{const t=$naniAutostartPath();if(!e)return await re.rm(t,{force:!0}),{ok:!0};const n=process.env.NANI_LAUNCHER_PATH;if(!n||!k.isAbsolute(n)||/[\r\n]/.test(n))return{ok:!1,message:"NANI_LAUNCHER_PATH must be an absolute path"};await re.mkdir(k.dirname(t),{recursive:!0});const r=t+".tmp-"+process.pid+"-"+Date.now(),a="[Desktop Entry]\nType=Application\nName=Nani Translate\nExec="+$naniDesktopQuote(n)+" --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n";try{return await re.writeFile(r,a,{mode:420}),await re.rename(r,t),{ok:!0}}finally{await re.rm(r,{force:!0}).catch(()=>{})}},$naniSyncAutostart=async()=>{await $naniGetAutostart()&&await $naniSetAutostart(!0)},uc=(async()=>process.platform==="linux"?({autoLaunchEnabled:await $naniGetAutostart()}):({autoLaunchEnabled:c.app.getLoginItemSettings().openAtLogin}))` + AUTOSTART_MARKER + ',dc="ms-settings:startupapps";';

const AUTOSTART_SET_REPLACEMENT = 'const fc=(async(e,t)=>{if(process.platform==="win32")return await pc();try{return process.platform==="linux"?await $naniSetAutostart(t):(c.app.setLoginItemSettings({openAtLogin:t}),{ok:!0})}catch(n){return{ok:!1,message:n instanceof Error?n.message:"Unknown error"}}})';

export default definePatch({
  id: "xdg-autostart",
  phase: PHASE_MAIN_BUNDLE,
  order: 30,
  required: false,
  apply({ source }) {
    const status = markerStatus(source, AUTOSTART_MARKER);
    if (status) return { source, status };
    let patched = replaceExactly(
      source,
      AUTOSTART_GET_ANCHOR,
      AUTOSTART_GET_REPLACEMENT,
      "XDG autostart getter",
    );
    patched = replaceExactly(
      patched,
      AUTOSTART_SET_ANCHOR,
      AUTOSTART_SET_REPLACEMENT,
      "XDG autostart setter",
    );
    patched = replaceExactly(
      patched,
      AUTOSTART_SYNC_ANCHOR,
      'al(),Sc(),ko(),process.platform==="linux"&&await $naniSyncAutostart(),c.app.on("browser-window-created"',
      "XDG autostart launcher sync",
    );
    return { source: patched, status: "applied" };
  },
});
