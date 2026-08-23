import "../test_helper.js";
import "../../../lib/open_key_mouse/command_invocation.js";
import "../../../lib/open_key_mouse/message_protocol.js";
import "../../../background_scripts/open_key_mouse/command_dispatcher.js";

context("Command dispatcher", () => {
  function registry() {
    const commands = new Map([
      ["scrollDown", { name: "scrollDown", execution: "page", dangerous: false }],
      ["removeTab", { name: "removeTab", execution: "background", dangerous: true }],
    ]);
    return { getCommand: (name) => commands.get(name) || null };
  }

  should("route page invocations through tabs.sendMessage", async () => {
    let received;
    stub(chrome.tabs, "query", async () => [{ id: 7 }]);
    stub(chrome.tabs, "sendMessage", async (_tabId, message) => {
      received = message;
      return { ok: true, code: "OK" };
    });
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: registry(),
      browserAdapter: {},
      backgroundCommands: {},
    });
    const invocation = OpenKeyMouseCommandInvocation.createInvocation(
      "scrollDown",
      {},
      { type: "mouseGesture" },
      {},
      1,
    );
    const result = await dispatcher.dispatch(invocation, {});
    assert.isTrue(result.ok);
    assert.equal("openKeyMouse.executePageCommand", received.type);
    assert.equal("openKeyMouse.executePageCommand", received.handler);
  });

  should("deduplicate dangerous requests", async () => {
    const browserAdapter = {
      executeExisting: async () => ({ ok: true, code: "OK" }),
    };
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: registry(),
      browserAdapter,
      backgroundCommands: {},
    });
    const invocation = OpenKeyMouseCommandInvocation.createInvocation(
      "removeTab",
      {},
      { type: "mouseGesture" },
      {},
      1,
    );
    const first = await dispatcher.dispatch(invocation, { tab: { id: 1 } });
    const second = await dispatcher.dispatch(invocation, { tab: { id: 1 } });
    assert.isTrue(first.ok);
    assert.equal("DUPLICATE_REQUEST", second.code);
  });

  should("cancel a mouse gesture after its frame session expires", async () => {
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: registry(),
      browserAdapter: {},
      backgroundCommands: {},
      gestureCoordinator: { isActive: () => false },
    });
    const invocation = OpenKeyMouseCommandInvocation.createInvocation(
      "scrollDown",
      {},
      { type: "mouseGesture" },
      {},
      1,
    );
    const result = await dispatcher.dispatch(invocation, { tab: { id: 7 }, frameId: 0 });
    assert.isFalse(result.ok);
    assert.equal("COMMAND_CANCELLED", result.code);
  });

  should("route custom and upstream background commands and catch failures", async () => {
    const commands = new Map([
      ["OpenKeyMouse.toggleKeyboard", {
        name: "OpenKeyMouse.toggleKeyboard",
        execution: "background",
        dangerous: false,
      }],
      ["removeTab", { name: "removeTab", execution: "background", dangerous: true }],
      ["explode", { name: "explode", execution: "background", dangerous: false }],
    ]);
    const calls = [];
    const browserAdapter = {
      execute: async (invocation) => {
        calls.push(["custom", invocation.commandName]);
        return { ok: true, code: "OK", data: { custom: true } };
      },
      executeExisting: async (name) => {
        calls.push(["upstream", name]);
        if (name === "explode") throw new Error("adapter failed");
        return { ok: true, code: "OK" };
      },
    };
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: { getCommand: (name) => commands.get(name) || null },
      browserAdapter,
      backgroundCommands: {},
    });
    const custom = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation(
        "OpenKeyMouse.toggleKeyboard",
        {},
        { type: "ui" },
        {},
      ),
      { tab: { id: 1 } },
    );
    assert.isTrue(custom.ok);
    const upstream = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation("removeTab", {}, { type: "ui" }, {}),
      { tab: { id: 1 } },
    );
    assert.isTrue(upstream.ok);
    const failed = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation("explode", {}, { type: "ui" }, {}),
      { tab: { id: 1 } },
    );
    assert.equal("COMMAND_FAILED", failed.code);
    assert.equal(
      [["custom", "OpenKeyMouse.toggleKeyboard"], ["upstream", "removeTab"], [
        "upstream",
        "explode",
      ]],
      calls,
    );
  });

  should("honor frame routing, empty page results and active gesture sessions", async () => {
    const commands = new Map([
      ["top", { name: "top", execution: "topFrame", dangerous: false }],
      ["page", { name: "page", execution: "page", dangerous: false }],
    ]);
    const messages = [];
    stub(chrome.tabs, "sendMessage", async (_tabId, message, options) => {
      messages.push({ message, options });
      return undefined;
    });
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: { getCommand: (name) => commands.get(name) || null },
      browserAdapter: {},
      backgroundCommands: {},
      gestureCoordinator: { isActive: () => true },
    });
    const top = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation("top", {}, { type: "mouseGesture" }, {}),
      { tab: { id: 2 }, frameId: 5 },
    );
    const page = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation("page", {}, { type: "mouseGesture" }, {}),
      { tab: { id: 2 }, frameId: 5 },
    );
    assert.isTrue(top.ok);
    assert.isTrue(page.ok);
    assert.equal({ frameId: 0 }, messages[0].options);
    assert.equal({ frameId: 5 }, messages[1].options);
    assert.equal("openKeyMouse.executePageCommand", messages[0].message.type);
  });

  should("reject invalid or unavailable page dispatches and evict old request keys", async () => {
    const commands = new Map([
      ["page", { name: "page", execution: "page", dangerous: false }],
      ["removeTab", { name: "removeTab", execution: "background", dangerous: true }],
    ]);
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: { getCommand: (name) => commands.get(name) || null },
      browserAdapter: {},
      backgroundCommands: {},
    });
    const invalid = await dispatcher.dispatch({ protocolVersion: 99 }, {});
    assert.equal("INVALID_OPTIONS", invalid.code);
    stub(chrome.tabs, "query", async () => []);
    const noTab = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation("page"),
      {},
    );
    assert.equal("NO_ACTIVE_TAB", noTab.code);
    for (let index = 0; index < 258; index++) {
      dispatcher.rememberRequest({ commandName: "removeTab", requestId: `request-${index}` }, 1);
    }
    assert.equal(256, dispatcher.seenDangerousRequests.size);
    assert.isFalse(dispatcher.rememberRequest({ commandName: "page", requestId: "page-1" }, 1));
  });

  should("convert tab message failures into command failures", async () => {
    stub(chrome.tabs, "sendMessage", async () => {
      throw new Error("message failed");
    });
    const dispatcher = new OpenKeyMouseCommandDispatcher({
      registry: registry(),
      browserAdapter: {},
      backgroundCommands: {},
    });
    const result = await dispatcher.dispatch(
      OpenKeyMouseCommandInvocation.createInvocation("scrollDown"),
      { tab: { id: 1 } },
    );
    assert.equal("COMMAND_FAILED", result.code);
    assert.equal("message failed", result.message);
  });
});
