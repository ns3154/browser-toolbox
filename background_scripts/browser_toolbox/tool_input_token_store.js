// 工具输入一次性令牌：只在 session storage 保存短期、绑定工具的本地输入。
(function () {
  const contract = globalThis.BrowserToolboxToolContract;
  const registry = globalThis.BrowserToolboxToolRegistry;
  const TOKEN_PREFIX = "browserToolboxToolInput:";
  const TOKEN_BYTES = 16;
  const TTL_MS = 60 * 1000;
  const MAX_STORAGE_BYTES = 1 * 1024 * 1024;
  const tokenPattern = /^[a-f0-9]{32}$/;
  const lockedTokens = new Set();

  function createToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function serializedSize(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  function assertInput(input, descriptor) {
    if (typeof input !== "string") throw new Error("工具输入必须是字符串。");
    const size = new TextEncoder().encode(input).byteLength;
    if (size > Math.min(descriptor.maxInputBytes, MAX_STORAGE_BYTES)) {
      throw new Error("工具输入超过本地一次性令牌大小限制。");
    }
    return size;
  }

  class ToolInputTokenStore {
    constructor(storage = chrome.storage.session) {
      this.storage = storage;
    }

    async put({ toolId, input, source = "selection", tabId = null }) {
      const descriptor = registry.get(toolId);
      if (!descriptor || !descriptor.allowedSources.includes(source)) {
        throw new Error("工具或输入来源无效。");
      }
      const inputBytes = descriptor.inputMode === "none" ? 0 : assertInput(input || "", descriptor);
      const token = createToken();
      const now = Date.now();
      const value = {
        token,
        toolId,
        source,
        input: descriptor.inputMode === "none" ? "" : input || "",
        tabId: Number.isInteger(tabId) ? tabId : null,
        createdAt: now,
        expiresAt: now + TTL_MS,
      };
      if (serializedSize(value) > MAX_STORAGE_BYTES) {
        throw new Error("工具输入令牌超过 session storage 限制。");
      }
      await this.storage.set({ [`${TOKEN_PREFIX}${token}`]: value });
      return token;
    }

    async consume(token, toolId, source = null) {
      if (!tokenPattern.test(token || "") || !registry.has(toolId)) return null;
      if (lockedTokens.has(token)) return null;
      lockedTokens.add(token);
      const key = `${TOKEN_PREFIX}${token}`;
      try {
        const values = await this.storage.get(key);
        const value = values?.[key];
        // 先删除再返回，令牌即使被页面重复提交也不能再次使用。
        await this.storage.remove(key);
        const now = Date.now();
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        if (
          value.token !== token || value.toolId !== toolId ||
          (source != null && value.source !== source) ||
          !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) ||
          value.createdAt > now || value.expiresAt <= now ||
          value.expiresAt - value.createdAt > TTL_MS
        ) return null;
        const descriptor = registry.get(toolId);
        if (!descriptor.allowedSources.includes(value.source)) return null;
        if (descriptor.inputMode !== "none" && typeof value.input !== "string") return null;
        if (descriptor.inputMode === "none" && value.input !== "") return null;
        if (value.tabId !== null && !Number.isInteger(value.tabId)) return null;
        try {
          if (descriptor.inputMode !== "none") assertInput(value.input, descriptor);
        } catch (_) {
          return null;
        }
        return {
          toolId,
          source: value.source,
          input: descriptor.inputMode === "none" ? "" : value.input,
          tabId: value.tabId,
        };
      } finally {
        lockedTokens.delete(token);
      }
    }

    async cleanup(now = Date.now()) {
      if (!this.storage?.get || !this.storage?.remove) return 0;
      const values = await this.storage.get(null);
      const expired = [];
      for (const [key, value] of Object.entries(values || {})) {
        if (!key.startsWith(TOKEN_PREFIX)) continue;
        const token = key.slice(TOKEN_PREFIX.length);
        const descriptor = registry.get(value?.toolId);
        let invalidInput = !descriptor;
        if (descriptor?.inputMode === "none") invalidInput = value.input !== "";
        else if (descriptor) {
          try {
            assertInput(value.input, descriptor);
          } catch (_) {
            invalidInput = true;
          }
        }
        if (
          !value || typeof value !== "object" || Array.isArray(value) ||
          !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt) ||
          value.createdAt > now || value.expiresAt <= now ||
          value.expiresAt - value.createdAt > TTL_MS ||
          typeof value.token !== "string" || value.token !== token || !tokenPattern.test(value.token) ||
          !descriptor || !descriptor.allowedSources.includes(value.source) ||
          (value.tabId !== null && !Number.isInteger(value.tabId)) || invalidInput
        ) expired.push(key);
      }
      if (expired.length > 0) await this.storage.remove(expired);
      return expired.length;
    }
  }

  globalThis.BrowserToolboxToolInputTokenStore = Object.freeze({
    TOKEN_PREFIX,
    TOKEN_BYTES,
    TTL_MS,
    MAX_STORAGE_BYTES,
    tokenPattern,
    createToken,
    serializedSize,
    ToolInputTokenStore,
  });
  globalThis.BrowserToolboxToolInputTokenStoreInstance ||= new ToolInputTokenStore();
})();
