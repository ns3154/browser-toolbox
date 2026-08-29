/**
 * 内容脚本运行时设置客户端的单元测试。
 * 测试输入为 runtime 响应和超时场景，输出为兜底配置断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../lib/browser_toolbox/message_protocol.js";
import "../../../lib/browser_toolbox/settings_schema.js";
import "../../../lib/browser_toolbox/module_registry.js";
import "../../../lib/browser_toolbox/site_rule_matcher.js";
import "../../../lib/browser_toolbox/settings_policy.js";
import "../../../lib/i18n.js";
import "../../../lib/browser_toolbox/settings_runtime_client.js";

context("Settings runtime client", () => {
  function createHarness(responder, fallbackRepository = null, isTopFrame) {
    const messages = [];
    const listeners = [];
    const runtimeApi = {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
      sendMessage(message) {
        messages.push(message);
        return responder(message);
      },
    };
    return {
      client: new BrowserToolboxSettingsRuntimeClient({
        runtimeApi,
        fallbackRepository,
        requestTimeoutMs: 20,
        isTopFrame,
      }),
      messages,
      listeners,
    };
  }

  function settingsWithHud(showHud, language = "auto") {
    return BrowserToolboxSettingsPolicy.withEffectiveSettings(
      BrowserToolboxSettingsSchema.mergeSettings({ general: { showHud, language } }),
      "https://example.com/",
    );
  }

  teardown(() => BrowserToolboxI18n.setLocale("auto"));

  should("cache one defensive snapshot for the same context", async () => {
    const { client, messages } = createHarness(() => settingsWithHud(true));
    const first = await client.ensureLoaded("https://example.com/one");
    first.general.showHud = false;
    const second = await client.ensureLoaded("https://example.com/one");

    assert.equal(1, messages.length);
    assert.isTrue(second.general.showHud);
  });

  should("refresh when a single-page application changes context URL", async () => {
    let callCount = 0;
    const { client, messages } = createHarness(() => settingsWithHud(++callCount === 1));
    const first = await client.ensureLoaded("https://example.com/one");
    const second = await client.ensureLoaded("https://example.com/two");

    assert.equal(2, messages.length);
    assert.isTrue(first.general.showHud);
    assert.isFalse(second.general.showHud);
  });

  should("use the current page URL when no context is supplied", async () => {
    const { client, messages } = createHarness(() => settingsWithHud(true));
    const settings = await client.ensureLoaded();

    assert.isTrue(settings.general.showHud);
    assert.equal(1, messages.length);
  });

  should("reload after a validated settings-changed notification", async () => {
    let callCount = 0;
    const { client, listeners } = createHarness(() => settingsWithHud(++callCount === 1));
    const observed = [];
    client.addEventListener((settings) => observed.push(settings.general.showHud));
    await client.ensureLoaded("https://example.com/");

    listeners[0](BrowserToolboxMessageProtocol.create("browserToolbox.settingsChanged"));
    const refreshed = await client.ensureLoaded("https://example.com/");

    assert.isFalse(refreshed.general.showHud);
    assert.equal([true, false], observed);
  });

  should("apply the configured locale initially and after a live settings update", async () => {
    let callCount = 0;
    const { client, listeners } = createHarness(() =>
      settingsWithHud(true, ++callCount === 1 ? "zh_CN" : "en")
    );

    await client.ensureLoaded("https://example.com/");
    assert.equal("zh_CN", BrowserToolboxI18n.locale());
    assert.equal("取消", BrowserToolboxI18n.message("cancel"));

    listeners[0](BrowserToolboxMessageProtocol.create("browserToolbox.settingsChanged"));
    await client.ensureLoaded("https://example.com/");
    assert.equal("en", BrowserToolboxI18n.locale());
    assert.equal("Cancel", BrowserToolboxI18n.message("cancel"));
  });

  should("discard an in-flight response invalidated by a settings change", async () => {
    let resolveFirst;
    let callCount = 0;
    const firstResponse = new Promise((resolve) => resolveFirst = resolve);
    const { client, listeners } = createHarness(() => {
      callCount++;
      return callCount === 1 ? firstResponse : settingsWithHud(false);
    });
    const loading = client.ensureLoaded("https://example.com/");
    listeners[0](BrowserToolboxMessageProtocol.create("browserToolbox.settingsChanged"));
    resolveFirst(settingsWithHud(true));

    const settings = await loading;
    assert.equal(2, callCount);
    assert.isFalse(settings.general.showHud);
  });

  should("fall back to the local repository when the Service Worker is unavailable", async () => {
    let fallbackLoads = 0;
    const fallback = {
      async ensureLoaded() {
        fallbackLoads++;
      },
      getEffectiveSettings() {
        return settingsWithHud(false);
      },
    };
    const { client } = createHarness(
      () => Promise.reject(new Error("worker unavailable")),
      fallback,
    );
    const settings = await client.ensureLoaded("https://example.com/");

    assert.equal(1, fallbackLoads);
    assert.isFalse(settings.general.showHud);
  });

  should("fall back to defaults when the repository also fails", async () => {
    const fallback = {
      async ensureLoaded() {
        throw new Error("storage unavailable");
      },
    };
    const { client } = createHarness(
      () => Promise.reject(new Error("worker unavailable")),
      fallback,
    );
    const settings = await client.ensureLoaded("https://example.com/");

    assert.isTrue(settings.general.enabled);
    assert.isTrue(settings.effectiveModules.mouse);
  });

  should(
    "fail closed in a child frame when both the Service Worker and fallback are unavailable",
    async () => {
      let fallbackLoads = 0;
      const fallback = {
        async ensureLoaded() {
          fallbackLoads++;
        },
        getEffectiveSettings() {
          return settingsWithHud(true);
        },
      };
      const { client } = createHarness(
        () => Promise.reject(new Error("worker unavailable")),
        fallback,
        () => false,
      );
      const settings = await client.ensureLoaded("https://embedded.example/frame");

      assert.equal(0, fallbackLoads);
      assert.isFalse(settings.general.enabled);
      assert.isTrue(Object.values(settings.effectiveModules).every((enabled) => enabled === false));
    },
  );

  should("queue a refresh for a changed context after another refresh settles", async () => {
    let resolveFirst;
    let callCount = 0;
    const firstResponse = new Promise((resolve) => resolveFirst = resolve);
    const { client } = createHarness(() => {
      callCount++;
      return callCount === 1 ? firstResponse : settingsWithHud(false);
    });
    const first = client.refresh("https://example.com/one");
    await Promise.resolve();
    const second = client.refresh("https://example.com/two");
    resolveFirst(settingsWithHud(true));

    const results = await Promise.all([first, second]);
    assert.equal(2, callCount);
    assert.isFalse(results[1].general.showHud);
  });

  should("ignore malformed runtime responses and remove listeners on destroy", async () => {
    const listeners = [];
    const removed = [];
    const runtimeApi = {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          removed.push(listener);
        },
      },
      sendMessage() {
        return Promise.resolve({ effectiveModules: [] });
      },
    };
    const client = new BrowserToolboxSettingsRuntimeClient({ runtimeApi, requestTimeoutMs: 20 });
    let observed = 0;
    client.addEventListener(() => observed++);
    client.addEventListener(() => {
      throw new Error("listener failure");
    });
    const before = client.getSettings();
    await client.ensureLoaded("https://example.com/");
    assert.isTrue(before.general.enabled);
    assert.equal(1, observed);
    client.removeEventListener(() => {});
    client.destroy();
    assert.equal([listeners[0]], removed);
    assert.equal(0, client.listeners.size);
  });

  should("fail closed when frame detection throws and allow a runtime-less client", () => {
    const throwing = new BrowserToolboxSettingsRuntimeClient({
      runtimeApi: null,
      fallbackRepository: null,
      isTopFrame: () => {
        throw new Error("cross-origin");
      },
    });
    const settings = throwing.getSettings();
    assert.isFalse(settings.general.enabled);
    assert.isTrue(Object.values(settings.effectiveModules).every((enabled) => enabled === false));

    const noEventsApi = { sendMessage: () => Promise.resolve(settingsWithHud(true)) };
    const withoutListener = new BrowserToolboxSettingsRuntimeClient({ runtimeApi: noEventsApi });
    assert.isTrue(withoutListener.listenerInstalled === false);
    withoutListener.destroy();
  });
});
