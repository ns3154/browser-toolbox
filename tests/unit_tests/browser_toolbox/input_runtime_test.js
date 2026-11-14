// SPDX-License-Identifier: GPL-3.0-or-later
// 用独立期望检验前缀、回退和原生输入边界，不能只比较两个实现恰好返回同一个错误。
import "../test_helper.js";
import "../../../lib/handler_stack.js";
import "../../../content_scripts/mode.js";
import "../../../content_scripts/mode_key_handler.js";
import "../../../lib/browser_toolbox/runtime_plan.js";
import "../../../lib/browser_toolbox/runtime_host.js";
import "../../../content_scripts/browser_toolbox/input_runtime.js";

const { KeySequence, NormalMode, InsertMode: IndependentInsertMode, KeyboardEngine, SessionSnapshotReader } = BrowserToolboxInputRuntime;
const down = { command: "scrollDown", options: {} };
const top = { command: "scrollToTop", options: {} };
const tab = { command: "nextTab", options: {} };
const mapping = { j: down, g: { g: top, t: tab }, t: tab, "<c-j>": down };

context("独立输入状态机", () => {
  should("普通命令、三位次数与组合键保留原参数语义", () => {
    const sequence = new KeySequence(mapping);
    assert.equal({ handled: true, entry: down, count: null }, sequence.accept("j"));
    for (const key of "100") assert.equal({ handled: true }, sequence.accept(key));
    assert.equal({ handled: true, entry: down, count: 100 }, sequence.accept("j"));
    assert.equal({ handled: true, entry: down, count: null }, sequence.accept("<c-j>"));
  });
  should("失配回到根映射时清除旧次数，7gj 只执行一次 j", () => {
    const sequence = new KeySequence(mapping);
    sequence.accept("7"); sequence.accept("g");
    assert.equal({ handled: true, entry: down, count: null }, sequence.accept("j"));
  });
  should("连续键位保留次数，12gg 与 3gt 分别执行 12 和 3", () => {
    const sequence = new KeySequence(mapping);
    for (const key of "12g") sequence.accept(key);
    assert.equal({ handled: true, entry: top, count: 12 }, sequence.accept("g"));
    for (const key of "3g") sequence.accept(key);
    assert.equal({ handled: true, entry: tab, count: 3 }, sequence.accept("t"));
  });
  should("pass key 只在完整命令起始生效，gt 和 99t 仍执行", () => {
    const sequence = new KeySequence(mapping);
    sequence.configure(mapping, "t");
    assert.equal({ handled: false }, sequence.accept("t"));
    sequence.accept("g");
    assert.equal({ handled: true, entry: tab, count: null }, sequence.accept("t"));
    sequence.accept("9"); sequence.accept("9");
    assert.equal({ handled: true, entry: tab, count: 99 }, sequence.accept("t"));
  });
  should("数字零在空闲状态放行，第二位零及映射零有各自语义", () => {
    const sequence = new KeySequence(mapping);
    assert.equal({ handled: false }, sequence.accept("0"));
    sequence.accept("1"); sequence.accept("0");
    assert.equal({ handled: true, entry: down, count: 10 }, sequence.accept("j"));
    sequence.configure({ ...mapping, "0": top });
    assert.equal({ handled: true, entry: top, count: null }, sequence.accept("0"));
  });
  should("连续序列内的数字开始新次数，未知键清除残留前缀", () => {
    const sequence = new KeySequence(mapping);
    sequence.accept("7"); sequence.accept("g"); sequence.accept("2");
    assert.equal({ handled: true, entry: down, count: 2 }, sequence.accept("j"));
    sequence.accept("9"); assert.equal({ handled: false }, sequence.accept("z"));
    assert.equal({ handled: true, entry: down, count: null }, sequence.accept("j"));
  });
  should("设置更新和 Escape 重置不会保留旧序列或次数", () => {
    const sequence = new KeySequence(mapping);
    sequence.accept("1"); sequence.accept("g");
    assert.isTrue(sequence.pending);
    sequence.reset(); assert.isFalse(sequence.pending);
    sequence.accept("g"); sequence.configure({ k: down });
    assert.equal({ handled: false }, sequence.accept("g"));
    assert.equal({ handled: true, entry: down, count: null }, sequence.accept("k"));
  });
  should("新普通模式仅继承公共 Mode，不继承旧 KeyHandler", () => {
    assert.isTrue(NormalMode.prototype instanceof Mode);
    assert.isFalse(NormalMode.prototype instanceof KeyHandlerMode);
  });
  should("IME 候选 Esc、CTRL-[ 和普通键均直接返回原生放行", () => {
    const engine = new KeyboardEngine({});
    for (const event of [
      { type: "keydown", key: "Escape", isComposing: true },
      { type: "keydown", key: "[", ctrlKey: true, keyCode: 229 },
      { type: "keypress", key: "j", isComposing: true },
      { type: "keyup", key: "j", isComposing: true },
    ]) assert.equal(BrowserToolboxRuntime.PASS, engine.handleKeyEvent(event));
  });
  should("默认包忽略本机试用选择且不读取配置存储", async () => {
    let reads = 0;
    const api = { storage: { local: { get() { reads++; throw new Error("不得读取"); } } } };
    assert.equal(1, (await BrowserToolboxRuntimePlans.select(api)).planVersion);
    assert.equal(0, reads);
    assert.equal(undefined, BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.INPUT_CANARY_PLAN));
    assert.equal(undefined, BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.MARKS_CANARY_PLAN));
    assert.isFalse(BrowserToolboxRuntimePlans.COMPILED_MARKS_CANARY);
    assert.equal(undefined, BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.UI_CANARY_PLAN));
    assert.isFalse(BrowserToolboxRuntimePlans.COMPILED_UI_CANARY);
    assert.equal(undefined, BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.PAGES_CANARY_PLAN));
    assert.isFalse(BrowserToolboxRuntimePlans.COMPILED_PAGES_CANARY);
  });
});

