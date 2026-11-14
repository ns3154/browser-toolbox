import "./test_helper.js";
import "../../lib/settings.js";

context("settings", () => {
  should("旧备份导入请求后台先保存当前配置，不退化为普通提交", async () => {
    const baseline = { ...structuredClone(Settings.defaultOptions), settingsVersion: "2.4.2" };
    let captured;
    stub(Settings, "_settings", baseline);
    stub(globalThis, "BrowserToolboxConfigurationClientInstance", {
      enabled: true,
      async importConfiguration(input) {
        captured = structuredClone(input);
        return { keyboard: baseline };
      },
      async commit() {
        throw new Error("导入不得调用无备份的普通提交");
      },
    });
    await Settings.setSettings({ settingsVersion: "2.4.2", scrollStepSize: 90 }, {
      baseline,
      beforeImport: true,
    });
    assert.equal(90, captured.legacyPatch.scrollStepSize);
    assert.equal(baseline, captured.baseline.keyboard);
  });

  should("导入确认前捕获的基线不能被稍后的页面状态替换", async () => {
    const baseline = { ...structuredClone(Settings.defaultOptions), settingsVersion: "2.4.2" };
    const newer = { ...structuredClone(baseline), scrollStepSize: 88 };
    let submitted;
    stub(Settings, "_settings", newer);
    stub(globalThis, "BrowserToolboxConfigurationClientInstance", {
      enabled: true,
      async commit(input) {
        submitted = structuredClone(input);
        return { keyboard: { ...structuredClone(newer), scrollStepSize: 90 } };
      },
    });
    await Settings.setSettings({ settingsVersion: "2.4.2", scrollStepSize: 90 }, { baseline });
    assert.equal(60, submitted.baseline.keyboard.scrollStepSize);
    assert.equal(90, submitted.legacyPatch.scrollStepSize);
  });

  should("带确认基线的导入在后台不可用时不绕过提交队列", async () => {
    const baseline = { ...structuredClone(Settings.defaultOptions), settingsVersion: "2.4.2" };
    let wrote = false;
    stub(Settings, "_settings", baseline);
    stub(globalThis, "BrowserToolboxConfigurationClientInstance", { enabled: false });
    stub(chrome.storage.sync, "set", () => wrote = true);
    stub(chrome.storage.sync, "remove", () => wrote = true);
    let failure;
    try {
      await Settings.setSettings({ settingsVersion: "2.4.2", scrollStepSize: 90 }, { baseline });
    } catch (caught) {
      failure = caught;
    }
    assert.equal("CONFIGURATION_UNAVAILABLE", failure?.code);
    assert.isFalse(wrote);
  });

  should("标量保持原值，嵌套配置的调用者修改不能写回设置源", () => {
    stub(Settings, "_settings", {
      text: "中文",
      number: 0,
      enabled: false,
      empty: null,
      rules: [{ pattern: "https://synthetic.invalid/*", options: { enabled: true } }],
    });
    assert.equal("中文", Settings.get("text"));
    assert.equal(0, Settings.get("number"));
    assert.equal(false, Settings.get("enabled"));
    assert.equal(null, Settings.get("empty"));
    assert.equal(undefined, Settings.get("missing"));
    const rules = Settings.get("rules");
    rules[0].options.enabled = false;
    rules.push({ pattern: "https://synthetic.invalid/other" });
    assert.equal(
      [{ pattern: "https://synthetic.invalid/*", options: { enabled: true } }],
      Settings.get("rules"),
    );
  });
  context("初次读取合并", () => {
    teardown(async () => {
      await Settings.clear();
    });
    should("多个启动订阅等待同一次读取完成", async () => {
      await Settings.clear();
      let calls = 0, finish;
      stub(Settings, "load", () => {
        calls++;
        return new Promise((resolve) => finish = resolve);
      });
      const first = Settings.onLoaded(), second = Settings.onLoaded();
      assert.equal(1, calls);
      finish();
      await Promise.all([first, second]);
      assert.equal(null, Settings._initialLoading);
    });
    should("首次失败不会锁死后续读取", async () => {
      await Settings.clear();
      let calls = 0;
      stub(Settings, "load", async () => {
        if (++calls === 1) throw new Error("SYNTHETIC_READ_FAILURE");
      });
      const failed = await Promise.allSettled([Settings.onLoaded(), Settings.onLoaded()]);
      assert.equal(["rejected", "rejected"], failed.map((item) => item.status));
      await Settings.onLoaded();
      assert.equal(2, calls);
    });
    should("显式热更新不复用尚未完成的初次读取", async () => {
      await Settings.clear();
      let calls = 0, finish;
      stub(Settings, "load", () => {
        calls++;
        return calls === 1 ? new Promise((resolve) => finish = resolve) : Promise.resolve();
      });
      const initial = Settings.onLoaded();
      await Settings.load();
      assert.equal(2, calls);
      finish();
      await initial;
    });
  });
  context("配置异步通知失败保护", () => {
    teardown(async () => {
      await Settings.clear();
    });
    should("不产生未处理异常，也不以默认值覆盖最后有效配置", async () => {
      await Settings.load();
      const previous = Settings.getSettings();
      stub(Settings, "load", async () => {
        throw Object.assign(new Error("合成错误正文"), { code: "CONFIGURATION_RECOVERY_CONFLICT" });
      });
      await Settings.chromeStorageOnChanged({}, "sync");
      assert.equal(previous, Settings.getSettings());
      assert.equal("CONFIGURATION_RECOVERY_CONFLICT", Settings.lastSettingsErrorCode);
    });
  });
  context("BrowserToolbox pre-release version", () => {
    teardown(async () => {
      await Settings.clear();
    });

    should("keeps Vimium migration version separate from the manifest version", async () => {
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal("2.4.2", settings.settingsVersion);
      assert.equal(Settings.newTabDestinations.vimiumNewTabPage, settings.newTabDestination);
    });
  });

  context("v2.0 migration", () => {
    setup(async () => {
      // Prior to Vimium 2.0.0, the settings values were encoded as JSON strings.
      await chrome.storage.sync.set({ scrollStepSize: JSON.stringify(123) });
    });

    teardown(async () => {
      await Settings.clear();
    });

    should("Run v2.0.0 migration when loading settings", async () => {
      let storage = await chrome.storage.sync.get(null);
      assert.equal("123", storage.scrollStepSize);
      // The JSON value should've been migrated to an int when loading settings.
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(123, settings["scrollStepSize"]);
      // When writing settings, the JSON value should be persisted back to storage.
      await Settings.set(settings);
      storage = await chrome.storage.sync.get(null);
      assert.equal(123, storage.scrollStepSize);
    });
  });

  context("v2.4 migration", () => {
    setup(async () => {
      await chrome.storage.sync.set({
        settingsVersion: "2.3",
      });
    });

    teardown(async () => {
      await Settings.clear();
    });

    should("Handle null newTabUrl", async () => {
      // Users who never changed newTabUrl from its old default ("about:newtab") won't have it
      // stored, because Settings.pruneOutDefaultValues removes keys equal to the default. The
      // migration should still set browserNewTabPage as the destination.
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(Settings.newTabDestinations.browserNewTabPage, settings.newTabDestination);
    });

    should("Remove deprecated option", async () => {
      await chrome.storage.sync.set({ newTabUrl: "pages/blank.html" });
      await Settings.load();
      const settings = Settings.getSettings();
      assert.isFalse(Object.hasOwn(settings, "newTabUrl"));
    });

    should("Handle pages/blank.html new tab URL", async () => {
      await chrome.storage.sync.set({ newTabUrl: "pages/blank.html" });
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(Settings.newTabDestinations.vimiumNewTabPage, settings.newTabDestination);
    });

    should("Handle https://example.com new tab URL", async () => {
      await chrome.storage.sync.set({ newTabUrl: "https://example.com" });
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(Settings.newTabDestinations.customUrl, settings.newTabDestination);
      assert.equal("https://example.com", settings.newTabCustomUrl);
    });
  });

  context("v2.4.1 migration", () => {
    setup(async () => {
      await chrome.storage.sync.set({ settingsVersion: "2.4.0" });
    });

    teardown(async () => {
      await Settings.clear();
    });

    should("Sets default/missing newTabDestination to browserNewTabPage", async () => {
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(Settings.newTabDestinations.browserNewTabPage, settings.newTabDestination);
    });

    should("Preserve customUrl destination", async () => {
      await chrome.storage.sync.set({ newTabDestination: Settings.newTabDestinations.customUrl });
      await Settings.load();
      const settings = Settings.getSettings();
      assert.equal(Settings.newTabDestinations.customUrl, settings.newTabDestination);
    });
  });
});
