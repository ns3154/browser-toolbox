// SPDX-License-Identifier: GPL-3.0-or-later
// 只加载独立合成 profile；同一 CFT 的冻结提示与新提示执行相同实际按键和 DOM 操作。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_HINTS_COMPAT_PATH");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_HINTS_REPORT");
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_HINTS_KEEP_OPEN") === "true";
const canaryPlan = Number(Deno.env.get("BROWSER_TOOLBOX_HINTS_PLAN_VERSION") || 5);
if (![5, 6, 7, 8, 9].includes(canaryPlan)) throw new Error("未登记的提示测试方案");
if (!compatPath || !canaryPath) throw new Error("必须提供冻结提示与独立提示目录");
const html =
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Link Hints 旧新验收</title>
<style>body{margin:16px;font:16px/24px sans-serif;min-height:6000px}a,button{display:inline-block;margin:3px}input,textarea{margin:3px}iframe{width:440px;height:110px}#editor{border:1px solid #aaa;width:440px;height:36px}#scroll{height:38px;width:240px;overflow:auto}#covered{position:absolute;left:700px;top:90px;width:80px;height:30px}#cover{position:absolute;left:695px;top:85px;width:100px;height:45px;z-index:3;background:#eee}#rotate a{margin:0}</style>
<body><h1>Link Hints 提示验收</h1><p>f 提示；F 新标签；yf 复制链接；zc 复制文字；zf 聚焦；zh 悬停。候选、Shadow DOM 和子 frame 均为合成数据。</p>
<div><a id="alpha" href="#alpha-clicked">alpha target</a><a id="beta" href="#beta-clicked">beta alpha</a><a id="mail" href="mailto:synthetic@example.invalid">synthetic mail</a><button id="button">alpha button</button></div>
<input id="input" value="synthetic alpha"><input id="readonly" readonly value="readonly alpha"><input id="disabled" disabled><input id="password" type="password" value="synthetic-only-password"><input id="hidden" type="hidden">
<label for="label-control">Label alpha:</label><input id="label-control"><label id="off-label" for="off-control">Offscreen control:</label><input id="off-control" style="position:absolute;top:5000px">
<textarea id="textarea">textarea alpha</textarea><div id="editor" contenteditable="true">中文编辑区域 alpha</div>
<div id="roles"><div id="role" role="button">role alpha</div><div id="aria-disabled" role="button" aria-disabled="true">disabled aria</div><div id="aria-hidden" role="button" aria-hidden="true">hidden aria clickable</div><div id="jsaction" jsaction="click:synthetic.activate">jsaction alpha</div><div id="tab-only" tabindex="0">tab only</div></div>
<span id="weak-span" onclick="void 0"><button id="nested-button">nested alpha</button></span><div id="weak-class" class="button-wrap"><a id="nested-link" href="#nested">nested beta</a></div>
<a id="covered" href="#covered">covered</a><div id="cover"></div><div id="scroll"><div style="height:160px">Scrollable panel alpha</div></div><details id="details"><summary>Details alpha</summary><a id="details-link" href="#details">inside details</a></details>
<div id="shadow"></div><div id="text-shadow" role="button"></div><img id="map-image" alt="合成地图" width="180" height="60" usemap="#map" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='60'%3E%3Crect width='180' height='60' fill='%23ddd'/%3E%3C/svg%3E"><map name="map"><area id="area-a" shape="rect" coords="0,0,85,55" href="#area-a"><area id="area-b" shape="circle" coords="130,30,20" href="#area-b"></map>
<div id="rotate"><a id="rotate-a" href="#rotate-a">a</a><a id="rotate-b" href="#rotate-b">b</a><a id="rotate-c" href="#rotate-c">c</a></div>
<iframe id="child" src="/child" title="同源提示子页"></iframe><iframe id="cross" title="跨源提示子页"></iframe>
<p id="selection">alpha beta gamma. 中文目标。 This visible sentence exceeds fifty characters for Caret and selection checks.</p>
<script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<a id="shadow-link" href="#shadow-link">shadow alpha</a><input id="shadow-input" value="shadow value">';document.querySelector('#text-shadow').attachShadow({mode:'open'}).textContent='text-only shadow';document.querySelector('#cross').src=location.href.replace('127.0.0.1','localhost').replace('/fixture','/cross');document.addEventListener('click',e=>{const target=e.composedPath()[0];window.syntheticClicks||=[];window.syntheticClicks.push({id:target.id,ctrl:e.ctrlKey,meta:e.metaKey,shift:e.shiftKey,alt:e.altKey})});document.querySelector('#button').onclick=()=>{window.buttonClicks=(window.buttonClicks||0)+1};document.querySelector('#role').onclick=()=>{window.roleClicks=(window.roleClicks||0)+1};document.querySelector('#alpha').addEventListener('mouseover',()=>window.alphaHovered=true);document.querySelector('#alpha').addEventListener('mouseout',()=>window.alphaHovered=false);</script></body></html>`;
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const route = new URL(request.url);
  if (route.pathname === "/download") {
    return new Response("synthetic-hints-download", {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="synthetic-hints.txt"',
      },
    });
  }
  const body = ["/child", "/cross"].includes(route.pathname)
    ? `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><a id="child-link" href="#child-clicked">${
      route.pathname.slice(1)
    } alpha</a><input id="child-input"><script>document.querySelector('a').onclick=()=>window.childClicks=(window.childClicks||0)+1</script></body></html>`
    : html;
  return new Response(body, {
    headers: {
      "content-type": "text/html;charset=utf-8",
      ...(route.searchParams.has("clipboard-denied")
        ? { "Permissions-Policy": "clipboard-write=()" }
        : {}),
    },
  });
});
const url = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  fixtureUrl: url,
  browsers: [],
  checks: [],
  comparisons: {},
  manualHints: "pending",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function wait(predicate, message = "等待提示状态超时") {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}
