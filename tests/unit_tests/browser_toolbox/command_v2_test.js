// SPDX-License-Identifier: GPL-3.0-or-later
// 同一执行边界对照冻结的键盘语义，故障发生后以新 Dispatcher 检查去重证据。
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../lib/browser_toolbox/command_invocation.js";
import "../../../lib/browser_toolbox/message_protocol.js";
import "../../../lib/browser_toolbox/command_definitions.js";
import "../../../lib/browser_toolbox/page_command_executor.js";
import "../../../background_scripts/browser_toolbox/request_ledger.js";
import "../../../background_scripts/browser_toolbox/command_dispatcher.js";

context("v2 命令次数、时序与结果", () => {
  const api = BrowserToolboxCommandInvocation;
  const registry = BrowserToolboxCommandDefinitions;
  const sender = { tab: { id: 7, incognito: false }, frameId: 2 };
  const identity = { documentId: "synthetic-document", runtimeEpoch: 4, incognito: false };
  const authority = { role: "content" };
  const make = (name, count = 1, source = "keyboard") =>
    api.createV2(name, {}, { type: source }, {}, count, { identity });
  const validate = (invocation) =>
    api.validateInvocation(invocation, registry, { keyboardTrusted: true });
  function store() {
    const values = {};
    return {
      values,
      async get(key) {
        return structuredClone({ [key]: values[key] });
      },
      async set(items) {
        Object.assign(values, structuredClone(items));
      },
    };
  }
  should("null 范围和 100 次仅按 v2 键盘契约接受，v1 与其他来源的上限仍有效", () => {
    assert.isTrue(validate(make("closeTabsOnRight", null)).ok);
    assert.isTrue(validate(make("scrollDown", 100)).ok);
    assert.equal(
      "PERMISSION_DENIED",
      api.validateInvocation(make("scrollDown", 100), registry).code,
    );
    for (const source of ["ui", "wheel", "rocker", "superDrag", "mouseGesture"]) {
      assert.equal("INVALID_OPTIONS", validate(make("scrollDown", 100, source)).code);
    }
    for (const [name, count] of [["closeTabsOnRight", null], ["scrollDown", 100]]) {
      assert.equal(
        "INVALID_OPTIONS",
        validate(api.createInvocation(name, {}, { type: "keyboard" }, {}, count)).code,
      );
    }
    assert.isFalse(validate({ ...make("scrollDown", null), countProvided: false }).ok);
    assert.isFalse(validate({ ...make("closeTabsOnRight", null), countProvided: true }).ok);
  });
  should("乘法、显式空值、零映射和 noRepeat 与旧键盘规则保持一致", () => {
    for (
      const [name, prefix, options, expected] of [
        ["scrollDown", null, {}, { count: 1, countProvided: false }],
        ["scrollDown", 3, { count: 2 }, { count: 6, countProvided: true }],
        ["scrollDown", null, { count: 0 }, { count: 1, countProvided: false }],
        ["scrollDown", null, { count: -2 }, { count: -2, countProvided: true }],
        ["closeTabsOnRight", null, {}, { count: null, countProvided: false }],
        ["showHelp", 100, { count: 3 }, { count: 1, countProvided: true }],
      ]
    ) assert.equal(expected, api.keyboardCount(registry.getCommand(name), options, prefix));
    assert.equal("INVALID_OPTIONS", validate(make("scrollDown", Number.MAX_SAFE_INTEGER + 1)).code);
    assert.isTrue(validate(make("scrollDown", -2)).ok);
    assert.equal("INVALID_OPTIONS", validate(make("scrollDown", -2, "ui")).code);
    assert.equal(
      "INVALID_OPTIONS",
      validate({ ...make("scrollDown"), options: { arbitraryFunction: "run" } }).code,
    );
  });
  should("超过确认阈值不能执行，声明 noRepeat 的直接调用只执行一次", async () => {
    assert.equal("CONFIRMATION_REQUIRED", validate(make("createTab", 21)).code);
    assert.isTrue(validate({ ...make("createTab", 21), confirmationGranted: true }).ok);
    const counts = [];
    const dispatcher = new BrowserToolboxCommandDispatcher({
      registry,
      backgroundCommands: {},
      browserAdapter: {
        async executeExisting(_name, invocation) {
          counts.push(invocation.count);
          return { ok: true, code: "OK" };
        },
      },
    });
    assert.equal(
      "CONFIRMATION_REQUIRED",
      (await dispatcher.dispatch(make("createTab", 21), sender, authority)).code,
    );
    await dispatcher.dispatch(make("toggleMuteTab", 100), sender, authority);
    assert.equal([1], counts);
  });
  should("95 个描述具有参数和结果契约，映射文本保持旧语义并拒绝嵌套或超长参数", () => {
    for (const command of registry.listCommands()) {
      assert.isTrue(command.parameterSchema != null);
      assert.isTrue(command.resultCodes.includes("RESULT_UNKNOWN"));
      for (const alias of command.aliases) assert.equal(command, registry.getCommand(alias));
    }
    for (
      const [name, options] of [
        ["reload", { hard: "false" }],
        ["passNextKey", { normal: true }],
        ["Marks.activateGotoMode", { swap: "true" }],
        ["setZoom", { level: "1.25" }],
        ["createTab", { "https://example.invalid/fixture": true, position: "after" }],
        ["createTab", { "chrome://newtab/": true }],
        ["Vomnibar.activate", { query: "合成文字", keyword: "g" }],
      ]
    ) assert.isTrue(validate({ ...make(name), options }).ok);
    assert.equal(
      "INVALID_OPTIONS",
      validate({ ...make("reload"), options: { hard: { nested: true } } }).code,
    );
    assert.equal(
      "INVALID_OPTIONS",
      validate({ ...make("Vomnibar.activate"), options: { query: "x".repeat(8193) } }).code,
    );
    assert.equal(
      "INVALID_OPTIONS",
      validate({ ...make("createTab", 1, "ui"), options: { "chrome://newtab/": true } }).code,
    );
    assert.equal(
      "INVALID_OPTIONS",
      validate({ ...make("createTab"), options: { "javascript:alert(1)": true } }).code,
    );
  });
  should("副作用后响应丢失、完成记录失败和新 worker 都不能再次执行同一危险请求", async () => {
    const session = store();
    let effects = 0;
    const dependencies = {
      registry,
      backgroundCommands: {},
      browserAdapter: {
        async executeExisting() {
          effects++;
          throw new Error("合成响应丢失");
        },
      },
      requestLedger: new BrowserToolboxRequestLedger(session),
    };
    const invocation = make("closeTabsOnRight", null);
    assert.equal(
      "RESULT_UNKNOWN",
      (await new BrowserToolboxCommandDispatcher(dependencies).dispatch(
        invocation,
        sender,
        authority,
      )).code,
    );
    assert.equal(
      "RESULT_UNKNOWN",
      (await new BrowserToolboxCommandDispatcher({
        ...dependencies,
        requestLedger: new BrowserToolboxRequestLedger(session),
      }).dispatch(invocation, sender, authority)).code,
    );
    assert.equal(1, effects);
    const second = make("closeTabsOnRight", null);
    const next = new BrowserToolboxCommandDispatcher({
      ...dependencies,
      browserAdapter: {
        async executeExisting() {
          effects++;
          return { ok: true, code: "OK" };
        },
      },
      requestLedger: {
        begin: (...args) => dependencies.requestLedger.begin(...args),
        complete: () => Promise.reject(new Error("合成完成记录失败")),
      },
    });
    assert.equal("RESULT_UNKNOWN", (await next.dispatch(second, sender, authority)).code);
    assert.equal(
      "RESULT_UNKNOWN",
      (await new BrowserToolboxCommandDispatcher(dependencies).dispatch(second, sender, authority))
        .code,
    );
    assert.equal(2, effects);
  });
  should("持久接收后文档失效时不执行，新 worker 保留不重放的证据", async () => {
    let effects = 0;
    const session = store();
    const dependencies = {
      registry,
      backgroundCommands: {},
      requestLedger: new BrowserToolboxRequestLedger(session),
      browserAdapter: {
        async executeExisting() {
          effects++;
          return { ok: true, code: "OK" };
        },
      },
    };
    const invocation = make("closeTabsOnRight", null);
    const stale = () => {
      throw Object.assign(new Error("文档已导航"), { code: "STALE_DOCUMENT" });
    };
    assert.equal(
      "STALE_DOCUMENT",
      (await new BrowserToolboxCommandDispatcher(dependencies).dispatch(
        invocation,
        sender,
        authority,
        stale,
      )).code,
    );
    assert.equal(0, effects);
    assert.equal(
      "RESULT_UNKNOWN",
      (await new BrowserToolboxCommandDispatcher(dependencies).dispatch(
        invocation,
        sender,
        authority,
      )).code,
    );
  });
  should("执行预算结束只返回结果未知，迟到完成不产生自动重试", async () => {
    let calls = 0;
    const command = {
      ...registry.getCommand("createTab"),
      countPolicy: { ...registry.getCommand("createTab").countPolicy, executionBudgetMs: 10 },
    };
    const dispatcher = new BrowserToolboxCommandDispatcher({
      registry: { getCommand: () => command },
      backgroundCommands: {},
      browserAdapter: {
        executeExisting() {
          calls++;
          return new Promise((resolve) => setTimeout(() => resolve({ ok: true, code: "OK" }), 25));
        },
      },
    });
    assert.equal(
      "RESULT_UNKNOWN",
      (await dispatcher.dispatch(make("createTab"), sender, authority)).code,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(1, calls);
  });
  should("top-frame 使用目标 documentId，源 frame 不替代命令次数或目标身份", async () => {
    let delivered;
    stub(chrome.tabs, "sendMessage", async (_tab, message, options) => {
      delivered = { message, options };
      return { ok: true, code: "INTERACTION_OPENED" };
    });
    const target = { documentId: "top-document", runtimeEpoch: 9, incognito: false };
    const dispatcher = new BrowserToolboxCommandDispatcher({
      registry,
      browserAdapter: {},
      backgroundCommands: {},
      targetIdentity: async (_tab, frame) => {
        assert.equal(0, frame);
        return target;
      },
    });
    const invocation = make("showHelp", 100);
    await dispatcher.dispatch(invocation, sender, authority);
    assert.equal({ documentId: target.documentId }, delivered.options);
    assert.equal(target, delivered.message.identity);
    assert.equal(1, delivered.message.payload.invocation.count);
    assert.equal(invocation.requestId, delivered.message.requestId);
  });
  should("换代后的命令响应被丢弃，未知版本不降级到 v1", async () => {
    const host = { state: "active", context: identity, runtimeEpoch: identity.runtimeEpoch };
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", host);
    let resolve;
    let sends = 0;
    stub(chrome.runtime, "sendMessage", () => {
      sends++;
      return new Promise((done) => resolve = done);
    });
    const invocation = make("showHelp");
    const pending = BrowserToolboxPageCommandExecutorInstance.invoke(invocation);
    host.runtimeEpoch++;
    resolve({
      ok: true,
      code: "OK",
      requestId: invocation.requestId,
      documentId: identity.documentId,
      runtimeEpoch: identity.runtimeEpoch,
    });
    assert.equal("STALE_RUNTIME", (await pending).code);
    assert.equal(1, sends);
    assert.equal("INVALID_OPTIONS", validate({ ...invocation, protocolVersion: 3 }).code);
    assert.isFalse(
      BrowserToolboxMessageProtocol.validateEnvelope({
        ...BrowserToolboxMessageProtocol.envelope("command", "invoke"),
        protocolVersion: 3,
      }),
    );
    assert.isFalse(
      BrowserToolboxMessageProtocol.validateEnvelope({
        ...BrowserToolboxMessageProtocol.envelope("lifecycle", "register"),
        action: "runAnything",
      }),
    );
  });
  should("完整设置页 UI 的来源标签不能覆盖其明确的目标标签", async () => {
    let destination;
    stub(chrome.tabs, "get", async (id) => ({ id }));
    stub(chrome.tabs, "sendMessage", async (id) => {
      destination = id;
      return { ok: true, code: "OK" };
    });
    const dispatcher = new BrowserToolboxCommandDispatcher({
      registry,
      browserAdapter: {},
      backgroundCommands: {},
    });
    const invocation = {
      ...api.createInvocation("showHelp", {}, { type: "ui" }),
      context: { tabId: 99, sourceFrameId: 0 },
    };
    const result = await dispatcher.dispatch(invocation, sender);
    assert.isTrue(result.ok);
    assert.equal(99, destination);
  });
  should("交互命令已被 Esc 取消时不会迟到打开，v1 主 frame 参数仍使用来源 frame", async () => {
    const host = {
      state: "active",
      context: identity,
      runtimeEpoch: identity.runtimeEpoch,
      interactionEpoch: 2,
    };
    stub(globalThis, "BrowserToolboxRuntimeHostInstance", host);
    let calls = 0;
    stub(globalThis, "NormalModeCommands", {
      showHelp(sourceFrame) {
        calls++;
        assert.equal(0, sourceFrame);
        return true;
      },
    });
    assert.equal(
      "CANCELLED",
      (await BrowserToolboxPageCommandExecutorInstance.execute({
        ...make("showHelp"),
        context: { interactionEpoch: 1 },
      })).code,
    );
    assert.equal(0, calls);
    assert.isTrue(
      (await BrowserToolboxPageCommandExecutorInstance.execute(
        api.createInvocation("showHelp", {}, { type: "ui" }, { sourceFrameId: 0 }),
      )).ok,
    );
    assert.equal(1, calls);
  });
});
