import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../lib/browser_toolbox/message_protocol.js";

context("Message protocol", () => {
  should("accept only known message types and plain data", () => {
    const message = BrowserToolboxMessageProtocol.create("browserToolbox.gestureUpdate", {
      requestId: "request-1234",
      direction: "R",
    });
    assert.isTrue(BrowserToolboxMessageProtocol.validate(message));
    assert.isFalse(
      BrowserToolboxMessageProtocol.validate({ protocolVersion: 1, type: "unknown", fn: () => {} }),
    );
  });

  should("reject a sender from another extension", () => {
    assert.isFalse(
      BrowserToolboxMessageProtocol.isTrustedSender({ id: "other" }, "browsertoolbox"),
    );
    assert.isTrue(
      BrowserToolboxMessageProtocol.isTrustedSender({ id: "browsertoolbox" }, "browsertoolbox"),
    );
  });

  should("validate sender shapes, errors and responses", () => {
    const protocol = BrowserToolboxMessageProtocol;
    let threw = false;
    try {
      protocol.create("unknown");
    } catch (_) {
      threw = true;
    }
    assert.isTrue(threw);
    assert.isFalse(protocol.validate(null));
    assert.isFalse(protocol.validate({ protocolVersion: 2, type: "browserToolbox.invoke" }));
    assert.isFalse(
      protocol.validate({ protocolVersion: 1, type: "browserToolbox.invoke", bad: new Date() }),
    );
    assert.isFalse(protocol.isTrustedSender(null, "id"));
    assert.isFalse(protocol.isTrustedSender({ id: 1 }, "id"));
    assert.isFalse(protocol.isTrustedSender({ id: "other" }, "id"));
    assert.isFalse(protocol.isTrustedSender({}, "id"));
    assert.isFalse(protocol.isTrustedSender({ id: "id" }, null));
    assert.equal({
      protocolVersion: 1,
      type: "browserToolbox.result",
      requestId: "request-1",
      result: { ok: true },
    }, protocol.response("request-1", { ok: true }));
  });
});
