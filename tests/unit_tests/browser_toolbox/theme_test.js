// SPDX-License-Identifier: GPL-3.0-or-later
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/theme.js";

context("BrowserToolboxTheme", () => {
  should("resolve supported themes and fall back to sage-mist", () => {
    const api = globalThis.BrowserToolboxTheme;
    assert.equal("sage-mist", api.resolveTheme());
    assert.equal("sage-mist", api.resolveTheme("unknown-theme"));
    for (const theme of ["sage-mist", "cobalt", "paper-ink", "slate"]) {
      assert.equal(theme, api.resolveTheme(theme));
      const lightPalette = api.getPalette(theme, false);
      const darkPalette = api.getPalette(theme, true);
      assert.isTrue(typeof lightPalette.trail === "string" && lightPalette.trail.length > 0);
      assert.isTrue(typeof darkPalette.trail === "string" && darkPalette.trail.length > 0);
      assert.isTrue(lightPalette.bg !== darkPalette.bg);
    }
  });

  should("apply data-bt-theme attribute on documentElement", () => {
    const api = globalThis.BrowserToolboxTheme;
    const mockDoc = {
      documentElement: {
        dataset: {},
      },
    };
    assert.equal("paper-ink", api.applyTheme("paper-ink", mockDoc));
    assert.equal("paper-ink", mockDoc.documentElement.dataset.btTheme);
    assert.equal("sage-mist", api.applyTheme("invalid", mockDoc));
    assert.equal("sage-mist", mockDoc.documentElement.dataset.btTheme);
  });

  should("read stored theme preferring local over sync fallback", async () => {
    const api = globalThis.BrowserToolboxTheme;
    const prevChrome = globalThis.chrome;
    const prevRepo = globalThis.BrowserToolboxSettingsRepositoryInstance;
    const prevStorage = globalThis.BrowserToolboxSettingsStorageInstance;
    try {
      globalThis.BrowserToolboxSettingsRepositoryInstance = null;
      globalThis.BrowserToolboxSettingsStorageInstance = null;
      globalThis.chrome = {
        storage: {
          local: {
            get: async () => ({
              browserToolboxSettings: {
                general: { theme: "paper-ink" },
              },
            }),
          },
          sync: {
            get: async () => ({
              browserToolboxSettings: {
                general: { theme: "cobalt" },
              },
            }),
          },
        },
      };
      assert.equal("paper-ink", await api.readStoredTheme());

      globalThis.chrome.storage.local.get = async () => ({});
      assert.equal("cobalt", await api.readStoredTheme());
    } finally {
      globalThis.chrome = prevChrome;
      globalThis.BrowserToolboxSettingsRepositoryInstance = prevRepo;
      globalThis.BrowserToolboxSettingsStorageInstance = prevStorage;
    }
  });
});
