import "../test_helper.js";
import "../../../lib/open_key_mouse/command_invocation.js";
import "../../../lib/open_key_mouse/message_protocol.js";

context("Message protocol", () => {
  should("accept only known message types and plain data", () => {
    const message = OpenKeyMouseMessageProtocol.create("openKeyMouse.gestureUpdate", {
      requestId: "request-1234",
      direction: "R",
    });
    assert.isTrue(OpenKeyMouseMessageProtocol.validate(message));
    assert.isFalse(
      OpenKeyMouseMessageProtocol.validate({ protocolVersion: 1, type: "unknown", fn: () => {} }),
    );
  });

  should("reject a sender from another extension", () => {
    assert.isFalse(OpenKeyMouseMessageProtocol.isTrustedSender({ id: "other" }, "openkeymouse"));
    assert.isTrue(
      OpenKeyMouseMessageProtocol.isTrustedSender({ id: "openkeymouse" }, "openkeymouse"),
    );
  });

  should("validate sender shapes, errors and responses", () => {
    const protocol = OpenKeyMouseMessageProtocol;
    let threw = false;
    try {
      protocol.create("unknown");
    } catch (_) {
      threw = true;
    }
    assert.isTrue(threw);
    assert.isFalse(protocol.validate(null));
    assert.isFalse(protocol.validate({ protocolVersion: 2, type: "openKeyMouse.invoke" }));
    assert.isFalse(
      protocol.validate({ protocolVersion: 1, type: "openKeyMouse.invoke", bad: new Date() }),
    );
    assert.isFalse(protocol.isTrustedSender(null, "id"));
    assert.isFalse(protocol.isTrustedSender({ id: 1 }, "id"));
    assert.isFalse(protocol.isTrustedSender({ id: "other" }, "id"));
    assert.isTrue(protocol.isTrustedSender({}, "id"));
    assert.equal({
      protocolVersion: 1,
      type: "openKeyMouse.result",
      requestId: "request-1",
      result: { ok: true },
    }, protocol.response("request-1", { ok: true }));
  });
});
