// SPDX-License-Identifier: GPL-3.0-or-later
// 所有页面和 profile 均为合成数据；使用真实 sender、浏览器文档和后台终止验证权限与副作用。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { assertSafeTestBrowser } from "./test_browser_safety.js";

assertSafeTestBrowser({ headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false" });

const root = path.resolve(path.dirname(path.fromFileUrl(import.meta.url)), "..");
const extensionPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  path.join(root, "dist/browser-toolbox");
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const reportPath = Deno.env.get("BROWSER_TOOLBOX_COMMAND_RUNTIME_REPORT");
const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-command-cft-" });
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  () =>
    new Response(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>命令协议合成验收</title></head><body style="min-height:20000px"><h1>命令协议合成验收</h1><input id="input"><textarea id="textarea"></textarea><div contenteditable="true">合成编辑区</div><a href="#target">合成链接</a><div id="target">合成查找文字</div><script>window.bfcRestores=0;window.addEventListener('pageshow',event=>{if(event.persisted)window.bfcRestores++;});window.nativeKeys=0;window.addEventListener('keydown',()=>window.nativeKeys++);</script></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
);
const url = `http://127.0.0.1:${server.addr.port}/fixture`;
const browser = await puppeteer.launch({
  executablePath,
  headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false",
  userDataDir: profile,
  defaultViewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-features=Prerender2",
    "--force-effective-connection-type=4G",
  ],
});
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  browser: await browser.version(),
  extensionPath,
  checks: [],
  source: "synthetic",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
async function waitFor(predicate, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error("等待协议合成状态超时");
}
async function check(name, action) {
  const start = performance.now();
  try {
    const data = await action();
    report.checks.push({
      name,
      status: "passed",
      durationMs: Math.round(performance.now() - start),
      ...(data ? { data } : {}),
    });
    console.log(`命令协议验收通过：${name}`);
  } catch (error) {
    report.checks.push({ name, status: "failed", error: error.message });
    throw error;
  }
}
let options;
let extensionId;
let page;
let tabId;
async function call(tab, operation, input = {}, frameId = 0) {
  return options.evaluate(async ({ tab, operation, inputJson, frameId }) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab, frameIds: [frameId] },
      world: "ISOLATED",
      func: async (operation, inputJson) => {
        const input = JSON.parse(inputJson);
        const host = globalThis.BrowserToolboxRuntimeHostInstance;
        const identity = host
          ? {
            documentId: host.context.documentId,
            runtimeEpoch: host.runtimeEpoch,
            incognito: host.context.incognito === true,
          }
          : null;
        if (operation === "state") {
          return {
            identity,
            state: host?.state,
            independentFind: Boolean(globalThis.BrowserToolboxFindControllerInstance),
            scrollY,
            modes: globalThis.Mode?.modes?.map((mode) => mode.name) || [],
            listeners: host?.getDiagnostics().activeListeners,
          };
        }
        if (operation === "find-history") {
          const history = BrowserToolboxFindControllerInstance.history;
          await history.saveQuery(input.query || "");
          return { incognito: history.incognito, queries: history.queries.slice() };
        }
        if (operation === "grant") {
          return chrome.runtime.sendMessage(
            BrowserToolboxMessageProtocol.envelope("ui", "authorize", {
              component: input.component,
              componentId: crypto.randomUUID(),
            }, identity),
          );
        }
        if (operation === "lifecycle") {
          return chrome.runtime.sendMessage(
            BrowserToolboxMessageProtocol.envelope(
              "lifecycle",
              input.action,
              input.payload || {},
              input.identity || identity,
            ),
          );
        }
        if (operation === "lifecycle-response-fixture") {
          globalThis.syntheticLifecycleOriginal ||= messageHandlers.showMessage;
          const choices = {
            value: () => ({ synthetic: true }),
            empty: () => {},
            asyncValue: async () => ({ synthetic: true }),
            syncError: () => {
              throw new Error("合成同步错误");
            },
            asyncError: async () => {
              throw new Error("合成异步错误");
            },
            restore: globalThis.syntheticLifecycleOriginal,
          };
          messageHandlers.showMessage = choices[input.type];
          return true;
        }
        if (operation === "attest") {
          return chrome.runtime.sendMessage(
            BrowserToolboxMessageProtocol.envelope("ui", "attest", input.proof, identity),
          );
        }
        if (operation === "command" || operation === "start") {
          const invocation = BrowserToolboxCommandInvocation.createV2(
            input.name,
            input.options || {},
            { type: input.source || "keyboard" },
            { sourceFrameId: globalThis.frameId },
            Object.hasOwn(input, "count") ? input.count : 1,
            {
              identity,
              countProvided: input.countProvided ?? input.count != null,
              confirmationGranted: input.confirmationGranted === true,
            },
          );
          const message = BrowserToolboxMessageProtocol.envelope("command", "invoke", {
            invocation,
          }, identity);
          message.requestId = invocation.requestId;
          globalThis.syntheticLastCommand = message;
          if (operation === "start") {
            chrome.runtime.sendMessage(message).then((result) =>
              globalThis.syntheticLastResult = result
            ).catch(() => {});
            return { requestId: invocation.requestId };
          }
          return chrome.runtime.sendMessage(message);
        }
        if (operation === "replay") {
          return chrome.runtime.sendMessage(globalThis.syntheticLastCommand);
        }
        if (operation === "v1") {
          const invocation = BrowserToolboxCommandInvocation.createInvocation(
            input.name,
            {},
            { type: input.source || "ui" },
            {},
            input.count,
          );
          const response = await chrome.runtime.sendMessage({
            handler: "browserToolbox.invoke",
            invocation,
          });
          return {
            ...response,
            submittedCount: invocation.count,
            submittedVersion: invocation.protocolVersion,
          };
        }
        if (operation === "legacy") {
          return chrome.runtime.sendMessage({
            handler: "runBackgroundCommand",
            registryEntry: { command: input.name, options: input.options || {} },
            count: input.count,
          });
        }
        if (operation === "reset") {
          scrollTo(0, 0);
          document.activeElement?.blur();
          UIComponent.destroyAll();
          HUD.hudUI = null;
          return true;
        }
        if (operation === "slowHints") {
          const original = HintCoordinator.getHintDescriptors.bind(HintCoordinator);
          HintCoordinator.getHintDescriptors = async (...args) => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return original(...args);
          };
          return true;
        }
        if (operation === "slowUi") {
          UIComponent.destroyAll();
          HUD.hudUI = null;
          Vomnibar.vomnibarUI = null;
          const controller = globalThis.BrowserToolboxUIControllerInstance;
          const independent = controller?.valid() === true;
          // 新组件绕过旧类原型且复用控制器 CSS；故障注入须命中实际类及本次未完成读取。
          if (independent) controller.cssLoading = null;
          const Component = independent ? globalThis.BrowserToolboxUIComponent : UIComponent;
          globalThis.syntheticUiShowStarted = false;
          globalThis.syntheticUiCssPending = false;
          globalThis.syntheticUiCssDelayCompleted = false;
          globalThis.syntheticUiImplementation = independent ? "browser-toolbox" : "vimium-compat";
          const get = chrome.storage.session.get.bind(chrome.storage.session);
          chrome.storage.session.get = async (keys) => {
            const value = await get(keys);
            if (keys === "vimiumCSSInChromeStorage") {
              chrome.storage.session.get = get;
              globalThis.syntheticUiCssPending = true;
              await new Promise((resolve) => setTimeout(resolve, 500));
              globalThis.syntheticUiCssPending = false;
              globalThis.syntheticUiCssDelayCompleted = true;
            }
            return value;
          };
          const show = Component.prototype.show;
          Component.prototype.show = function (...args) {
            globalThis.syntheticUiShowStarted = true;
            Component.prototype.show = show;
            return show.apply(this, args);
          };
          return true;
        }
        if (operation === "uiState") {
          return {
            started: globalThis.syntheticUiShowStarted === true,
            cssPending: globalThis.syntheticUiCssPending === true,
            cssDelayCompleted: globalThis.syntheticUiCssDelayCompleted === true,
            implementation: globalThis.syntheticUiImplementation,
            visible: [...UIComponent.instances].some((component) => component.showing),
            focus: document.activeElement.tagName,
          };
        }
      },
      args: [operation, inputJson],
    });
    return results[0]?.result;
  }, { tab, operation, inputJson: JSON.stringify(input), frameId });
}
async function ready(tab = tabId) {
  await waitFor(async () => (await readState(tab))?.state === "active");
}
async function readState(tab) {
  try {
    return await call(tab, "state");
  } catch (error) {
    // 丢弃后的新 frame 尚在创建，只有只读状态查询可以继续等待；任何用户命令都不重发。
    if (/Frame with ID \d+ was removed|No frame with id \d+/.test(error.message)) return null;
    throw error;
  }
}
async function tabs() {
  return options.evaluate(() => chrome.tabs.query({}));
}
async function createTab(suffix, properties = {}) {
  return options.evaluate((input) => chrome.tabs.create(input), {
    url: `${url}${suffix}`,
    active: false,
    ...properties,
  });
}
async function closeTabs(ids) {
  await options.evaluate(async (ids) => {
    const tabs = await chrome.tabs.query({});
    const present = ids.filter((id) => tabs.some((tab) => tab.id === id));
    if (present.length) await chrome.tabs.remove(present);
  }, ids);
}
async function publicComponent(parent = page, name = "vomnibar") {
  const source = `chrome-extension://${extensionId}/pages/${
    name === "help" ? "help_dialog" : name === "hud" ? "hud" : "vomnibar"
  }_page.html`;
  const id = crypto.randomUUID();
  await parent.evaluate(({ source, id }) => {
    const iframe = document.createElement("iframe");
    iframe.id = id;
    iframe.src = source;
    document.body.appendChild(iframe);
  }, { source, id });
  const handle = await parent.$(`[id="${id}"]`);
  let frame;
  await waitFor(async () => {
    frame = await handle.contentFrame();
    return frame?.url() === source;
  });
  await frame.waitForFunction(() => typeof globalThis.BrowserToolboxMessageProtocol === "object");
  return { frame, id };
}
async function uiMessage(frame, action, payload, identity = null) {
  return frame.evaluate(
    ({ action, payload, identity }) =>
      chrome.runtime.sendMessage(
        BrowserToolboxMessageProtocol.envelope("ui", action, payload, identity),
      ),
    { action, payload, identity },
  );
}
async function stopWorker() {
  const cdp = await browser.target().createCDPSession();
  const targets = (await cdp.send("Target.getTargets")).targetInfos;
  const target = targets.find((item) =>
    item.type === "service_worker" && item.url.startsWith(`chrome-extension://${extensionId}/`)
  );
  assert(
    target && (await cdp.send("Target.closeTarget", { targetId: target.targetId })).success,
    "未实际终止后台",
  );
  await waitFor(async () =>
    !(await cdp.send("Target.getTargets")).targetInfos.some((item) =>
      item.targetId === target.targetId
    )
  );
  await cdp.detach();
}
async function faultLedger(phase) {
  await options.evaluate(() => chrome.runtime.sendMessage({ handler: "getBrowserInfo" }));
  const target = browser.targets().find((target) =>
    target.type() === "service_worker" &&
    target.url().startsWith(`chrome-extension://${extensionId}/`)
  );
  const cdp = await target.createCDPSession();
  await cdp.send("Runtime.evaluate", {
    expression: phase === "before"
      ? "{ const original = BrowserToolboxRequestLedger.prototype.begin; BrowserToolboxRequestLedger.prototype.begin = async function(...args) { const value = await original.apply(this,args); if (value) return value; await new Promise(()=>{}); }; }"
      : "BrowserToolboxRequestLedger.prototype.complete = async function() { await new Promise(()=>{}); };",
  });
  await cdp.detach();
}
try {
  const target = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().startsWith("chrome-extension://")
  );
  extensionId = new URL(target.url()).host;
  options = await browser.newPage();
  await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
  await options.bringToFront();
  await waitFor(async () =>
    options.evaluate(() => typeof globalThis.Settings !== "undefined" && Settings.isLoaded())
  );
  await options.evaluate(async () => {
    await Settings.set("smoothScroll", false);
    await Settings.set("grabBackFocus", false);
  });
  page = await browser.newPage();
  await page.goto(url);
  await page.bringToFront();
  tabId = (await tabs()).find((tab) => tab.url === url).id;
  await ready();
  await check("v2 100j、来源次数上限、v1 既有限制和旧入口对照", async () => {
    await page.keyboard.type("100j");
    await waitFor(async () => await page.evaluate(() => scrollY) === 6000);
    await call(tabId, "reset");
    for (const source of ["ui", "wheel", "rocker", "superDrag", "mouseGesture"]) {
      assert(
        (await call(tabId, "command", { name: "scrollDown", count: 100, source })).code ===
          "INVALID_OPTIONS",
        "其他来源不应放宽次数",
      );
    }
    for (const [name, count] of [["scrollDown", 100], ["closeTabsOnRight", null]]) {
      const response = await call(tabId, "v1", { name, count });
      assert(
        response?.code === "INVALID_OPTIONS",
        `v1 ${name} 预期 INVALID_OPTIONS，实际 ${response?.code}，提交版本 ${response.submittedVersion} 次数 ${response.submittedCount}`,
      );
    }
    for (const source of ["ui", "wheel", "rocker"]) {
      const before = (await call(tabId, "state")).scrollY;
      assert(
        (await call(tabId, "v1", { name: "scrollDown", count: 1, source })).ok,
        "v1 来源调用失败",
      );
      await waitFor(async () => (await call(tabId, "state")).scrollY === before + 60);
    }
    assert(
      (await call(tabId, "legacy", { name: "missing", count: 1 })).code === "UNKNOWN_COMMAND",
      "旧入口不能接受任意函数名",
    );
    return { keyboardDistance: 6000, step: 60, otherInputsLimited: true };
  });
  await check("nullable 关闭右侧全部、noRepeat 和原生确认取消无副作用", async () => {
    const right = await Promise.all([
      createTab("?right=1"),
      createTab("?right=2"),
      createTab("?right=3"),
    ]);
    assert(
      (await call(tabId, "command", { name: "closeTabsOnRight", count: null })).ok,
      "关闭全部失败",
    );
    await waitFor(async () => {
      const present = await tabs();
      return right.every((tab) => !present.some((item) => item.id === tab.id));
    });
    const start = (await tabs()).length;
    let dialog = false;
    const dismiss = async (event) => {
      dialog = true;
      await event.dismiss();
    };
    page.on("dialog", dismiss);
    await page.bringToFront();
    await page.keyboard.type("21t");
    await waitFor(async () => dialog);
    page.off("dialog", dismiss);
    assert((await tabs()).length === start, "取消确认后仍创建标签");
    const result = await call(tabId, "command", { name: "toggleMuteTab", count: 100 });
    assert(result.ok, "noRepeat 调用未正常归一化");
    await call(tabId, "command", { name: "toggleMuteTab", count: 1 });
    return { closed: right.length, confirmationCancelled: true };
  });
  await check("原生生命周期同步、异步及抛错回包均有明确结果", async () => {
    try {
      for (const type of ["value", "empty", "asyncValue", "syncError", "asyncError"]) {
        await call(tabId, "lifecycle-response-fixture", { type });
        const target = browser.targets().find((target) =>
          target.type() === "service_worker" &&
          target.url().startsWith(`chrome-extension://${extensionId}/`)
        );
        const cdp = await target.createCDPSession();
        let result;
        try {
          // 固定合成操作只插入浏览器产生的整数 tabId；实际后台作为原生消息发送者。
          assert(Number.isInteger(tabId), "合成 tabId 必须为整数");
          const reply = await cdp.send("Runtime.evaluate", {
            expression:
              `(async()=>{const frame=await chrome.webNavigation.getFrame({tabId:${tabId},frameId:0});const row=(await chrome.storage.session.get('browserToolboxRuntimeDocuments')).browserToolboxRuntimeDocuments.documents.find(item=>item.tabId===${tabId}&&item.documentId===frame.documentId);const identity={documentId:row.documentId,runtimeEpoch:row.runtimeEpoch,incognito:row.incognito};return await chrome.tabs.sendMessage(${tabId},BrowserToolboxMessageProtocol.envelope('lifecycle','relay',{message:{handler:'showMessage'}},identity),{documentId:identity.documentId});})()`,
            awaitPromise: true,
            returnByValue: true,
          });
          assert(
            !reply.exceptionDetails,
            `${type} 原生消息通道异常：${
              reply.exceptionDetails?.exception?.description || reply.exceptionDetails?.text
            }`,
          );
          result = reply.result.value;
        } finally {
          await cdp.detach();
        }
        assert(
          type.endsWith("Error")
            ? result?.code === "INTERACTION_UNAVAILABLE"
            : type === "empty"
            ? result?.code === "LIFECYCLE_DELIVERED"
            : result?.synthetic === true,
          `${type} 生命周期回包语义错误`,
        );
      }
    } finally {
      await call(tabId, "lifecycle-response-fixture", { type: "restore" });
    }
    return {
      synchronousValue: true,
      emptyReceipt: true,
      asynchronousValue: true,
      synchronousFailure: true,
      asynchronousFailure: true,
    };
  });
  await check("公开 UI 不能注册、导航、调用命令或创建手势会话", async () => {
    const { frame } = await publicComponent();
    const result = await frame.evaluate(async () => ({
      state: Boolean(BrowserToolboxUIAuthorization.session),
      register: await chrome.runtime.sendMessage(
        BrowserToolboxMessageProtocol.envelope("lifecycle", "register", { runtimeEpoch: 1 }),
      ),
      navigate: await chrome.runtime.sendMessage({
        handler: "openUrlInCurrentTab",
        url: "about:blank",
      }),
      invoke: await chrome.runtime.sendMessage({
        handler: "browserToolbox.invoke",
        invocation: BrowserToolboxCommandInvocation.createInvocation("removeTab"),
      }),
      gesture: await new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: "browserToolbox.gesture" });
        port.onMessage.addListener((response) => {
          resolve(response);
          port.disconnect();
        });
        port.postMessage({
          handler: "browserToolbox.gestureStart",
          requestId: crypto.randomUUID(),
        });
      }),
    }));
    assert(
      !result.state && result.register.code === "UI_NOT_AUTHORIZED" &&
        result.navigate.code === "UI_NOT_AUTHORIZED" &&
        result.invoke.code === "UI_NOT_AUTHORIZED" && result.gesture.accepted === false,
      "公开 UI 获得了后台能力",
    );
    assert(page.url() === url, "未授权导航改变了宿主页");
    return { denied: 4 };
  });
  await check("授权绑定实际父文档、组件、代次，秘密不入 session且重放失败", async () => {
    const { frame } = await publicComponent(page, "hud");
    const grant = (await call(tabId, "grant", { component: "hud" })).grant;
    const proof = (await uiMessage(frame, "claim", grant)).proof;
    assert(
      (await uiMessage(frame, "finalize", proof)).code === "INVALID_UI_GRANT",
      "未确认父文档即可完成授权",
    );
    const childUrl = url.replace("127.0.0.1", "localhost") + "?child=1";
    await page.evaluate((url) => {
      const iframe = document.createElement("iframe");
      iframe.id = "cross-frame";
      iframe.src = url;
      document.body.appendChild(iframe);
    }, childUrl);
    await waitFor(async () => page.frames().some((item) => item.url() === childUrl));
    const child = (await options.evaluate(async (tabId) =>
      chrome.webNavigation.getAllFrames({ tabId }), tabId)).find((item) =>
        item.url === childUrl
      );
    await waitFor(async () => (await call(tabId, "state", {}, child.frameId)).state === "active");
    assert(
      (await call(tabId, "attest", { proof }, child.frameId)).code === "INVALID_UI_OWNER",
      "其他父文档代为确认了组件",
    );
    assert((await call(tabId, "attest", { proof })).ok, "真实父文档无法证明授权");
    const finalized = await uiMessage(frame, "finalize", proof);
    assert(finalized.ok, `父文档证明后完成授权失败：${finalized.code}`);
    const session = finalized.session;
    assert(
      session.ownerDocumentId === (await call(tabId, "state")).identity.documentId,
      "组件所有者绑定错误",
    );
    assert((await uiMessage(frame, "finalize", proof)).code === "INVALID_UI_GRANT", "授权重放成功");
    const stored = await options.evaluate(() =>
      chrome.storage.session.get("browserToolboxRuntimeDocuments")
    );
    assert(!JSON.stringify(stored).includes(grant.secret), "秘密进入共享存储");
    await call(tabId, "lifecycle", {
      action: "register",
      payload: { runtimeEpoch: (await call(tabId, "state")).identity.runtimeEpoch + 1 },
    });
    const stale = await frame.evaluate(() =>
      chrome.runtime.sendMessage({ handler: "openUrlInCurrentTab", url: "about:blank" })
    );
    assert(stale.code === "UI_NOT_AUTHORIZED", "所有者换代后组件仍有效");
    await page.reload();
    await ready();
    return { parentProof: true, replayDenied: true, epochDenied: true };
  });
  for (const phase of ["before", "after"]) {
    await check(
      `副作用${phase === "before" ? "前" : "后"}真实终止后台，结果未知且同 ID 不重放`,
      async () => {
        const victims = await Promise.all([
          createTab(`?kill=${phase}1`),
          createTab(`?kill=${phase}2`),
        ]);
        await faultLedger(phase);
        const { requestId } = await call(tabId, "start", { name: "closeTabsOnRight", count: null });
        await waitFor(async () =>
          options.evaluate(
            async (requestId) =>
              (await chrome.storage.session.get("browserToolboxCommandRequests"))
                .browserToolboxCommandRequests?.entries.some((entry) =>
                  entry.key.endsWith(requestId) && entry.state === "executing"
                ),
            requestId,
          )
        );
        if (phase === "after") {
          await waitFor(async () => {
            const present = await tabs();
            return victims.every((victim) => !present.some((item) => item.id === victim.id));
          });
        } else {
          const present = await tabs();
          assert(
            victims.every((victim) => present.some((item) => item.id === victim.id)),
            "接收记录之后、执行之前产生副作用",
          );
        }
        await stopWorker();
        const later = await createTab(`?later=${phase}`);
        const replay = await call(tabId, "replay");
        assert(replay.code === "RESULT_UNKNOWN", "未完成动作没有返回结果未知");
        assert((await tabs()).some((item) => item.id === later.id), "后台重启后重复关闭了新标签");
        await closeTabs([...victims.map((item) => item.id), later.id]);
        return { phase, replay: replay.code };
      },
    );
  }
  await check("有授权 Vomnibar 在后台重启后保留身份，原生焦点和 Esc 正常", async () => {
    await page.bringToFront();
    await page.keyboard.press("o");
    await waitFor(async () => page.frames().some((frame) => frame.url().includes("vomnibar_page")));
    const frame = page.frames().find((frame) => frame.url().includes("vomnibar_page"));
    await frame.waitForFunction(() =>
      BrowserToolboxUIAuthorization.session && document.activeElement?.id === "vomnibar-search"
    );
    await stopWorker();
    const result = await frame.evaluate(() =>
      chrome.runtime.sendMessage({
        handler: "filterCompletions",
        completerName: "tabs",
        queryTerms: [],
        query: "",
      })
    );
    assert(Array.isArray(result), "后台重启后有授权组件被错误拒绝");
    await page.keyboard.press("Escape");
    await waitFor(async () =>
      await page.evaluate(() => document.activeElement?.tagName !== "IFRAME")
    );
    return { authenticatedAfterRestart: true };
  });
  await check("导航后的旧文档/旧代次不能执行，BFCache 恢复重新握手且 j 只执行一次", async () => {
    await call(tabId, "reset");
    const before = await call(tabId, "state");
    await page.goto(url + "?navigation=1");
    await ready();
    const forged = await call(tabId, "lifecycle", {
      action: "relay",
      identity: before.identity,
      payload: { message: { handler: "showMessage", message: "合成旧消息" } },
    });
    assert(forged.code === "PERMISSION_DENIED", "旧文档身份被新文档接受");
    await page.goBack({ waitUntil: "domcontentloaded" });
    await ready();
    const restored = await call(tabId, "state");
    const persisted = await page.evaluate(() => window.bfcRestores);
    assert(
      persisted > 0 && restored.identity.documentId === before.identity.documentId &&
        restored.identity.runtimeEpoch > before.identity.runtimeEpoch,
      "没有实际 BFCache 恢复或没有重新握手",
    );
    await page.bringToFront();
    await page.keyboard.press("j");
    await waitFor(async () => (await call(tabId, "state")).scrollY === 60);
    return {
      persisted,
      epochBefore: before.identity.runtimeEpoch,
      epochAfter: restored.identity.runtimeEpoch,
      distance: 60,
    };
  });
  await check("标签实际丢弃恢复使用新文档身份", async () => {
    const tab = await createTab("?discard=1");
    await ready(tab.id);
    const before = await call(tab.id, "state");
    await page.bringToFront();
    const discarded = await options.evaluate((id) => chrome.tabs.discard(id), tab.id);
    assert(discarded?.discarded === true, "浏览器未实际丢弃标签");
    await options.evaluate((id) => chrome.tabs.update(id, { active: true }), tab.id);
    await ready(tab.id);
    let after;
    await waitFor(async () => {
      after = await readState(tab.id);
      return after?.state === "active" && after.identity.documentId !== before.identity.documentId;
    });
    assert(after.identity.documentId !== before.identity.documentId, "丢弃恢复仍使用旧文档身份");
    await closeTabs([tab.id]);
    await page.bringToFront();
    return { discarded: true, freshDocument: true };
  });
  await check("实际预渲染文档在激活前无执行权，激活后握手且按键单次执行", async () => {
    // 丢弃/BFCache 后 Puppeteer 23 的父 session 可能残留旧 frame 树；原生预渲染使用新合成父文档独立验证。
    await closeTabs([tabId]);
    page = await browser.newPage();
    await page.goto(url + "?before-prerender=1");
    tabId = (await tabs()).find((tab) => tab.url === page.url()).id;
    await ready();
    await page.bringToFront();
    const prerenderUrl = url + "?prerender=1";
    const client = await browser.target().createCDPSession();
    const preload = page._client();
    const tabSession = preload.parentSession();
    let prerenderSession;
    const attached = (event) => {
      (report.prerenderDiagnostics.attached ||= []).push({
        type: event.targetInfo.type,
        subtype: event.targetInfo.subtype,
      });
      if (event.targetInfo.subtype === "prerender") {
        prerenderSession = preload.connection().session(event.sessionId);
      }
    };
    tabSession.on("Target.attachedToTarget", attached);
    report.prerenderDiagnostics = {
      enabled: null,
      status: null,
      targetObserved: false,
      freshSyntheticParent: true,
    };
    preload.on(
      "Preload.preloadEnabledStateUpdated",
      (event) => report.prerenderDiagnostics.enabled = event,
    );
    preload.on(
      "Preload.prerenderStatusUpdated",
      (event) =>
        report.prerenderDiagnostics.status = {
          status: event.status,
          prerenderStatus: event.prerenderStatus,
          disallowedMojoInterface: event.disallowedMojoInterface,
        },
    );
    await preload.send("Preload.enable");
    // Puppeteer 23 附着 frame target 时默认关闭预渲染；只在合成测试浏览器中恢复浏览器原生预渲染。
    await preload.send("Page.setPrerenderingAllowed", { isAllowed: true });
    await page.evaluate((url) => {
      const script = document.createElement("script");
      script.type = "speculationrules";
      script.textContent = JSON.stringify({
        prerender: [{ source: "list", urls: [url], eagerness: "immediate" }],
      });
      document.head.appendChild(script);
    }, prerenderUrl);
    await waitFor(() => Boolean(prerenderSession));
    // Puppeteer 的 ChromeTargetManager 已负责恢复自动附着目标；重复发送会与其握手竞争。
    // 仍等待浏览器报告实际 Ready，未激活权限和激活身份均继续作原生验证。
    await waitFor(() => report.prerenderDiagnostics.status?.status === "Ready");
    report.prerenderDiagnostics.targets = (await client.send("Target.getTargets", { filter: [{}] }))
      .targetInfos.map((item) => ({
        type: item.type,
        subtype: item.subtype,
        matches: item.url === prerenderUrl,
      }));
    report.prerenderDiagnostics.parent =
      (await tabSession.send("Target.getTargetInfo")).targetInfo.type;
    prerenderSession ||= [...page.target()._childTargets()].find((target) =>
      target._subtype() === "prerender"
    )?._session();
    assert(prerenderSession, "原生预渲染已就绪，但自动附着 session 未找到");
    report.prerenderDiagnostics.targetObserved = true;
    report.prerenderDiagnostics.step = "before-activation";
    const cdp = prerenderSession;
    const contexts = [];
    cdp.on("Runtime.executionContextCreated", (event) => contexts.push(event.context));
    await cdp.send("Runtime.enable");
    const before = (await cdp.send("Runtime.evaluate", {
      expression:
        "({url:location.href,prerendering:document.prerendering,token:(globalThis.syntheticPrerenderToken ||= crypto.randomUUID())})",
      returnByValue: true,
    })).result.value;
    assert(before.prerendering && before.url === prerenderUrl, "target 不是实际预渲染文档");
    const isolated = contexts.find((context) =>
      context.origin === `chrome-extension://${extensionId}` || context.name?.includes(extensionId)
    );
    let denial = "NOT_INJECTED_BEFORE_ACTIVATION";
    if (isolated) {
      const response = (await cdp.send("Runtime.evaluate", {
        contextId: isolated.id,
        expression:
          "{ globalThis.syntheticPreActivationReply=null; if (globalThis.BrowserToolboxMessageProtocol) chrome.runtime.sendMessage(BrowserToolboxMessageProtocol.envelope('lifecycle','initialize')).then(result=>globalThis.syntheticPreActivationReply={code:result?.code,ok:result?.ok}); }; ({active:globalThis.BrowserToolboxRuntimeHostInstance?.state==='active'})",
        returnByValue: true,
      })).result.value;
      assert(response && !response.active, "未激活文档获得执行权");
      await sleep(100);
      const reply = (await cdp.send("Runtime.evaluate", {
        contextId: isolated.id,
        expression: "globalThis.syntheticPreActivationReply",
        returnByValue: true,
      })).result.value;
      assert(!reply?.ok, "激活前初始化成功");
      denial = reply?.code || "NO_REPLY_BEFORE_ACTIVATION";
    }
    tabSession.off("Target.attachedToTarget", attached);
    await client.detach();
    await page.evaluate((url) => {
      const link = document.createElement("a");
      link.id = "activate-prerender";
      link.href = url;
      link.textContent = "激活合成预渲染";
      document.body.prepend(link);
    }, prerenderUrl);
    report.prerenderDiagnostics.step = "activate";
    await page.click("#activate-prerender");
    report.prerenderDiagnostics.nativeNavigation = await options.evaluate(
      async ({ id, url }) => (await chrome.tabs.get(id)).url === url,
      { id: tabId, url: prerenderUrl },
    );
    await waitFor(async () =>
      options.evaluate(async ({ id, url }) => (await chrome.tabs.get(id)).url === url, {
        id: tabId,
        url: prerenderUrl,
      })
    );
    await ready();
    report.prerenderDiagnostics.step = "active";
    const activated = await options.evaluate(async (id) =>
      (await chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        world: "MAIN",
        func: () => ({
          prerendering: document.prerendering,
          token: globalThis.syntheticPrerenderToken,
        }),
      }))[0]?.result, tabId);
    assert(
      activated && !activated.prerendering && activated.token === before.token,
      "导航没有激活原预渲染文档",
    );
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "j",
      code: "KeyJ",
      text: "j",
      windowsVirtualKeyCode: 74,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "j",
      code: "KeyJ",
      windowsVirtualKeyCode: 74,
    });
    await waitFor(async () => (await call(tabId, "state")).scrollY === 60);
    // Puppeteer 23 对 CFT 152 的预渲染激活 frame 树不能可靠重建；后续用新合成标签，不重载证明中的文档。
    await closeTabs([tabId]);
    page = await browser.newPage();
    await page.goto(url + "?after-prerender=1");
    tabId = (await tabs()).find((tab) => tab.url === page.url()).id;
    await ready();
    return { nativePrerender: true, denial, activatedSameDocument: true };
  });
  await check("普通与无痕文档/去重记录隔离，关闭无痕后清理文档授权", async () => {
    const management = await browser.newPage();
    await management.goto(`chrome://extensions/?id=${extensionId}`);
    const devMode = await management.waitForSelector("pierce/#devMode");
    if (!await devMode.evaluate((toggle) => toggle.checked)) await devMode.click();
    const row = await management.waitForSelector("pierce/#allow-incognito");
    await row.evaluate((row) => row.scrollIntoView({ block: "center" }));
    const geometry = await row.evaluate((row) => {
      const toggle = row.shadowRoot.querySelector("cr-toggle");
      const rect = toggle.getBoundingClientRect();
      return { checked: toggle.checked, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    if (!geometry.checked) await management.mouse.click(geometry.x, geometry.y);
    await waitFor(() =>
      management.$eval(
        "pierce/#allow-incognito",
        (row) => row.shadowRoot.querySelector("cr-toggle").checked,
      )
    );
    const previousOptions = options;
    options = await browser.newPage();
    await waitFor(async () => {
      try {
        await options.goto(`chrome-extension://${extensionId}/pages/options.html`);
        return true;
      } catch (error) {
        if (error.message.includes("ERR_BLOCKED_BY_CLIENT")) return false;
        throw error;
      }
    });
    await previousOptions.close().catch(() => {});
    await waitFor(async () => {
      try {
        return await options.evaluate(() =>
          new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve))
        );
      } catch (_) {
        return false;
      }
    });
    report.incognitoPermission = {
      nativeUiChecked: true,
      apiAllowed: true,
      freshExtensionContext: true,
    };
    await management.close();
    await page.reload();
    await ready();
    const window = await options.evaluate(
      (url) => chrome.windows.create({ url, incognito: true }),
      url + "?incognito=1",
    );
    const incognitoTab = window.tabs[0];
    await ready(incognitoTab.id);
    const privateState = await call(incognitoTab.id, "state");
    const ordinaryState = await call(tabId, "state");
    assert(
      privateState.identity.incognito === true && ordinaryState.identity.incognito === false &&
        privateState.identity.documentId !== ordinaryState.identity.documentId,
      "文档身份没有隔离无痕上下文",
    );
    if (ordinaryState.independentFind) {
      await call(tabId, "find-history", { query: "synthetic-ordinary-find" });
      const privateHistory = await call(incognitoTab.id, "find-history", {
        query: "synthetic-private-find",
      });
      const queryLists = await options.evaluate(() =>
        chrome.storage.session.get(["findModeRawQueryList", "findModeRawQueryListIncognito"])
      );
      assert(
        privateHistory.incognito && privateHistory.queries.includes("synthetic-private-find") &&
          !queryLists.findModeRawQueryList.includes("synthetic-private-find"),
        "无痕查询写入了普通历史",
      );
      assert(
        queryLists.findModeRawQueryListIncognito.includes("synthetic-ordinary-find"),
        "既有普通到无痕传播未保留",
      );
      const second = await options.evaluate(
        ({ windowId, url }) => chrome.tabs.create({ windowId, url }),
        { windowId: window.id, url: url + "?incognito-new-document=1" },
      );
      await ready(second.id);
      assert(
        (await call(second.id, "find-history")).queries.includes("synthetic-private-find"),
        "新无痕文档覆盖了已有私有历史",
      );
      report.findHistoryIsolation = {
        nativeIncognito: true,
        noPrivateToOrdinary: true,
        retainedOnNewDocument: true,
      };
    }
    const privateResult = await call(incognitoTab.id, "command", {
      name: "closeTabsOnRight",
      count: null,
    });
    assert(privateResult.ok, "无痕危险请求失败");
    const records = await options.evaluate(() =>
      chrome.storage.session.get([
        "browserToolboxCommandRequests",
        "browserToolboxRuntimeDocuments",
      ])
    );
    assert(
      records.browserToolboxRuntimeDocuments.documents.some((item) =>
        item.documentId === privateState.identity.documentId && item.incognito
      ),
      "没有独立无痕身份记录",
    );
    assert(
      records.browserToolboxCommandRequests.entries.some((item) =>
        item.key.startsWith(`1:${incognitoTab.id}:`)
      ),
      "无痕去重记录不独立",
    );
    await options.evaluate((id) => chrome.windows.remove(id), window.id);
    if (ordinaryState.independentFind) {
      await waitFor(() =>
        options.evaluate(async () =>
          !Object.hasOwn(
            await chrome.storage.session.get("findModeRawQueryListIncognito"),
            "findModeRawQueryListIncognito",
          )
        )
      );
      report.findHistoryIsolation.clearedOnLastWindowClose = true;
    }
    await waitFor(async () =>
      options.evaluate(
        async (documentId) =>
          !(await chrome.storage.session.get("browserToolboxRuntimeDocuments"))
            .browserToolboxRuntimeDocuments.documents.some((item) =>
              item.documentId === documentId
            ),
        privateState.identity.documentId,
      )
    );
    await page.bringToFront();
    return { documentIsolation: true, ledgerIsolation: true, closedDocumentCleaned: true };
  });
  await check("Hints 收集期间退出不会被迟到响应重新打开", async () => {
    await call(tabId, "slowHints");
    await page.bringToFront();
    await page.keyboard.press("f");
    await page.keyboard.press("Escape");
    await sleep(800);
    const state = await call(tabId, "state");
    assert(
      !state.modes.some((name) => name?.startsWith("link-hints")),
      "迟到 Hints 响应重新打开模式",
    );
    await page.keyboard.press("j");
    await waitFor(async () => (await call(tabId, "state")).scrollY === state.scrollY + 60);
    return { cancelled: true };
  });
  await check("组件授权和样式尚未完成时 Esc 会取消迟到显示，原生焦点可用", async () => {
    await call(tabId, "slowUi");
    await page.keyboard.press("o");
    await waitFor(async () => {
      const state = await call(tabId, "uiState");
      return state.started && state.cssPending;
    });
    await page.keyboard.press("Escape");
    await sleep(700);
    const state = await call(tabId, "uiState");
    assert(state.cssDelayCompleted && !state.cssPending, "必须实际结束本次延迟 CSS 读取");
    assert(!state.visible && state.focus !== "IFRAME", "已取消的组件被迟到显示或抢走焦点");
    const before = (await call(tabId, "state")).scrollY;
    await page.keyboard.press("j");
    await waitFor(async () => (await call(tabId, "state")).scrollY === before + 60);
    return { cancelled: true, focusPreserved: true, cssDelayed: true,
      implementation: state.implementation };
  });
  await check("设置页直接发给内容脚本不能绕过后台，正式 UI 调用能到达指定标签", async () => {
    await call(tabId, "reset");
    await options.evaluate(async (id) => {
      const invocation = BrowserToolboxCommandInvocation.createInvocation("scrollDown", {}, {
        type: "ui",
      });
      try {
        await chrome.tabs.sendMessage(id, {
          handler: "browserToolbox.executePageCommand",
          type: "browserToolbox.executePageCommand",
          protocolVersion: 1,
          invocation,
        }, { frameId: 0 });
      } catch (_) { /* 内容脚本不响应未经后台路由的 UI 请求。 */ }
    }, tabId);
    await sleep(50);
    assert((await call(tabId, "state")).scrollY === 0, "直接 UI 消息产生了页面副作用");
    const result = await options.evaluate(
      async (id) =>
        chrome.runtime.sendMessage({
          handler: "browserToolbox.invoke",
          invocation: BrowserToolboxCommandInvocation.createInvocation("scrollDown", {}, {
            type: "ui",
          }, { tabId: id }),
        }),
      tabId,
    );
    assert(result.ok, "正式 UI 命令未被接受");
    await waitFor(async () => (await call(tabId, "state")).scrollY === 60);
    return { directUiDenied: true, officialUiDistance: 60 };
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  console.error(error.stack);
} finally {
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  await server.shutdown();
  await Deno.remove(profile, { recursive: true });
}
console.log(`命令协议门禁：${report.status}`);
if (report.status !== "passed") Deno.exit(1);
