// Representative upstream snippets; production matchers must not import these.
export const UPDATER_ENABLE_ANCHOR = 'const fe=process.platform!=="win32",session=factory({checkForUpdates:async()=>{const e=await updater.autoUpdater.checkForUpdates();';
export const UPDATER_HANDLERS_ANCHOR = "checkForUpdates:We,checkForUpdatesSilent:Qa,quitAndInstall:Kn,ensureUpdateDownloaded:Xa,";
export const TRAY_ANCHOR = 'function Xs(e){if(!ft()&&process.platform==="win32"){const t=new c.Tray(k.join(__dirname,"../../resources/tray-icon-win.ico"));rr(t),Fe(t,e);return}Fe(null,e)}';
export const CLOSE_TO_TRAY_ANCHOR = 'function Ys(e){e.on("close",t=>{quitting()||(t.preventDefault(),e.hide())})}process.platform==="darwin"&&Ys(d)';
export const DEEPLINK_ANCHOR =
  'if(t&&e){o.info(`Handling initial deeplink: ${t}`);const n=t;e.webContents.once("did-finish-load",()=>{Ke(n)})}';
export const AUTOSTART_GET_ANCHOR = ',uc=(async()=>({autoLaunchEnabled:c.app.getLoginItemSettings().openAtLogin})),dc="ms-settings:startupapps";';
export const AUTOSTART_SET_ANCHOR = 'const fc=(async(e,t)=>{if(process.platform==="win32")return await pc();try{return c.app.setLoginItemSettings({openAtLogin:t}),{ok:!0}}catch(n){return{ok:!1,message:n instanceof Error?n.message:"Unknown error"}}})';
export const AUTOSTART_SYNC_ANCHOR = 'al(),Sc(),ko(),c.app.on("browser-window-created"';
