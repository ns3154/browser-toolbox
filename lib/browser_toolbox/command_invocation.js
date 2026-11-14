// 统一命令调用的数据模型和安全校验。
/**
 * 浏览器工具箱跨输入层传递的命令调用。
 * @typedef {Object} BrowserToolboxCommandInvocation
 * @property {number} protocolVersion 协议版本。
 * @property {string} requestId 请求去重标识。
 * @property {string} commandName 命令名称。
 * @property {number} count 重复执行次数。
 * @property {Object} source 输入来源。
 * @property {Object} context 页面上下文。
 * @property {Object} options 命令参数。
 */
/**
 * 命令执行结果。
 * @typedef {Object} BrowserToolboxCommandResult
 * @property {boolean} ok 是否成功。
 * @property {string} code 稳定错误码或 OK。
 * @property {string} [message] 可展示的错误说明。
 * @property {unknown} [data] 命令返回数据。
 */
(function () {
  const clone = globalThis.BrowserToolboxValueUtils.clone;
  const PROTOCOL_VERSION = 1;
  const MAX_REPEAT_COUNT = 50;
  const MAX_DANGEROUS_REPEAT_COUNT = 10;
  const INPUT_TYPES = new Set([
    "keyboard",
    "mouseGesture",
    "superDrag",
    "wheel",
    "rocker",
    "ui",
  ]);
  const DANGEROUS_COMMANDS = new Set([
    "removeTab",
    "restoreTab",
    "closeTabsOnLeft",
    "closeTabsOnRight",
    "closeOtherTabs",
    "BrowserToolbox.closeWindow",
    "BrowserToolbox.minimizeWindow",
  ]);
  const ERROR_CODES = Object.freeze({
    OK: "OK",
    UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
    INVALID_OPTIONS: "INVALID_OPTIONS",
    UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
    PERMISSION_DENIED: "PERMISSION_DENIED",
    NO_ACTIVE_TAB: "NO_ACTIVE_TAB",
    NO_MATCHING_ELEMENT: "NO_MATCHING_ELEMENT",
    CLIPBOARD_DENIED: "CLIPBOARD_DENIED",
    BLOCKED_URL_SCHEME: "BLOCKED_URL_SCHEME",
    EXTENSION_CONTEXT_LOST: "EXTENSION_CONTEXT_LOST",
    COMMAND_FAILED: "COMMAND_FAILED",
    COMMAND_CANCELLED: "COMMAND_CANCELLED",
    DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  });

  function requestId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function isPlainData(value, depth = 0) {
    if (depth > 5 || value == null) {
      return value == null || ["string", "number", "boolean"].includes(typeof value);
    }
    if (["string", "number", "boolean"].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every((item) => isPlainData(item, depth + 1));
    if (typeof value !== "object" || value.constructor !== Object) return false;
    return Object.values(value).every((item) => isPlainData(item, depth + 1));
  }

  function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasRequiredContext(requiredContext, context = {}, binding = {}) {
    for (const requirement of requiredContext || []) {
      if (
        requirement === "link" &&
        (typeof context.linkUrl !== "string" || context.linkUrl.length === 0) &&
        binding.context !== "LINK"
      ) return false;
      if (
        requirement === "image" &&
        (typeof context.imageUrl !== "string" || context.imageUrl.length === 0) &&
        binding.context !== "IMAGE"
      ) return false;
      if (
        requirement === "selection" &&
        (typeof context.selectedText !== "string" || context.selectedText.trim().length === 0) &&
        binding.context !== "SELECTED_TEXT"
      ) return false;
      if (
        requirement === "pointer" &&
        (!context.pointer || !Number.isFinite(context.pointer.x) ||
          !Number.isFinite(context.pointer.y))
      ) return false;
    }
    return true;
  }

  function validateOptionSchema(command, options, { v2 = false } = {}) {
    if (options == null || typeof options !== "object" || Array.isArray(options)) {
      return "Options must be a plain object.";
    }
    if (!isPlainData(options)) return "Options must contain plain data only.";
    const optionSchema = v2 ? command?.parameterSchema : command?.optionSchema;
    if (!optionSchema) return null;
    for (const [name, value] of Object.entries(options)) {
      const rule = optionSchema[name] || (v2 ? optionSchema["(any url)"] : null);
      if (!rule) return `Unknown option: ${name}.`;
      if (rule.type === "boolean" && typeof value !== "boolean") {
        return `Option ${name} must be a boolean.`;
      }
      if (rule.type === "string" && typeof value !== "string") {
        return `Option ${name} must be a string.`;
      }
      if (
        rule.type === "mappingScalar" && !["boolean", "string", "number"].includes(typeof value)
      ) {
        return `Option ${name} must be a mapping scalar.`;
      }
      if (
        typeof value === "string" && rule.maxLength != null &&
        value.length > rule.maxLength
      ) {
        return `Option ${name} is too long.`;
      }
      if (rule.type === "enum" && (!rule.values || !rule.values.includes(value))) {
        return `Option ${name} has an invalid value.`;
      }
    }
    return null;
  }

  function validateCommandMetadata(
    command,
    { source = "ui", context = {}, contextType = null, options = {}, v2 = false } = {},
  ) {
    if (!command) return { ok: false, error: "Unknown command." };
    if (Array.isArray(command.supportedInputs) && !command.supportedInputs.includes(source)) {
      return { ok: false, error: `${command.name} does not support ${source}.` };
    }
    const binding = contextType ? { context: contextType } : {};
    if (!hasRequiredContext(command.requiredContext, context, binding)) {
      return { ok: false, error: `${command.name} requires a matching page context.` };
    }
    const optionError = validateOptionSchema(command, options, { v2 });
    if (optionError) return { ok: false, error: optionError };
    return { ok: true, command };
  }

  function isAllowedUrl(value, { allowExtension = true } = {}) {
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
    let url;
    try {
      url = new URL(value, globalThis.location?.href || "https://browsertoolbox.invalid/");
    } catch (_) {
      return false;
    }
    if (["http:", "https:", "file:", "ftp:", "mailto:"].includes(url.protocol)) return true;
    if (allowExtension && ["chrome-extension:", "moz-extension:"].includes(url.protocol)) {
      const ownExtensionUrl = globalThis.chrome?.runtime?.getURL?.("");
      return typeof ownExtensionUrl === "string" && ownExtensionUrl.length > 0 &&
        url.href.startsWith(ownExtensionUrl);
    }
    return false;
  }

  /**
   * 创建统一的命令结果。
   * @param {boolean} ok 是否成功。
   * @param {string} [code] 错误码。
   * @param {unknown} [message] 错误说明。
   * @param {unknown} [data] 返回数据。
   * @returns {BrowserToolboxCommandResult} 规范化结果。
   */
  function createResult(
    ok,
    code = ok ? ERROR_CODES.OK : ERROR_CODES.COMMAND_FAILED,
    message,
    data,
  ) {
    const result = { ok: Boolean(ok), code };
    if (message != null) result.message = String(message);
    if (data !== undefined) result.data = data;
    return result;
  }

  /**
   * 校验来自输入层或 Runtime 的命令调用。
   * @param {unknown} invocation 待校验调用。
   * @param {Object} registry 命令注册表。
   * @returns {BrowserToolboxCommandResult} 校验结果。
   */
  function validateInvocation(invocation, registry, { keyboardTrusted = false } = {}) {
    const v2 = invocation?.protocolVersion === 2;
    if (!invocation || ![PROTOCOL_VERSION, 2].includes(invocation.protocolVersion)) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Unsupported command protocol.");
    }
    if (
      typeof invocation.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{8,128}$/.test(invocation.requestId)
    ) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Invalid request id.");
    }
    if (typeof invocation.commandName !== "string" || invocation.commandName.length > 128) {
      return createResult(false, ERROR_CODES.UNKNOWN_COMMAND, "Unknown command.");
    }
    const command = registry?.getCommand?.(invocation.commandName);
    if (!command) return createResult(false, ERROR_CODES.UNKNOWN_COMMAND, invocation.commandName);
    if (v2 && (typeof invocation.countProvided !== "boolean" || !command.countPolicy)) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Invalid count contract.");
    }
    const nullable = v2 && invocation.count === null && !invocation.countProvided &&
      command.countPolicy.nullable;
    const trustedKeyboard = v2 && invocation.source?.type === "keyboard" && keyboardTrusted;
    if (v2 && invocation.source?.type === "keyboard" && !trustedKeyboard) {
      return createResult(false, ERROR_CODES.PERMISSION_DENIED, "Keyboard identity required.");
    }
    if (
      !nullable &&
      (!Number.isSafeInteger(invocation.count) || !trustedKeyboard && invocation.count < 1)
    ) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Count must be a positive integer.");
    }
    const count = normalizeInvocation(invocation, command).count;
    const maxCount = trustedKeyboard
      ? command.countPolicy.keyboardHardLimit
      : command.dangerous || DANGEROUS_COMMANDS.has(invocation.commandName)
      ? MAX_DANGEROUS_REPEAT_COUNT
      : MAX_REPEAT_COUNT;
    if (
      Math.abs(invocation.count) > maxCount && !(trustedKeyboard && command.countPolicy.noRepeat)
    ) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, `Count must not exceed ${maxCount}.`);
    }
    if (!INPUT_TYPES.has(invocation.source?.type)) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Invalid input source.");
    }
    if (
      v2 && command.countPolicy.confirmationThreshold != null &&
      count > command.countPolicy.confirmationThreshold &&
      invocation.confirmationGranted !== true
    ) {
      return createResult(false, "CONFIRMATION_REQUIRED");
    }
    if (!isPlainRecord(invocation.context) || !isPlainData(invocation.context)) {
      return createResult(
        false,
        ERROR_CODES.INVALID_OPTIONS,
        "Context must contain plain data only.",
      );
    }
    if (!isPlainRecord(invocation.options) || !isPlainData(invocation.options)) {
      return createResult(
        false,
        ERROR_CODES.INVALID_OPTIONS,
        "Options must contain plain data only.",
      );
    }
    for (const key of ["linkUrl", "imageUrl"]) {
      if (invocation.context[key] != null && !isAllowedUrl(invocation.context[key])) {
        return createResult(false, ERROR_CODES.BLOCKED_URL_SCHEME, invocation.context[key]);
      }
    }
    const metadataOptions = v2
      ? Object.fromEntries(Object.entries(invocation.options).filter(([key]) => key !== "count"))
      : invocation.options;
    if (v2) {
      const keys = new Set([
        ...Object.keys(command.parameterSchema || {}),
      ]);
      for (const key of Object.keys(metadataOptions)) {
        const mappingUrl = keys.has("(any url)") &&
          (isAllowedUrl(key) ||
            trustedKeyboard && /^(?:chrome:\/\/|edge:\/\/|about:(?:blank|newtab)$)/.test(key));
        if (!keys.has(key) && !mappingUrl) {
          return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Unknown command parameter.");
        }
      }
    }
    const metadata = validateCommandMetadata(command, {
      source: invocation.source.type,
      context: invocation.context,
      options: metadataOptions,
      v2,
    });
    if (!metadata.ok) return createResult(false, ERROR_CODES.INVALID_OPTIONS, metadata.error);
    return createResult(true);
  }

  // 归一化由执行边界负责，直接协议调用也不能绕过 noRepeat；v1 的校验上限保持不变。
  function normalizeInvocation(invocation, command) {
    if (invocation.protocolVersion === 2 && command?.countPolicy?.noRepeat && invocation.count) {
      return { ...invocation, count: 1 };
    }
    return invocation;
  }

  function keyboardCount(command, options, prefix) {
    const countProvided = prefix != null || Boolean(options?.count);
    let count = options?.count ? (prefix ?? 1) * options.count : prefix;
    if (count == null && !command.countPolicy.nullable) count = 1;
    if (command.countPolicy.noRepeat && count) count = 1;
    return { count, countProvided };
  }

  /**
   * 创建带随机请求 ID 的命令调用。
   * @param {string} commandName 命令名称。
   * @param {Object} [options] 命令参数。
   * @param {Object} [source] 输入来源。
   * @param {Object} [context] 页面上下文。
   * @param {number} [count] 重复次数。
   * @returns {BrowserToolboxCommandInvocation} 新调用。
   */
  function createInvocation(
    commandName,
    options = {},
    source = { type: "ui" },
    context = {},
    count = 1,
  ) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: requestId(),
      commandName,
      options: clone(options || {}),
      count,
      source: clone(source || { type: "ui" }),
      context: clone(context || {}),
    };
  }

  function createV2(
    commandName,
    options,
    source,
    context,
    count,
    { countProvided = count != null, identity = null, confirmationGranted = false } = {},
  ) {
    const invocation = createInvocation(commandName, options, source, context, count);
    return { ...invocation, protocolVersion: 2, countProvided, identity, confirmationGranted };
  }

  globalThis.BrowserToolboxCommandInvocation = Object.freeze({
    PROTOCOL_VERSION,
    MAX_REPEAT_COUNT,
    MAX_DANGEROUS_REPEAT_COUNT,
    DANGEROUS_COMMANDS,
    ERROR_CODES,
    clone,
    isPlainData,
    isPlainRecord,
    isAllowedUrl,
    createResult,
    hasRequiredContext,
    validateOptionSchema,
    validateCommandMetadata,
    validateInvocation,
    createInvocation,
    createV2,
    requestId,
    normalizeInvocation,
    keyboardCount,
  });
})();
