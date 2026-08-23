// 统一命令 Dispatcher。输入模块只提交 Invocation，不直接触碰 tabs、windows 或业务函数。
(function () {
  const invocationApi = globalThis.OpenKeyMouseCommandInvocation;
  const protocol = globalThis.OpenKeyMouseMessageProtocol;

  class CommandDispatcher {
    constructor({ registry, browserAdapter, backgroundCommands, gestureCoordinator = null }) {
      this.registry = registry;
      this.browserAdapter = browserAdapter;
      this.backgroundCommands = backgroundCommands;
      this.gestureCoordinator = gestureCoordinator;
      this.seenDangerousRequests = new Map();
    }

    rememberRequest(invocation, tabId) {
      if (
        !invocationApi.DANGEROUS_COMMANDS.has(invocation.commandName) &&
        !this.registry.getCommand(invocation.commandName)?.dangerous
      ) {
        return false;
      }
      const key = `${tabId ?? "none"}:${invocation.requestId}`;
      if (this.seenDangerousRequests.has(key)) return true;
      this.seenDangerousRequests.set(key, Date.now());
      if (this.seenDangerousRequests.size > 256) {
        const first = this.seenDangerousRequests.keys().next().value;
        this.seenDangerousRequests.delete(first);
      }
      return false;
    }

    async dispatch(invocation, sender = {}) {
      const validation = invocationApi.validateInvocation(invocation, this.registry);
      if (!validation.ok) return validation;
      const tabId = sender.tab?.id ?? invocation.context?.tabId;
      if (invocation.source.type === "mouseGesture" && this.gestureCoordinator) {
        if (!this.gestureCoordinator.isActive(tabId, sender.frameId, invocation.requestId)) {
          return invocationApi.createResult(false, invocationApi.ERROR_CODES.COMMAND_CANCELLED);
        }
      }
      if (this.rememberRequest(invocation, tabId)) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.DUPLICATE_REQUEST);
      }
      const command = this.registry.getCommand(invocation.commandName);
      try {
        if (command.execution === "background") {
          const custom = invocation.commandName.startsWith("OpenKeyMouse.");
          return custom
            ? await this.browserAdapter.execute(invocation, sender)
            : await this.browserAdapter.executeExisting(
              invocation.commandName,
              invocation,
              sender,
              this.backgroundCommands,
            );
        }
        return await this.dispatchToPage(invocation, sender, command.execution === "topFrame");
      } catch (error) {
        return invocationApi.createResult(
          false,
          invocationApi.ERROR_CODES.COMMAND_FAILED,
          error.message,
        );
      }
    }

    async dispatchToPage(invocation, sender, topFrame) {
      let tab = sender.tab;
      if (!tab) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs?.[0];
      }
      if (!tab?.id) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_ACTIVE_TAB);
      }
      const options = topFrame
        ? { frameId: 0 }
        : sender.frameId == null
        ? {}
        : { frameId: sender.frameId };
      const message = protocol.create("openKeyMouse.executePageCommand", { invocation });
      message.handler = message.type;
      const result = await chrome.tabs.sendMessage(tab.id, message, options);
      return result?.ok == null ? invocationApi.createResult(true) : result;
    }
  }

  globalThis.OpenKeyMouseCommandDispatcher = CommandDispatcher;
})();
