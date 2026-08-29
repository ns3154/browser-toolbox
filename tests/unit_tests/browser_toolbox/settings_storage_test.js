/**
 * 设置存储适配层的单元测试。
 * 测试输入为规范键、旧键和本地资源，输出为读写及迁移结果断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../background_scripts/browser_toolbox/settings_storage.js";

context("Settings storage adapter", () => {
  async function clearStorage() {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  }

  should("prefer canonical keys and fall back to legacy keys", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    await chrome.storage.sync.set({
      browserToolboxSettings: { general: { language: "zh_CN" } },
      openKeyMouseSettings: { general: { language: "en" } },
    });
    const canonical = await storage.readSettings();
    assert.isFalse(canonical.legacy);
    assert.isTrue(canonical.canonicalPresent);
    assert.equal("zh_CN", canonical.value.general.language);

    await chrome.storage.sync.remove("browserToolboxSettings");
    const legacy = await storage.readSettings();
    assert.isTrue(legacy.legacy);
    assert.isFalse(legacy.canonicalPresent);
    assert.equal("en", legacy.value.general.language);
  });

  should("write only canonical settings and keep migration backups detached", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const value = { schemaVersion: 0, nested: { enabled: true } };
    await storage.writeMigrationBackup(value);
    value.nested.enabled = false;
    await storage.writeSettings(value);

    const values = await chrome.storage.sync.get([
      "browserToolboxSettings",
      "openKeyMouseSettings",
    ]);
    const backup = (await chrome.storage.local.get("browserToolboxSettingsMigrationBackup"))
      .browserToolboxSettingsMigrationBackup;
    assert.equal(false, values.browserToolboxSettings.nested.enabled);
    assert.equal(true, backup.nested.enabled);
    assert.equal(undefined, values.openKeyMouseSettings);
  });

  should(
    "store settings locally when browser sync is disabled and move them back safely",
    async () => {
      await clearStorage();
      const storage = new BrowserToolboxSettingsStorageAdapter();
      const localValue = { general: { browserSyncEnabled: false }, value: "local" };
      assert.equal("local", await storage.writeSettings(localValue));
      assert.equal(
        undefined,
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.equal(
        localValue,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
      const localRead = await storage.readSettings();
      assert.equal("local", localRead.area);
      assert.equal(localValue, localRead.value);

      const syncValue = { general: { browserSyncEnabled: true }, value: "sync" };
      assert.equal("sync", await storage.writeSettings(syncValue));
      assert.equal(
        syncValue,
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.equal(
        undefined,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
    },
  );

  should("roll back the target area when old-area cleanup fails", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const original = { general: { browserSyncEnabled: true }, value: "original" };
    await storage.writeSettings(original);
    const originalRemove = chrome.storage.sync.remove;
    chrome.storage.sync.remove = async () => {
      throw new Error("simulated old-area cleanup failure");
    };
    try {
      let failed = false;
      try {
        await storage.writeSettings({ general: { browserSyncEnabled: false }, value: "local" });
      } catch (error) {
        failed = error.message === "simulated old-area cleanup failure";
      }
      assert.isTrue(failed);
      assert.equal(
        original,
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.equal(
        undefined,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
    } finally {
      chrome.storage.sync.remove = originalRemove;
    }
  });

  should("restore the old area when cleanup deleted before reporting failure", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const original = { general: { browserSyncEnabled: true }, value: "original" };
    await storage.writeSettings(original);
    const originalRemove = chrome.storage.sync.remove;
    chrome.storage.sync.remove = async function (key) {
      await originalRemove.call(this, key);
      throw new Error("simulated cleanup failure after deletion");
    };
    try {
      let failed = false;
      try {
        await storage.writeSettings({ general: { browserSyncEnabled: false }, value: "local" });
      } catch (error) {
        failed = error.message === "simulated cleanup failure after deletion";
      }
      assert.isTrue(failed);
      assert.equal(
        original,
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.equal(
        undefined,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
    } finally {
      chrome.storage.sync.remove = originalRemove;
    }
  });

  should("restore both areas when cleanup deleted a pre-existing duplicate", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const syncOriginal = { general: { browserSyncEnabled: true }, value: "sync-original" };
    const localOriginal = { general: { browserSyncEnabled: false }, value: "local-original" };
    await chrome.storage.sync.set({ browserToolboxSettings: syncOriginal });
    await chrome.storage.local.set({ browserToolboxSettings: localOriginal });
    const originalRemove = chrome.storage.sync.remove;
    chrome.storage.sync.remove = async function (key) {
      await originalRemove.call(this, key);
      throw new Error("simulated duplicate cleanup failure after deletion");
    };
    try {
      let failed = false;
      try {
        await storage.writeSettings({
          general: { browserSyncEnabled: false },
          value: "local-next",
        });
      } catch (error) {
        failed = error.message === "simulated duplicate cleanup failure after deletion";
      }
      assert.isTrue(failed);
      assert.equal(
        syncOriginal,
        (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
      );
      assert.equal(
        localOriginal,
        (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
      );
    } finally {
      chrome.storage.sync.remove = originalRemove;
    }
  });

  should("restore canonical values in both areas after a failed migration", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const original = { general: { browserSyncEnabled: false }, value: "original" };
    await storage.writeSettings(original);
    const state = await storage.readSettings();
    await storage.writeSettings({ general: { browserSyncEnabled: true }, value: "changed" });
    await storage.restoreSettings(original, state);

    assert.equal(
      undefined,
      (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
    );
    assert.equal(
      original,
      (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
    );
  });

  should("clear canonical and legacy session overrides together", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    await chrome.storage.session.set({
      browserToolboxSessionOverrides: { mouse: false },
      openKeyMouseSessionOverrides: { rocker: false },
    });

    await storage.clearSessionOverrides();

    const values = await chrome.storage.session.get([
      "browserToolboxSessionOverrides",
      "openKeyMouseSessionOverrides",
    ]);
    assert.equal(undefined, values.browserToolboxSessionOverrides);
    assert.equal(undefined, values.openKeyMouseSessionOverrides);
  });

  should("restore the exact pre-migration state when canonical storage was absent", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const raw = { schemaVersion: 0, value: "legacy" };
    await storage.writeSettings({ schemaVersion: 4 });
    await storage.restoreSettings(raw, false);
    const values = await chrome.storage.sync.get("browserToolboxSettings");
    assert.equal(undefined, values.browserToolboxSettings);
  });

  should("enforce the sync safety budget before writing", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    let failed = false;
    try {
      await storage.writeSettings({ value: "x".repeat(100 * 1024) });
    } catch (error) {
      failed = error.message === "Synchronized settings exceed the safe size limit.";
    }
    assert.isTrue(failed);
  });

  should("keep local asset access inside the storage adapter", async () => {
    await clearStorage();
    const storage = new BrowserToolboxSettingsStorageAdapter();
    const asset = "data:image/png;base64,AA==";
    await storage.writeLocalAsset("browserToolboxCursor-test", asset);
    assert.equal(asset, await storage.readLocalAsset("browserToolboxCursor-test"));
    assert.equal(undefined, await storage.readLocalAsset(""));

    await storage.removeLocalAsset("browserToolboxCursor-test");
    assert.equal(undefined, await storage.readLocalAsset("browserToolboxCursor-test"));
    let failed = false;
    try {
      await storage.writeLocalAsset("", asset);
    } catch (error) {
      failed = error.message === "Local asset id must be a non-empty string.";
    }
    assert.isTrue(failed);
  });

  should("measure the sync budget in UTF-8 bytes", () => {
    const ascii = BrowserToolboxSettingsStorage.serializedSize("a");
    const chinese = BrowserToolboxSettingsStorage.serializedSize("中");
    assert.equal(3, ascii);
    assert.equal(5, chinese);
    assert.isTrue(
      BrowserToolboxSettingsStorage.serializedSize({ value: "中".repeat(40000) }) >
        BrowserToolboxSettingsStorage.MAX_SYNC_BYTES,
    );
  });
});
