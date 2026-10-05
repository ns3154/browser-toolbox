import "../test_helper.js";
import "../../../lib/browser_toolbox/browser_startup.js";

context("Browser startup navigation", () => {
  const api = () => globalThis.BrowserToolboxBrowserStartup;

  should("accept only bounded HTTP(S) URLs", () => {
    assert.isTrue(api().validateUrl("https://example.com/path").ok);
    assert.isTrue(api().validateUrl("http://localhost:3000/").ok);
    assert.isTrue(api().validateUrl("").ok);
    assert.isFalse(api().validateUrl("javascript:alert(1)").ok);
    assert.isFalse(api().validateUrl("file:///tmp/start.html").ok);
    assert.isFalse(api().validateUrl(" https://example.com").ok);
    assert.isFalse(api().validateUrl("https://example.com".repeat(200)).ok);
  });

  should("open one active tab in the focused normal window", async () => {
    const tabCalls = [];
    const windowCalls = [];
    const navigator = new (api().BrowserStartupNavigator)({
      tabsApi: {
        async create(properties) {
          tabCalls.push(properties);
          return { id: 42 };
        },
      },
      windowsApi: {
        async getAll() {
          return [
            { id: 9, type: "normal", focused: true, incognito: false },
            { id: 10, type: "normal", focused: false, incognito: false },
            { id: 11, type: "normal", focused: true, incognito: true },
          ];
        },
        async create(properties) {
          windowCalls.push(properties);
          return { id: 12 };
        },
      },
    });

    const settings = { browserStartup: { enabled: true, url: "https://example.com" } };
    const result = await navigator.openConfiguredPage(settings);
    const repeated = await navigator.openConfiguredPage(settings);

    assert.equal({
      opened: true,
      mode: "tab",
      windowId: 9,
      tabId: 42,
      url: "https://example.com",
    }, result);
    assert.equal([{ windowId: 9, url: "https://example.com", active: true }], tabCalls);
    assert.equal([], windowCalls);
    assert.equal({ opened: false, reason: "already-handled" }, repeated);
  });

  should("create a normal window when no normal window is available", async () => {
    const created = [];
    const navigator = new (api().BrowserStartupNavigator)({
      tabsApi: {
        async create() {
          throw new Error("不应打开标签页");
        },
      },
      windowsApi: {
        async getAll() {
          return [{ id: 3, type: "normal", focused: true, incognito: true }];
        },
        async create(properties) {
          created.push(properties);
          return { id: 4 };
        },
      },
    });

    const result = await navigator.openConfiguredPage({
      browserStartup: { enabled: true, url: "http://localhost:8080" },
    });

    assert.equal({
      opened: true,
      mode: "window",
      windowId: 4,
      url: "http://localhost:8080",
    }, result);
    assert.equal([{
      url: "http://localhost:8080",
      type: "normal",
      focused: true,
    }], created);
  });
});
