/**
 * 设置应用服务的单元测试。
 * 测试输入为两个设置域的快照，输出为组合、加载和提交结果断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../background_scripts/browser_toolbox/settings_migrations.js";
import "../../../pages/settings_commit_coordinator.js";
import "../../../lib/browser_toolbox/settings_application_service.js";

context("Settings application service", () => {
  const api = () => globalThis.BrowserToolboxSettingsApplicationService;
  const valueUtils = () => globalThis.BrowserToolboxValueUtils;

  function createHarness() {
    const writes = [];
    const repository = {
      current: {
        schemaVersion: 4,
        general: { enabled: true, language: "en" },
        keyboard: { keyMappings: "browser-copy" },
        searchEngines: "browser-search",
        cursor: { enabled: false, localAssetId: null },
      },
      async ensureLoaded() {},
      async load() {},
      getSettings() {
        return valueUtils().clone(this.current);
      },
      async setSettings(value) {
        writes.push("BrowserToolbox");
        this.current = valueUtils().clone(value);
      },
    };
    const vimiumSettings = {
      current: {
        keyMappings: "vimium-copy",
        searchEngines: "vimium-search",
        exclusionRules: [{ pattern: "https://example.com/*", passKeys: "" }],
        unrelated: "initial",
      },
      async onLoaded() {},
      async load() {},
      get(key) {
        return this.current[key];
      },
      getSettings() {
        return valueUtils().clone(this.current);
      },
      async setSettings(value) {
        writes.push("Vimium");
        this.current = valueUtils().clone(value);
      },
    };
    const service = new (api().SettingsApplicationService)({
      repository,
      vimiumSettings,
    });
    return { service, repository, vimiumSettings, writes };
  }

  should("load a composed snapshot and establish a conflict baseline", async () => {
    const { service } = createHarness();
    const snapshot = await service.load({});

    assert.equal("vimium-copy", snapshot.settings.keyboard.keyMappings);
    assert.equal("vimium-search", snapshot.settings.searchEngines);
    assert.equal("browser-copy", snapshot.browserToolbox.keyboard.keyMappings);
    assert.equal("vimium-copy", snapshot.vimium.keyMappings);
  });

  should("导入要求备份时必须使用后台导入入口，后台不可用不能回退为双域直写", async () => {
    const { service, writes } = createHarness();
    const loaded = await service.load({});
    let submitted;
    stub(globalThis, "BrowserToolboxConfigurationClientInstance", {
      enabled: true,
      async importConfiguration(input) {
        submitted = input;
        throw Object.assign(new Error("合成停止"), { code: "TEST_STOP" });
      },
      async commit() {
        throw new Error("导入不得调用无备份的普通提交");
      },
    });
    let caught;
    try {
      await service.commit(loaded.settings, {
        registry: {},
        vimiumPatch: { exclusionRules: [] },
        beforeImport: true,
      });
    } catch (failure) {
      caught = failure;
    }
    assert.equal("TEST_STOP", caught?.code);
    assert.equal([], submitted.legacyPatch.exclusionRules);
    assert.equal([], writes);
  });

  should("导入备份时后台不可用不会绕过队列直接写入", async () => {
    const { service, repository, writes } = createHarness();
    const loaded = await service.load({});
    stub(globalThis, "BrowserToolboxConfigurationClientInstance", { enabled: false });
    stub(repository, "load", async () => writes.push("unexpected-reload"));
    let caught;
    try {
      await service.commit(loaded.settings, { registry: {}, beforeImport: true });
    } catch (failure) {
      caught = failure;
    }
    assert.equal("CONFIGURATION_UNAVAILABLE", caught?.code);
    assert.equal([], writes);
  });

  should("commit both domains while preserving unrelated external Vimium fields", async () => {
    const { service, repository, vimiumSettings, writes } = createHarness();
    const loaded = await service.load({});
    vimiumSettings.current.unrelated = "changed-elsewhere";
    const next = loaded.settings;
    next.general.enabled = false;
    next.keyboard.keyMappings = "updated-mapping";

    const snapshot = await service.commit(next, { registry: {} });

    assert.equal(["Vimium", "BrowserToolbox"], writes);
    assert.isFalse(repository.current.general.enabled);
    assert.equal("updated-mapping", vimiumSettings.current.keyMappings);
    assert.equal("changed-elsewhere", vimiumSettings.current.unrelated);
    assert.equal("updated-mapping", snapshot.settings.keyboard.keyMappings);
  });

  should("stop a commit when an external field conflicts with the page intent", async () => {
    const { service, repository, writes } = createHarness();
    const loaded = await service.load({});
    repository.current.general.enabled = false;
    const next = loaded.settings;
    next.cursor.enabled = true;

    let error;
    try {
      await service.commit(next, { registry: {} });
    } catch (caught) {
      error = caught;
    }

    assert.equal("browser-toolbox-settings-conflict", error.code);
    assert.equal("BrowserToolbox", error.conflicts[0].name);
    assert.equal(["general.enabled"], error.conflicts[0].paths);
    assert.equal([], writes);
  });

  should("delegate export creation and migration to the versioned migration layer", () => {
    const { service } = createHarness();
    const payload = service.createExportPayload({
      schemaVersion: 0,
      gestureBindings: [{ pattern: ["R"], commandName: "OpenKeyMouse.newWindow" }],
    }, { extensionVersion: "test" });
    const migrated = service.migrateExportPayload(payload);

    assert.equal("browser-toolbox-settings", payload.format);
    assert.isTrue(migrated.ok);
    assert.equal(9, migrated.settings.schemaVersion);
    assert.equal("BrowserToolbox.newWindow", migrated.settings.mouse.bindings[0].commandName);
  });
});
