import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/regex_safety.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/settings_validator.js";
import "../../../lib/browser_toolbox/site_rule_matcher.js";
import "../../../lib/browser_toolbox/settings_policy.js";
import "../../../background_scripts/browser_toolbox/command_registry_adapter.js";
import "../../../background_scripts/browser_toolbox/settings_migrations.js";
import "../../../background_scripts/browser_toolbox/settings_storage.js";
import "../../../background_scripts/browser_toolbox/vimium_settings_adapter.js";
import "../../../background_scripts/browser_toolbox/settings_repository.js";

context("Settings repository", () => {
  async function clearStorage() {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    chrome.storage.onChanged.func = undefined;
  }

  should("load migrated defaults and return defensive clones", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    const beforeLoad = repository.getSettings();
    beforeLoad.general.enabled = false;
    assert.isTrue(repository.getSettings().general.enabled);

    const loaded = await repository.load(BrowserToolboxCommandRegistry);
    assert.equal(7, loaded.schemaVersion);
    assert.isTrue(loaded.general.enabled);
    assert.isTrue(repository.listenerInstalled);
    assert.equal(
      {},
      (await chrome.storage.local.get("browserToolboxSettingsMigrationBackup"))[
        "browserToolboxSettingsMigrationBackup"
      ],
    );
    assert.equal(
      7,
      (await chrome.storage.sync.get("browserToolboxSettings"))["browserToolboxSettings"]
        .schemaVersion,
    );
    assert.equal(repository.settings, await repository.ensureLoaded(BrowserToolboxCommandRegistry));
    repository.installListener(BrowserToolboxCommandRegistry);
  });

  should("ignore object key order when deciding whether to create a backup", async () => {
    await clearStorage();
    const defaults = BrowserToolboxSettingsSchema.clone(
      BrowserToolboxSettingsSchema.DEFAULT_SETTINGS,
    );
    const reordered = Object.fromEntries(Object.entries(defaults).reverse());
    await chrome.storage.sync.set({ browserToolboxSettings: reordered });

    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);

    const local = await chrome.storage.local.get("browserToolboxSettingsMigrationBackup");
    assert.equal(undefined, local.browserToolboxSettingsMigrationBackup);
  });

  should("move a migrated sync-disabled configuration into local storage", async () => {
    await clearStorage();
    await chrome.storage.sync.set({
      browserToolboxSettings: { general: { browserSyncEnabled: false } },
    });

    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);

    assert.equal("local", repository.storageArea);
    assert.isFalse(repository.getSettings().general.browserSyncEnabled);
    assert.equal(
      undefined,
      (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
    );
    assert.isFalse(
      (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings.general
        .browserSyncEnabled,
    );
  });

  should("deduplicate concurrent initial loads in one context", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    const originalGet = chrome.storage.sync.get;
    let readCount = 0;
    chrome.storage.sync.get = async function (...args) {
      // 只统计一次初始化所需的规范/旧键联合读取；写入失败回滚会额外读取目标键。
      if (Array.isArray(args[0]) && args[0].includes("openKeyMouseSettings")) readCount++;
      await Promise.resolve();
      return originalGet.apply(this, args);
    };
    try {
      const [first, second] = await Promise.all([
        repository.ensureLoaded(BrowserToolboxCommandRegistry),
        repository.ensureLoaded(BrowserToolboxCommandRegistry),
      ]);
      assert.isTrue(first === second);
      assert.equal(1, readCount);
    } finally {
      chrome.storage.sync.get = originalGet;
    }
  });

  should("read the canonical locale before the legacy locale", async () => {
    await clearStorage();
    await chrome.storage.sync.set({
      browserToolboxSettings: { general: { language: "zh_CN" } },
      openKeyMouseSettings: { general: { language: "en" } },
    });
    const repository = new BrowserToolboxSettingsRepository();
    assert.equal("zh_CN", await repository.getStoredLocale());
  });

  should("fall back to the legacy locale inside the repository", async () => {
    await clearStorage();
    await chrome.storage.sync.set({ openKeyMouseSettings: { general: { language: "en" } } });
    const repository = new BrowserToolboxSettingsRepository();
    assert.equal("en", await repository.getStoredLocale());
  });

  should("refresh Vimium search engines before reading them", async () => {
    const calls = [];
    const repository = new BrowserToolboxSettingsRepository({}, {
      async load() {
        calls.push("load");
      },
      get(name) {
        calls.push(name);
        return name === "searchEngines" ? "local: https://example.com/search?q=%s Local" : null;
      },
    });
    assert.equal(
      "local: https://example.com/search?q=%s Local",
      await repository.getSearchEngines(),
    );
    assert.equal(["load", "searchEngines"], calls);
  });

  should("apply sync, session, site and Vimium exclusion state", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);
    const events = [];
    const listener = (settings) => events.push(settings);
    repository.addEventListener(listener);

    const next = BrowserToolboxSettingsSchema.clone(
      BrowserToolboxSettingsSchema.DEFAULT_SETTINGS,
    );
    next.siteRules = [{
      pattern: "^https://example\\.com/.*$",
      matchType: "regex",
      modules: { mouse: false },
    }];
    next.exclusionRules = [{ pattern: "https://example.com/*", passKeys: "" }];
    await chrome.storage.sync.set({ browserToolboxSettings: next });
    await chrome.storage.session.set({
      browserToolboxSessionOverrides: { mouse: true, cursor: false, ignored: true },
    });
    const originalSettings = globalThis.Settings;
    globalThis.Settings = undefined;
    try {
      const effective = repository.getEffectiveSettings("https://example.com/page");
      assert.isTrue(effective.effectiveModules.mouse);
      assert.isFalse(effective.effectiveModules.keyboard);
      assert.isFalse(effective.effectiveModules.cursor);
      assert.isTrue(events.length >= 2);

      globalThis.Settings = {
        isLoaded: () => true,
        get: () => [{ pattern: "https://example.com/*", passKeys: "j" }],
      };
      assert.isTrue(
        repository.getEffectiveSettings("https://example.com/page").effectiveModules.keyboard,
      );

      globalThis.Settings = {
        isLoaded: () => {
          throw new Error("not ready");
        },
      };
      assert.isFalse(
        repository.getEffectiveSettings("https://example.com/page").effectiveModules.keyboard,
      );
    } finally {
      globalThis.Settings = originalSettings;
    }
    repository.removeEventListener(listener);
  });

  should("make the global enabled flag override every module", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);
    await repository.update((settings) => {
      settings.general.enabled = false;
      return settings;
    }, BrowserToolboxCommandRegistry);
    await repository.setSessionOverrides({ mouse: true, keyboard: true });
    const modules = repository.getEffectiveSettings("https://example.com/").effectiveModules;
    assert.isFalse(modules.enabled);
    for (const name of BrowserToolboxModuleRegistry.ids({ siteRule: true })) {
      assert.isFalse(modules[name]);
    }
  });

  should("migrate legacy storage keys without deleting the source values", async () => {
    await clearStorage();
    const legacy = BrowserToolboxSettingsSchema.clone(
      BrowserToolboxSettingsSchema.DEFAULT_SETTINGS,
    );
    legacy.mouse.bindings[11].commandName = "OpenKeyMouse.newWindow";
    await chrome.storage.sync.set({ openKeyMouseSettings: legacy });
    await chrome.storage.session.set({
      openKeyMouseSessionOverrides: { mouse: false },
    });

    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);

    assert.equal(
      "BrowserToolbox.newWindow",
      repository.getSettings().mouse.bindings[11].commandName,
    );
    assert.equal({ mouse: false }, repository.sessionOverrides);
    assert.equal(
      "BrowserToolbox.newWindow",
      (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings.mouse
        .bindings[11].commandName,
    );
    assert.equal(
      legacy,
      (await chrome.storage.sync.get("openKeyMouseSettings")).openKeyMouseSettings,
    );
    assert.equal(
      { mouse: false },
      (await chrome.storage.session.get("browserToolboxSessionOverrides"))
        .browserToolboxSessionOverrides,
    );
    assert.equal(
      legacy,
      (await chrome.storage.local.get("browserToolboxSettingsMigrationBackup"))
        .browserToolboxSettingsMigrationBackup,
    );
  });

  should("clear a migrated legacy session override without restoring it on reload", async () => {
    await clearStorage();
    await chrome.storage.session.set({ openKeyMouseSessionOverrides: { mouse: false } });

    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);
    await repository.clearSessionOverrides();

    assert.equal({}, repository.sessionOverrides);
    const stored = await chrome.storage.session.get([
      "browserToolboxSessionOverrides",
      "openKeyMouseSessionOverrides",
    ]);
    assert.equal(undefined, stored.browserToolboxSessionOverrides);
    assert.equal(undefined, stored.openKeyMouseSessionOverrides);
    assert.isTrue(
      repository.getEffectiveSettings("https://example.com/").effectiveModules.mouse,
    );
  });

  should("persist validated settings and session overrides", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);
    let eventCount = 0;
    const listener = () => eventCount++;
    repository.addEventListener(listener);

    const updated = await repository.update((settings) => {
      settings.general.enabled = false;
    }, BrowserToolboxCommandRegistry);
    assert.isFalse(updated.general.enabled);
    const withCursor = await repository.update((settings) => {
      settings.cursor.enabled = true;
      return settings;
    }, BrowserToolboxCommandRegistry);
    assert.isTrue(withCursor.cursor.enabled);
    assert.isTrue(eventCount >= 2);

    const oversized = BrowserToolboxSettingsSchema.clone(withCursor);
    oversized.keyboard.keyMappings = "x".repeat(101 * 1024);
    let oversizedError = false;
    try {
      await repository.setSettings(oversized, BrowserToolboxCommandRegistry);
    } catch (_) {
      oversizedError = true;
    }
    assert.isTrue(oversizedError);

    let invalidError = false;
    try {
      await repository.setSessionOverrides({ mouse: "yes" });
    } catch (_) {
      invalidError = true;
    }
    assert.isTrue(invalidError);
    await repository.setSessionOverrides({ mouse: false, cursor: true });
    assert.equal({ mouse: false, cursor: true }, repository.sessionOverrides);
    await repository.clearSessionOverrides();
    assert.equal({}, repository.sessionOverrides);
    repository.removeEventListener(listener);
  });

  should(
    "toggle the configured storage area without leaving a duplicate canonical value",
    async () => {
      await clearStorage();
      const repository = new BrowserToolboxSettingsRepository();
      await repository.load(BrowserToolboxCommandRegistry);

      await repository.update((settings) => {
        settings.general.browserSyncEnabled = false;
        return settings;
      }, BrowserToolboxCommandRegistry);
      assert.equal(
        undefined,
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.isFalse(
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings.general
          .browserSyncEnabled,
      );

      await repository.update((settings) => {
        settings.general.browserSyncEnabled = true;
        return settings;
      }, BrowserToolboxCommandRegistry);
      assert.equal(
        undefined,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.isTrue(
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings.general
          .browserSyncEnabled,
      );
      // 存储 change 监听是异步的；等待它处理跨区域写入的过渡事件，确认旧值不会写回。
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(
        undefined,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.isTrue(
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings.general
          .browserSyncEnabled,
      );
    },
  );

  should("expose local asset access through the repository facade", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    const asset = "data:image/png;base64,AA==";
    await repository.writeLocalAsset("browserToolboxCursor-test", asset);
    assert.equal(asset, await repository.readLocalAsset("browserToolboxCursor-test"));
    await repository.removeLocalAsset("browserToolboxCursor-test");
    assert.equal(undefined, await repository.readLocalAsset("browserToolboxCursor-test"));
  });

  should("keep the last valid memory snapshot when storage write fails", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);
    const before = repository.getSettings();
    const originalSet = chrome.storage.sync.set;
    chrome.storage.sync.set = async () => {
      throw new Error("simulated storage failure");
    };
    try {
      let failed = false;
      try {
        await repository.update((settings) => {
          settings.general.enabled = false;
        }, BrowserToolboxCommandRegistry);
      } catch (error) {
        failed = error.message === "simulated storage failure";
      }
      assert.isTrue(failed);
      assert.equal(before, repository.getSettings());
    } finally {
      chrome.storage.sync.set = originalSet;
    }
  });

  should("keep session overrides when clearing storage fails", async () => {
    await clearStorage();
    const repository = new BrowserToolboxSettingsRepository();
    await repository.load(BrowserToolboxCommandRegistry);
    await repository.setSessionOverrides({ mouse: false });
    const originalRemove = chrome.storage.session.remove;
    chrome.storage.session.remove = async () => {
      throw new Error("simulated session clear failure");
    };
    try {
      let failed = false;
      try {
        await repository.clearSessionOverrides();
      } catch (error) {
        failed = error.message === "simulated session clear failure";
      }
      assert.isTrue(failed);
      assert.equal({ mouse: false }, repository.sessionOverrides);
    } finally {
      chrome.storage.session.remove = originalRemove;
    }
  });

  should("restore raw settings when migration or validation fails", async () => {
    await clearStorage();
    const raw = { schemaVersion: 99, unexpected: "preserve" };
    await chrome.storage.sync.set({ browserToolboxSettings: raw });
    const repository = new BrowserToolboxSettingsRepository();
    let failed = false;
    try {
      await repository.load(BrowserToolboxCommandRegistry);
    } catch (error) {
      failed = error.message.includes("Unsupported schema version");
    }
    assert.isTrue(failed);
    assert.equal(
      raw,
      (await chrome.storage.sync.get("browserToolboxSettings"))["browserToolboxSettings"],
    );
  });
});
