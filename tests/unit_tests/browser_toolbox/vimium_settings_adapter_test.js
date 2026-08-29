/**
 * Vimium 设置适配层的单元测试。
 * 测试输入为外部设置解析结果，输出为读取和写入委托断言。
 */
import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/vimium_settings_adapter.js";

context("Vimium settings adapter", () => {
  should("delegate to a replaceable settings source", async () => {
    let loaded = false;
    const values = { exclusionRules: [{ pattern: "https://example.com/*", passKeys: "" }] };
    let loadCount = 0;
    const source = {
      load: async () => {
        loadCount += 1;
        loaded = true;
      },
      isLoaded: () => loaded,
      get: (key) => values[key],
      getSettings: () => ({ ...values }),
      onLoaded: async () => {
        loaded = true;
      },
      set: async (key, value) => {
        values[key] = value;
      },
      setSettings: async (next) => Object.assign(values, next),
    };
    const adapter = new BrowserToolboxVimiumSettingsAdapter.VimiumSettingsAdapter(() => source);
    assert.isTrue(adapter.isAvailable());
    assert.isFalse(adapter.isLoaded());
    await adapter.load();
    assert.equal(1, loadCount);
    await adapter.onLoaded();
    assert.isTrue(adapter.isLoaded());
    assert.equal(values.exclusionRules, adapter.get("exclusionRules"));
    assert.equal(values, adapter.getSettings());
    await adapter.set("exclusionRules", []);
    assert.equal([], values.exclusionRules);
    await adapter.setSettings({ scrollStepSize: 90 });
    assert.equal(90, values.scrollStepSize);
  });

  should("fall back safely when Vimium settings are unavailable", async () => {
    const adapter = new BrowserToolboxVimiumSettingsAdapter.VimiumSettingsAdapter(() => null);
    assert.isFalse(adapter.isAvailable());
    assert.isFalse(adapter.isLoaded());
    assert.equal(undefined, adapter.get("exclusionRules"));
    assert.equal(undefined, adapter.getSettings());
    assert.equal(undefined, await adapter.onLoaded());
    assert.equal(undefined, await adapter.load());
  });
});
