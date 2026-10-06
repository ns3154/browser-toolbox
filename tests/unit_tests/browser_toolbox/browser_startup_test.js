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

  should("recognize ordinary browser new-tab URLs", () => {
    assert.isTrue(api().isNewTabUrl("chrome://newtab/"));
    assert.isTrue(api().isNewTabUrl("chrome://newtab"));
    assert.isTrue(api().isNewTabUrl("chrome://new-tab-page/"));
    assert.isTrue(api().isNewTabUrl("about:newtab"));
    assert.isFalse(api().isNewTabUrl("https://example.com"));
    assert.isTrue(api().isNewTabTab({ id: 7, url: "chrome://newtab/", incognito: false }));
    assert.isTrue(api().isNewTabTab({ id: 7, url: "chrome://new-tab-page/", incognito: false }));
    assert.isFalse(api().isNewTabTab({ id: 7, url: "chrome://newtab/", incognito: true }));
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

  should("redirect an enabled normal new tab only once", async () => {
    const updates = [];
    const navigator = new (api().BrowserStartupNavigator)({
      tabsApi: {
        async update(tabId, properties) {
          updates.push({ tabId, properties });
        },
      },
    });
    const settings = {
      browserStartup: {
        enabled: false,
        newTabEnabled: true,
        url: "https://example.com/new-tab",
      },
    };

    const result = await navigator.redirectNewTab(
      { id: 7, url: "chrome://newtab/", incognito: false },
      settings,
    );
    const repeated = await navigator.redirectNewTab(
      { id: 7, url: "chrome://newtab/", incognito: false },
      settings,
    );

    assert.equal({ redirected: true, tabId: 7, url: "https://example.com/new-tab" }, result);
    assert.equal([{ tabId: 7, properties: { url: "https://example.com/new-tab" } }], updates);
    assert.equal({ redirected: false, reason: "already-redirected", tabId: 7 }, repeated);
  });

  should("keep disabled and incognito new tabs unchanged", async () => {
    const updates = [];
    const navigator = new (api().BrowserStartupNavigator)({
      tabsApi: {
        async update(tabId, properties) {
          updates.push({ tabId, properties });
        },
      },
    });
    const settings = {
      browserStartup: {
        enabled: false,
        newTabEnabled: false,
        url: "https://example.com/new-tab",
      },
    };

    assert.equal(
      { redirected: false, reason: "disabled", tabId: 8 },
      await navigator.redirectNewTab(
        { id: 8, url: "chrome://newtab/", incognito: false },
        settings,
      ),
    );
    assert.equal(
      { redirected: false, reason: "not-new-tab", tabId: 9 },
      await navigator.redirectNewTab(
        { id: 9, url: "chrome://newtab/", incognito: true },
        { browserStartup: { newTabEnabled: true, url: "https://example.com/new-tab" } },
      ),
    );
    assert.equal([], updates);
  });
});
