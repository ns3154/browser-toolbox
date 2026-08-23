import "../test_helper.js";
import "../../../lib/open_key_mouse/settings_schema.js";
import "../../../lib/open_key_mouse/settings_validator.js";
import "../../../lib/open_key_mouse/site_rule_matcher.js";
import "../../../background_scripts/open_key_mouse/command_registry_adapter.js";
import "../../../background_scripts/open_key_mouse/settings_migrations.js";
import "../../../background_scripts/open_key_mouse/settings_repository.js";

context("Settings repository", () => {
  async function clearStorage() {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    chrome.storage.onChanged.func = undefined;
  }

  should("load migrated defaults and return defensive clones", async () => {
    await clearStorage();
    const repository = new OpenKeyMouseSettingsRepository();
    const beforeLoad = repository.getSettings();
    beforeLoad.general.enabled = false;
    assert.isTrue(repository.getSettings().general.enabled);

    const loaded = await repository.load(OpenKeyMouseCommandRegistry);
    assert.equal(3, loaded.schemaVersion);
    assert.isTrue(loaded.general.enabled);
    assert.isTrue(repository.listenerInstalled);
    assert.equal(
      {},
      (await chrome.storage.local.get("openKeyMouseSettingsMigrationBackup"))[
        "openKeyMouseSettingsMigrationBackup"
      ],
    );
    assert.equal(
      3,
      (await chrome.storage.sync.get("openKeyMouseSettings"))["openKeyMouseSettings"].schemaVersion,
    );
    assert.equal(repository.settings, await repository.ensureLoaded(OpenKeyMouseCommandRegistry));
    repository.installListener(OpenKeyMouseCommandRegistry);
  });

  should("apply sync, session, site and Vimium exclusion state", async () => {
    await clearStorage();
    const repository = new OpenKeyMouseSettingsRepository();
    await repository.load(OpenKeyMouseCommandRegistry);
    const events = [];
    const listener = (settings) => events.push(settings);
    repository.addEventListener(listener);

    const next = OpenKeyMouseSettingsSchema.clone(
      OpenKeyMouseSettingsSchema.DEFAULT_SETTINGS,
    );
    next.siteRules = [{
      pattern: "https://example.com/*",
      modules: { mouse: false },
    }];
    next.exclusionRules = [{ pattern: "https://example.com/*", passKeys: "" }];
    await chrome.storage.sync.set({ openKeyMouseSettings: next });
    await chrome.storage.session.set({
      openKeyMouseSessionOverrides: { mouse: true, cursor: false, ignored: true },
    });
    const effective = repository.getEffectiveSettings("https://example.com/page");
    assert.isTrue(effective.effectiveModules.mouse);
    assert.isFalse(effective.effectiveModules.keyboard);
    assert.isFalse(effective.effectiveModules.cursor);
    assert.isTrue(events.length >= 2);

    const originalSettings = globalThis.Settings;
    globalThis.Settings = {
      isLoaded: () => true,
      get: () => [{ pattern: "https://example.com/*", passKeys: "j" }],
    };
    try {
      assert.isTrue(
        repository.getEffectiveSettings("https://example.com/page").effectiveModules.keyboard,
      );
    } finally {
      globalThis.Settings = originalSettings;
    }
    globalThis.Settings = {
      isLoaded: () => {
        throw new Error("not ready");
      },
    };
    try {
      assert.isFalse(
        repository.getEffectiveSettings("https://example.com/page").effectiveModules.keyboard,
      );
    } finally {
      globalThis.Settings = originalSettings;
    }
    repository.removeEventListener(listener);
  });

  should("persist validated settings and session overrides", async () => {
    await clearStorage();
    const repository = new OpenKeyMouseSettingsRepository();
    await repository.load(OpenKeyMouseCommandRegistry);
    let eventCount = 0;
    const listener = () => eventCount++;
    repository.addEventListener(listener);

    const updated = await repository.update((settings) => {
      settings.general.enabled = false;
    }, OpenKeyMouseCommandRegistry);
    assert.isFalse(updated.general.enabled);
    const withCursor = await repository.update((settings) => {
      settings.cursor.enabled = true;
      return settings;
    }, OpenKeyMouseCommandRegistry);
    assert.isTrue(withCursor.cursor.enabled);
    assert.isTrue(eventCount >= 2);

    const oversized = OpenKeyMouseSettingsSchema.clone(withCursor);
    oversized.keyboard.keyMappings = "x".repeat(101 * 1024);
    let oversizedError = false;
    try {
      await repository.setSettings(oversized, OpenKeyMouseCommandRegistry);
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

  should("restore raw settings when migration or validation fails", async () => {
    await clearStorage();
    const raw = { schemaVersion: 99, unexpected: "preserve" };
    await chrome.storage.sync.set({ openKeyMouseSettings: raw });
    const repository = new OpenKeyMouseSettingsRepository();
    let failed = false;
    try {
      await repository.load(OpenKeyMouseCommandRegistry);
    } catch (error) {
      failed = error.message.includes("Unsupported schema version");
    }
    assert.isTrue(failed);
    assert.equal(
      raw,
      (await chrome.storage.sync.get("openKeyMouseSettings"))["openKeyMouseSettings"],
    );
  });
});
