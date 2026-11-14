// SPDX-License-Identifier: GPL-3.0-or-later
// 页面命令门面供键盘、鼠标和 UI 共用；旧函数表仅在该兼容边界内解析。
(function () {
  const invocationApi = globalThis.BrowserToolboxCommandInvocation;
  async function copyText(text) {
    if (typeof text !== "string" || text.length === 0) {
      return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_MATCHING_ELEMENT);
    }
    try {
      await navigator.clipboard.writeText(text);
      return invocationApi.createResult(true);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.documentElement.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand?.("copy") === true;
      textarea.remove();
      return ok
        ? invocationApi.createResult(true)
        : invocationApi.createResult(false, invocationApi.ERROR_CODES.CLIPBOARD_DENIED);
    }
  }

  async function executePageInvocation(invocation) {
    const entry = Object.assign(
      {},
      globalThis.BrowserToolboxCommandRegistry?.getCommand?.(invocation.commandName) || {},
      {
        command: invocation.commandName,
        options: invocation.options || {},
      },
    );
    const count = invocation.protocolVersion === 2 ? invocation.count : invocation.count || 1;
    const command = globalThis.BrowserToolboxPageCommandExecutorInstance.implementations.get(
      invocation.commandName,
    ) || globalThis.NormalModeCommands?.[invocation.commandName];
    if (typeof command === "function") {
      const descriptor = globalThis.BrowserToolboxCommandDefinitions?.getCommand(
        invocation.commandName,
      );
      let opened;
      if (descriptor?.execution === "topFrame") {
        opened = await command(invocation.context?.sourceFrameId ?? 0, entry);
      } else {opened = await command(count, {
          registryEntry: entry,
          executionDeadline: invocation.protocolVersion === 2
            ? Date.now() + descriptor.countPolicy.executionBudgetMs
            : null,
        });}
      if (
        invocation.protocolVersion === 2 && descriptor?.resultKind === "interaction" &&
        opened === false
      ) {
        return invocationApi.createResult(false, "CANCELLED");
      }
      return invocationApi.createResult(
        true,
        invocation.protocolVersion === 2 && descriptor?.resultKind === "interaction"
          ? "INTERACTION_OPENED"
          : "OK",
      );
    }
    const context = invocation.context || {};
    switch (invocation.commandName) {
      case "BrowserToolbox.copySelection":
        return copyText(globalThis.getSelection?.()?.toString() || context.selectedText || "");
      case "BrowserToolbox.copyLinkText":
        return copyText(context.linkText || "");
      case "BrowserToolbox.copyLinkUrl":
      case "BrowserToolbox.copyImageUrl":
        return copyText(context.linkUrl || context.imageUrl || "");
      case "BrowserToolbox.downloadImage": {
        const url = context.imageUrl;
        if (!invocationApi.isAllowedUrl(url)) {
          return invocationApi.createResult(
            false,
            invocationApi.ERROR_CODES.BLOCKED_URL_SCHEME,
            url,
          );
        }
        const link = document.createElement("a");
        link.href = url;
        link.download = "";
        link.rel = "noreferrer";
        link.style.display = "none";
        document.documentElement.appendChild(link);
        link.click();
        link.remove();
        return invocationApi.createResult(true);
      }
      default:
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.UNKNOWN_COMMAND);
    }
  }

  class PageCommandExecutor {
    constructor() {
      this.implementations = new Map();
    }

    registerImplementations(commands) {
      const entries = Object.entries(commands);
      if (entries.some(([name, fn]) => typeof fn !== "function" || this.implementations.has(name))) {
        throw new Error("PAGE_IMPLEMENTATION_ALREADY_OWNED");
      }
      for (const [name, fn] of entries) this.implementations.set(name, fn);
      return () => {
        for (const [name, fn] of entries) {
          if (this.implementations.get(name) === fn) this.implementations.delete(name);
        }
      };
    }
    async execute(invocation) {
      const host = globalThis.BrowserToolboxRuntimeHostInstance;
      if (host?.maintenancePaused) return invocationApi.createResult(false, "STALE_RUNTIME");
      if (host?.disposed) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.EXTENSION_CONTEXT_LOST);
      }
      if (invocation.protocolVersion === 2) {
        if (
          !host || host.state !== "active" ||
          invocation.identity?.documentId !== host.context.documentId ||
          invocation.identity?.runtimeEpoch !== host.runtimeEpoch
        ) return invocationApi.createResult(false, "STALE_RUNTIME");
        if (invocation.identity.planVersion != null && invocation.identity.planVersion !== host.plan.planVersion) {
          return invocationApi.createResult(false, "RUNTIME_PLAN_MISMATCH");
        }
        if (
          (invocation.context?.sourceDocumentId || invocation.identity.documentId) ===
            host.context.documentId &&
          invocation.context?.interactionEpoch != null &&
          invocation.context.interactionEpoch !== host.interactionEpoch &&
          BrowserToolboxCommandDefinitions.getCommand(invocation.commandName)?.resultKind ===
            "interaction"
        ) return invocationApi.createResult(false, "CANCELLED");
        const validation = invocationApi.validateInvocation(
          invocation,
          BrowserToolboxCommandDefinitions,
          { keyboardTrusted: invocation.source.type === "keyboard" },
        );
        if (!validation.ok) return validation;
        invocation = invocationApi.normalizeInvocation(
          invocation,
          BrowserToolboxCommandDefinitions.getCommand(invocation.commandName),
        );
      }
      return executePageInvocation(invocation);
    }

    invoke(invocation) {
      const descriptor = BrowserToolboxCommandDefinitions.getCommand(invocation.commandName);
      if (descriptor?.execution === "page") return this.execute(invocation);
      const message = BrowserToolboxMessageProtocol.envelope(
        "command",
        "invoke",
        { invocation },
        invocation.identity,
      );
      message.requestId = invocation.requestId;
      return chrome.runtime.sendMessage(message).then((result) => {
        const host = globalThis.BrowserToolboxRuntimeHostInstance;
        if (
          host?.state !== "active" || host.suspended ||
          host.runtimeEpoch !== invocation.identity.runtimeEpoch ||
          host.context.documentId !== invocation.identity.documentId
        ) return invocationApi.createResult(false, "STALE_RUNTIME");
        if (
          result?.requestId !== invocation.requestId ||
          result.documentId !== invocation.identity.documentId ||
          result.runtimeEpoch !== invocation.identity.runtimeEpoch
        ) return invocationApi.createResult(false, "RESULT_UNKNOWN");
        return result;
      }).catch(() => invocationApi.createResult(false, "RESULT_UNKNOWN"));
    }

    executeCompatibility(registryEntry, count) {
      const command = this.implementations.get(registryEntry.command) || globalThis.NormalModeCommands?.[registryEntry.command];
      if (typeof command !== "function") throw new Error("UNKNOWN_PAGE_COMMAND");
      // 旧键盘语义不经过 v1 的次数上限，Phase 3 再通过正式版本适配迁入。
      return command(count, { registryEntry });
    }

    executeCompatibilityTopFrame(registryEntry, sourceFrameId) {
      const command = this.implementations.get(registryEntry.command) || globalThis.NormalModeCommands?.[registryEntry.command];
      if (typeof command !== "function") throw new Error("UNKNOWN_PAGE_COMMAND");
      return command(sourceFrameId, registryEntry);
    }
  }
  globalThis.BrowserToolboxPageCommandExecutor = PageCommandExecutor;
  globalThis.BrowserToolboxPageCommandExecutorInstance ||= new PageCommandExecutor();
  globalThis.BrowserToolboxPageExecutor = (invocation) =>
    globalThis.BrowserToolboxPageCommandExecutorInstance.execute(invocation);
})();
