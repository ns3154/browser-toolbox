import * as testHelper from "../test_helper.js";
import { ActionPage } from "../../../pages/action.js";

context("BrowserToolbox action page", () => {
  let repository;
  let settings;
  let created;
  const flushEvents = () => new Promise((resolve) => setTimeout(resolve, 0));

  setup(async () => {
    await testHelper.jsdomStub("pages/action.html");
    settings = BrowserToolboxSettingsSchema.clone(BrowserToolboxSettingsSchema.DEFAULT_SETTINGS);
    settings.general.language = "en";
    const listeners = new Set();
    repository = {
      sessionOverrides: {},
      async ensureLoaded() {},
      async getStoredLocale() {
        return "en";
      },
      getSettings() {
        return settings;
      },
      getEffectiveSettings(url) {
        return BrowserToolboxSettingsPolicy.withEffectiveSettings(settings, url, {
          sessionOverrides: this.sessionOverrides,
        });
      },
      async setSessionOverrides(overrides) {
        this.sessionOverrides = overrides;
        for (const listener of listeners) listener();
      },
      async clearSessionOverrides() {
        this.sessionOverrides = {};
        for (const listener of listeners) listener();
      },
      addEventListener(listener) {
        listeners.add(listener);
      },
    };
    created = [];
    stub(globalThis, "BrowserToolboxSettingsRepositoryInstance", repository);
    stub(globalThis, "close", () => {});
    stub(chrome.runtime, "getURL", (path) => `chrome-extension://test/${path}`);
    stub(chrome.tabs, "create", async (tab) => created.push(tab));
    stub(
      chrome.tabs,
      "query",
      async () => [{ id: 7, url: "https://example.com/private?secret=1" }],
    );
    stub(chrome.tabs, "sendMessage", async () => ({}));
  });

  teardown(() => BrowserToolboxI18n.setLocale("auto"));

  should("restore all session overrides and honor saved site rules after pausing", async () => {
    settings.siteRules.push({ pattern: "https://example.com/*", modules: { mouse: false } });
    await ActionPage.init();
    const button = document.querySelector("#browser-toolbox-disable-session");
    button.click();
    await flushEvents();
    assert.equal({ enabled: false }, repository.sessionOverrides);
    assert.isFalse(
      repository.getEffectiveSettings("https://other.example/").effectiveModules.keyboard,
    );
    assert.isFalse(button.disabled);
    assert.isTrue(document.querySelector("#browser-toolbox-toggle-keyboard").disabled);
    button.click();
    await flushEvents();
    assert.equal({}, repository.sessionOverrides);
    assert.isTrue(repository.getEffectiveSettings("https://other.example/").effectiveModules.mouse);
    assert.isFalse(repository.getEffectiveSettings("https://example.com/").effectiveModules.mouse);
    assert.isFalse(document.querySelector("#browser-toolbox-toggle-keyboard").disabled);
    assert.isTrue(document.querySelector("#browser-toolbox-toggle-keyboard").checked);
  });

  should("restore a legacy pause from a restricted page and keep all tools working", async () => {
    repository.sessionOverrides = { enabled: false, mouse: false, keyboard: false, cursor: false };
    stub(chrome.tabs, "query", async () => [{ id: 7, url: "chrome://extensions/" }]);
    stub(chrome.tabs, "sendMessage", async () => {
      throw new Error("No receiver");
    });
    await ActionPage.init();
    assert.equal("block", document.querySelector("#not-enabled-error").style.display);
    assert.equal("flex", document.querySelector("#browser-toolbox-session-controls").style.display);
    assert.isTrue(document.querySelector("#browser-toolbox-open-help").disabled);
    document.querySelector("#browser-toolbox-all-tools").click();
    await flushEvents();
    assert.equal("chrome-extension://test/pages/mouse_options.html#toolsOverview", created[0].url);
    document.querySelector("#browser-toolbox-disable-session").click();
    await flushEvents();
    assert.equal({}, repository.sessionOverrides);
  });

  should("keep a failed restore actionable without losing session overrides", async () => {
    repository.sessionOverrides = { enabled: false };
    stub(repository, "clearSessionOverrides", async () => {
      throw new Error("Storage unavailable");
    });
    await ActionPage.initSessionControls();
    const button = document.querySelector("#browser-toolbox-disable-session");
    button.click();
    await flushEvents();
    assert.equal({ enabled: false }, repository.sessionOverrides);
    assert.isFalse(button.disabled);
    assert.equal(
      BrowserToolboxI18n.message("sessionUpdateFailed"),
      document.querySelector("#browser-toolbox-session-status").textContent,
    );
  });

  should("pass only the site origin to an unsaved site-rule shortcut", async () => {
    ActionPage.initSiteShortcut({
      url: "https://user:password@example.com:8443/private?q=secret#token",
    });
    const button = document.querySelector("#browser-toolbox-manage-site");
    assert.isFalse(button.hidden);
    button.click();
    await flushEvents();
    const url = new URL(created[0].url);
    assert.equal("https://example.com:8443", url.searchParams.get("siteOrigin"));
    assert.equal("#siteRules", url.hash);
    assert.isFalse(created[0].url.includes("private"));
    assert.isFalse(created[0].url.includes("password"));
    assert.isFalse(created[0].url.includes("secret"));
  });

  should("hide the site shortcut for unsupported or invalid URLs", () => {
    for (
      const url of ["chrome://settings/", "file:///tmp/test", "javascript:alert(1)", "invalid"]
    ) {
      ActionPage.initSiteShortcut({ url });
      assert.isTrue(document.querySelector("#browser-toolbox-manage-site").hidden);
    }
  });
});
