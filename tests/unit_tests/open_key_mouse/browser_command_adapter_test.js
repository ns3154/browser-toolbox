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
});
