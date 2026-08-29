// Runtime 消息协议。消息只接受固定类型，不执行消息中传入的函数名或脚本。
/**
 * Runtime 消息的公共字段。
 * @typedef {Object} BrowserToolboxRuntimeMessage
 * @property {number} protocolVersion 协议版本。
 * @property {string} type 固定消息类型。
 * @property {unknown} [payload] 消息数据。
 */
(function () {
  const protocol = globalThis.BrowserToolboxCommandInvocation;
  const MESSAGE_TYPES = new Set([
    "browserToolbox.invoke",
    "browserToolbox.effectiveSettings",
    "browserToolbox.executePageCommand",
    "browserToolbox.gestureStart",
    "browserToolbox.gestureUpdate",
    "browserToolbox.gestureFinish",
    "browserToolbox.gestureCancel",
    "browserToolbox.settingsChanged",
  ]);

  /**
   * 创建固定类型的 Runtime 消息。
   * @param {string} type 消息类型。
   * @param {Object} [payload] 消息负载。
   * @returns {BrowserToolboxRuntimeMessage} 新消息。
   */
  function create(type, payload = {}) {
    if (!MESSAGE_TYPES.has(type)) throw new Error(`Unsupported message type: ${type}`);
    return Object.assign({ protocolVersion: protocol.PROTOCOL_VERSION, type }, payload);
  }

  /**
   * 校验消息版本、类型和数据形状。
   * @param {unknown} message 待校验消息。
   * @returns {boolean} 是否有效。
   */
  function validate(message) {
    if (!message || message.protocolVersion !== protocol.PROTOCOL_VERSION) return false;
    if (!MESSAGE_TYPES.has(message.type)) return false;
    return protocol.isPlainData(message);
  }

  /**
   * 校验 Runtime 消息发送方是否属于当前扩展。
   * @param {unknown} sender 发送方信息。
   * @param {string} runtimeId 当前扩展 ID。
   * @returns {boolean} 是否可信。
   */
  function isTrustedSender(sender, runtimeId) {
    return Boolean(
      sender &&
        typeof sender === "object" &&
        typeof runtimeId === "string" &&
        sender.id === runtimeId,
    );
  }

  /**
   * 创建对应请求的响应消息。
   * @param {string} requestId 请求 ID。
   * @param {BrowserToolboxCommandResult|Object} result 命令结果。
   * @returns {BrowserToolboxRuntimeMessage} 响应消息。
   */
  function response(requestId, result) {
    return {
      protocolVersion: protocol.PROTOCOL_VERSION,
      type: "browserToolbox.result",
      requestId,
      result,
    };
  }

  globalThis.BrowserToolboxMessageProtocol = Object.freeze({
    MESSAGE_TYPES,
    create,
    validate,
    isTrustedSender,
    response,
  });
})();
