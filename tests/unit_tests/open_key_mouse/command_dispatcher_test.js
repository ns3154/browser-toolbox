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
});