function snapshotApi(incognito = false) {
  const calls = [], listeners = new Set();
  const api = {
    extension: { inIncognitoContext: incognito },
    storage: {
      session: {
        get(keys) {
          return new Promise((resolve, reject) => calls.push({ keys: [...keys], resolve, reject }));
        },
      },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
  };
  const resources = new BrowserToolboxRuntime.ResourceScope();
  const reader = new SessionSnapshotReader(api, resources);
  const notify = (changes, area = "session") => {
    for (const listener of listeners) listener(changes, area);
  };
  return { calls, listeners, resources, reader, notify };
}

context("输入 session 并行准备的更新与生命周期", () => {
  should("缓存快照交付前的通知仍更新准备中的引擎，不能被旧映射覆盖", async () => {
    const h = snapshotApi();
    const reading = h.reader.read();
    h.calls[0].resolve({ normalModeKeyStateMapping: { j: down }, passNextKeyKeys: [] });
    await reading;
    const engine = new KeyboardEngine({ inputSnapshot: h.reader });
    const prepared = engine.initialize({}, h.resources);
    h.notify({ normalModeKeyStateMapping: { newValue: { z: { i: tab } } } });
    await prepared;
    assert.equal({ z: { i: tab } }, engine.inputSettings.normalModeKeyStateMapping);
    assert.equal(1, h.calls.length);
    h.resources.dispose();
  });
  should("普通文档只读普通键，共享读取保留显式空值且不暴露可变缓存", async () => {
    const h = snapshotApi();
    const first = h.reader.read(), second = h.reader.read();
    assert.isTrue(first === second);
    assert.equal(["normalModeKeyStateMapping", "passNextKeyKeys", "findModeRawQueryList"], h.calls[0].keys);
    h.calls[0].resolve({ normalModeKeyStateMapping: { j: down }, passNextKeyKeys: [], findModeRawQueryList: [] });
    const snapshot = await first;
    snapshot.normalModeKeyStateMapping.j.command = "不得污染";
    assert.equal({ j: down }, (await h.reader.read()).normalModeKeyStateMapping);
    assert.equal([], (await second).findModeRawQueryList);
    assert.equal(1, h.calls.length);
    h.resources.dispose();
  });
  should("读取期间的更新阻止旧回包覆盖最新映射，必须重新取得完整快照", async () => {
    const h = snapshotApi();
    const reading = h.reader.read();
    h.notify({ normalModeKeyStateMapping: { newValue: { k: top } } });
    h.calls[0].resolve({ normalModeKeyStateMapping: { j: down }, findModeRawQueryList: ["旧合成查询"] });
    await Promise.resolve();
    assert.equal(2, h.calls.length);
    h.calls[1].resolve({ normalModeKeyStateMapping: { k: top }, findModeRawQueryList: ["新合成查询"] });
    const snapshot = await reading;
    assert.equal({ k: top }, snapshot.normalModeKeyStateMapping);
    assert.equal(["新合成查询"], snapshot.findModeRawQueryList);
    assert.isTrue(Object.hasOwn(snapshot, "passNextKeyKeys"));
    h.resources.dispose();
  });
  should("session 更新及删除同步给订阅者，sync 通知不能改写输入设置", async () => {
    const h = snapshotApi();
    const reading = h.reader.read();
    h.calls[0].resolve({ normalModeKeyStateMapping: { j: down }, findModeRawQueryList: ["原合成查询"] });
    await reading;
    let updates = 0;
    const unsubscribe = h.reader.subscribe((snapshot) => {
      updates++;
      snapshot.normalModeKeyStateMapping = { z: tab };
    });
    h.notify({ normalModeKeyStateMapping: { newValue: { k: top } } }, "sync");
    assert.equal({ j: down }, (await h.reader.read()).normalModeKeyStateMapping);
    h.notify({ normalModeKeyStateMapping: { newValue: { k: top } }, findModeRawQueryList: {} });
    const snapshot = await h.reader.read();
    assert.equal({ k: top }, snapshot.normalModeKeyStateMapping);
    assert.isTrue(Object.hasOwn(snapshot, "findModeRawQueryList"));
    assert.equal(undefined, snapshot.findModeRawQueryList);
    assert.equal(1, updates);
    unsubscribe();
    h.notify({ passNextKeyKeys: { newValue: [] } });
    assert.equal(1, updates);
    assert.equal(1, h.calls.length);
    h.resources.dispose();
  });
  should("BFCache 失效后迟到的旧回包被拒绝，不能覆盖新代次的完整快照", async () => {
    const h = snapshotApi();
    const old = h.reader.read().catch((error) => error.message);
    h.reader.invalidate();
    const current = h.reader.read();
    h.calls[1].resolve({ normalModeKeyStateMapping: { k: top }, findModeRawQueryList: [] });
    assert.equal({ k: top }, (await current).normalModeKeyStateMapping);
    h.calls[0].resolve({ normalModeKeyStateMapping: { j: down } });
    assert.equal("STALE_INPUT_SNAPSHOT", await old);
    assert.equal({ k: top }, (await h.reader.read()).normalModeKeyStateMapping);
    assert.equal(1, h.listeners.size);
    h.resources.dispose();
  });
  should("读取失败保留错误，后续只读重试不会把错误当作空设置", async () => {
    const h = snapshotApi();
    const failed = h.reader.read().catch((error) => error.message);
    h.calls[0].reject(new Error("合成读取失败"));
    assert.equal("合成读取失败", await failed);
    const retry = h.reader.read();
    assert.equal(2, h.calls.length);
    h.calls[1].resolve({ normalModeKeyStateMapping: {}, passNextKeyKeys: [], findModeRawQueryList: [] });
    assert.equal({}, (await retry).normalModeKeyStateMapping);
    h.resources.dispose();
  });
  should("文档销毁立即释放监听器并拒绝尚未返回的读取及未来读取", async () => {
    const h = snapshotApi();
    const pending = h.reader.read().catch((error) => error.message);
    let updates = 0;
    h.reader.subscribe(() => updates++);
    h.resources.dispose();
    h.resources.dispose();
    assert.equal(0, h.listeners.size);
    h.calls[0].resolve({ normalModeKeyStateMapping: { j: down } });
    assert.equal("STALE_INPUT_SNAPSHOT", await pending);
    assert.equal("INPUT_SNAPSHOT_CLOSED", await h.reader.read().catch((error) => error.message));
    h.notify({ normalModeKeyStateMapping: { newValue: { k: top } } });
    assert.equal(0, updates);
    assert.equal({}, h.resources.counts());
  });
  should("只有原生无痕文档读取私有历史，私有显式空值不会退回普通查询", async () => {
    const h = snapshotApi(true);
    const reading = h.reader.read();
    assert.equal(["normalModeKeyStateMapping", "passNextKeyKeys", "findModeRawQueryList", "findModeRawQueryListIncognito"], h.calls[0].keys);
    h.calls[0].resolve({ findModeRawQueryList: ["普通合成查询"], findModeRawQueryListIncognito: [] });
    assert.equal([], (await reading).findModeRawQueryListIncognito);
    h.resources.dispose();
  });
});

context("模式首次读取不能覆盖已收到的 session 更新", () => {
  let calls, listeners, invoked;
  const notify = (key, value) => {
    const change = value === undefined ? {} : { newValue: value };
    for (const listener of [...listeners]) listener({ [key]: change }, "session");
  };
  const normal = (mapping) => {
    const mode = new NormalMode();
    mode.init({ keyMapping: mapping });
    mode.invoke = (entry, count) => invoked.push({ command: entry.command, count });
    return mode;
  };
  const inserted = () => new IndependentInsertMode({ global: true, indicator: false });
  const incognito = { z: { i: { command: "LinkHints.activateModeToOpenIncognito" } } };
  setup(() => {
    calls = [];
    listeners = new Set();
    invoked = [];
    stub(globalThis, "chrome", { storage: {
      session: { get: (key) => new Promise((resolve) => calls.push({ key, resolve })) },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    } });
    stub(globalThis, "BrowserToolboxFrameRuntimeBridgeInstance", { session: {} });
    stub(globalThis, "handlerStack", new HandlerStack());
    stub(Mode, "modes", []);
    stub(Mode, "singletons", {});
    stub(globalThis, "HUD", { show() {}, hide() {} });
    stub(globalThis, "KeyboardUtils", {
      getKeyCharString: (event) => event.key,
      isEscape: (event) => event.key === "Escape",
    });
    stub(globalThis, "document", { activeElement: {}, body: {} });
  });
  teardown(() => {
    for (const mode of [...Mode.modes].reverse()) mode.exit();
    assert.equal(0, listeners.size);
  });
  should("普通模式的新命令不被迟到的缺键回包撤销", async () => {
    const mode = normal();
    notify("normalModeKeyStateMapping", incognito);
    calls[0].resolve({});
    await Promise.resolve();
    mode.keydown({ key: "z" });
    mode.keydown({ key: "i" });
    assert.equal([{ command: "LinkHints.activateModeToOpenIncognito", count: null }], invoked);
  });
  should("普通模式没有更新通知时仍接收首次读取", async () => {
    const mode = normal();
    calls[0].resolve({ normalModeKeyStateMapping: { j: down } });
    await Promise.resolve();
    mode.keydown({ key: "j" });
    assert.equal([{ command: "scrollDown", count: null }], invoked);
  });
  for (const [name, value] of [["删除", undefined], ["显式清空", {}]]) {
    should(`普通模式${name}映射后，旧读取不能恢复命令`, async () => {
      const mode = normal();
      notify("normalModeKeyStateMapping", incognito);
      notify("normalModeKeyStateMapping", value);
      calls[0].resolve({ normalModeKeyStateMapping: incognito });
      await Promise.resolve();
      assert.equal(mode.continueBubbling, mode.keydown({ key: "z" }));
      mode.keydown({ key: "i" });
      assert.equal([], invoked);
    });
  }
  should("普通模式退出后，迟到读取不恢复已退出模式的映射", async () => {
    const mode = normal();
    mode.exit();
    calls[0].resolve({ normalModeKeyStateMapping: incognito });
    await Promise.resolve();
    assert.isFalse(mode.modeIsActive);
    assert.equal({}, mode.keyMapping);
    assert.equal([], Mode.modes);
  });
  should("同一普通模式退出再初始化后，前一轮读取不能改写新键序列", async () => {
    const mode = normal();
    mode.exit();
    mode.init({ keyMapping: { k: top } });
    calls[0].resolve({ normalModeKeyStateMapping: incognito });
    await Promise.resolve();
    mode.keydown({ key: "k" });
    assert.equal([{ command: "scrollToTop", count: null }], invoked);
    assert.equal(mode.continueBubbling, mode.keydown({ key: "z" }));
  });
  should("输入模式采用新放行键，迟到读取不能换回旧键", async () => {
    const mode = inserted();
    notify("passNextKeyKeys", ["<c-x>"]);
    calls[0].resolve({ passNextKeyKeys: ["<c-y>"] });
    await Promise.resolve();
    assert.equal(mode.suppressEvent, mode.key({ key: "<c-x>", type: "keydown" }));
    assert.equal(mode.passEventToPage, mode.key({ key: "<c-y>", type: "keydown" }));
    assert.equal(1, Mode.modes.filter((item) => item.name === "pass-next-key").length);
  });
  should("输入模式没有更新通知时仍接收首次放行键", async () => {
    const mode = inserted();
    calls[0].resolve({ passNextKeyKeys: ["<c-x>"] });
    await Promise.resolve();
    assert.equal(mode.suppressEvent, mode.key({ key: "<c-x>", type: "keydown" }));
  });
  for (const [name, value] of [["删除", undefined], ["显式清空", []]]) {
    should(`输入模式${name}放行键后，旧读取不能重新拦截按键`, async () => {
      const mode = inserted();
      notify("passNextKeyKeys", ["<c-x>"]);
      notify("passNextKeyKeys", value);
      calls[0].resolve({ passNextKeyKeys: ["<c-x>"] });
      await Promise.resolve();
      assert.equal(mode.passEventToPage, mode.key({ key: "<c-x>", type: "keydown" }));
      assert.equal(0, Mode.modes.filter((item) => item.name === "pass-next-key").length);
    });
  }
  should("输入模式退出后，迟到读取不恢复放行键或监听器", async () => {
    const mode = inserted();
    mode.exit();
    calls[0].resolve({ passNextKeyKeys: ["<c-x>"] });
    await Promise.resolve();
    assert.isFalse(mode.modeIsActive);
    assert.equal([], mode.passNextKeyKeys);
    assert.equal([], Mode.modes);
  });
});
