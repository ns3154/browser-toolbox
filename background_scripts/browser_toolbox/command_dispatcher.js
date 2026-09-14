// 统一命令 Dispatcher。输入模块只提交 Invocation，不直接触碰 tabs、windows 或业务函数。
/**
 * Dispatcher 的依赖集合。
 * @typedef {Object} BrowserToolboxDispatcherDependencies
 * @property {Object} registry 命令注册表。
 * @property {Object} browserAdapter 浏览器命令适配器。
 * @property {Object} backgroundCommands 上游后台命令集合。
 * @property {Object|null} [gestureCoordinator] 跨 frame 手势协调器。
 */
(function () {
  const invocationApi = globalThis.BrowserToolboxCommandInvocation;
  const protocol = globalThis.BrowserToolboxMessageProtocol;

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

    /**
     * 校验并路由一条命令调用。
     * @param {BrowserToolboxCommandInvocation|unknown} invocation 命令调用。
     * @param {Object} [sender] Runtime 发送方上下文。
     * @returns {Promise<BrowserToolboxCommandResult>} 路由结果。
     */
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
          const custom = invocation.commandName.startsWith("BrowserToolbox.");
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

    /**
     * 将页面命令发送到目标 frame。
     * @param {BrowserToolboxCommandInvocation} invocation 命令调用。
     * @param {Object} sender Runtime 发送方上下文。
     * @param {boolean} topFrame 是否强制主 frame。
     * @returns {Promise<BrowserToolboxCommandResult>} 页面执行结果。
     */
    async dispatchToPage(invocation, sender, topFrame) {
      let tab = sender.tab;
      if (!tab && invocation.context?.tabId != null) {
        try {
          tab = await chrome.tabs.get(invocation.context.tabId);
        } catch (_) {
          // 来源标签页已关闭时继续尝试当前活动标签页，保持 UI 调用的可恢复性。
        }
      }
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
      const message = protocol.create("browserToolbox.executePageCommand", { invocation });
      message.handler = message.type;
      const result = await chrome.tabs.sendMessage(tab.id, message, options);
      return result?.ok == null ? invocationApi.createResult(true) : result;
    }
  }

  globalThis.BrowserToolboxCommandDispatcher = CommandDispatcher;
})();
