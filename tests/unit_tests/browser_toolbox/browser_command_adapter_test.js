import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../background_scripts/browser_toolbox/command_registry_adapter.js";
import "../../../background_scripts/browser_toolbox/browser_command_adapter.js";

context("Browser command adapter", () => {
  function invocation(commandName, context = {}, options = {}) {
    return BrowserToolboxCommandInvocation.createInvocation(
      commandName,
      options,
      { type: "superDrag" },
      context,
    );
  }

  should("open an allowed URL and reject an unsafe URL", async () => {
    let created;
    stub(chrome.tabs, "create", async (value) => created = value);
    const adapter = new BrowserToolboxBrowserCommandAdapter({});
    const tab = { id: 7, index: 2, windowId: 1 };

    const opened = await adapter.execute(
      invocation("BrowserToolbox.openLinkForeground", { linkUrl: "https://example.com/a" }),
      { tab },
    );
    assert.isTrue(opened.ok);
    assert.equal({ url: "https://example.com/a", active: true, index: 3 }, created);

    const blocked = await adapter.execute(
      invocation("BrowserToolbox.openLinkForeground", { linkUrl: "javascript:alert(1)" }),
      { tab },
    );
    assert.isFalse(blocked.ok);
    assert.equal("BLOCKED_URL_SCHEME", blocked.code);
  });

  should("route selected text to the browser search API", async () => {
    let query;
    stub(chrome.search, "query", async (value) => query = value);
    const adapter = new BrowserToolboxBrowserCommandAdapter({});
    const result = await adapter.execute(
      invocation("BrowserToolbox.searchSelection", { selectedText: "  local query  " }, {
        disposition: "background",
      }),
      { tab: { id: 7, index: 0, windowId: 1 } },
    );
    assert.isTrue(result.ok);
    assert.equal({ disposition: "NEW_TAB", text: "local query" }, query);
  });

  should("route selected text through the configured search engine keyword", async () => {
    let created;
    stub(chrome.tabs, "create", async (value) => created = value);
    const adapter = new BrowserToolboxBrowserCommandAdapter({
      getSearchEngines: () =>
        "ddg: https://duckduckgo.com/?q=%s DuckDuckGo\njs: javascript:alert(%s) Script",
    });
    const result = await adapter.execute(
      invocation("BrowserToolbox.searchSelection", { selectedText: "中文 query" }, {
        disposition: "background",
        keyword: "ddg",
      }),
      { tab: { id: 7, index: 2, windowId: 1 } },
    );
    assert.isTrue(result.ok);
    assert.equal(
      { url: "https://duckduckgo.com/?q=%E4%B8%AD%E6%96%87%20query", active: false, index: 3 },
      created,
    );

    const unknown = await adapter.execute(
      invocation("BrowserToolbox.searchSelection", { selectedText: "query" }, {
        keyword: "missing",
      }),
      { tab: { id: 7, index: 2, windowId: 1 } },
    );
    assert.isFalse(unknown.ok);
    assert.equal("INVALID_OPTIONS", unknown.code);

    const unsafe = await adapter.execute(
      invocation("BrowserToolbox.searchSelection", { selectedText: "query" }, { keyword: "js" }),
      { tab: { id: 7, index: 2, windowId: 1 } },
    );
    assert.isFalse(unsafe.ok);
    assert.equal("INVALID_OPTIONS", unsafe.code);
  });

  should("persist a session module toggle", async () => {
    let overrides;
    let enabled = true;
    const repository = {
      sessionOverrides: {},
      getEffectiveSettings: () => ({ effectiveModules: { superDrag: enabled } }),
      setSessionOverrides: async (value) => {
        overrides = value;
        enabled = value.superDrag;
      },
    };
    const adapter = new BrowserToolboxBrowserCommandAdapter(repository);
    const result = await adapter.execute(
      invocation("BrowserToolbox.toggleSuperDrag"),
      { tab: { id: 7, url: "https://example.com/" } },
    );
    assert.isTrue(result.ok);
    assert.equal({ superDrag: false }, overrides);
    assert.equal({ enabled: false }, result.data);
  });

  should("report the effective state when a global switch still disables the module", async () => {
    let overrides;
    const repository = {
      sessionOverrides: {},
      getEffectiveSettings: () => ({
        effectiveModules: { enabled: false, keyboard: false },
      }),
      setSessionOverrides: async (value) => overrides = value,
    };
    const adapter = new BrowserToolboxBrowserCommandAdapter(repository);
    const result = await adapter.execute(
      invocation("BrowserToolbox.toggleKeyboard"),
      { tab: { id: 7, url: "https://example.com/" } },
    );
    assert.isTrue(result.ok);
    assert.equal({ keyboard: true }, overrides);
    assert.equal({ enabled: false }, result.data);
  });

  should("operate on windows, tabs and safe fallback searches", async () => {
    const calls = { removed: [], created: [], updated: [] };
    stub(chrome.windows, "remove", async (windowId) => calls.removed.push(windowId));
    stub(chrome.windows, "create", async (value) => calls.created.push(value));
    stub(chrome.windows, "get", async () => ({ state: "fullscreen" }));
    stub(
      chrome.windows,
      "update",
      async (windowId, value) => calls.updated.push({ windowId, value }),
    );
    stub(chrome.tabs, "create", async (value) => calls.created.push(value));
    stub(chrome.search, "query", null);
    const adapter = new BrowserToolboxBrowserCommandAdapter({});
    const tab = { id: 8, index: 1, windowId: 4, url: "https://example.com/" };

    assert.isTrue((await adapter.execute(invocation("BrowserToolbox.closeWindow"), { tab })).ok);
    assert.equal([4], calls.removed);
    assert.isTrue(
      (await adapter.execute(
        invocation("BrowserToolbox.newWindow", { linkUrl: "https://example.com/new" }),
        { tab },
      )).ok,
    );
    assert.equal({ url: "https://example.com/new" }, calls.created[0]);
    assert.isTrue((await adapter.execute(invocation("BrowserToolbox.showTabList"), { tab })).ok);
    assert.equal({ url: "" }, calls.created[1]);
    assert.isTrue(
      (await adapter.execute(
        invocation("BrowserToolbox.searchSelection", { selectedText: " fallback query " }),
        { tab },
      )).ok,
    );
    assert.equal(
      { url: "https://www.google.com/search?q=fallback%20query", active: true, index: 2 },
      calls.created[2],
    );
    assert.equal(
      "NO_MATCHING_ELEMENT",
      (await adapter.execute(
        invocation("BrowserToolbox.searchSelection", { selectedText: "   " }),
        { tab },
      )).code,
    );
    assert.isTrue(
      (await adapter.execute(invocation("BrowserToolbox.toggleFullscreen"), { tab })).ok,
    );
    assert.equal({ windowId: 4, value: { state: "normal" } }, calls.updated[0]);
    assert.isTrue((await adapter.execute(invocation("BrowserToolbox.minimizeWindow"), { tab })).ok);
    assert.isTrue((await adapter.execute(invocation("BrowserToolbox.maximizeWindow"), { tab })).ok);
    assert.equal({ windowId: 4, value: { state: "maximized" } }, calls.updated[2]);
    assert.equal("UNKNOWN_COMMAND", (await adapter.execute(invocation("missing"), { tab })).code);
  });

  should("handle tab lookup and existing background commands", async () => {
    const tab = { id: 9, index: 0, windowId: 5, url: "https://example.com/" };
    stub(chrome.tabs, "get", async () => tab);
    stub(chrome.tabs, "query", async () => []);
    let openedSettingsUrl;
    stub(chrome.runtime, "getURL", (path) => `chrome-extension://test/${path}`);
    stub(chrome.tabs, "create", async ({ url }) => openedSettingsUrl = url);
    const adapter = new BrowserToolboxBrowserCommandAdapter({});
    const byContext = await adapter.getTab(
      invocation("BrowserToolbox.showTabList", { tabId: 9 }),
      {},
    );
    assert.equal(tab, byContext);
    assert.equal(
      "NO_ACTIVE_TAB",
      (await adapter.execute(invocation("BrowserToolbox.showTabList"), {})).code,
    );
    assert.isTrue(
      (await adapter.execute(invocation("BrowserToolbox.openSettings"), {})).ok,
    );
    assert.equal(
      "chrome-extension://test/pages/mouse_options.html",
      openedSettingsUrl,
    );
    assert.isTrue(
      (await adapter.execute(invocation("BrowserToolbox.openCommandCenter"), { tab })).ok,
    );
    assert.equal(
      "chrome-extension://test/pages/command_center.html?tabId=9",
      openedSettingsUrl,
    );
    const calls = [];
    const existing = await adapter.executeExisting(
      "scrollDown",
      invocation("scrollDown"),
      { tab },
      {
        scrollDown: async (details, sender) => calls.push({ details, sender }),
      },
    );
    assert.isTrue(existing.ok);
    assert.equal(1, calls.length);
    assert.equal(9, calls[0].details.tabId);

    let receivedOptions;
    const reload = await adapter.executeExisting(
      "reload",
      invocation("reload"),
      { tab },
      {
        reload: async (details) => receivedOptions = details.registryEntry.options,
      },
    );
    assert.isTrue(reload.ok);
    assert.equal({}, receivedOptions);

    assert.equal(
      "UNKNOWN_COMMAND",
      (await adapter.executeExisting(
        "missing",
        invocation("missing"),
        { tab },
        {},
      )).code,
    );
    const failed = await adapter.executeExisting(
      "explode",
      invocation("explode"),
      { tab },
      {
        explode: async () => {
          throw new Error("boom");
        },
      },
    );
    assert.equal("COMMAND_FAILED", failed.code);
    assert.equal("boom", failed.message);
  });
});
