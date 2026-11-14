globalThis.vimiumDomTestsAreRunning = true;

import * as shoulda from "../vendor/shoulda.js";

// Attach shoulda's functions -- like setup, context, should -- to the global namespace.
Object.assign(globalThis, shoulda);
globalThis.shoulda = shoulda;

globalThis.domTestInitialization = new Promise((resolve, reject) =>
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      isEnabledForUrl = true;
      await Utils.populateBrowserInfo();
      await Settings.onLoaded();
      await HUD.init();
      resolve();
    } catch (error) {
      reject(error);
    }
  })
);
