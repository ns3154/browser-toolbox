// 统一命令调用的数据模型和安全校验。
(function () {
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
    "OpenKeyMouse.closeWindow",
    "OpenKeyMouse.minimizeWindow",
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

  function clone(value) {
    return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

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

  function isAllowedUrl(value, { allowExtension = true } = {}) {
    if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
    let url;
    try {
      url = new URL(value, globalThis.location?.href || "https://openkeymouse.invalid/");
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

  function validateInvocation(invocation, registry) {
    if (!invocation || invocation.protocolVersion !== PROTOCOL_VERSION) {
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
    if (!Number.isInteger(invocation.count) || invocation.count < 1) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Count must be a positive integer.");
    }
    const maxCount = command.dangerous || DANGEROUS_COMMANDS.has(invocation.commandName)
      ? MAX_DANGEROUS_REPEAT_COUNT
      : MAX_REPEAT_COUNT;
    if (invocation.count > maxCount) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, `Count must not exceed ${maxCount}.`);
    }
    if (!INPUT_TYPES.has(invocation.source?.type)) {
      return createResult(false, ERROR_CODES.INVALID_OPTIONS, "Invalid input source.");
    }
    if (!isPlainData(invocation.options)) {
      return createResult(
        false,
        ERROR_CODES.INVALID_OPTIONS,
        "Options must contain plain data only.",
      );
    }
    if (!isPlainData(invocation.context)) {
      return createResult(
        false,
        ERROR_CODES.INVALID_OPTIONS,
        "Context must contain plain data only.",
      );
    }
    for (const key of ["linkUrl", "imageUrl"]) {
      if (invocation.context[key] != null && !isAllowedUrl(invocation.context[key])) {
        return createResult(false, ERROR_CODES.BLOCKED_URL_SCHEME, invocation.context[key]);
      }
    }
    return createResult(true);
  }

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

  globalThis.OpenKeyMouseCommandInvocation = Object.freeze({
    PROTOCOL_VERSION,
    MAX_REPEAT_COUNT,
    MAX_DANGEROUS_REPEAT_COUNT,
    DANGEROUS_COMMANDS,
    ERROR_CODES,
    clone,
    isPlainData,
    isAllowedUrl,
    createResult,
    validateInvocation,
    createInvocation,
  });
})();
