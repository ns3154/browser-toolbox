// Runtime 消息协议。消息只接受固定类型，不执行消息中传入的函数名或脚本。
(function () {
  const protocol = globalThis.OpenKeyMouseCommandInvocation;
  const MESSAGE_TYPES = new Set([
    "openKeyMouse.invoke",
    "openKeyMouse.effectiveSettings",
    "openKeyMouse.executePageCommand",
    "openKeyMouse.gestureStart",
    "openKeyMouse.gestureUpdate",
    "openKeyMouse.gestureFinish",
    "openKeyMouse.gestureCancel",
    "openKeyMouse.settingsChanged",
  ]);

  function create(type, payload = {}) {
    if (!MESSAGE_TYPES.has(type)) throw new Error(`Unsupported message type: ${type}`);
    return Object.assign({ protocolVersion: protocol.PROTOCOL_VERSION, type }, payload);
  }

  function validate(message) {
    if (!message || message.protocolVersion !== protocol.PROTOCOL_VERSION) return false;
    if (!MESSAGE_TYPES.has(message.type)) return false;
    return protocol.isPlainData(message);
  }

  function isTrustedSender(sender, runtimeId) {
    if (!sender || typeof sender !== "object") return false;
    if (runtimeId && sender.id && sender.id !== runtimeId) return false;
    return sender.id == null || typeof sender.id === "string";
  }

  function response(requestId, result) {
    return {
      protocolVersion: protocol.PROTOCOL_VERSION,
      type: "openKeyMouse.result",
      requestId,
      result,
    };
  }

  globalThis.OpenKeyMouseMessageProtocol = Object.freeze({
    MESSAGE_TYPES,
    create,
    validate,
    isTrustedSender,
    response,
  });
})();
