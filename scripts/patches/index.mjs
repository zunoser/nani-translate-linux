import disableUpdater from "./disable-updater.mjs";
import linuxOnboarding from "./linux-onboarding.mjs";
import linuxTray from "./linux-tray.mjs";
import ocrStub from "./ocr-stub.mjs";
import pruneNonLinux from "./prune-non-linux.mjs";
import xdgAutostart from "./xdg-autostart.mjs";

export const corePatchDescriptors = [
  pruneNonLinux,
  ocrStub,
  linuxOnboarding,
  linuxTray,
  disableUpdater,
  xdgAutostart,
];
