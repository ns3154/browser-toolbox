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
  const ACTIONS = Object.freeze({
    command: new Set(["invoke", "execute"]),
    lifecycle: new Set(["register", "unregister", "initialize", "ready", "relay", "hints", "marks"]),
    ui: new Set(["authorize", "claim", "attest", "finalize", "release", "submitVomnibar", "captureFocus", "restoreFocus"]),
  });

  function envelope(kind, action, payload = {}, identity = null) {
    if (!ACTIONS[kind]?.has(action)) throw new Error("INVALID_MESSAGE_ACTION");
    return {
      handler: "browserToolbox.message",
      protocolVersion: 2,
      requestId: protocol.requestId(),
      kind,
      action,
      payload,
      identity,
    };
  }

  function validateEnvelope(message) {
    return message?.protocolVersion === 2 && ACTIONS[message.kind]?.has(message.action) &&
      typeof message.requestId === "string" && /^[a-zA-Z0-9-]{8,128}$/.test(message.requestId) &&
      protocol.isPlainRecord(message.payload) && protocol.isPlainData(message.payload) &&
      (message.identity === null ||
        protocol.isPlainRecord(message.identity) && protocol.isPlainData(message.identity));
  }

  // 私有组件端口只委托这四种数据动作；额外字段不能变成后台命令选项。
  function validateVomnibarSubmission(value) {
    if (!protocol.isPlainRecord(value) || !protocol.isPlainData(value)) return false;
    const text = (item) => typeof item === "string" && item.length > 0 && item.length <= 65536;
    let keys;
    if (["openUrlInCurrentTab", "openUrlInNewTab"].includes(value.handler)) {
      if (!text(value.url)) return false;
      keys = ["handler", "url"];
    } else if (value.handler === "launchSearchQuery") {
      if (!text(value.query) || typeof value.openInNewTab !== "boolean") return false;
      keys = ["handler", "query", "openInNewTab"];
    } else if (value.handler === "selectSpecificTab") {
      if (!Number.isInteger(value.id) || value.id < 0) return false;
      keys = ["handler", "id"];
    } else return false;
    return Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key));
  }

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
    envelope,
    validateEnvelope,
    validateVomnibarSubmission,
  });
})();
