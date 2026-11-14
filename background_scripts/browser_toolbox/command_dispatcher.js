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
    constructor(
      {
        registry,
        browserAdapter,
        backgroundCommands,
        selectBackgroundCommands = null,
        gestureCoordinator = null,
        requestLedger = null,
        targetIdentity = null,
      },
    ) {
      this.registry = registry;
      this.browserAdapter = browserAdapter;
      this.backgroundCommands = backgroundCommands;
      this.selectBackgroundCommands = selectBackgroundCommands;
      this.gestureCoordinator = gestureCoordinator;
      this.requestLedger = requestLedger;
      this.targetIdentity = targetIdentity;
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
    async dispatch(invocation, sender = {}, authority = null, revalidate = null) {
      const keyboardTrusted = Boolean(
        authority && ["content", "ownedUi"].includes(authority.role) ||
          authority?.component === "help",
      );
      const validation = invocationApi.validateInvocation(invocation, this.registry, {
        keyboardTrusted,
      });
      if (!validation.ok) return validation;
      const command = this.registry.getCommand(invocation.commandName);
      invocation = invocationApi.normalizeInvocation(invocation, command);
      if (invocation.protocolVersion === 2 && authority && authority.role !== "ownedUi") {
        invocation = { ...invocation, context: { ...invocation.context,
          sourcePlanVersion: authority.planVersion || 1 } };
      }
      const tabId = sender.tab?.id ?? invocation.context?.tabId;
      if (invocation.source.type === "mouseGesture" && this.gestureCoordinator) {
        if (!this.gestureCoordinator.isActive(tabId, sender.frameId, invocation.requestId)) {
          return invocationApi.createResult(false, invocationApi.ERROR_CODES.COMMAND_CANCELLED);
        }
      }
      if (this.rememberRequest(invocation, tabId)) {
        return invocationApi.createResult(false, invocationApi.ERROR_CODES.DUPLICATE_REQUEST);
      }
      const persistent = this.requestLedger &&
        (command.dangerous || invocationApi.DANGEROUS_COMMANDS.has(command.name));
      let effectStarted = false;
      let timer;
      try {
        if (persistent) {
          const failure = await this.requestLedger.begin(invocation, sender);
          if (failure) return invocationApi.createResult(false, failure);
        }
        if (revalidate) await revalidate();
        const deadline = Date.now() + (command.countPolicy?.executionBudgetMs || 30000);
        const guard = async () => {
          if (Date.now() >= deadline) {
            throw Object.assign(new Error("EXECUTION_BUDGET_EXCEEDED"), { code: "RESULT_UNKNOWN" });
          }
          if (revalidate) await revalidate();
        };
        effectStarted = true;
        let work;
        if (command.execution === "background") {
          const custom = invocation.commandName.startsWith("BrowserToolbox.");
          work = custom
            ? this.browserAdapter.execute(invocation, sender)
            : this.browserAdapter.executeExisting(
              invocation.commandName,
              invocation,
              sender,
              invocation.protocolVersion === 2 && revalidate
                ? this.selectBackgroundCommands?.(invocation, authority) || this.backgroundCommands
                : this.backgroundCommands,
              invocation.protocolVersion === 2 ? guard : null,
            );
        } else {work = this.dispatchToPage(
            invocation,
            sender,
            command.execution === "topFrame",
          );}
        let result;
        if (invocation.protocolVersion === 2) {
          // 超时只能停止等待，已交给浏览器的动作不能撤销；重复适配器会在下一动作前检查执行预算。
          result = await Promise.race([
            work,
            new Promise((resolve) =>
              timer = setTimeout(
                () => resolve(invocationApi.createResult(false, "RESULT_UNKNOWN")),
                Math.max(0, deadline - Date.now()),
              )
            ),
          ]);
        } else result = await work;
        if (persistent) {
          try {
            await this.requestLedger.complete(invocation, sender, result);
          } catch (_) {
            return invocationApi.createResult(false, "RESULT_UNKNOWN");
          }
        }
        return result;
      } catch (error) {
        const code = invocation.protocolVersion === 2
          ? effectStarted ? "RESULT_UNKNOWN" : error.code || "COMMAND_UNAVAILABLE"
          : invocationApi.ERROR_CODES.COMMAND_FAILED;
        if (persistent && effectStarted) {
          await this.requestLedger.complete(invocation, sender, { code }).catch(() => {});
        }
        return invocationApi.createResult(
          false,
          code,
          invocation.protocolVersion === 2 ? undefined : error.message,
        );
      } finally {
        clearTimeout(timer);
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
      if (invocation.source.type === "ui" && invocation.context?.tabId != null) {
        try {
          tab = await chrome.tabs.get(invocation.context.tabId);
        } catch (_) {
          return invocationApi.createResult(false, invocationApi.ERROR_CODES.NO_ACTIVE_TAB);
        }
      }
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
      let message;
      if (invocation.protocolVersion === 2) {
        const frameId = topFrame ? 0 : sender.frameId;
        const identity = await this.targetIdentity(tab.id, frameId);
        if (invocation.context.sourcePlanVersion != null &&
          identity.planVersion != null && invocation.context.sourcePlanVersion !== identity.planVersion) {
          return invocationApi.createResult(false, "RUNTIME_PLAN_MISMATCH");
        }
        options.documentId = identity.documentId;
        delete options.frameId;
        message = protocol.envelope("command", "execute", { invocation }, identity);
        message.requestId = invocation.requestId;
      } else {
        message = protocol.create("browserToolbox.executePageCommand", { invocation });
        message.handler = message.type;
      }
      const result = await chrome.tabs.sendMessage(tab.id, message, options);
      if (invocation.protocolVersion === 2 && result?.ok == null) {
        return invocationApi.createResult(false, "RESULT_UNKNOWN");
      }
      return result?.ok == null ? invocationApi.createResult(true) : result;
    }
  }

  globalThis.BrowserToolboxCommandDispatcher = CommandDispatcher;
})();
