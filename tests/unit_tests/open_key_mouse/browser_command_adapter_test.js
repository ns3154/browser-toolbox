import "../test_helper.js";
import "../../../lib/open_key_mouse/command_invocation.js";
import "../../../background_scripts/open_key_mouse/command_registry_adapter.js";
import "../../../background_scripts/open_key_mouse/browser_command_adapter.js";

context("Browser command adapter", () => {
  function invocation(commandName, context = {}, options = {}) {
    return OpenKeyMouseCommandInvocation.createInvocation(
      commandName,
      options,
      { type: "superDrag" },
      context,
    );
  }

  should("open an allowed URL and reject an unsafe URL", async () => {
    let created;
    stub(chrome.tabs, "create", async (value) => created = value);
    const adapter = new OpenKeyMouseBrowserCommandAdapter({});
    const tab = { id: 7, index: 2, windowId: 1 };

    const opened = await adapter.execute(
      invocation("OpenKeyMouse.openLinkForeground", { linkUrl: "https://example.com/a" }),
      { tab },
    );
    assert.isTrue(opened.ok);
    assert.equal({ url: "https://example.com/a", active: true, index: 3 }, created);

    const blocked = await adapter.execute(
      invocation("OpenKeyMouse.openLinkForeground", { linkUrl: "javascript:alert(1)" }),
      { tab },
    );
    assert.isFalse(blocked.ok);
    assert.equal("BLOCKED_URL_SCHEME", blocked.code);
  });

  should("route selected text to the browser search API", async () => {
    let query;
    stub(chrome.search, "query", async (value) => query = value);
    const adapter = new OpenKeyMouseBrowserCommandAdapter({});
    const result = await adapter.execute(
      invocation("OpenKeyMouse.searchSelection", { selectedText: "  local query  " }, {
        disposition: "background",
      }),
      { tab: { id: 7, index: 0, windowId: 1 } },
    );
    assert.isTrue(result.ok);
    assert.equal({ disposition: "NEW_TAB", text: "local query" }, query);
  });

  should("persist a session module toggle", async () => {
    let overrides;
    const repository = {
      sessionOverrides: {},
      getEffectiveSettings: () => ({ effectiveModules: { superDrag: true } }),
      setSessionOverrides: async (value) => overrides = value,
    };
    const adapter = new OpenKeyMouseBrowserCommandAdapter(repository);
    const result = await adapter.execute(
      invocation("OpenKeyMouse.toggleSuperDrag"),
      { tab: { id: 7, url: "https://example.com/" } },
    );
    assert.isTrue(result.ok);
    assert.equal({ superDrag: false }, overrides);
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
    const adapter = new OpenKeyMouseBrowserCommandAdapter({});
    const tab = { id: 8, index: 1, windowId: 4, url: "https://example.com/" };

    assert.isTrue((await adapter.execute(invocation("OpenKeyMouse.closeWindow"), { tab })).ok);
    assert.equal([4], calls.removed);
    assert.isTrue(
      (await adapter.execute(
        invocation("OpenKeyMouse.newWindow", { linkUrl: "https://example.com/new" }),
        { tab },
      )).ok,
    );
    assert.equal({ url: "https://example.com/new" }, calls.created[0]);
    assert.isTrue((await adapter.execute(invocation("OpenKeyMouse.showTabList"), { tab })).ok);
    assert.equal({ url: "" }, calls.created[1]);
    assert.isTrue(
      (await adapter.execute(
        invocation("OpenKeyMouse.searchSelection", { selectedText: " fallback query " }),
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
        invocation("OpenKeyMouse.searchSelection", { selectedText: "   " }),
        { tab },
      )).code,
    );
    assert.isTrue((await adapter.execute(invocation("OpenKeyMouse.toggleFullscreen"), { tab })).ok);
    assert.equal({ windowId: 4, value: { state: "normal" } }, calls.updated[0]);
    assert.isTrue((await adapter.execute(invocation("OpenKeyMouse.minimizeWindow"), { tab })).ok);
    assert.isTrue((await adapter.execute(invocation("OpenKeyMouse.maximizeWindow"), { tab })).ok);
    assert.equal({ windowId: 4, value: { state: "maximized" } }, calls.updated[2]);
    assert.equal("UNKNOWN_COMMAND", (await adapter.execute(invocation("missing"), { tab })).code);
  });

  should("handle tab lookup and existing background commands", async () => {
    const tab = { id: 9, index: 0, windowId: 5, url: "https://example.com/" };
    stub(chrome.tabs, "get", async () => tab);
    stub(chrome.tabs, "query", async () => []);
    const adapter = new OpenKeyMouseBrowserCommandAdapter({});
    const byContext = await adapter.getTab(
      invocation("OpenKeyMouse.showTabList", { tabId: 9 }),
      {},
    );
    assert.equal(tab, byContext);
    assert.equal(
      "NO_ACTIVE_TAB",
      (await adapter.execute(invocation("OpenKeyMouse.showTabList"), {})).code,
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
