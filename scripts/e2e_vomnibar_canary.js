// SPDX-License-Identifier: GPL-3.0-or-later
// 只用独立合成profile和本地页面；在线建议替换为同结构假响应，绝不读取个人资料。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { launchCanaryBrowser, resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_VOMNIBAR_COMPAT_PATH");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_VOMNIBAR_REPORT");
const canaryPlan = Number(Deno.env.get("BROWSER_TOOLBOX_VOMNIBAR_PLAN_VERSION") || 6);
if (![6, 7, 8, 9].includes(canaryPlan)) throw new Error("未登记的导航测试方案");
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_VOMNIBAR_KEEP_OPEN") === "true";
const headed = Deno.env.get("BROWSER_TOOLBOX_VOMNIBAR_HEADED") !== "false";
// 只为这份不可修改的方案5冻结件复现已确认的窗口焦点缺陷；当前兼容方案必须正常归还焦点。
const frozenFocusDefectHash = "f86cf63573b50acf66fc5c198b6faf8401c8e10b26a6fba354bdc5e09855411e";
if (!compatPath || !canaryPath) throw new Error("必须提供冻结方案5和独立导航方案6");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
async function wait(predicate, message = "等待查找栏状态超时", ms = 10000, interval = 20) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(interval);
  }
  throw new Error(message);
}
async function focusObservation(frame, callback, input) {
  const realm = frame.mainRealm();
  const result = await realm.client.send("Runtime.callFunctionOn", {
    functionDeclaration: callback.toString(),
    executionContextId: realm.context.id,
    arguments: [{ value: input }],
    userGesture: false,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("焦点观测失败：" + result.exceptionDetails.text);
  return result.result.value;
}
async function resumeWorkerDebugger(endpoint, oldTargetId, extensionId, diagnostics) {
  // CFT152/Puppeteer23可能把新worker留在调试器等待状态；只恢复本轮扩展的新target，不发送第二次请求。
  const ws = new WebSocket(endpoint), pending = new Map();
  let sequence = 0;
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (event) => {
    const value = JSON.parse(event.data), item = pending.get(value.id);
    if (!item) return;
    pending.delete(value.id);
    clearTimeout(item.timer);
    value.error ? item.reject(new Error(JSON.stringify(value.error))) : item.resolve(value.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(method + " 原生调试等待超时"));
        }, 5000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  try {
    await send("Target.setDiscoverTargets", { discover: true });
    let target;
    await wait(async () => {
      const targets = (await send("Target.getTargets")).targetInfos;
      diagnostics.lastNativeTargets = targets.map(({ targetId, type, url }) => ({
        targetId,
        type,
        url,
      }));
      target = targets.find((item) =>
        item.type === "service_worker" &&
        item.url.startsWith(`chrome-extension://${extensionId}/`)
      );
      return Boolean(target);
    }, "组件请求没有启动新worker");
    const { sessionId } = await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    await send("Runtime.enable", {}, sessionId);
    const before = await send("Runtime.evaluate", {
      expression:
        "JSON.stringify({chrome:!!globalThis.chrome,installed:!!globalThis.BrowserToolboxCompletions})",
      returnByValue: true,
    }, sessionId);
    await send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    let after;
    await wait(async () => {
      after = await send("Runtime.evaluate", {
        expression:
          "JSON.stringify({chrome:!!globalThis.chrome,installed:!!globalThis.BrowserToolboxCompletions})",
        returnByValue: true,
      }, sessionId);
      const value = JSON.parse(after.result.value);
      return value.chrome && value.installed;
    }, "恢复调试等待后新worker未完成初始化");
    await send("Target.detachFromTarget", { sessionId });
    return { targetId: target.targetId, before: before.result.value, after: after.result.value };
  } finally {
    ws.close();
  }
}
async function nativeWorker(target) {
  // 后台真实重启后Puppeteer23的WebWorker上下文跟踪可能缺失；使用该确切target的原生执行上下文。
  const client = await target.createCDPSession();
  await client.send("Runtime.enable", {}, { timeout: 5000 });
  await client.send("Runtime.runIfWaitingForDebugger", {}, { timeout: 5000 });
  return {
    async evaluate(fn, ...args) {
      const result = await client.send("Runtime.evaluate", {
        expression: `(${fn.toString()})(...${JSON.stringify(args)})`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      }
      return result.result.value;
    },
  };
}
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const route = new URL(request.url).pathname;
  const child = route === "/child";
  const title = route.startsWith("/history")
    ? "Synthetic Alpha 中文历史"
    : route.startsWith("/target")
    ? "Synthetic Alpha 标签目标"
    : "独立 Vomnibar 验收";
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title></head><body style="font:16px sans-serif;min-height:6000px;margin:16px"><h1 id="heading">${title}</h1><p>o/O 查找；b/B 书签；T 标签；ge/gE 编辑地址。中文目标均为合成数据。</p><input id="input" aria-label="合成输入框"><textarea id="textarea" aria-label="合成文本区"></textarea><div id="editor" contenteditable="true" style="border:1px solid #888">中文编辑区域</div><a href="/target-manual">Synthetic Alpha 本地目标</a>${
      child
        ? ""
        : '<iframe id="child" src="/child" title="合成子框架" style="width:500px;height:170px"></iframe>'
    }<div id="targets">${
      Array.from(
        { length: 1000 },
        (_, index) =>
          `<a style="display:inline-block;margin:3px" href="#link-${index}">候选${index}</a>`,
      ).join("")
    }</div><script>window.bfcRestores=0;window.addEventListener('pageshow',e=>{if(e.persisted)window.bfcRestores++});window.nativeKeys=0;window.addEventListener('keydown',()=>window.nativeKeys++);</script></body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8" } },
  );
});
const url = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  fixtureUrl: url,
  browsers: [],
  checks: [],
  comparisons: {},
  manualSystemIme: "pending",
  frozenDefects: [],
};
async function run(name, extensionPath, plan) {
  const componentHash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        await Deno.readFile(path.join(extensionPath, "content_scripts/ui_component.js")),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const reproducesFrozenFocusDefect = plan === 5 && componentHash === frozenFocusDefectHash;
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-vomnibar-cft-" });
  const session = await launchCanaryBrowser({
    label: "Vomnibar",
    plan,
    extensionPath,
    launchOptions: {
      executablePath,
      headless: !headed,
      userDataDir: profile,
      defaultViewport: { width: 1280, height: 1000 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,1000",
        "--window-position=1960,213",
        "--no-proxy-server",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      ],
    },
  });
  const { browser } = session;
  const metadata = {
    implementation: name,
    extensionPath,
    profile,
    version: await browser.version(),
    browserPid: session.pid,
    browserSession: session.metadata,
    browserWsEndpoint: browser.wsEndpoint(),
    headed,
    componentHash,
    browserSearchNetwork: "真实系统搜索API只验收原生唯一提交，外部DNS拒绝；本地关键词验收完整加载",
  };
  report.browsers.push(metadata);
  const values = {};
  let page, options, workerTarget, worker, tabId, id;
  const errors = [];
  const check = async (label, action) => {
    const start = performance.now();
    console.log(`${name}：开始${label}`);
    try {
      await action();
      report.checks.push({
        implementation: name,
        name: label,
        status: "passed",
        durationMs: Math.round(performance.now() - start),
      });
      console.log(`${name}：${label} 通过`);
      if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    } catch (error) {
      report.checks.push({
        implementation: name,
        name: label,
        status: "failed",
        error: error.message,
      });
      throw error;
    }
  };
  async function inspect(operation = "state", input = {}) {
    return options.evaluate(async ({ tabId, operation, input }) => {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "ISOLATED",
        func: async (operation, input) => {
          const host = globalThis.BrowserToolboxRuntimeHostInstance;
          if (!host) return null;
          const component = Vomnibar.vomnibarUI;
          if (operation === "reset") {
            document.activeElement?.blur();
            getSelection().removeAllRanges();
            scrollTo(0, 0);
            return true;
          }
          if (operation === "poison-legacy") {
            for (
              const key of [
                "activate",
                "activateInNewTab",
                "activateTabSelection",
                "activateBookmarks",
                "activateBookmarksInNewTab",
                "activateEditUrl",
                "activateEditUrlInNewTab",
                "init",
                "open",
              ]
            ) {
              Vomnibar[key] = () => {
                globalThis.syntheticLegacyVomnibarCalls =
                  (globalThis.syntheticLegacyVomnibarCalls || 0) + 1;
                throw new Error("LEGACY_VOMNIBAR_FORBIDDEN");
              };
            }
            return true;
          }
          if (operation === "delay-ui") {
            const show = UIComponent.prototype.show;
            UIComponent.prototype.show = async function (...args) {
              await new Promise((resolve) => setTimeout(resolve, 300));
              return show.apply(this, args);
            };
            return true;
          }
          if (operation === "install-focus-gate") {
            if (location.pathname !== "/fixture") return null;
            globalThis.syntheticFocusGate = { blocked: false, release: null };
            const original = UIComponent.prototype.show;
            UIComponent.prototype.show = async function (...args) {
              if (!this.iframeElement?.classList.contains("vomnibar-frame")) {
                return original.apply(this, args);
              }
              UIComponent.prototype.show = original;
              syntheticFocusGate.blocked = true;
              await new Promise((resolve) => syntheticFocusGate.release = resolve);
              return original.apply(this, args);
            };
            return true;
          }
          if (operation === "focus-gate-status") return {
            blocked: globalThis.syntheticFocusGate?.blocked === true,
          };
          if (operation === "focus-gate-release") {
            globalThis.syntheticFocusGate?.release?.();
            return true;
          }
          if (operation === "focus-probe") {
            globalThis.syntheticComponentFocusEvents = [];
            const observe = host.observe;
            host.observe = function (type, callback) {
              return observe.call(
                this,
                type,
                type !== "focus" ? callback : (event) => {
                  const component = Vomnibar.vomnibarUI;
                  syntheticComponentFocusEvents.push({
                    windowEvent: event.target === window,
                    showing: component?.showing,
                    requestedFocus: component?.focusOptions.focus,
                    active: document.activeElement?.tagName,
                    shadowActive: component?.shadowDOM.activeElement?.tagName,
                    focusingCall: Boolean(globalThis.syntheticComponentFocusing),
                  });
                  return callback(event);
                },
              );
            };
            const focus = HTMLIFrameElement.prototype.focus;
            HTMLIFrameElement.prototype.focus = function (...args) {
              globalThis.syntheticComponentFocusing = true;
              try {
                return focus.apply(this, args);
              } finally {
                globalThis.syntheticComponentFocusing = false;
              }
            };
            return true;
          }
          if (operation === "refocus-probe") {
            globalThis.syntheticRefocusCalls = [];
            globalThis.syntheticObservedFocus = [];
            host.observe("focus", (event) => {
              const component = Vomnibar.vomnibarUI;
              syntheticObservedFocus.push({
                at: Date.now(),
                windowEvent: event.target === window,
                active: document.activeElement?.tagName,
                shadow: component?.shadowDOM.activeElement?.tagName,
                showing: component?.showing,
                interactionId: component?.interactionId,
              });
              return true;
            });
            const bridge = BrowserToolboxFrameRuntimeBridgeInstance, send = bridge.sendToFrame;
            bridge.sendToFrame = async function (frameId, message, ...rest) {
              if (message.handler !== "focusFrame") {
                return send.call(this, frameId, message, ...rest);
              }
              const row = {
                start: Date.now(),
                frameId,
                interactionId: Vomnibar.vomnibarUI?.interactionId,
              };
              syntheticRefocusCalls.push(row);
              try {
                return await send.call(this, frameId, message, ...rest);
              } finally {
                row.end = Date.now();
                row.afterInteractionId = Vomnibar.vomnibarUI?.interactionId;
                row.afterShowing = Vomnibar.vomnibarUI?.showing;
              }
            };
            return true;
          }
          if (operation === "stale-hide") {
            await component.hide(undefined, input.interactionId);
            return component.showing;
          }
          if (operation === "parent-hide") {
            await component.hide(false);
            return true;
          }
          return {
            path: location.pathname,
            state: host.state,
            plan: host.plan.planVersion,
            epoch: host.runtimeEpoch,
            documentId: host.context.documentId,
            own: Boolean(globalThis.BrowserToolboxVomnibarControllerInstance),
            provider:
              BrowserToolboxPageCommandExecutorInstance.providers?.get?.("Vomnibar.activate")
                ?.owner || null,
            showing: Boolean(component?.showing),
            components: UIComponent.instances.size,
            hudShowing: Boolean(HUD.hudUI?.showing),
            interactionId: component?.interactionId,
            resources: host.getDiagnostics().resources,
            modes: Mode.modes.map((mode) => mode.name),
            handlers: handlerStack.stack.length,
            focus: document.activeElement?.id,
            hasFocus: document.hasFocus(),
            scrollY,
            legacyCalls: globalThis.syntheticLegacyVomnibarCalls || 0,
            frame: component
              ? (() => {
                const rect = component.iframeElement.getBoundingClientRect();
                return {
                  width: rect.width,
                  left: rect.left,
                  right: rect.right,
                  viewport: innerWidth,
                };
              })()
              : null,
          };
        },
        args: [operation, input],
      });
      return rows.filter((row) => row.result).map((row) => ({
        ...row.result,
        frameId: row.frameId,
        nativeDocumentId: row.documentId,
      }));
    }, { tabId, operation, input });
  }
  const state = async () => (await inspect()).find((item) => item.frameId === 0);
  const focusEvents = () =>
    options.evaluate(async (tabId) => {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "ISOLATED",
        func: () => globalThis.syntheticComponentFocusEvents,
      });
      return rows.filter((row) => row.result).map((row) => ({
        frameId: row.frameId,
        events: row.result,
      }));
    }, tabId);
  const ready = async (expected = plan) =>
    wait(async () => {
      const rows = await inspect();
      return rows.length === 2 &&
        rows.every((item) => item.state === "active" && item.plan === expected);
    }, "原生文档方案未就绪");
  const componentFrame = () =>
    page.frames().find((frame) =>
      frame.url().split("?")[0] === `chrome-extension://${id}/pages/vomnibar_page.html`
    );
  async function ui(operation = "state", input = {}) {
    const frame = componentFrame();
    if (!frame) return null;
    return frame.evaluate(async ({ operation, input }) => {
      const { ui } = await import("./vomnibar_page.js");
      if (!ui) return null;
      if (operation === "request") return chrome.runtime.sendMessage(input);
      if (operation === "late-hidden") {
        ui.onHidden(input);
        return true;
      }
      if (operation === "delay-query") {
        const send = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = async (message, ...args) => {
          const value = await send(message, ...args);
          if (message.handler === "filterCompletions" && message.query.endsWith("synthetic slow")) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          return value;
        };
        return true;
      }
      if (operation === "composition") {
        const event = new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        });
        ui.input.dispatchEvent(event);
        return { prevented: event.defaultPrevented, focused: document.activeElement === ui.input };
      }
      const list = ui.list || ui.completionList;
      return {
        own: ui.implementation === "browser-toolbox",
        query: ui.input.value,
        active: ui.active,
        interactionId: ui.interactionId,
        focused: document.hasFocus() && document.activeElement === ui.input,
        documentFocused: document.hasFocus(),
        inputActive: document.activeElement === ui.input,
        selectionStart: ui.input.selectionStart,
        selectionEnd: ui.input.selectionEnd,
        selection: ui.selection,
        keyword: (ui.engine || ui.activeUserSearchEngine)?.keyword || null,
        completer: ui.completerName,
        forceNewTab: ui.forceNewTab,
        expanded: ui.input.getAttribute("aria-expanded"),
        role: ui.input.getAttribute("role"),
        label: ui.modeLabel.textContent,
        placeholder: ui.input.placeholder,
        disposition: ui.dispositionLabel.hidden,
        fontSize: getComputedStyle(ui.input).fontSize,
        resources: ui.resources?.counts(),
        lastErrorCode: ui.lastErrorCode,
        items: ui.completions.map((item, index) => ({
          url: item.url,
          title: item.title,
          description: item.description,
          shortUrl: item.shortUrl,
          tabId: item.tabId,
          primary: item.isPrimarySuggestion,
          insertText: item.insertText,
          selected: list.children[index]?.getAttribute("aria-selected"),
          hasBottom: Boolean(list.children[index]?.querySelector(".bottom-half")),
          hasTitle: Boolean(list.children[index]?.querySelector(".title")),
          matches: list.children[index]?.querySelectorAll(".match").length || 0,
          favicon: list.children[index]?.querySelector(".icon")?.getAttribute("src") || null,
        })),
      };
    }, { operation, input });
  }
  async function reset() {
    const trace = (step) => {
      if (metadata.workerRestart?.tracing) {
        console.log("重启后reset：" + step);
        metadata.workerRestart.trace.push(step);
      }
    };
    trace("读取showing");
    if ((await state())?.showing) {
      await page.keyboard.press("Escape");
      await wait(async () => !(await state()).showing);
    }
    // 独立界面须通过自然退出确认释放，测试不能直接销毁iframe来制造缓存资格。
    if ((await state())?.own) {
      await wait(
        async () => !componentFrame() && !(await state()).frame,
        "自然退出后组件仍留在文档中",
      );
    }
    await inspect("reset");
    trace("原生清理完成");
    await session.activatePage(page, options);
    trace("前景完成");
    if (metadata.workerRestart?.tracing) {
      metadata.workerRestart.pageBeforeClick = await page.evaluate(() => ({
        url: location.href,
        heading: !!document.querySelector("#heading"),
        focus: document.activeElement?.tagName,
      }));
    }
    await page.click("#heading");
    trace("标题点击完成");
  }
  async function open(keys = "o") {
    await reset();
    if (metadata.cycle?.step === "open") {
      const chrome = await focusObservation(options.mainFrame(), async (fixtureTabId) => {
        const tab = await chrome.tabs.get(fixtureTabId);
        const window = await chrome.windows.get(tab.windowId, { populate: true });
        return { active: tab.active, windowFocused: window.focused,
          activeTabId: window.tabs.find((item) => item.active)?.id, tabId: tab.id };
      }, tabId);
      const frames = await Promise.all(page.frames().map(async (frame) => ({
        path: new URL(frame.url()).pathname,
        state: await focusObservation(frame, () => ({ focus: document.hasFocus(),
          activeTag: document.activeElement?.tagName, activeId: document.activeElement?.id }))
          .catch(() => null),
      })));
      (metadata.cycleBeforeKey ||= []).push({ round: metadata.cycle.round, at: Date.now(), chrome, frames });
    }
    const started = performance.now();
    await page.keyboard.type(keys);
    if (metadata.workerRestart?.tracing) console.log("重启后open：按键完成");
    let current = null;
    await wait(
      async () => {
        if (!componentFrame()) return false;
        // 缩短轮询间隔至 5ms 并直接复用当轮组件状态，避免 20ms 定时器与重复探测掩盖真实延迟。
        const [visible, snapshot] = await Promise.all([
          page.evaluate(() =>
            [...document.querySelectorAll(".vimium-reset")].some((wrapper) =>
              wrapper.shadowRoot?.querySelector("iframe.vomnibar-frame.vimium-ui-component-visible")
            )
          ).catch(() => false),
          ui().catch(() => null),
        ]);
        if (!visible || !snapshot?.focused || (snapshot.own && !snapshot.active)) return false;
        current = snapshot;
        return true;
      },
      "真实按键未打开查找栏或未获得原生焦点",
      10000,
      5,
    );
    if (!current.own) {
      // 旧版 VomnibarUI 无 active 标记，window focus 可能早于 activate 异步设置完成；补采一次完整状态。
      await sleep(10);
      current = await ui();
    }
    if (metadata.workerRestart?.tracing) console.log("重启后open：输入元素完成");
    metadata.openSamples ||= [];
    metadata.openSamples.push({ keys, durationMs: performance.now() - started });
    return current;
  }
  async function query(value) {
    const frame = componentFrame();
    // 原生三击选择单行输入；不能假定无头CFT的Command+A具有macOS菜单快捷键语义。
    await frame.click("input", { clickCount: 3 });
    const selected = await ui();
    assert(
      selected.selectionStart === 0 && selected.selectionEnd === selected.query.length,
      "原生三击未选中完整查询",
    );
    await page.keyboard.press("Backspace");
    if ((await ui()).keyword) {
      await page.keyboard.press("Backspace");
      await frame.click("input", { clickCount: 3 });
      await page.keyboard.press("Backspace");
    }
    if (value) await page.keyboard.type(value);
    await wait(async () => (await ui())?.query === value.replace(/^[gl]\s+/, ""));
    await sleep(180);
    return ui();
  }
  const tabs = () => options.evaluate(() => chrome.tabs.query({}));
  async function press(keys) {
    const parts = keys.split("+"), key = parts.pop();
    for (const modifier of parts) await page.keyboard.down(modifier);
    // Puppeteer对带Control的Enter默认不发送字符，显式文本让CFT产生冻结UI处理的原生keypress。
    try {
      await page.keyboard.press(
        key,
        key === "Enter" && parts.includes("Control") ? { text: "\n" } : {},
      );
    } finally {
      for (const modifier of parts.reverse()) await page.keyboard.up(modifier);
    }
  }
  async function navigateOnce(expected, newTab, key = "Enter") {
    const before = await tabs();
    const navigationOffset = await options.evaluate(() => syntheticTopNavigations.length);
    // tabs.url先于页面加载完成更新；先订阅本次导航，再提交一次，避免重置与尚未完成的导航竞争。
    const navigation = newTab
      ? null
      : page.waitForNavigation({ waitUntil: "load", timeout: 10000 });
    navigation?.catch(() => {});
    const observed = [];
    const observeNavigation = (frame) => {
      if (frame === page.mainFrame()) observed.push({ url: frame.url(), at: Date.now() });
    };
    page.on("framenavigated", observeNavigation);
    const attempt = { expected, newTab, key, observed };
    (metadata.navigationAttempts ||= []).push(attempt);
    try {
      await press(key);
      let after;
      const committed = (tab) => {
        if (!tab?.url) return false;
        return typeof expected === "string"
          ? tab.url === expected
          : new URL(tab.url).searchParams.get("q") === expected.searchQuery;
      };
      await wait(async () => {
        after = await tabs();
        const added = after.filter((tab) => !before.some((old) => old.id === tab.id));
        return newTab
          ? added.length === 1 && committed(added[0]) && added[0].active
          : committed(after.find((tab) => tab.id === tabId));
      }, "导航没有唯一完成的目标标签");
      if (navigation) {
        await navigation;
        // 系统默认引擎由Chrome决定；外网被拒绝时错误页是预期结果，仍严格核对原生提交目标与次数。
        assert(
          committed({ url: page.url() }) ||
            expected.searchQuery && page.url() === "chrome-error://chromewebdata/",
          "页面实际完成的导航必须匹配提交目标或被隔离的系统搜索错误页",
        );
      }
      await sleep(100);
      const final = await tabs();
      const destination = newTab
        ? final.find((tab) => !before.some((old) => old.id === tab.id))
        : final.find((tab) => tab.id === tabId);
      attempt.nativeSubmissions = await options.evaluate(
        ({ offset, tabId }) =>
          syntheticTopNavigations.slice(offset).filter((item) => item.tabId === tabId),
        { offset: navigationOffset, tabId: destination?.id },
      );
      assert(
        attempt.nativeSubmissions.filter(committed).length === 1,
        "原生目标导航必须只提交一次：" + JSON.stringify(attempt.nativeSubmissions),
      );
      if (newTab) {
        const added = final.filter((tab) => !before.some((old) => old.id === tab.id));
        assert(added.length === 1 && committed(added[0]), "导航重复创建标签");
        await options.evaluate((id) => chrome.tabs.remove(id), added[0].id);
      } else {
        assert(final.length === before.length, "当前标签导航不得创建额外标签");
        assert(
          observed.length === 1,
          "当前标签必须恰好提交一次文档导航：" + JSON.stringify(observed),
        );
        attempt.loadedTarget = page.url();
        page.off("framenavigated", observeNavigation);
        await page.goto(url);
        await ready();
      }
      await session.activatePage(page, options);
      await reset();
      attempt.resetCompleted = true;
    } finally {
      page.off("framenavigated", observeNavigation);
    }
  }
  try {
    id = metadata.extensionId = await resolveCanaryExtensionId(browser);
    options = await session.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const configured = await options.evaluate(async (url) => {
      const current = await BrowserToolboxConfigurationClientInstance.read();
      const result = await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: {
          toolbox: BrowserToolboxSettingsSchema.mergeSettings(current.toolboxSource.value, {
            general: { language: "zh_CN" },
          }),
          legacyPatch: {
            smoothScroll: false,
            grabBackFocus: false,
            userDefinedLinkHintCss: "#vomnibar input { font-size: 19px; }",
            searchUrl: url.replace("/fixture", "/target-search") + "?q=%s",
            searchEngines: "g: https://www.google.com/search?q=%s Synthetic Google\nl: " +
              url.replace("/fixture", "/target-search") + "?q=%s Synthetic Local",
            keyMappings: "map zq Vomnibar.activate keyword=g query=synthetic",
          },
        },
      });
      if (!result.ok) return result;
      const folder = await chrome.bookmarks.create({ title: "Synthetic Folder" });
      for (
        const [title, suffix] of [["Synthetic Alpha 书签", "/target-alpha"], [
          "中文目标",
          "/target-chinese",
        ], ["Synthetic Alpha JS", "javascript:void(0)"]]
      ) {
        await chrome.bookmarks.create({
          parentId: folder.id,
          title,
          url: suffix.startsWith("javascript") ? suffix : url.replace("/fixture", suffix),
        });
      }
      return result;
    }, url);
    metadata.configurationResult = { ok: configured.ok, code: configured.code };
    assert(configured.ok, "合成配置或书签初始化失败：" + (configured.code || "unknown"));
    for (const suffix of ["/history-alpha", "/history-beta"]) {
      const historyPage = await session.newPage();
      await historyPage.goto(url.replace("/fixture", suffix));
      await historyPage.close();
    }
    await options.evaluate(() => {
      globalThis.syntheticWindowFocusEvents = [];
      chrome.windows.onFocusChanged.addListener((windowId) =>
        syntheticWindowFocusEvents.push({ at: Date.now(), kind: "window-focus", windowId }));
      chrome.tabs.onActivated.addListener(({ tabId, windowId }) =>
        syntheticWindowFocusEvents.push({ at: Date.now(), kind: "tab-active", windowId, tabId }));
    });
    page = await session.newPage();
    metadata.nativeFocusEvents = [];
    await page.evaluateOnNewDocument(() => {
      for (const kind of ["focus", "blur"]) {
        globalThis.addEventListener(kind, (event) => {
          const target = event.target;
          console.log("PHASE4_FOCUS " + JSON.stringify({
            at: Date.now(), kind, path: location.pathname, trusted: event.isTrusted,
            windowTarget: target === globalThis, tag: target?.tagName, id: target?.id,
            documentFocus: document.hasFocus(),
          }));
        }, true);
      }
    });
    page.on("console", (message) => {
      const value = message.text();
      if (value.startsWith("PHASE4_FOCUS ")) {
        try { metadata.nativeFocusEvents.push(JSON.parse(value.slice(13))); } catch (_) { /* 仅保留有效事件。 */ }
      }
    });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const target = new URL(request.url());
      if (
        !["http:", "https:"].includes(target.protocol) ||
        [url, url.replace("127.0.0.1", "localhost")].some((fixture) =>
          target.origin === new URL(fixture).origin
        )
      ) {
        return request.continue();
      }
      // 保留Chrome实际搜索API及目标URL，导航响应在发送前用合成HTML代替，避免联系真实搜索站点。
      metadata.interceptedNavigations = (metadata.interceptedNavigations || 0) +
        Number(request.isNavigationRequest());
      return request.isNavigationRequest()
        ? request.respond({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>合成搜索响应</title><p>只验收用户提交的合成查询</p>",
        })
        : request.abort();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await session.activatePage(page, options);
    tabId = (await tabs()).find((tab) => tab.url === url).id;
    metadata.fixtureTabId = tabId;
    await options.evaluate(() => {
      globalThis.syntheticTopNavigations = [];
      chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
        if (frameId === 0) syntheticTopNavigations.push({ tabId, url });
      });
    });
    await ready();
    workerTarget = await browser.waitForTarget((target) =>
      target.type() === "service_worker" &&
      target.url() === `chrome-extension://${id}/background_scripts/main.js`
    );
    worker = await workerTarget.worker();
    async function installWorkerProbes(poison = false) {
      await worker.evaluate(async (poison) => {
        globalThis.syntheticRequests = [];
        globalThis.syntheticNetworkMode = "normal";
        globalThis.syntheticOriginalFetch = globalThis.fetch;
        globalThis.fetch = async (target, options = {}) => {
          const parsed = new URL(target), query = parsed.searchParams.get("q") || "";
          if (parsed.protocol === "chrome-extension:") {
            return syntheticOriginalFetch(target, options);
          }
          if (parsed.origin !== "http://suggestqueries.google.com") {
            throw new Error("SYNTHETIC_UNREGISTERED_NETWORK");
          }
          globalThis.syntheticRequests.push({
            origin: parsed.origin,
            pathname: parsed.pathname,
            query,
            aborted: options.signal?.aborted === true,
            sentAt: Date.now(),
          });
          if (globalThis.syntheticNetworkMode === "failure") {
            throw new Error("SYNTHETIC_NETWORK_FAILURE");
          }
          if (globalThis.syntheticNetworkMode === "late") {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          return new Response(
            JSON.stringify([query, [query, query + " FIRST", query + " second"]]),
          );
        };
        if (!poison) return;
        const own = BrowserToolboxCompletions;
        const get = own.CompletionHub.prototype.get;
        own.CompletionHub.prototype.get = function (...args) {
          globalThis.syntheticCompletionHub = this;
          const value = get.apply(this, args);
          // worker恢复前的书签请求已创建会话；也替换该合成会话捕获的fetch，禁止随后联系真实建议端点。
          value.suggestions.fetcher = globalThis.fetch;
          return value;
        };
        const filter = own.CompletionSession.prototype.filter;
        own.CompletionSession.prototype.filter = function (...args) {
          globalThis.syntheticOwnCompletionCalls = (globalThis.syntheticOwnCompletionCalls || 0) +
            1;
          return filter.apply(this, args);
        };
      }, poison);
    }
    await installWorkerProbes([6, 7, 8, 9].includes(plan));
    if ([6, 7, 8, 9].includes(plan)) await inspect("poison-legacy");
    await check("固定方案、全部frame和独立入口实际所有权", async () => {
      const rows = await inspect();
      assert(
        rows.every((item) => item.own === ([6, 7, 8, 9].includes(plan)) && item.resources.events.listener === 13),
        "方案或监听所有者错误",
      );
      const entries = [
        ["o", "omni", false, false],
        ["O", "omni", true, false],
        ["T", "tabs", false, true],
        ["b", "bookmarks", false, true],
        ["B", "bookmarks", true, true],
        ["ge", "omni", false, false],
        ["gE", "omni", true, false],
      ];
      values.entries = [];
      for (const [keys, completer, newTab, selected] of entries) {
        const current = await open(keys);
        assert(
          current.own === ([6, 7, 8, 9].includes(plan)) && current.completer === completer &&
            current.forceNewTab === newTab,
          `入口${keys}参数错误`,
        );
        if (keys.startsWith("g")) assert(current.query === url, "编辑地址必须预填当前页");
        if (keys === "T") assert(current.selection === 0, "标签入口预选首项");
        values.entries.push([keys, completer, newTab, selected]);
        await reset();
      }
    });
    const summarize = (current) =>
      current.items.map((
        item,
      ) => [
        item.url.replace(/^chrome-extension:\/\/[^/]+\//, "extension://"),
        item.title,
        item.description,
        item.primary === true,
        item.insertText || null,
        item.hasBottom,
        item.hasTitle,
      ]);
    await check("书签、历史、域名、标签与关键字五来源真实候选", async () => {
      values.sources = {};
      for (
        const [keys, text, expected] of [
          ["b", "Alpha", "bookmark"],
          ["b", "/Synthetic Alpha", "bookmark"],
          ["b", "中文目标", "bookmark"],
          ["o", "history-alpha", "history"],
          ["o", "127.0.0.1", "domain"],
        ]
      ) {
        await open(keys);
        const current = await query(text);
        assert(current.items.some((item) => item.description === expected), `缺少${expected}候选`);
        values.sources[keys + " " + text] = summarize(current);
        assert(
          current.items.length <= 10 &&
            current.items.every((item) => item.hasTitle && item.hasBottom),
          "候选显示模型或上限错误",
        );
        await reset();
      }
      await open("zq");
      await wait(async () => (await ui()).items.some((item) => item.primary));
      const scoped = await ui();
      assert(scoped.keyword === "g" && scoped.query === "synthetic", "映射关键词或初始查询丢失");
      values.explicitKeyword = summarize(scoped);
      await reset();
      await open();
      const current = await query("g synthetic alpha");
      assert(
        current.keyword === "g" && current.items[0].primary && current.selection === 0 &&
          current.items.every((item) => !item.hasBottom),
        "搜索引擎必须独占且预选primary",
      );
      values.searchCandidates = summarize(current);
      await page.keyboard.press("ArrowDown");
      await wait(async () => (await ui()).query === "synthetic alpha first");
      await page.keyboard.press("ArrowUp");
      await wait(async () => (await ui()).query === "synthetic alpha");
      await reset();
    });
    await check("候选Tab/上下键、ctrl-enter编辑和原生标签选择", async () => {
      const targetPage = await session.newPage();
      await targetPage.goto(url.replace("/fixture", "/target-tab"));
      await session.activatePage(page, options);
      await open("T");
      await query("target-tab");
      await wait(async () => (await ui()).items.length === 1);
      const current = await ui();
      assert(
        current.items[0].description === "tab" && current.items[0].favicon?.includes("/_favicon/"),
        "标签候选缺少本地favicon",
      );
      await press("Control+Enter");
      await wait(async () => (await ui()).query === url.replace("/fixture", "/target-tab"));
      await page.keyboard.press("Enter");
      await wait(async () =>
        (await tabs()).find((tab) => tab.id === current.items[0].tabId)?.active
      );
      assert(!(await state()).showing, "选择标签必须关闭查找栏");
      await targetPage.close();
      await session.activatePage(page, options);
      await reset();
      values.tabSelection = true;
    });
    await check("当前页、新标签、修饰键和书签导航恰好一次", async () => {
      for (
        const [keys, suffix, newTab, enter] of [
          ["o", "/target-typed", false, "Enter"],
          ["O", "/target-new", true, "Enter"],
          ["o", "/target-modifier", true, "Shift+Enter"],
          ["B", "/target-alpha", true, "Enter"],
        ]
      ) {
        await open(keys);
        await query(keys === "B" ? "Alpha 书签" : url.replace("/fixture", suffix));
        await navigateOnce(url.replace("/fixture", suffix), newTab, enter);
      }
      values.navigation = true;
    });
    await check("普通文本搜索及本地自定义关键词沿用URL模板", async () => {
      await open();
      await query("synthetic unmatched word");
      await navigateOnce(
        { searchQuery: "synthetic unmatched word" },
        false,
      );
      await open();
      await query("l 中文目标");
      await navigateOnce(
        url.replace("/fixture", "/target-search") + "?q=" + encodeURIComponent("中文目标"),
        false,
      );
      values.searchNavigation = true;
    });
    await check(
      reproducesFrozenFocusDefect
        ? "指定哈希冻结旧版的跨frame窗口焦点缺陷原生复现"
        : "跨frame入口和Esc归还实际源框架焦点",
      async () => {
        await reset();
        const child = page.frames().find((frame) => frame.url().endsWith("/child"));
        await child.evaluate(() => {
          window.syntheticKeys = [];
          addEventListener("keydown", (event) =>
            syntheticKeys.push({
              key: event.key,
              code: event.code,
              composing: event.isComposing,
              focused: document.hasFocus(),
            }), true);
        });
        await child.click("#heading");
        metadata.childFocusBefore = await inspect();
        await inspect("focus-probe");
        await page.keyboard.press("o");
        if (reproducesFrozenFocusDefect) {
          await wait(async () => Boolean(componentFrame()) && Boolean((await state()).frame));
          await sleep(200);
          const current = await state(), events = await focusEvents();
          assert(
            !current.showing && !(await ui()).focused,
            "指定冻结缺陷没有复现，不能沿用既有诊断",
          );
          assert(
            events.find((row) => row.frameId === 0)?.events.some((event) =>
              event.windowEvent && event.focusingCall && event.requestedFocus &&
              event.active === "BODY"
            ),
            "缺少组件focus调用期间的原生window焦点证据",
          );
          report.frozenDefects.push({
            name: "子frame打开旧组件时window焦点误退出",
            componentHash,
            nativeEvents: events,
            showing: current.showing,
            focused: (await ui()).focused,
            expectedCanaryResult: "方案6及其当前兼容方案1至5打开后保持焦点，Esc归还源frame",
          });
          values.childFocus = false;
          await reset();
          return;
        }
        await wait(async () => (await ui())?.focused && (await state()).showing);
        await page.keyboard.press("Escape");
        await wait(async () => !(await state()).showing);
        await wait(() => page.evaluate(() => document.activeElement?.id === "child"));
        assert(await child.evaluate(() => document.hasFocus()), "原生焦点未归还源frame");
        await page.keyboard.press("j");
        await wait(() => child.evaluate(() => scrollY === 60));
        assert(await page.evaluate(() => scrollY === 0), "子frame滚动不应移动顶层");
        values.childFocus = true;
        await reset();
      },
    );
    await check("候选CSS、ARIA、中英文及窄窗口几何", async () => {
      await open("b");
      await query("Alpha");
      await wait(async () => (await ui()).fontSize === "19px");
      const current = await ui();
      assert(
        current.role === "combobox" && current.expanded === "true" &&
          current.items[0].selected === "true",
        "combobox或选中语义丢失",
      );
      assert(current.label === "搜索书签" && current.placeholder.length > 0, "中文本地化未应用");
      await page.setViewport({ width: 600, height: 800 });
      const rect = (await state()).frame;
      assert(rect.left >= 0 && rect.right <= 600 && rect.width > 300, "窄屏组件超出可见宽度");
      await page.setViewport({ width: 1280, height: 1000 });
      await reset();
      const locale = await options.evaluate(async () =>
        BrowserToolboxConfigurationClientInstance.commit({
          toolbox: BrowserToolboxSettingsSchema.mergeSettings(
            (await BrowserToolboxConfigurationClientInstance.read()).toolboxSource.value,
            { general: { language: "en" } },
          ),
        })
      );
      assert(locale, "英文语言提交失败");
      await open("b");
      assert((await ui()).label === "Search bookmarks", "英文模式文案错误");
      await reset();
      await options.evaluate(async () =>
        BrowserToolboxConfigurationClientInstance.commit({
          toolbox: BrowserToolboxSettingsSchema.mergeSettings(
            (await BrowserToolboxConfigurationClientInstance.read()).toolboxSource.value,
            { general: { language: "zh_CN" } },
          ),
        })
      );
      values.presentation = true;
    });
    await check("连续输入、晚回包与退出不恢复候选或焦点", async () => {
      await open();
      await ui("delay-query");
      const frame = componentFrame();
      await frame.focus("input");
      await page.keyboard.type("synthetic slow");
      await query("Alpha");
      await wait(async () => (await ui()).items.length > 0);
      const before = summarize(await ui());
      await sleep(350);
      assert(JSON.stringify(before) === JSON.stringify(summarize(await ui())), "旧查询覆盖新候选");
      await query("synthetic slow");
      await page.keyboard.press("Escape");
      await wait(async () => !(await state()).showing);
      await sleep(350);
      assert(!(await state()).showing && !(await ui())?.focused, "退出后旧查询重新聚焦");
      values.lateResponses = true;
      await reset();
    });
    await check("建议只按既有条件发送，100ms取消和会话缓存实际生效", async () => {
      await open();
      await worker.evaluate(() => globalThis.syntheticRequests = []);
      for (const value of ["g abc", "g " + url, "g javascript:void(0)", "l synthetic long query"]) {
        await query(value);
      }
      assert(
        await worker.evaluate(() => syntheticRequests.length === 0),
        "短词、URL、javascript或未知端点发出建议请求",
      );
      await query("g zzsyntheticcache");
      await wait(() =>
        worker.evaluate(() => syntheticRequests.some((item) => item.query === "zzsyntheticcache"))
      );
      const sent = await worker.evaluate(() => structuredClone(syntheticRequests));
      assert(
        sent.length === 1 && sent[0].origin === "http://suggestqueries.google.com" &&
          sent[0].pathname === "/complete/search",
        "既有建议端点或等待去重发生变化",
      );
      await reset();
      await open();
      await query("g zzsyntheticcache");
      assert(await worker.evaluate(() => syntheticRequests.length === 1), "组件会话建议缓存未复用");
      await reset();
      await open();
      await query("g abc");
      const inputAt = Date.now();
      // 一次原生文本提交后立即Esc，避免逐字符自动化本身耗尽100ms等待窗口。
      await page.keyboard.sendCharacter("zzsyntheticcancel");
      await page.keyboard.press("Escape");
      const escapeAt = Date.now();
      assert(escapeAt - inputAt < 100, "取消fixture在按Esc前已经超过待发送窗口");
      await sleep(160);
      const cancelledRequests = await worker.evaluate(() =>
        syntheticRequests.filter((item) => item.query.includes("cancel"))
      );
      metadata.pendingSuggestionExit = { inputAt, escapeAt, requests: cancelledRequests };
      if (plan === 5) {
        assert(
          cancelledRequests.length === 1 && cancelledRequests[0].sentAt > escapeAt,
          "冻结版Esc只隐藏、不取消待发送建议的原生边界未复现",
        );
        values.escapeCancelsPending = false;
      } else {
        assert(!cancelledRequests.length, "Esc后尚未发送的建议仍发出");
        values.escapeCancelsPending = true;
      }
      values.networkBoundary = true;
      await reset();
    });
    await check("建议故障保留primary及中文输入，原生编辑器和j可继续使用", async () => {
      await worker.evaluate(() => globalThis.syntheticNetworkMode = "failure");
      await open();
      await query("g zzsyntheticfailure");
      await wait(async () => (await ui()).items.length === 1 && (await ui()).items[0].primary);
      await page.keyboard.press("Escape");
      await worker.evaluate(() => globalThis.syntheticNetworkMode = "normal");
      await open();
      await query("g 中文目标");
      assert((await ui()).query === "中文目标", "提交态中文输入丢失");
      await reset();
      await page.click("#input");
      await page.keyboard.type("合成中文输入");
      assert(await page.$eval("#input", (node) => node.value === "合成中文输入"), "原生输入被破坏");
      await reset();
      await page.keyboard.press("j");
      await wait(() => page.evaluate(() => scrollY === 60));
      values.nativeInput = true;
      await reset();
    });
    await check("30次已就绪反馈保留全部样本并核验100ms预算", async () => {
      const samples = [];
      for (let index = 0; index < 30; index++) {
        await open();
        samples.push(metadata.openSamples.at(-1).durationMs);
        await reset();
      }
      const sorted = [...samples].sort((a, b) => a - b),
        p95 = sorted[Math.ceil(samples.length * .95) - 1];
      metadata.feedback = {
        samples,
        count: samples.length,
        p95,
        max: sorted.at(-1),
        firstOpen: metadata.openSamples[0].durationMs,
        scope: "已就绪真实按键到组件焦点，含自动化检查；首开另记，不删样本或预热",
      };
      assert(
        p95 <= 100,
        `已就绪查找栏反馈超过100ms (p95=${p95.toFixed(1)}ms, max=${sorted.at(-1).toFixed(1)}ms)`,
      );
    });
    await check("1000书签和1000历史的30次Native补全与稳定后台内存", async () => {
      const created = await options.evaluate(async (url) => {
        const folder = await chrome.bookmarks.create({ title: "Synthetic Perf" });
        const urls = [];
        for (let start = 0; start < 1000; start += 20) {
          await Promise.all(Array.from({ length: 20 }, async (_, offset) => {
            const index = start + offset, target = url.replace("/fixture", "/zzperfkey/" + index);
            urls.push(target);
            await chrome.bookmarks.create({
              parentId: folder.id,
              title: "Synthetic zzperfkey " + index,
              url: target,
            });
            await chrome.history.addUrl({ url: target });
          }));
        }
        return { folderId: folder.id, urls };
      }, url);
      try {
        await open();
        const samples = [];
        for (let index = 0; index < 30; index++) {
          const started = performance.now();
          const candidates = await componentFrame().evaluate(() =>
            chrome.runtime.sendMessage({
              handler: "filterCompletions",
              completerName: "omni",
              query: "zzperfkey",
              queryTerms: ["zzperfkey"],
            })
          );
          samples.push(performance.now() - started);
          assert(
            Array.isArray(candidates) && candidates.length === 10 &&
              candidates.every((item) => item.url.includes("/zzperfkey/")),
            "合成规模补全必须返回真实Native来源的10项候选",
          );
        }
        const sorted = [...samples].sort((a, b) => a - b),
          p95 = sorted[Math.ceil(samples.length * .95) - 1];
        const client = await workerTarget.createCDPSession(), heap = [];
        try {
          for (let index = 0; index < 5; index++) {
            await client.send("HeapProfiler.collectGarbage");
            heap.push((await client.send("Runtime.getHeapUsage")).usedSize);
          }
        } finally {
          await client.detach();
        }
        metadata.completionPerformance = {
          nativeBookmarks: 1000,
          nativeHistory: 1000,
          samples,
          p95,
          first: samples[0],
          max: sorted.at(-1),
          heapSamples: heap,
          stableHeapBytes: [...heap].sort((a, b) => a - b)[2],
          scope:
            "Native授权组件发起真实后台补全；全部30样本含首次、不预热；仅合成worker GC后5点中位数，不保存堆快照",
        };
        assert(p95 <= 100, "合成规模补全p95超过100ms");
      } finally {
        await options.evaluate(async ({ folderId, urls }) => {
          await chrome.bookmarks.removeTree(folderId);
          for (let start = 0; start < urls.length; start += 20) {
            await Promise.all(
              urls.slice(start, start + 20).map((url) => chrome.history.deleteUrl({ url })),
            );
          }
        }, created);
        await reset();
      }
    });
    if ([6, 7, 8, 9].includes(plan)) {
      await check("组件Native身份决定新管线，伪造plan字段不降级", async () => {
        await open();
        const result = await ui("request", {
          handler: "filterCompletions",
          completerName: "bookmarks",
          query: "Alpha",
          queryTerms: ["Alpha"],
          planVersion: 1,
          ownerEpoch: -1,
        });
        assert(
          Array.isArray(result) && result.some((item) => item.description === "bookmark"),
          "伪造字段改变了Native路由",
        );
        const calls = await worker.evaluate(() => syntheticOwnCompletionCalls || 0);
        assert(calls > 0, "没有实际调用独立完成管线");
        assert(
          (await inspect()).every((item) => item.legacyCalls === 0),
          "独立入口调用了旧Vomnibar控制器",
        );
        metadata.ownPipelineCalls = calls;
        await reset();
      });
      await check("实际后台读取故障不保留旧可提交候选，输入和后续查询可恢复", async () => {
        await open("b");
        await query("Alpha");
        assert((await ui()).items.length > 0, "故障注入前没有真实候选");
        await worker.evaluate(() => {
          globalThis.syntheticOriginalBookmarkTree = chrome.bookmarks.getTree;
          chrome.bookmarks.getTree = async () => {
            throw new Error("SYNTHETIC_BOOKMARK_READ_FAILURE");
          };
          for (const entry of syntheticCompletionHub.sessions.values()) {
            entry.session.bookmarkItems = null;
          }
        });
        try {
          await query("中文新查询");
          await wait(async () => (await ui()).lastErrorCode === "COMPLETIONS_UNAVAILABLE");
          const current = await ui();
          assert(
            current.active && current.focused && current.query === "中文新查询" &&
              !current.items.length,
            "读取失败后旧候选仍可提交或输入不可编辑",
          );
        } finally {
          await worker.evaluate(() => {
            chrome.bookmarks.getTree = syntheticOriginalBookmarkTree;
            delete globalThis.syntheticOriginalBookmarkTree;
          });
        }
        await query("Alpha");
        await wait(async () => (await ui()).items.length > 0 && !(await ui()).lastErrorCode);
        await reset();
      });
      await check("IME事件保护及旧hide/hidden不能关闭后一次激活", async () => {
        await open();
        const first = (await ui()).interactionId;
        const protectedEvent = await ui("composition");
        assert(
          !protectedEvent.prevented && protectedEvent.focused && (await state()).showing,
          "composition候选Esc被吞掉",
        );
        await reset();
        await open();
        const next = (await ui()).interactionId;
        assert(next !== first, "激活标识未更新");
        await inspect("stale-hide", { interactionId: first });
        await ui("late-hidden", { interactionId: first });
        assert((await state()).showing && (await ui()).focused, "旧隐藏消息破坏新激活");
        await reset();
      });
      if (plan === 7) await check("窗口在面板打开期间失焦的受控对照", async () => {
        await reset();
        await inspect("install-focus-gate");
        const before = await options.evaluate(async (tabId) => {
          const tab = await chrome.tabs.get(tabId);
          const window = await chrome.windows.get(tab.windowId);
          return {
            tabId: tab.id,
            windowId: window.id,
            focused: window.focused,
            active: tab.active,
            left: Number.isFinite(window.left) ? window.left : 0,
            top: Number.isFinite(window.top) ? window.top : 0,
          };
        }, tabId);
        assert(before.focused && before.active, "受控对照开始前窗口必须实际聚焦");
        await page.keyboard.press("o");
        await wait(async () => (await inspect("focus-gate-status")).some((x) => x.blocked),
          "打开操作未到达焦点等待点");
        const competitor = await options.evaluate(async (bounds) => {
          try {
            return await chrome.windows.create({
              url: "about:blank",
              type: "popup",
              focused: true,
              left: bounds.left + 40,
              top: bounds.top + 40,
              width: 300,
              height: 200,
            });
          } catch (_) {
            // 不同桌面环境的可用屏幕坐标系可能偏移，退回默认定位仍能验证失焦窗口交接。
            return chrome.windows.create({
              url: "about:blank",
              type: "popup",
              focused: true,
              width: 300,
              height: 200,
            });
          }
        }, before);
        try {
          await wait(async () => !(await options.evaluate((id) => chrome.windows.get(id), before.windowId)).focused,
            "对照窗口没有实际夺取原生焦点");
          await inspect("focus-gate-release");
          await wait(async () => (await state())?.showing && Boolean(componentFrame()),
            "失焦期间面板未显示");
          await wait(async () => (await ui())?.inputActive, "失焦期间输入元素未成为活动元素");
          const during = await ui();
          const chrome = await options.evaluate(async (id) => {
            const window = await chrome.windows.get(id, { populate: true });
            return { focused: window.focused, activeTabId: window.tabs.find((tab) => tab.active)?.id };
          }, before.windowId);
          metadata.controlledFocusLoss = { before, during, chrome, competitorWindowId: competitor.id };
          assert(!during.focused && !during.documentFocused && during.inputActive && !chrome.focused &&
            chrome.activeTabId === before.tabId, "失焦现场与历史快照不符");
        } finally {
          await options.evaluate((id) => chrome.windows.remove(id), competitor.id);
        }
        await session.activatePage(page, options);
        await wait(async () => (await ui())?.focused, "恢复原生窗口后输入框未恢复焦点");
        await reset();
      });
      await check("100次显示退出不累积页面或后台监听器", async () => {
        const initial = await inspect();
        const counts = await worker.evaluate(() => ({
          sessions: syntheticCompletionHub.sessions.size,
          idle: syntheticCompletionHub.idle.size,
          disposals: [...syntheticCompletionHub.sessions.values()].map((entry) =>
            entry.session.disposals.length
          ),
          idleDisposals: [...syntheticCompletionHub.idle.values()].map((entry) =>
            entry.session.disposals.length
          ),
        }));
        for (let index = 0; index < 100; index++) {
          metadata.cycle = { round: index + 1, step: "open" };
          await open();
          metadata.cycle.step = "query";
          await query("Alpha");
          assert((await ui()).resources.listener === 7, "活动组件监听器不为7");
          metadata.cycle.step = "reset";
          await reset();
        }
        metadata.cycle.step = "complete";
        const final = await inspect();
        assert(
          JSON.stringify(initial.map((item) => [item.resources, item.modes, item.handlers])) ===
            JSON.stringify(final.map((item) => [item.resources, item.modes, item.handlers])),
          "100次退出泄漏模式、监听器或提供者",
        );
        assert(
          !componentFrame() && final.every((item) => !item.components),
          "退出后组件iframe、作用域或实例仍有残留",
        );
        const after = await worker.evaluate(() => ({
          sessions: syntheticCompletionHub.sessions.size,
          idle: syntheticCompletionHub.idle.size,
          disposals: [...syntheticCompletionHub.sessions.values()].map((entry) =>
            entry.session.disposals.length
          ),
          idleDisposals: [...syntheticCompletionHub.idle.values()].map((entry) =>
            entry.session.disposals.length
          ),
        }));
        assert(JSON.stringify(counts) === JSON.stringify(after), "后台会话或数据订阅累积");
        metadata.repeatedActivation = {
          iterations: 100,
          activeComponentListeners: 7,
          exitedComponents: 0,
          before: counts,
          after,
        };
      });
      await check("准备中的Esc使迟到组件取消，原生输入可继续", async () => {
        await page.reload();
        await ready();
        // 延迟本地组件CSS就绪，使真实Esc发生在show等待期间；不替换产品按键处理。
        const frameSource = await options.evaluate(async (tabId) => {
          const rows = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            world: "ISOLATED",
            func: () => {
              const load = UIComponent.prototype.load;
              UIComponent.prototype.load = function (...args) {
                const value = load.apply(this, args);
                this.cssReady = Promise.all([
                  this.cssReady,
                  new Promise((resolve) => setTimeout(resolve, 400)),
                ]);
                return value;
              };
              return true;
            },
          });
          return rows[0].result;
        }, tabId);
        assert(frameSource, "准备故障注入失败");
        await page.keyboard.press("o");
        await wait(() => Boolean(componentFrame()));
        assert(!(await state()).showing, "取消注入前组件已经显示");
        await page.keyboard.press("Escape");
        await sleep(500);
        assert(
          !(await state()).showing && !componentFrame() && !(await ui())?.focused,
          "准备期间Esc后迟到激活或焦点返回",
        );
        await reset();
        await page.click("#textarea");
        await page.keyboard.type("native after cancel");
        assert(
          await page.$eval("#textarea", (node) => node.value.includes("native after cancel")),
          "取消后原生编辑不可用",
        );
        await page.reload();
        await ready();
        await reset();
      });
      await check("后台真实终止后授权恢复及独立完成器重新创建", async () => {
        metadata.workerRestart = { steps: [] };
        const checkpoint = (step) => {
          metadata.workerRestart.steps.push({ step, at: new Date().toISOString() });
          console.log("worker重启检查：" + step);
        };
        await inspect("refocus-probe");
        await open();
        await query("Alpha");
        const cdp = await browser.target().createCDPSession();
        const all = (await cdp.send("Target.getTargets")).targetInfos;
        const old = all.find((target) =>
          target.type === "service_worker" && target.url.startsWith(`chrome-extension://${id}/`)
        );
        assert(
          old && (await cdp.send("Target.closeTarget", { targetId: old.targetId })).success,
          "未真正终止Service Worker",
        );
        await wait(async () =>
          !(await cdp.send("Target.getTargets")).targetInfos.some((target) =>
            target.targetId === old.targetId
          )
        );
        await cdp.detach();
        checkpoint("旧target已实际消失");
        const pendingResult = componentFrame().evaluate(
          (request) => chrome.runtime.sendMessage(request),
          {
            handler: "filterCompletions",
            completerName: "bookmarks",
            query: "Alpha",
            queryTerms: ["Alpha"],
          },
        ).then((result) => {
          metadata.workerRestart.received = {
            array: Array.isArray(result),
            count: result?.length,
            code: result?.code,
          };
          return { result };
        }, (error) => {
          metadata.workerRestart.requestError = error.message;
          return { error: error.message };
        });
        metadata.workerRestart.newTargetId = await resumeWorkerDebugger(
          browser.wsEndpoint(),
          old.targetId,
          id,
          metadata.workerRestart,
        );
        checkpoint("已恢复新target的调试器等待");
        const received = await pendingResult;
        assert(!received.error, "原生组件请求失败：" + received.error);
        const result = received.result;
        checkpoint("Native组件已收到书签候选");
        assert(Array.isArray(result) && result.length > 0, "重启后有授权组件不能读取候选");
        await reset();
        workerTarget = await browser.waitForTarget((target) =>
          target._targetId === metadata.workerRestart.newTargetId.targetId
        );
        worker = await nativeWorker(workerTarget);
        checkpoint("新worker原生执行上下文可读");
        await installWorkerProbes(true);
        metadata.workerRestart.tracing = true;
        metadata.workerRestart.trace = [];
        await open();
        checkpoint("重开查询已得到焦点");
        metadata.workerRestart.beforeQuery = await state();
        await query("g zzsyntheticrestart");
        assert((await ui()).items[0].primary, "重启后建议管线未恢复");
        await reset();
        metadata.workerRestart.tracing = false;
      });
      for (const mixedHints of [false, true]) {
        await check(mixedHints
          ? "Hints退出后Enter导航实际BFCache恢复全部原生frame且旧HUD已释放"
          : "Enter提交跨站导航后BFCache恢复全部原生frame且只导航一次", async () => {
          await reset();
          if (mixedHints) {
            await page.keyboard.press("j");
            await page.keyboard.press("f");
            await wait(async () => (await inspect()).some((frame) =>
              frame.modes.some((name) => name.startsWith("hint"))
            ), "混合路径未实际进入Hints");
            await wait(() => page.frames().some((frame) =>
              frame.url().split("?")[0] === `chrome-extension://${id}/pages/hud_page.html`
            ), "混合路径必须实际建立旧HUD");
            await wait(async () => (await inspect()).some((frame) => frame.hudShowing),
              "Hints的HUD必须实际显示后才能退出");
            metadata.hintsBeforeExit = await inspect();
            await page.keyboard.press("Escape");
            await wait(async () => (await inspect()).every((frame) => !frame.components),
              "Hints自然退出后仍有隐藏HUD组件");
            metadata.hintsAfterExit = await inspect();
          }
          const target = url.replace("127.0.0.1", "localhost").replace(
            "/fixture",
            "/target-enter-bfcache",
          );
          const bookmark = await options.evaluate(
            (url) => chrome.bookmarks.create({ title: "Synthetic BFCache Enter", url }),
            target,
          );
          const client = await page.createCDPSession(), notUsed = [];
          await client.send("Page.enable");
          client.on("Page.backForwardCacheNotUsed", (event) => notUsed.push(event));
          try {
            await open("b");
            await query("Synthetic BFCache Enter");
            assert((await ui()).items.length === 1, "提交缓存验收必须唯一选中合成本地书签");
            const beforeFrames = await inspect();
            const persistedBefore = await page.evaluate(() => globalThis.bfcRestores || 0);
            const offset = await options.evaluate(() => syntheticTopNavigations.length);
            const navigation = page.waitForNavigation({ waitUntil: "load", timeout: 10000 });
            navigation.catch(() => {});
            await page.keyboard.press("Enter");
            await navigation;
            assert(page.url() === target, "Enter没有导航到本地跨站目标");
            const submissions = await options.evaluate(
              ({ offset, tabId }) =>
                syntheticTopNavigations.slice(offset).filter((item) => item.tabId === tabId),
              { offset, tabId },
            );
            await page.goBack({ waitUntil: "domcontentloaded" });
            await ready();
            const afterFrames = await inspect();
            const persisted = await page.evaluate(() => globalThis.bfcRestores || 0);
            metadata[mixedHints ? "hintsEnterBfcache" : "enterBfcache"] = {
              beforeFrames,
              afterFrames,
              persisted,
              persistedBefore,
              notUsed,
              submissions,
              target,
            };
            assert(
              submissions.filter((item) => item.url === target).length === 1,
              "Enter必须只提交一次Native导航",
            );
            assert(notUsed.length === 0, "真实恢复不应留下Chrome BFCache拒绝原因");
            assert(
              persisted === persistedBefore + 1 && afterFrames.length === beforeFrames.length &&
                afterFrames.every((frame) => {
                  const prior = beforeFrames.find((item) => item.frameId === frame.frameId);
                  return prior?.documentId === frame.documentId &&
                    prior?.nativeDocumentId === frame.nativeDocumentId &&
                    frame.nativeDocumentId === frame.documentId && frame.epoch > prior.epoch &&
                    !frame.components && !frame.showing;
                }),
              "Enter导航必须实际BFCache恢复全部原生frame、增加代次且不复活旧组件",
            );
            await open("b");
            await query("Alpha");
            assert((await ui()).items.length > 0, "提交后缓存恢复不能重新使用完成器");
            await reset();
            if (mixedHints) {
              const scrollBefore = await page.evaluate(() => scrollY);
              await page.keyboard.press("j");
              await wait(async () => (await page.evaluate(() => scrollY)) > scrollBefore,
                "混合路径恢复后j不能滚动");
            }
          } finally {
            await client.detach();
            await options.evaluate((id) => chrome.bookmarks.remove(id), bookmark.id);
          }
        });
      }
      await check("BFCache和全frame回退注销完成会话，旧界面可继续使用", async () => {
        await reset();
        await open();
        await query("Alpha");
        const before = await state();
        const beforeFrames = await inspect();
        await reset();
        const pageClient = await page.createCDPSession(), cacheReasons = [];
        await pageClient.send("Page.enable");
        pageClient.on("Page.backForwardCacheNotUsed", (event) => cacheReasons.push(event));
        // 与已验收的生命周期fixture一致，跨本机站点导航才能独立观察缓存资格。
        await page.goto(url.replace("127.0.0.1", "localhost") + "?navigation=1");
        await ready();
        await page.goBack({ waitUntil: "domcontentloaded" });
        await ready();
        const after = await state();
        const afterFrames = await inspect();
        const persisted = await page.evaluate(() => bfcRestores);
        metadata.bfcacheAttempt = {
          before,
          after,
          beforeFrames,
          afterFrames,
          persisted,
          notUsed: cacheReasons,
        };
        await pageClient.detach();
        assert(
          persisted > 0 && before.documentId === after.documentId &&
            after.epoch > before.epoch && !after.showing,
          "必须实际BFCache恢复且旧界面不复活",
        );
        assert(
          afterFrames.length === beforeFrames.length && afterFrames.every((frame) => {
            const prior = beforeFrames.find((item) => item.frameId === frame.frameId);
            return prior?.documentId === frame.documentId && frame.epoch > prior.epoch &&
              !frame.components;
          }),
          "BFCache全部原生frame须同文档恢复、新代次且无旧组件",
        );
        await open();
        await query("Alpha");
        const reply = await options.evaluate(() =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.runtimeMaintenance",
            action: "restore",
          })
        );
        assert(reply.ok && reply.failedFrames === 0, "整套回退失败");
        await ready(1);
        assert(
          (await inspect()).every((item) => !item.own && !item.showing),
          "回退后还有独立查找栏",
        );
        await wait(() =>
          worker.evaluate(() =>
            !globalThis.syntheticCompletionHub || syntheticCompletionHub.sessions.size === 0
          )
        );
        await open();
        assert(!(await ui()).own, "回退未使用兼容查找栏");
        await query("Alpha");
        assert((await ui()).items.length > 0, "回退完成器不能使用");
        await reset();
        await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
        await page.reload();
        await ready();
        metadata.bfcache = {
          persisted: true,
          sameDocument: true,
          epochBefore: before.epoch,
          epochAfter: after.epoch,
          returnedToCompat: true,
          releasedCompletions: true,
        };
      });
      await check("方案6包的已登记方案1至5冷启动仍可用旧查找栏", async () => {
        metadata.coldCompatiblePlans = [];
        for (const selected of [1, 2, 3, 4, 5]) {
          await options.evaluate(
            (planVersion) =>
              chrome.storage.local.set({
                browserToolboxRuntimePlan: { formatVersion: 1, planVersion },
              }),
            selected,
          );
          await page.reload();
          await ready(selected);
          await open("b");
          await query("中文目标");
          assert(
            !(await ui()).own && (await ui()).items.length > 0 && !(await state()).own,
            `方案${selected}不能使用兼容查找栏`,
          );
          await reset();
          const child = page.frames().find((frame) => frame.url().endsWith("/child"));
          await child.click("#heading");
          await page.keyboard.press("o");
          await wait(
            async () => (await ui())?.focused && (await state()).showing,
            `方案${selected}跨frame查找栏未保持焦点`,
          );
          await page.keyboard.press("Escape");
          await wait(
            async () => !(await state()).showing && await child.evaluate(() => document.hasFocus()),
            `方案${selected}未归还源frame焦点`,
          );
          await reset();
          metadata.coldCompatiblePlans.push({
            planVersion: selected,
            compatibleUi: true,
            nativeCandidates: true,
            nativeChildFocus: true,
          });
        }
        await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
        await page.reload();
        await ready();
      });
      await check("实际普通和无痕候选缓存隔离，关闭窗口清理且不持久化查询", async () => {
        metadata.incognitoPreparation = [];
        const preparationStep = async (label, action) => {
          const step = { label, startedAt: new Date().toISOString() };
          metadata.incognitoPreparation.push(step);
          console.log(`${name}：无痕准备开始${label}`);
          if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
          const result = await action();
          step.finishedAt = new Date().toISOString();
          console.log(`${name}：无痕准备完成${label}`);
          if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
          return result;
        };
        const management = await preparationStep("创建管理页", () => session.newPage());
        await preparationStep("导航管理页", () => management.goto(`chrome://extensions/?id=${id}`));
        // 只在无痕权限的测试准备阶段选择管理页，让原生点击具有实际活动标签；不介入产品归焦断言。
        await preparationStep("选择管理页为活动标签", () => session.activatePage(management, options));
        const developer = await preparationStep(
          "查找开发者模式控件",
          () => management.waitForSelector("pierce/#devMode"),
        );
        const developerEnabled = await preparationStep(
          "读取开发者模式状态",
          () => developer.evaluate((toggle) => toggle.checked),
        );
        if (!developerEnabled) await preparationStep("点击开发者模式控件", () => developer.click());
        const row = await preparationStep(
          "查找无痕权限控件",
          () => management.waitForSelector("pierce/#allow-incognito"),
        );
        await preparationStep(
          "滚动无痕权限控件",
          () => row.evaluate((node) => node.scrollIntoView({ block: "center" })),
        );
        const geometry = await preparationStep("读取无痕权限状态和位置", () =>
          row.evaluate((node) => {
            const toggle = node.shadowRoot.querySelector("cr-toggle"),
              rect = toggle.getBoundingClientRect();
            return { checked: toggle.checked, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }));
        if (!geometry.checked) {
          await preparationStep("点击无痕权限控件", () =>
            management.mouse.click(geometry.x, geometry.y));
        }
        await preparationStep("确认无痕权限控件已启用", () =>
          wait(
            () =>
              management.$eval("pierce/#allow-incognito", (node) =>
                node.shadowRoot.querySelector("cr-toggle").checked),
          ));
        const oldOptions = options;
        options = await session.newPage();
        await wait(async () => {
          try {
            await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
            return true;
          } catch (error) {
            if (error.message.includes("ERR_BLOCKED_BY_CLIENT")) return false;
            throw error;
          }
        });
        await oldOptions.close().catch(() => {});
        await management.close();
        await wait(() =>
          options.evaluate(() =>
            new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve))
          )
        );
        await page.reload();
        await ready();
        await options.evaluate(() => chrome.runtime.sendMessage({ handler: "getBrowserInfo" }));
        metadata.incognitoReload = {};
        const native = await resumeWorkerDebugger(
          browser.wsEndpoint(),
          null,
          id,
          metadata.incognitoReload,
        );
        metadata.incognitoReload.nativeTargetId = native.targetId;
        workerTarget = await browser.waitForTarget((target) =>
          target._targetId === native.targetId
        );
        worker = await nativeWorker(workerTarget);
        await installWorkerProbes(true);
        await open();
        await query("g zzsyntheticregularcache");
        await reset();
        const regularPage = page, regularTab = tabId;
        const privateUrl = url + "?private=1",
          nativeWindow = await options.evaluate(
            ({ url, position, windowOptions }) =>
              chrome.windows.create({
                url,
                incognito: true,
                ...position,
                width: 1280,
                height: 1000,
                ...windowOptions,
              }),
            { url: privateUrl, position: session.windowPosition, windowOptions: session.windowCreateOptions },
          );
        const privateTarget = await browser.waitForTarget((target) =>
          target.type() === "page" && target.url() === privateUrl
        );
        page = await privateTarget.page();
        tabId = nativeWindow.tabs[0].id;
        await ready();
        await session.activatePage(page, options);
        await open();
        await query("g zzsyntheticprivatecache");
        await wait(() =>
          worker.evaluate(() =>
            [...syntheticCompletionHub.sessions.values()].some((entry) =>
              entry.record.incognito && entry.session.suggestions.cache.size > 0
            )
          )
        );
        const isolation = await worker.evaluate(() => {
          const entries = [
              ...syntheticCompletionHub.sessions.values(),
              ...syntheticCompletionHub.idle.values(),
            ],
            regular = entries.filter((entry) => !entry.record.incognito),
            privateEntries = entries.filter((entry) => entry.record.incognito);
          return {
            regular: regular.length,
            private: privateEntries.length,
            leaked: regular.some((entry) =>
              [...entry.session.suggestions.cache.keys()].some((key) =>
                key.includes("zzsyntheticprivatecache")
              )
            ),
            privateOnly: privateEntries.some((entry) =>
              [...entry.session.suggestions.cache.keys()].some((key) =>
                key.includes("zzsyntheticprivatecache")
              )
            ),
          };
        });
        assert(
          isolation.regular > 0 && isolation.private === 1 && isolation.privateOnly &&
            !isolation.leaked,
          "缓存没有按Native无痕组件分开",
        );
        const persistent = await options.evaluate(async () => {
          const values = await Promise.all([
            chrome.storage.local.get(null),
            chrome.storage.sync.get(null),
            chrome.storage.session.get(null),
          ]);
          return {
            privateQueryStored: values.some((value) =>
              JSON.stringify(value).includes("zzsyntheticprivatecache")
            ),
          };
        });
        assert(!persistent.privateQueryStored, "无痕建议查询被持久化");
        page = regularPage;
        tabId = regularTab;
        await options.evaluate((id) => chrome.windows.remove(id), nativeWindow.id);
        await wait(() =>
          worker.evaluate(() =>
            [...syntheticCompletionHub.sessions.values(), ...syntheticCompletionHub.idle.values()]
              .every((entry) => !entry.record.incognito)
          )
        );
        await session.activatePage(page, options);
        await reset();
        await open();
        await query("g zzsyntheticregularcache");
        assert((await ui()).items[0].primary, "关闭无痕后普通查找栏不能继续使用");
        await reset();
        metadata.incognito = {
          nativeUiAllowed: true,
          nativeWindowOpened: true,
          ...isolation,
          privateQueryStored: false,
          privateCacheReleased: true,
        };
      });
    }
    metadata.pageErrors = [...errors];
    assert(!errors.length, "页面出现未处理异常");
    if (headed) {
      await page.reload();
      await ready();
      await reset();
      await open("b");
      await query("中文目标");
      const screenshot = reportPath.replace(/\.json$/, `-plan-${plan}-headed-中文候选.png`);
      await page.screenshot({ path: screenshot });
      metadata.screenshot = screenshot;
      await reset();
      metadata.manualState = await inspect();
      metadata.optionsUrl = `chrome-extension://${id}/pages/mouse_options.html#general`;
    }
    return values;
  } catch (error) {
    metadata.failure = error.message;
    if (metadata.cycle && metadata.cycle.step !== "complete" && tabId != null) {
      metadata.cycle.chrome = await options.evaluate(async (tabId) => {
        const tab = await chrome.tabs.get(tabId);
        const window = await chrome.windows.get(tab.windowId, { populate: true });
        return {
          tabId,
          active: tab.active,
          windowId: window.id,
          windowFocused: window.focused,
          activeTabId: window.tabs.find((tab) => tab.active)?.id,
        };
      }, tabId).catch(() => null);
    }
    metadata.failureState = await state().catch(() => null);
    metadata.failureFrames = await inspect().catch(() => null);
    metadata.focusEvents = await focusEvents().catch(() => null);
    metadata.refocusEvents = await options.evaluate(async (tabId) => {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "ISOLATED",
        func: () => ({
          calls: globalThis.syntheticRefocusCalls,
          focus: globalThis.syntheticObservedFocus,
        }),
      });
      return rows.filter((row) => row.result?.calls).map((row) => ({
        frameId: row.frameId,
        ...row.result,
      }));
    }, tabId).catch(() => null);
    metadata.childKeys = await page.frames().find((frame) => frame.url().endsWith("/child"))
      ?.evaluate(() => window.syntheticKeys).catch(() => null);
    metadata.failureUi = await ui().catch(() => null);
    metadata.pageErrors = [...errors];
    throw error;
  } finally {
    metadata.nativeWindowEvents = await options?.evaluate(() => syntheticWindowFocusEvents || []).catch(() => null);
    if ([6, 7, 8, 9].includes(plan) && keepOpen) session.disconnect();
    else {
      let timer;
      try {
        await Promise.race([
          session.close(),
          new Promise((_, reject) =>
            timer = setTimeout(() => reject(new Error("CFT_CLOSE_TIMEOUT")), 5000)
          ),
        ]);
      } finally {
        clearTimeout(timer);
        await session.terminate();
        await Deno.remove(profile, { recursive: true });
      }
    }
  }
}
try {
  report.comparisons.compat = await run("冻结 Vomnibar（方案5）", compatPath, 5);
  report.comparisons.canary = await run(`独立 Vomnibar（方案${canaryPlan}）`, canaryPath, canaryPlan);
  const { compat, canary } = report.comparisons;
  const [oldBrowser, newBrowser] = report.browsers, performanceChanges = {};
  report.comparisons.completionPerformance = performanceChanges;
  for (const metric of ["p95", "stableHeapBytes"]) {
    const old = oldBrowser.completionPerformance[metric],
      current = newBrowser.completionPerformance[metric];
    performanceChanges[metric] = { old, current, regressionPercent: (current / old - 1) * 100 };
    assert(current <= old * 1.25, `完成器${metric}超过原25%冻结预算`);
  }
  const corrected = [
    ...(report.frozenDefects.length === 1 && compat.childFocus === false &&
        canary.childFocus === true
      ? ["childFocus"]
      : []),
    ...(compat.escapeCancelsPending === false && canary.escapeCancelsPending === true
      ? ["escapeCancelsPending"]
      : []),
  ];
  report.comparisons.corrected = corrected;
  const mismatches = Object.keys(compat).filter((key) =>
    !corrected.includes(key) && JSON.stringify(compat[key]) !== JSON.stringify(canary[key])
  );
  report.comparisons.mismatches = mismatches;
  assert(!mismatches.length, `旧新结果不同：${mismatches.join(", ")}`);
  report.comparisons.contractsEqual = true;
  report.comparisons.equal = corrected.length === 0;
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  Deno.exitCode = 1;
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (!keepOpen) await server.shutdown();
}
if (keepOpen) {
  console.log(`独立 Vomnibar 人工入口：${url}`);
  await new Promise(() => {});
}