async function withoutActivation(frame, callback, input) {
  const result = await frame.mainRealm().client.send("Runtime.callFunctionOn", {
    functionDeclaration: callback.toString(),
    executionContextId: frame.mainRealm().context.id,
    arguments: [{ value: input }],
    userGesture: false,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("合成隔离探测失败：" + result.exceptionDetails.text);
  return result.result.value;
}
const frameOrdersByValues = new WeakMap();
// 当 Chrome 跨重载跨越两位数/三位数 frameId 边界导致字符串字典序重排时，
// 按各自实际的 String(frameId) 位次对照子页提示码分配，同时按路径严格核对元素与状态。
function normalizeByFrameOrder(snapshotFrames, frameOrder) {
  if (!Array.isArray(snapshotFrames) || !Array.isArray(frameOrder) || !frameOrder.length) {
    return snapshotFrames;
  }
  const byPath = new Map(snapshotFrames.map((state) => [state.path, state]));
  const byRank = frameOrder.map((framePath) => {
    const state = byPath.get(framePath);
    return state
      ? {
        codes: state.markers.map(({ code, caption, spans }) => ({ code, caption, spans })),
        domOrder: state.domOrder,
      }
      : null;
  });
  return {
    byPath: snapshotFrames.map(({ path, local, query, activeHint, openMode, markers }) => ({
      path,
      local,
      query,
      activeHint,
      openMode,
      markers: markers.map(({ code: _c, caption: _cap, spans: _s, ...rest }) => rest),
    })),
    byRank,
  };
}
function snapshotEqual(key, compat, canary) {
  const left = compat[key];
  const right = canary[key];
  if (JSON.stringify(left) === JSON.stringify(right)) return true;
  const leftOrder = frameOrdersByValues.get(compat)?.[key];
  const rightOrder = frameOrdersByValues.get(canary)?.[key];
  if (!leftOrder || !rightOrder || JSON.stringify(leftOrder) === JSON.stringify(rightOrder)) {
    return false;
  }
  return JSON.stringify(normalizeByFrameOrder(left, leftOrder)) ===
    JSON.stringify(normalizeByFrameOrder(right, rightOrder));
}
async function run(name, extensionPath, plan) {
  // 输入副本失效时先失败，避免启动浏览器后还没有进入清理作用域。
  const legacyHints = await Deno.readTextFile(
    path.join(extensionPath, "content_scripts/link_hints.js"),
  );
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-hints-cft-" });
  const browser = await puppeteer.launch({
    executablePath,
    headless: !keepOpen,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 1000 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,1000",
      "--window-position=50,60",
    ],
  });
  const metadata = {
    implementation: name,
    version: await browser.version(),
    extensionPath,
    profile,
    browserPid: browser.process().pid,
    browserWsEndpoint: browser.wsEndpoint(),
    headed: keepOpen,
  };
  report.browsers.push(metadata);
  const values = {};
  const frameOrders = {};
  frameOrdersByValues.set(values, frameOrders);
  metadata.values = values;
  metadata.frameOrders = frameOrders;
  const protectorSource = legacyHints.slice(
    legacyHints.indexOf("class TypingProtector"),
    legacyHints.indexOf("class WaitForEnter"),
  );
  const frozenProtectorBug = plan === 4 &&
    protectorSource.indexOf("const resetExitTimer") > protectorSource.indexOf("this.init(");
  let inspect, page, options, copyStep;
  try {
    const target = await browser.waitForTarget((target) =>
      target.type() === "service_worker" && target.url().startsWith("chrome-extension://")
    );
    const id = metadata.extensionId = new URL(target.url()).host;
    options = await browser.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const config = await options.evaluate(() =>
      chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: {
          legacyPatch: {
            smoothScroll: false,
            grabBackFocus: false,
            filterLinkHints: false,
            keyMappings:
              "map zc LinkHints.activateMode action=copy-text\nmap zf LinkHints.activateMode action=focus\nmap zh LinkHints.activateMode action=hover\nmap zg LinkHints.activateModeToOpenInNewForegroundTab\nmap zi LinkHints.activateModeToOpenIncognito\nmap zd LinkHints.activateModeToDownloadLink\nmap zq LinkHints.activateModeWithQueue",
          },
        },
      })
    );
    assert(config.ok, "合成设置写入失败");
    page = await browser.newPage();
    await page.goto(url);
    page.on("pageerror", (error) => {
      report.pageErrors ||= [];
      report.pageErrors.push({ name, message: error.message });
    });
    await page._client().send("Browser.setPermission", {
      permission: { name: "clipboard-read" },
      setting: "granted",
      origin: new URL(url).origin,
    });
    inspect = async (operation = "state", input = {}, allFrames = false) =>
      withoutActivation(options.mainFrame(), async ({ url, operation, input, allFrames }) => {
        const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.split(/[?#]/)[0] === url);
        if (!tab) return null;
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames },
          world: "ISOLATED",
          func: async (operation, input) => {
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            if (!host) return null;
            const controller = globalThis.BrowserToolboxHintsControllerInstance;
            const coordinator = HintCoordinator;
            if (operation === "cancel") {
              coordinator.exit({ isSuccess: false });
              return;
            }
            if (operation === "stale") return controller?.activateMode(input);
            if (operation === "destroy-ui") {
              HUD.destroy();
              return;
            }
            if (operation === "pause-scanner") {
              const original = coordinator.getHintDescriptors;
              coordinator.getHintDescriptors = async (...args) => {
                await new Promise((resolve) => setTimeout(resolve, 600));
                return original.apply(coordinator, args);
              };
              return;
            }
            if (operation === "own-providers") return host.engine.pageExecutor?.providers?.size;
            if (operation === "handshake-diagnostic") {
              const reply = await chrome.runtime.sendMessage(
                BrowserToolboxMessageProtocol.envelope("lifecycle", "initialize", {
                  runtimeEpoch: host.runtimeEpoch + (host.engine ? 0 : 1),
                }),
              );
              return { stage: host.lastFailureStage, reply };
            }
            if (operation === "clipboard-probe") {
              globalThis.browserToolboxSyntheticCopyProbe?.restore();
              const events = [], restorers = [], observed = new WeakSet();
              const started = performance.now();
              const record = (kind, detail = {}) => {
                // 只采集受控流程状态；文本参数和系统剪贴板原文均不进入事件记录。
                try {
                  if (events.length >= 96) return;
                  const ui = HUD.hudUI, iframe = ui?.iframeElement;
                  events.push({
                    kind,
                    atMs: Math.round(performance.now() - started),
                    ...detail,
                    documentFocused: document.hasFocus(),
                    activeTag: document.activeElement?.localName,
                    activeId: document.activeElement?.id,
                    hudPresent: !!iframe?.isConnected,
                    hudDisposed: ui?.disposed === true,
                    hudOwnsFocus: !!iframe && ui.shadowDOM?.activeElement === iframe,
                    hudDisplay: iframe ? getComputedStyle(iframe).display : null,
                    pendingCopyCount: globalThis.BrowserToolboxVisualControllerInstance
                      ?.pendingCopies?.size ?? null,
                    clipboardLeaseCount: HUD.clipboardRequests?.size ?? null,
                  });
                } catch (_) { /* 诊断失败不能改变原调用结果。 */ }
              };
              const resultFields = (result) => ({
                ok: typeof result?.ok === "boolean" ? result.ok : null,
                code: [
                    "OK",
                    "CANCELLED",
                    "CLIPBOARD_TIMEOUT",
                    "CLIPBOARD_DENIED",
                    "NO_MATCHING_ELEMENT",
                  ].includes(result?.code)
                  ? result.code
                  : null,
              });
              const wrap = (object, key, invoke) => {
                if (typeof object?.[key] !== "function") return;
                const original = object[key];
                const wrapped = function (...args) {
                  return invoke.call(this, original, args);
                };
                object[key] = wrapped;
                restorers.push(() => {
                  if (object[key] === wrapped) object[key] = original;
                });
              };
              const observeUI = () => {
                const ui = HUD.hudUI;
                if (!ui || observed.has(ui)) return;
                observed.add(ui);
                for (
                  const [key, kind] of [["cssReady", "hud-css-ready"], [
                    "iframePort",
                    "hud-port-ready",
                  ]]
                ) {
                  ui[key]?.then(() => record(kind), () => record(kind + "-error"));
                }
                wrap(ui, "postMessage", function (original, args) {
                  const message = args[0];
                  record("hud-send", {
                    name: message?.name,
                    id: message?.copyRequestId ?? message?.clipboardRequestId ?? null,
                    ...(["copyToClipboard", "copyToClipboardWithResult"].includes(message?.name)
                      ? { inputMatchesExpected: message.data === input.expected }
                      : {}),
                  });
                  return original.apply(this, args);
                });
              };
              wrap(HUD, "init", function (original, args) {
                record("hud-init");
                const result = original.apply(this, args);
                observeUI();
                result?.then(() => {
                  observeUI();
                  record("hud-init-complete");
                }, () => record("hud-init-error"));
                return result;
              });
              const hudOwner = globalThis.BrowserToolboxUIControllerInstance?.hud || HUD;
              wrap(hudOwner, "handleUIComponentMessage", function (original, args) {
                const message = args[0]?.data;
                record("hud-receive", {
                  name: message?.name,
                  id: message?.copyRequestId ?? message?.clipboardRequestId ?? null,
                  ...resultFields(message),
                });
                return original.apply(this, args);
              });
              const visual = globalThis.BrowserToolboxVisualControllerInstance;
              for (const [object, key] of [[visual, "copy"], [HUD, "copyToClipboard"]]) {
                wrap(object, key, function (original, args) {
                  record(key === "copy" ? "visual-copy" : "hud-copy", {
                    inputMatchesExpected: args[0] === input.expected,
                  });
                  return original.apply(this, args);
                });
              }
              wrap(visual, "finishCopy", function (original, args) {
                record("visual-finish", { id: args[0], ...resultFields(args[1]) });
                return original.apply(this, args);
              });
              wrap(controller, "act", function (original, args) {
                record("hint-act", {
                  modeIndex: args[1],
                  selectorMatchesExpected: args[0]?.element?.id === input.selector,
                });
                const result = original.apply(this, args);
                result?.then(undefined, (error) =>
                  record("hint-act-error", {
                    errorName: error?.name,
                  }));
                return result;
              });
              observeUI();
              globalThis.browserToolboxSyntheticCopyProbe = {
                events,
                restore() {
                  for (const restore of restorers.splice(0).reverse()) restore();
                },
              };
              record("probe-installed", { visualPresent: !!visual, hintsPresent: !!controller });
              return true;
            }
            if (operation === "clipboard-probe-result") {
              const probe = globalThis.browserToolboxSyntheticCopyProbe;
              probe?.restore();
              delete globalThis.browserToolboxSyntheticCopyProbe;
              return { path: location.pathname, events: probe?.events || [] };
            }
            if (operation === "clipboard-diagnostic") {
              const ui = HUD.hudUI, iframe = ui?.iframeElement;
              const visual = globalThis.BrowserToolboxVisualControllerInstance;
              return {
                path: location.pathname,
                documentFocused: document.hasFocus(),
                activeTag: document.activeElement?.localName,
                activeId: document.activeElement?.id,
                hintActive: !!coordinator.linkHintsMode?.hintMode?.modeIsActive,
                pendingCopyIds: [...(visual?.pendingCopies?.keys() || [])],
                clipboardLeaseIds: [...(HUD.clipboardRequests?.keys() || [])],
                hudPresent: !!iframe?.isConnected,
                hudShowing: ui?.showing === true,
                hudDisposed: ui?.disposed === true,
                hudOwnsFocus: !!iframe && ui.shadowDOM?.activeElement === iframe,
                hudDisplay: iframe ? getComputedStyle(iframe).display : null,
                hudVisibility: iframe ? getComputedStyle(iframe).visibility : null,
              };
            }
            const session = coordinator.linkHintsMode;
            return {
              path: location.pathname,
              plan: host.plan.planVersion,
              active: host.state,
              epoch: host.runtimeEpoch,
              settingsRevision: host.lastSettingsRevision,
              documentId: host.context.documentId,
              failure: host.lastErrorCode,
              failureStage: host.lastFailureStage,
              independent: !!controller,
              compatibleHintsLoaded: typeof globalThis.LocalHints?.getLocalHints === "function",
              normalReady: !!Mode.modes.find((mode) => mode.name === "normal")?.keyMapping,
              incognitoMapping: Mode.modes.find((mode) => mode.name === "normal")?.keyMapping
                ?.z?.i?.command,
              documentFocused: document.hasFocus(),
              pendingKeys: Mode.modes.find((mode) => mode.name === "normal")?.sequence?.pending,
              modes: Mode.modes.map((mode) => mode.name),
              insertModes: Mode.modes.filter((mode) => mode.name === "insert").map((mode) => ({
                permanent: mode.permanent === true,
                global: mode.global === true,
              })),
              handlers: handlerStack.stack.length,
              hostResources: host.getDiagnostics().resources,
              resources: controller?.resources.counts(),
              sessionResources: controller?.sessionResources?.counts(),
              interactionId: coordinator.runtimeInteractionId,
              hintActive: !!session?.hintMode?.modeIsActive,
              focus: document.activeElement?.id || document.activeElement?.localName,
              scrollTarget: globalThis.BrowserToolboxScrollControllerInstance?.activated?.id ||
                null,
              scrollHandoffCapability: typeof Scroller.activateElement === "function",
              scrollY,
              pendingCopies:
                globalThis.BrowserToolboxVisualControllerInstance?.pendingCopies.size || 0,
              pendingClipboard: HUD.clipboardRequests?.size || 0,
              query: session?.markerMatcher.linkTextKeystrokeQueue?.join(""),
              hintQueue: session?.markerMatcher.hintKeystrokeQueue?.join(""),
              openMode: session?.mode.name,
              activeHint: session?.markerMatcher.activeHintMarker?.localHint?.element.id,
              markers: session?.hintMarkers.filter((marker) => marker.localHint).map((marker) => ({
                id: marker.localHint.element.id || marker.localHint.element.localName,
                code: marker.hintString,
                text: marker.linkText,
                reason: marker.localHint.reason || null,
                visible: marker.element.style.display !== "none",
                caption: marker.element.textContent,
                className: marker.element.className,
                left: marker.element.style.left,
                top: marker.element.style.top,
                spans: [...marker.element.children].map((
                  span,
                ) => [span.textContent, span.className]),
              })) || [],
              local: coordinator.localHints?.map((hint) => ({
                id: hint.element.id || hint.element.localName,
                reason: hint.reason || null,
                text: hint.linkText ?? null,
                show: hint.showLinkText ?? null,
                rect: [hint.rect.left, hint.rect.top, hint.rect.width, hint.rect.height],
              })) || [],
              domOrder: [...document.querySelectorAll("#vimium-hint-marker-container > div")].map((
                element,
              ) => element.textContent),
              container: document.querySelectorAll("#vimium-hint-marker-container").length,
              selection: getSelection().toString(),
              selectedId: session?.selected?.localHint?.element.id,
              actionPending: !!controller?.action,
            };
          },
          args: [operation, input],
        });
        return allFrames ? results.map((item) => item.result).filter(Boolean) : results[0]?.result;
      }, { url, operation, input, allFrames });
    async function check(label, task) {
      const start = performance.now();
      await task();
      report.checks.push({
        implementation: name,
        name: label,
        status: "passed",
        durationMs: Math.round(performance.now() - start),
      });
      console.log(`${name}：${label} 通过`);
    }
    async function ready(expectedPlan = plan) {
      await wait(
        async () =>
          (await inspect("state", {}, true))?.length === 3 &&
          (await inspect("state", {}, true)).every((state) =>
            state.active === "active" && state.normalReady && state.plan === expectedPlan
          ),
        "三 frame 初始化未就绪",
      );
      await page.bringToFront();
    }
    async function reset() {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        document.activeElement?.blur();
        scrollTo(0, 0);
        location.hash = "";
      });
      await page.bringToFront();
      await wait(async () => (await inspect("state", {}, true)).every((state) => !state.container));
    }
    async function enter(keys = "f") {
      await page.keyboard.type(keys);
      await wait(async () => (await inspect("state", {}, true)).every((state) => state.hintActive));
    }
    async function snapshot(label, expectedPrefix = null) {
      if (expectedPrefix != null) {
        await wait(async () =>
          (await inspect("state", {}, true)).every((state) => state.hintQueue === expectedPrefix)
        );
      }
      const frames = await inspect("state", {}, true);
      assert(
        frames.every((state) => state.active === "active" && !state.failure),
        "提示不能使运行时失效",
      );
      const orderedFrames = await options.evaluate(async (targetUrl) => {
        const tab = (await chrome.tabs.query({})).find((item) =>
          item.url?.split(/[?#]/)[0] === targetUrl
        );
        if (!tab) return null;
        return (await chrome.webNavigation.getAllFrames({ tabId: tab.id }))
          .map((item) => {
            try {
              return { key: String(item.frameId), path: new URL(item.url).pathname };
            } catch (_) {
              return null;
            }
          })
          .filter((item) => item && ["/fixture", "/child", "/cross"].includes(item.path))
          .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
          .map((item) => item.path);
      }, url);
      if (orderedFrames?.length === 3) frameOrders[label] = orderedFrames;
      values[label] = frames.sort((a, b) => a.path.localeCompare(b.path)).map((state) => ({
        path: state.path,
        markers: state.markers,
        local: state.local,
        query: state.query || "",
        activeHint: state.activeHint || null,
        openMode: state.openMode,
        domOrder: state.domOrder,
      }));
      return frames;
    }
    async function choose(id, framePath = "/fixture") {
      const frames = await inspect("state", {}, true);
      const marker = frames.find((state) => state.path === framePath)?.markers.find((marker) =>
        marker.id === id
      );
      assert(marker, `未发现候选 ${framePath} ${id}`);
      await page.keyboard.type(marker.code.toLowerCase());
    }
    async function configure(legacyPatch) {
      const result = await options.evaluate(
        (legacyPatch) =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action: "commit",
            input: { legacyPatch },
          }),
        legacyPatch,
      );
      assert(result.ok, "提示配置更新失败");
      await page.reload();
      await ready();
    }
    const tabs = () => options.evaluate(() => chrome.tabs.query({}));
    await ready();
    await check("完整方案与单一输入承载", async () => {
      const states = await inspect("state", {}, true);
      assert(
        states.every((state) =>
          state.independent === [5, 6, 7, 8, 9].includes(plan) && state.hostResources.events.listener === 13
        ),
        "提示实现或输入监听器不正确",
      );
      if ([5, 6, 7, 8, 9].includes(plan)) {
        assert(
          states.every((state) => !state.compatibleHintsLoaded),
          "新提示启动不得提前安装旧提示算法",
        );
      }
      metadata.initial = states.map(({ path, plan, modes, handlers, hostResources }) => ({
        path,
        plan,
        modes,
        handlers,
        hostResources,
      }));
    });
    if ([5, 6, 7, 8, 9].includes(plan)) {
      await check("同一提示包的已登记方案2/3/4冷启动保留旧提示", async () => {
        metadata.coldCompatiblePlans = [];
        for (const selected of [2, 3, 4]) {
          await options.evaluate((planVersion) =>
            chrome.storage.local.set({
              browserToolboxRuntimePlan: { formatVersion: 1, planVersion },
            }), selected);
          await page.reload();
          await ready(selected);
          const states = await inspect("state", {}, true);
          assert(
            states.every((state) => state.compatibleHintsLoaded && !state.independent),
            `方案${selected}必须在准备完成前安装旧提示`,
          );
          await enter();
          await choose("button");
          await wait(() => page.evaluate(() => window.buttonClicks === 1));
          await reset();
          metadata.coldCompatiblePlans.push({ planVersion: selected, clickedOnce: true });
        }
        await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
        await page.reload();
        await ready();
        assert(
          (await inspect("state", {}, true)).every((state) => !state.compatibleHintsLoaded),
          "回到新方案的新文档不应装载旧算法",
        );
      });
    }
    await check("普通、角色、遮挡、禁用、地图与 Shadow DOM 扫描和 CSS", async () => {
      await enter();
      const state = await snapshot("alphabet");
      const root = state.find((state) => state.path === "/fixture");
      for (
        const id of [
          "alpha",
          "button",
          "input",
          "password",
          "off-label",
          "role",
          "aria-hidden",
          "jsaction",
          "nested-button",
          "nested-link",
          "scroll",
          "details",
          "shadow-link",
          "shadow-input",
          "text-shadow",
          "area-a",
          "area-b",
        ]
      ) assert(root.local.some((hint) => hint.id === id), `冻结可点击候选缺失 ${id}`);
      for (
        const id of [
          "readonly",
          "disabled",
          "hidden",
          "aria-disabled",
          "tab-only",
          "covered",
          "weak-span",
          "weak-class",
        ]
      ) assert(!root.local.some((hint) => hint.id === id), `不应出现候选 ${id}`);
      assert(
        state.every((state) =>
          state.markers.every((marker) =>
            marker.className.includes("vimiumHintMarker") &&
            marker.spans.every((span) => span[1].includes("vimium-reset"))
          )
        ),
        "公开 CSS 层级丢失",
      );
      await reset();
    });
    await check("前缀、Backspace、Esc、鼠标取消及输入恢复", async () => {
      await enter();
      const marker = (await inspect()).markers.find((marker) => marker.code.length > 1);
      assert(marker, "fixture 应有变长码");
      await page.keyboard.type(marker.code[0]);
      await snapshot("prefix", marker.code[0]);
      await page.keyboard.press("Backspace");
      await snapshot("backspace", "");
      await page.keyboard.press("Escape");
      await wait(async () => (await inspect("state", {}, true)).every((state) => !state.container));
      await enter();
      await page.click("h1");
      await wait(async () => !(await inspect()).hintActive);
      await page.click("#input");
      await page.keyboard.type("native");
      assert(
        await page.$eval("#input", (node) => node.value.includes("native")),
        "退出后原生输入失败",
      );
      await reset();
    });
    await check("同源和跨源 frame 的唯一实际点击", async () => {
      for (const route of ["/child", "/cross"]) {
        await reset();
        await enter();
        await choose("child-link", route);
        const child = page.frames().find((frame) => new URL(frame.url()).pathname === route);
        await wait(
          () => child.evaluate(() => window.childClicks === 1),
          "frame 链接未点击或重复点击",
        );
        assert(
          (await inspect("state", {}, true)).every((state) => !state.container),
          "点击后跨 frame 提示未清理",
        );
        values[`frame-click:${route}`] = await child.evaluate(() => ({
          clicked: window.childClicks,
          hash: location.hash,
        }));
      }
      await page.reload();
      await ready();
    });
    await check("当前页链接、文本控件、滚动区与 details 动作", async () => {
      await reset();
      await enter();
      await choose("alpha");
      await wait(() => page.evaluate(() => location.hash === "#alpha-clicked"));
      values.currentTab = true;
      await reset();
      await enter();
      await choose("input");
      await wait(() => page.evaluate(() => document.activeElement.id === "input"));
      values.selectInput = await page.$eval(
        "#input",
        (node) => ({
          focus: document.activeElement.id,
          start: node.selectionStart,
          end: node.selectionEnd,
        }),
      );
      assert(
        values.selectInput.start === "synthetic alpha".length &&
          values.selectInput.end === values.selectInput.start,
        "首次提示应将单行控件游标移到末尾",
      );
      await reset();
      await enter();
      await choose("scroll");
      await wait(async () => (await inspect()).interactionId == null);
      await page.keyboard.press("j");
      if ([5, 6, 7, 8, 9].includes(plan) || (await inspect()).scrollHandoffCapability) {
        await wait(() => page.$eval("#scroll", (node) => node.scrollTop > 0));
        assert((await inspect()).scrollTarget === "scroll", "Hints 必须交接独立滚动目标");
      } else {
        metadata.frozenScrollHandoff = await page.$eval(
          "#scroll",
          (node) => ({ scrollTop: node.scrollTop, pageScroll: scrollY }),
        );
        assert(
          metadata.frozenScrollHandoff.scrollTop === 0 &&
            metadata.frozenScrollHandoff.pageScroll > 0,
          "应复现冻结方案 4 的合成滚动目标缺口",
        );
      }
      await reset();
      await enter();
      await choose("details");
      await wait(() => page.$eval("#details", (node) => node.open));
      values.details = true;
      await page.reload();
      await ready();
    });
    await check("Shift/Control 打开模式与回退", async () => {
      await enter();
      await page.keyboard.down("Shift");
      await sleep(30);
      await snapshot("shift");
      await page.keyboard.up("Shift");
      await sleep(30);
      await snapshot("shift-release");
      await page.keyboard.down("Control");
      await sleep(30);
      await snapshot("control");
      await page.keyboard.up("Control");
      await sleep(30);
      await snapshot("control-release");
      await reset();
    });
    await check("过滤文字、数字、Tab/Shift-Tab、回退和 waitForEnter", async () => {
      await configure({ filterLinkHints: true, waitForEnterForFilteredHints: true });
      await enter();
      await snapshot("filtered-initial");
      await page.keyboard.type("alpha", { delay: 25 });
      await sleep(80);
      await snapshot("filtered-alpha");
      await page.keyboard.press("Tab");
      await sleep(40);
      await snapshot("filtered-tab");
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
      await sleep(40);
      await snapshot("filtered-backtab");
      await page.keyboard.press("Backspace");
      await sleep(40);
      await snapshot("filtered-backspace");
      await reset();
      await enter();
      await page.keyboard.type("nested beta", { delay: 25 });
      await wait(async () => (await inspect()).modes.includes("hint/wait-for-enter"));
      assert(await page.evaluate(() => location.hash === ""), "waitForEnter 不得提前点击");
      await page.keyboard.press("Escape");
      await reset();
      await enter();
      await page.keyboard.type("nested beta", { delay: 25 });
      await wait(async () => (await inspect()).modes.includes("hint/wait-for-enter"));
      await page.keyboard.press("Enter");
      metadata.beforeFilteredEnter = await inspect();
      await wait(() => page.evaluate(() => location.hash === "#nested"));
      values.filteredEnter = true;
      await configure({ filterLinkHints: false });
    });
    await check("后台和前台标签页真实创建且只执行一次", async () => {
      for (const [keys, active] of [["F", false], ["zg", true]]) {
        await page.reload();
        await ready();
        await reset();
        const before = (await tabs()).map((tab) => tab.id);
        await enter(keys);
        await choose("alpha");
        let opened, observation;
        await wait(async () => {
          opened = (await tabs()).filter((tab) => !before.includes(tab.id));
          assert(opened.length <= 1, "提示不得创建重复标签页");
          if (opened.length === 1 && !observation) {
            observation = {
              keys,
              expected: { url: url + "#alpha-clicked", active },
              firstNativeTab: {
                id: opened[0].id, url: opened[0].url, pendingUrl: opened[0].pendingUrl,
                active: opened[0].active, status: opened[0].status,
              },
            };
            (metadata.newTabObservations ||= []).push(observation);
          }
          // Native 标签出现早于导航提交；不重发动作，等待同一唯一标签达到原目标/前后台状态。
          return opened.length === 1 && opened[0].url === url + "#alpha-clicked" &&
            opened[0].active === active;
        }, "提示必须恰好创建一个目标及前后台状态正确的标签页");
        observation.completedNativeTab = {
          id: opened[0].id, url: opened[0].url, active: opened[0].active,
          status: opened[0].status,
        };
        assert(
          opened[0].url === url + "#alpha-clicked" && opened[0].active === active,
          "新标签目标或前后台语义错误",
        );
        values[`newTab:${keys}`] = { opened: 1, active };
        await options.evaluate((id) => chrome.tabs.remove(id), opened[0].id);
      }
      await page.bringToFront();
    });
    await check("次数和队列成功重入、取消不再启动", async () => {
      await page.reload();
      await ready();
      await enter("2f");
      await choose("button");
      await wait(() => page.evaluate(() => window.buttonClicks === 1));
      await wait(async () => (await inspect()).hintActive);
      await choose("role");
      await wait(() => page.evaluate(() => window.roleClicks === 1));
      await wait(async () => !(await inspect()).hintActive);
      values.count = true;
      const before = (await tabs()).map((tab) => tab.id);
      await page.reload();
      await ready();
      await enter("zq");
      await choose("alpha");
      await wait(async () =>
        (await tabs()).filter((tab) => !before.includes(tab.id)).length === 1 &&
        (await inspect()).hintActive
      );
      await choose("beta");
      await wait(async () =>
        (await tabs()).filter((tab) => !before.includes(tab.id)).length === 2 &&
        (await inspect()).hintActive
      );
      await page.keyboard.press("Escape");
      await sleep(450);
      assert(!(await inspect()).hintActive, "队列 Esc 后不得重新进入");
      const opened = (await tabs()).filter((tab) => !before.includes(tab.id));
      assert(opened.length === 2 && opened.every((tab) => !tab.active), "队列只打开两个后台标签页");
      await options.evaluate((ids) => chrome.tabs.remove(ids), opened.map((tab) => tab.id));
      values.queue = true;
    });
    await check("复制 URL、mailto 和文字的实际剪贴板内容", async () => {
      for (
        const [keys, selector, expected] of [["yf", "alpha", url + `#synthetic-copy-${plan}`], [
          "yf",
          "mail",
          `synthetic-${plan}@example.invalid`,
        ], ["zc", "alpha", `synthetic-copy-text-${plan}`]]
      ) {
        copyStep = {
          keys, selector, phase: "prepare", readAttempts: 0, clipboardMatchesExpected: null,
        };
        await page.reload();
        await ready();
        await reset();
        await page.evaluate(({ selector, expected, keys }) => {
          const element = document.getElementById(selector);
          if (keys === "zc") element.textContent = expected;
          else element.href = selector === "mail" ? "mailto:" + expected : expected;
        }, { keys, selector, expected });
        await inspect("clipboard-probe", { selector, expected }, true);
        copyStep.phase = "enter";
        await enter(keys);
        copyStep.phase = "choose";
        await choose(selector);
        copyStep.phase = "clipboard-read";
        await wait(
          async () => {
            copyStep.readAttempts++;
            // 读取端会影响真实焦点；先等本次动作和写入回执结束，避免探测与 HUD 写入竞争。
            const states = await inspect("state", {}, true);
            if (states.some((state) =>
              state.hintActive || state.actionPending || state.pendingCopies || state.pendingClipboard
            )) return false;
            try {
              // 仅保留是否匹配，绝不把系统剪贴板原文写入报告。
              copyStep.clipboardMatchesExpected = await page.evaluate(
                async (expected) => (await navigator.clipboard.readText()) === expected,
                expected,
              );
              return copyStep.clipboardMatchesExpected;
            } catch (error) {
              copyStep.readErrorName = error.name;
              throw error;
            }
          },
          "合成复制内容不正确",
        );
        copyStep.phase = "request-release";
        assert((await inspect()).pendingCopies === 0, "成功复制必须清理等待请求");
        values[`copy:${keys}:${selector}`] = true;
        (metadata.copyTraces ||= []).push({
          keys, selector, frames: await inspect("clipboard-probe-result", {}, true),
        });
        copyStep = null;
      }
      await page.reload();
      await ready();
    });
    await check("下载动作的 Alt 修饰键与真实合成文件", async () => {
      const directory = await Deno.makeTempDir({ prefix: "browser-toolbox-hints-download-" });
      const client = await browser.target().createCDPSession();
      let finished = false;
      client.on("Browser.downloadProgress", (event) => {
        if (event.state === "completed") finished = true;
      });
      try {
        await client.send("Browser.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: directory,
          eventsEnabled: true,
        });
        await page.evaluate(
          (url) => document.querySelector("#alpha").href = url,
          url.replace("/fixture", "/download"),
        );
        await enter("zd");
        await choose("alpha");
        await wait(() => finished, "必须实际完成合成下载");
        assert(
          await Deno.readTextFile(path.join(directory, "synthetic-hints.txt")) ===
            "synthetic-hints-download",
          "合成下载文件不正确",
        );
        const event = await page.evaluate(() => window.syntheticClicks.at(-1));
        assert(
          event?.id === "alpha" && event.alt && !event.ctrl && !event.meta,
          "下载不得改变 Alt/CTRL/Meta 修饰语义",
        );
        values.download = true;
      } finally {
        await client.send("Browser.setDownloadBehavior", { behavior: "deny" });
        await client.detach();
        await Deno.remove(directory, { recursive: true });
      }
      await page.reload();
      await ready();
    });
    await check("自定义字母/数字/CSS、遮挡动态变化与重采集", async () => {
      await configure({
        linkHintCharacters: "ab",
        userDefinedLinkHintCss: ".vimiumHintMarker { color: rgb(12, 34, 56) !important; }",
      });
      await enter();
      await snapshot("custom-alphabet");
      assert(
        await page.$eval(
          ".vimiumHintMarker",
          (node) => getComputedStyle(node).color === "rgb(12, 34, 56)",
        ),
        "用户提示 CSS 未生效",
      );
      await reset();
      await page.evaluate(() => {
        document.querySelector("#cover").remove();
        const button = document.createElement("button");
        button.id = "dynamic";
        button.textContent = "dynamic alpha";
        document.querySelector("#roles").append(button);
      });
      await enter();
      const state = await snapshot("dynamic");
      assert(
        state.find((state) => state.path === "/fixture").local.some((hint) =>
          hint.id === "covered"
        ) && (await inspect()).local.some((hint) => hint.id === "dynamic"),
        "动态解除遮挡或新增候选未重新扫描",
      );
      await reset();
      await configure({ filterLinkHints: true, linkHintNumbers: "13579" });
      await enter();
      await snapshot("custom-numbers");
      assert(
        (await inspect()).markers.every((marker) => /^[13579]+$/.test(marker.code)),
        "自定义数字未保留",
      );
      await reset();
      await configure({
        filterLinkHints: false,
        linkHintCharacters: "asdfghjkl",
        linkHintNumbers: "0123456789",
        userDefinedLinkHintCss: "",
      });
    });
    await check("空格连续轮换重叠提示与过滤模式修饰规则", async () => {
      await configure({
        userDefinedLinkHintCss: ".vimiumHintMarker { min-width: 56px !important; }",
      });
      await enter();
      await page.keyboard.press("Space");
      await sleep(80);
      await snapshot("rotate-once");
      await page.keyboard.press("Space");
      await sleep(80);
      await snapshot("rotate-twice");
      await reset();
      await configure({ filterLinkHints: true });
      await enter();
      await page.keyboard.down("Control");
      await page.keyboard.press("Space");
      await page.keyboard.up("Control");
      await sleep(80);
      await snapshot("rotate-filtered");
      await reset();
      await configure({ filterLinkHints: false, userDefinedLinkHintCss: "" });
    });
    await check("过滤短暂停输入后点击与焦点 frame 选择", async () => {
      await configure({ filterLinkHints: true, waitForEnterForFilteredHints: false });
      await enter();
      await page.keyboard.type("nested beta", { delay: 25 });
      if (frozenProtectorBug) {
        await sleep(500);
        metadata.frozenTypingProtectorBug = {
          constructorDeclarationOrder: true,
          clicked: await page.evaluate(() => location.hash === "#nested"),
        };
        assert(!metadata.frozenTypingProtectorBug.clicked, "应实际复现冻结实现的 TDZ 缺口");
        await reset();
      } else {
        await wait(() => page.evaluate(() => location.hash === "#nested"));
        values.typingProtector = true;
      }
      await configure({ filterLinkHints: false, waitForEnterForFilteredHints: true });
      await enter();
      await choose("body", "/child");
      const child = page.frames().find((frame) => new URL(frame.url()).pathname === "/child");
      await wait(() => child.evaluate(() => document.hasFocus()));
      values.frameFocus = true;
      await page.reload();
      await ready();
    });
    await check("无痕打开的真实窗口、Native 权限和唯一动作", async () => {
      const management = await browser.newPage();
      await management.goto(`chrome://extensions/?id=${id}`);
      const developer = await management.waitForSelector("pierce/#devMode");
      if (!await developer.evaluate((toggle) => toggle.checked)) await developer.click();
      const row = await management.waitForSelector("pierce/#allow-incognito");
      await row.evaluate((row) => row.scrollIntoView({ block: "center" }));
      const toggle = await row.evaluate((row) => {
        const toggle = row.shadowRoot.querySelector("cr-toggle");
        const rect = toggle.getBoundingClientRect();
        return { checked: toggle.checked, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      if (!toggle.checked) await management.mouse.click(toggle.x, toggle.y);
      await wait(() =>
        management.$eval(
          "pierce/#allow-incognito",
          (row) => row.shadowRoot.querySelector("cr-toggle").checked,
        )
      );
      const oldOptions = options;
      options = await browser.newPage();
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
      await wait(async () => {
        try {
          // 开启无痕权限后 Chrome 可能异步重载扩展页，忽略上下文销毁并等待新页面稳定。
          return await options.evaluate(() =>
            new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve))
          );
        } catch (error) {
          if (
            /Execution context was destroyed|Cannot find context|Target closed/i.test(error.message)
          ) return false;
          throw error;
        }
      });
      metadata.incognitoPermission = {
        nativeUiChecked: true,
        apiAllowed: true,
        independentProfile: true,
      };
      await management.close();
      await page.reload();
      await ready();
      await reset();
      let stableSignature, stableSince = 0;
      await wait(async () => {
        const states = await inspect("state", {}, true);
        const prepared = states.length === 3 && states.every((state) =>
          state.incognitoMapping === "LinkHints.activateModeToOpenIncognito" &&
          state.modes.filter((mode) => mode === "insert").length === 1
        );
        const signature = JSON.stringify(states.map((state) => ({
          documentId: state.documentId,
          epoch: state.epoch,
          revision: state.settingsRevision,
          mapping: state.incognitoMapping,
          modes: state.modes,
        })));
        if (!prepared || signature !== stableSignature) {
          stableSignature = signature;
          stableSince = performance.now();
          return false;
        }
        // 原生权限切换会重载扩展；先确认映射/模式持续就绪，再开始多键命令。
        return performance.now() - stableSince >= 250;
      });
      metadata.incognitoInputBefore = await inspect();
      const before = (await tabs()).map((tab) => tab.id);
      await page.evaluate(() => {
        window.syntheticIncognitoKeys = [];
        addEventListener("keydown", (event) => {
          if (window.syntheticIncognitoKeys.length < 10) {
            window.syntheticIncognitoKeys.push({
              key: event.key,
              focused: document.hasFocus(),
            });
          }
        }, { capture: true });
      });
      await page.keyboard.press("z");
      metadata.incognitoInputPrefix = await inspect();
      assert(metadata.incognitoInputPrefix.pendingKeys, "无痕快捷键首键必须进入真实映射前缀");
      await page.keyboard.press("i");
      await wait(async () => (await inspect("state", {}, true)).every((state) => state.hintActive));
      await choose("alpha");
      let opened;
      await wait(async () => {
        opened = (await tabs()).filter((tab) => !before.includes(tab.id));
        return opened.length === 1 && opened[0].url === url + "#alpha-clicked";
      });
      assert(opened[0].incognito, "必须创建实际无痕窗口");
      await options.evaluate((windowId) => chrome.windows.remove(windowId), opened[0].windowId);
      values.incognito = true;
      await page.bringToFront();
      await page.reload();
      await ready();
    });
    if ([5, 6, 7, 8, 9].includes(plan)) {
      await check("原生拒绝复制、导航/BFCache 和全 frame 回退清理", async () => {
        await page.goto(url + "?clipboard-denied=1");
        await ready();
        await enter("yf");
        let hud;
        await wait(() => {
          hud = page.frames().find((frame) => frame.url().endsWith("/pages/hud_page.html"));
          return Boolean(hud?.mainRealm().context);
        });
        assert(
          !await withoutActivation(
            hud,
            () =>
              (document.permissionsPolicy || document.featurePolicy).allowsFeature(
                "clipboard-write",
              ),
          ),
          "必须实际禁止 HUD 剪贴板写入",
        );
        await choose("alpha");
        await wait(async () => !(await inspect()).hintActive && !(await inspect()).pendingCopies);
        await wait(
          async () => {
            // 拒绝反馈可能重建HUD，不能读取复制前已被自然释放的渲染上下文。
            const current = page.frames().find((frame) => frame.url().endsWith("/pages/hud_page.html"));
            if (!current?.mainRealm().context) return false;
            try {
              return await withoutActivation(current,
                () => document.querySelector("#hud").textContent.includes("Unable"));
            } catch (error) {
              if (!page.frames().includes(current) || !current.mainRealm().context) return false;
              throw error;
            }
          },
          "拒绝写入不得显示复制成功",
        );
        await page.goto(url);
        await ready();
        await enter();
        const before = await inspect();
        await inspect("destroy-ui");
        await page.evaluate(() =>
          addEventListener("pageshow", (event) => window.syntheticPersisted = event.persisted)
        );
        await page.goto(url.replace("127.0.0.1", "localhost") + "?bfcache=1");
        await page.goBack({ waitUntil: "domcontentloaded" });
        await ready();
        assert(
          await page.evaluate(() => window.syntheticPersisted === true),
          "必须实际进入 BFCache",
        );
        const after = await inspect();
        assert(
          after.documentId === before.documentId && after.epoch > before.epoch &&
            !after.hintActive && !after.container,
          "BFCache 恢复不能复活旧提示",
        );
        metadata.bfcache = {
          persisted: true,
          removedOwnedHudFrame: true,
          epochBefore: before.epoch,
          epochAfter: after.epoch,
        };
        await enter();
        const pending = await inspect();
        const result = await options.evaluate(() =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.runtimeMaintenance",
            action: "restore",
          })
        );
        assert(result.ok && result.failedFrames === 0, "整套回退失败");
        await sleep(150);
        const frames = await inspect("state", {}, true);
        assert(
          frames.every((state) =>
            state.plan === 1 && !state.independent && !state.hintActive && !state.container &&
            state.compatibleHintsLoaded
          ),
          "所有 frame 必须回到旧兼容且清理提示",
        );
        await inspect("stale", {
          interactionId: pending.interactionId,
          modeIndex: 0,
          frameIdToHintDescriptors: {},
        });
        assert(!(await inspect()).hintActive, "回退后晚到提示不得复活");
        await enter();
        await reset();
        await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
        await page.reload();
        await ready();
      });
      await check("快速过滤输入回包不覆盖新按键", async () => {
        await configure({ filterLinkHints: true, waitForEnterForFilteredHints: true });
        await enter();
        await page.keyboard.type("nested beta");
        await wait(async () => (await inspect()).modes.includes("hint/wait-for-enter"));
        assert((await inspect()).selectedId === "nested-link", "连续按键应选中目标链接");
        await page.keyboard.press("Enter");
        await wait(() => page.evaluate(() => location.hash === "#nested"));
        await configure({ filterLinkHints: false });
      });
      await check("悬停和聚焦独立路由及 Esc 退出", async () => {
        await reset();
        await enter("zf");
        await choose("alpha");
        await wait(() => page.evaluate(() => document.activeElement.id === "alpha"));
        await sleep(450);
        await reset();
        await enter("zh");
        await choose("alpha");
        await wait(() => page.evaluate(() => window.alphaHovered));
        await page.keyboard.press("Escape");
        await wait(() => page.evaluate(() => !window.alphaHovered));
      });
      await check("晚到激活、扫描中 Esc 与服务工作线程重启取消", async () => {
        await inspect("pause-scanner");
        await page.keyboard.type("f");
        await sleep(50);
        const pending = await inspect();
        await page.keyboard.press("Escape");
        await sleep(800);
        await inspect("stale", {
          interactionId: pending.interactionId,
          modeIndex: 0,
          frameIdToHintDescriptors: {},
        });
        assert(
          !(await inspect()).hintActive && !(await inspect()).container,
          "取消后晚到回包复活提示",
        );
        await page.reload();
        await ready();
        await enter();
        const session = await browser.target().createCDPSession();
        const worker = (await session.send("Target.getTargets")).targetInfos.find((item) =>
          item.type === "service_worker" && item.url === target.url()
        );
        assert(
          worker &&
            (await session.send("Target.closeTarget", { targetId: worker.targetId })).success,
          "必须实际终止工作线程",
        );
        await wait(async () =>
          !(await session.send("Target.getTargets")).targetInfos.some((item) =>
            item.targetId === worker.targetId
          )
        );
        await page.keyboard.press("Escape");
        await sleep(100);
        await wait(
          async () =>
            (await inspect("state", {}, true)).every((state) =>
              !state.hintActive && !state.container
            ),
          "worker 重启后 Esc 必须释放所有 frame 输入",
        );
        await page.keyboard.press("j");
        await wait(() => page.evaluate(() => scrollY > 0));
        await page.reload();
        await ready();
        await session.detach();
      });
    }
    await check("一百次进入退出后模式和资源不增长", async () => {
      await reset();
      await enter();
      await page.keyboard.press("Escape");
      await sleep(1200);
      const initial = await inspect();
      for (let index = 0; index < 100; index++) {
        await enter();
        await page.keyboard.press("Escape");
        await wait(async () => !(await inspect()).hintActive);
      }
      await sleep(1200);
      const final = await inspect();
      metadata.resourceCycles = { samples: 100, initial, final };
      assert(
        JSON.stringify(initial.modes) === JSON.stringify(final.modes) &&
          initial.handlers === final.handlers &&
          JSON.stringify(initial.hostResources) === JSON.stringify(final.hostResources),
        "提示循环泄漏模式、监听器或订阅",
      );
      if ([5, 6, 7, 8, 9].includes(plan)) {
        assert(
          JSON.stringify(initial.resources) === JSON.stringify(final.resources) &&
            !final.sessionResources,
          "独立提示资源未归零",
        );
      }
    });
    if (keepOpen && plan === canaryPlan) {
      await page._client().send("Browser.resetPermissions");
      await page.reload();
      await ready();
      await reset();
      metadata.manualState = await inspect("state", {}, true);
      metadata.optionsUrl = `chrome-extension://${id}/pages/mouse_options.html#general`;
      await page.screenshot({
        path: path.join(path.dirname(reportPath), "Phase4-Hints-headed-合成入口.png"),
      });
    }
    return values;
  } catch (failure) {
    metadata.failure = failure.message;
    if (copyStep) {
      // 失败后只读采样，保持原用例、等待窗口及成功条件不变。
      metadata.copyFailure = {
        ...copyStep,
        trace: await inspect?.("clipboard-probe-result", {}, true).catch(() => null),
        frames: await inspect?.("clipboard-diagnostic", {}, true).catch(() => null),
        hudFrames: await Promise.all((page?.frames() || []).filter((frame) => {
          try {
            const frameUrl = new URL(frame.url());
            return frameUrl.protocol === "chrome-extension:" &&
              frameUrl.pathname === "/pages/hud_page.html";
          } catch (_) {
            return false;
          }
        }).map(async (frame) => {
          try {
            return await withoutActivation(frame, () => ({
              documentFocused: document.hasFocus(),
              visibilityState: document.visibilityState,
              activeTag: document.activeElement?.localName,
              activeId: document.activeElement?.id,
              clipboardAvailable: !!navigator.clipboard,
            }), {});
          } catch (error) {
            return { diagnosticErrorName: error.name };
          }
        })),
      };
    }
    metadata.failureState = await inspect?.().catch(() => null);
    metadata.failureFrames = await inspect?.("state", {}, true).catch(() => null);
    metadata.frameUrls = page?.frames().map((frame) => frame.url());
    metadata.failureHandshake = await inspect?.("handshake-diagnostic", {}, true).catch(() => null);
    metadata.failureNativeFrames = await options?.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.split(/[?#]/)[0] === url);
      return tab ? chrome.webNavigation.getAllFrames({ tabId: tab.id }) : null;
    }, url).catch(() => null);
    metadata.incognitoKeys = await page?.evaluate(() => window.syntheticIncognitoKeys).catch(() =>
      null
    );
    throw failure;
  } finally {
    if (keepOpen && plan === canaryPlan) browser.disconnect();
    else {
      await browser.close();
      await Deno.remove(profile, { recursive: true });
    }
  }
}
try {
  const failures = [];
  for (
    const [key, name, directory, plan] of [
      ["compat", "冻结 Hints（方案4）", compatPath, 4],
      ["canary", `独立 Hints（方案${canaryPlan}）`, canaryPath, canaryPlan],
    ]
  ) {
    try {
      report.comparisons[key] = await run(name, directory, plan);
    } catch (failure) {
      failures.push(`${name}：${failure.message}`);
      console.error(failure);
    }
  }
  assert(!failures.length, failures.join("；"));
  const { compat, canary } = report.comparisons;
  const mismatches = Object.keys(compat).filter((key) => !snapshotEqual(key, compat, canary));
  report.comparisons.mismatches = mismatches;
  assert(!mismatches.length, `旧新提示结果不同：${mismatches.join(", ")}`);
  report.comparisons.equal = true;
  report.status = "passed";
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
  Deno.exitCode = 1;
  console.error(failure);
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (!keepOpen) await server.shutdown();
}
if (keepOpen) {
  console.log(`独立 Hints 人工入口：${url}`);
  await new Promise(() => {});
}
