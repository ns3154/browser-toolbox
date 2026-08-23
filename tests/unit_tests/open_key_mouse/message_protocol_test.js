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
});
