import { definePatch, PHASE_MAIN_BUNDLE } from "./descriptor.mjs";
import { markerStatus, replaceExactly } from "./lib.mjs";

export const AUTOSTART_MARKER = "/* nani-linux:xdg-autostart */";
export const AUTOSTART_GET_ANCHOR = ',vi=(async()=>({autoLaunchEnabled:c.app.getLoginItemSettings().openAtLogin})),Mi="ms-settings:startupapps";';
export const AUTOSTART_SET_ANCHOR = 'const Ti=(async(e,t)=>{if(process.platform==="win32")return await ki();try{return c.app.setLoginItemSettings({openAtLogin:t}),{ok:!0}}catch(n){return{ok:!1,message:n instanceof Error?n.message:"Unknown error"}}})';
export const AUTOSTART_SYNC_ANCHOR = 'hc(),Li(),to(),c.app.on("browser-window-created"';

const AUTOSTART_GET_REPLACEMENT = String.raw`,$naniAutostartPath=()=>v.join(process.env.XDG_CONFIG_HOME||v.join(c.app.getPath("home"),".config"),"autostart","nani.desktop"),$naniDesktopQuote=e=>'"'+e.replace(/([\"\u0060$])/g,"\\$1")+'"',$naniGetAutostart=async()=>se.access($naniAutostartPath()).then(()=>!0,()=>!1),$naniSetAutostart=async e=>{const t=$naniAutostartPath();if(!e)return await se.rm(t,{force:!0}),{ok:!0};const n=process.env.NANI_LAUNCHER_PATH;if(!n||!v.isAbsolute(n)||/[\r\n]/.test(n))return{ok:!1,message:"NANI_LAUNCHER_PATH must be an absolute path"};await se.mkdir(v.dirname(t),{recursive:!0});const r=t+".tmp-"+process.pid+"-"+Date.now(),a="[Desktop Entry]\nType=Application\nName=Nani Translate\nExec="+$naniDesktopQuote(n)+" --autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n";try{return await se.writeFile(r,a,{mode:420}),await se.rename(r,t),{ok:!0}}finally{await se.rm(r,{force:!0}).catch(()=>{})}},$naniSyncAutostart=async()=>{await $naniGetAutostart()&&await $naniSetAutostart(!0)},vi=(async()=>process.platform==="linux"?({autoLaunchEnabled:await $naniGetAutostart()}):({autoLaunchEnabled:c.app.getLoginItemSettings().openAtLogin}))` + AUTOSTART_MARKER + ',Mi="ms-settings:startupapps";';

const AUTOSTART_SET_REPLACEMENT = 'const Ti=(async(e,t)=>{if(process.platform==="win32")return await ki();try{return process.platform==="linux"?await $naniSetAutostart(t):(c.app.setLoginItemSettings({openAtLogin:t}),{ok:!0})}catch(n){return{ok:!1,message:n instanceof Error?n.message:"Unknown error"}}})';

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
      'hc(),Li(),to(),process.platform==="linux"&&await $naniSyncAutostart(),c.app.on("browser-window-created"',
      "XDG autostart launcher sync",
    );
    return { source: patched, status: "applied" };
  },
});
