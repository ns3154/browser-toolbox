// SPDX-License-Identifier: GPL-3.0-or-later
// 冻结旧 Visual 与独立 Visual 在原生 CFT 中执行相同按键，选区、焦点和复制均取实际结果。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_VISUAL_COMPAT_PATH");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const canaryPlan = Number(Deno.env.get("BROWSER_TOOLBOX_VISUAL_PLAN_VERSION") || 4);
if (![4, 5, 6, 7, 8, 9].includes(canaryPlan)) throw new Error("未登记的选择测试方案");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_VISUAL_REPORT");
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_VISUAL_KEEP_OPEN") === "true";
if (!compatPath || !canaryPath) throw new Error("必须提供冻结方案 3 与独立方案 4 目录");
const text =
  "alpha beta gamma, delta. 中文目标 epsilon. This visible sentence exceeds fifty characters.\nSecond line alpha beta. Another sentence for native line movements.\nThird line 中文目标. Final sentence with punctuation!\nFourth line for paragraph and document boundaries.";
const html =
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>独立选择旧新验收</title>
<style>body{margin:16px;font:16px sans-serif;min-height:18000px}#text,#editor{font:20px/30px monospace;white-space:pre-wrap;width:800px}#editor{border:1px solid #aaa}textarea{width:420px;height:90px}iframe{width:400px;height:100px}</style>
<body><h1>Visual / Caret 选择验收</h1><p id="text">${text}</p>
<p id="words">alpha,--- beta 中文目标 Älpha é emoji😀 end.</p><p id="navigation"></p>
<input id="input" value="alpha beta gamma"><input id="readonly" readonly value="alpha beta gamma">
<textarea id="textarea">alpha beta gamma\nSecond line here.</textarea><div id="editor" contenteditable="true">alpha beta gamma. 中文编辑区域。</div>
<a id="link" href="#clicked">可聚焦链接</a><iframe src="/child" title="选择子页"></iframe>
<p id="deep" style="margin-top:6500px">Deep visible target with more than fifty characters for viewport positioning and selection movement.</p></body></html>`;
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  (request) =>
    new Response(
      new URL(request.url).pathname === "/child"
        ? '<!doctype html><html lang="zh-CN"><body><p>Child frame visible selection text has more than fifty characters for caret entry.</p><input id="child-input"></body></html>'
        : html,
      {
        headers: {
          "content-type": "text/html;charset=utf-8",
          ...(new URL(request.url).searchParams.has("clipboard-denied")
            ? { "Permissions-Policy": "clipboard-write=()" }
            : {}),
        },
      },
    ),
);
const url = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  fixtureUrl: url,
  browsers: [],
  checks: [],
  comparisons: {},
  manualVisual: "pending",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function wait(predicate, message = "等待选择状态超时") {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}
async function evaluateWithoutActivation(frame, callback, input) {
  await wait(() => Boolean(frame.mainRealm().context), "等待合成执行上下文");
  const result = await frame.mainRealm().client.send("Runtime.callFunctionOn", {
    functionDeclaration: callback.toString(),
    executionContextId: frame.mainRealm().context.id,
    arguments: [{ value: input }],
    userGesture: false,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error("合成无激活探测失败：" + result.exceptionDetails.text);
  }
  return result.result.value;
}

async function run(name, extensionPath, plan) {
  const headed = keepOpen;
  const retainBrowser = plan === canaryPlan && keepOpen;
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-visual-cft-" });
  const browser = await puppeteer.launch({
    executablePath,
    headless: !headed,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
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
    headed,
  };
  report.browsers.push(metadata);
  const values = {};
  metadata.values = values;
  let page;
  let inspect;
  try {
    const target = await browser.waitForTarget((target) =>
      target.type() === "service_worker" && target.url().startsWith("chrome-extension://")
    );
    const id = new URL(target.url()).host;
    metadata.extensionId = id;
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const configured = await options.evaluate(() =>
      chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: { legacyPatch: { smoothScroll: false, grabBackFocus: false, regexFindMode: false } },
      })
    );
    assert(configured.ok, "合成配置提交失败");
    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      if (location.pathname !== "/pages/hud_page.html" || !navigator.clipboard) return;
      const note = (kind, detail) => console.log("PHASE4_HUD " + JSON.stringify({
        kind, detail, at: Date.now(), focused: document.hasFocus(), activation: navigator.userActivation.isActive,
      }));
      for (const name of ["focus", "blur"]) {
        globalThis.addEventListener(name, (event) => note("native-" + name, {
          trusted: event.isTrusted, targetWindow: event.target === globalThis,
        }), true);
      }
      globalThis.addEventListener("message", (event) => {
        for (const port of event.ports) {
          port.addEventListener("message", (message) => {
            if (message.data?.name === "clipboardFocusResult") {
              note("clipboardFocusResult", { ok: message.data.ok, id: message.data.clipboardRequestId });
            }
          });
        }
      }, true);
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (message, ...rest) {
        if (["clipboardFocus", "clipboardComplete", "copyToClipboardResult"].includes(message?.name)) {
          note(message.name, { ok: message.ok, id: message.clipboardRequestId ?? message.copyRequestId });
        }
        return post.call(this, message, ...rest);
      };
      const write = Clipboard.prototype.writeText;
      Clipboard.prototype.writeText = async function (...args) {
        note("writeStart", { alpha: args[0] === "alpha" });
        try {
          await write.apply(this, args);
          note("writeSuccess");
        } catch (error) {
          note("writeError", { name: error.name });
          throw error;
        }
      };
    });
    page.on("console", (message) => {
      const value = message.text();
      if (value.startsWith("PHASE4_HUD ")) (metadata.hudEvents ||= []).push(JSON.parse(value.slice(11)));
    });
    await page.goto(url);
    // 仅授权合成父页读取测试结果，不改变执行复制的扩展 iframe 写入权限。
    await page._client().send("Browser.setPermission", {
      permission: { name: "clipboard-read" },
      setting: "granted",
      origin: new URL(url).origin,
    });
    metadata.clipboardReaderPermission = "synthetic-parent-read-only";
    await page.bringToFront();
    page.on("pageerror", (error) => {
      report.pageErrors ||= [];
      report.pageErrors.push({ implementation: name, message: error.message });
    });
    inspect = async (operation = "state", input = {}) =>
      evaluateWithoutActivation(options.mainFrame(), async ({ url, operation, input }) => {
        const tab = (await chrome.tabs.query({})).find((tab) =>
          tab.url?.split(/[?#]/)[0] === url || tab.pendingUrl?.split(/[?#]/)[0] === url
        );
        if (!tab) return null;
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: operation === "frames" },
          world: "ISOLATED",
          func: async (operation, input) => {
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            if (!host) return null;
            const visual = globalThis.BrowserToolboxVisualControllerInstance;
            if (operation === "observe-next-copy") {
              globalThis.syntheticNextCopyResult = null;
              if (!visual) {
                const hud = globalThis.HUD;
                const copy = hud.copyToClipboard;
                hud.copyToClipboard = function (...args) {
                  hud.copyToClipboard = copy;
                  let requestId;
                  const retain = hud.retainClipboard;
                  hud.retainClipboard = function (...args) {
                    hud.retainClipboard = retain;
                    const request = retain.apply(this, args);
                    requestId = request.id;
                    return request;
                  };
                  const requestEvidence = {};
                  const receive = hud.handleUIComponentMessage;
                  hud.handleUIComponentMessage = function (event) {
                    const message = event.data;
                    if (message.name === "clipboardFocus" && message.clipboardRequestId === requestId) {
                      const request = hud.clipboardRequests.get(requestId);
                      Object.assign(requestEvidence, {
                        at: Date.now(),
                        focus: document.hasFocus(),
                        requestPresent: Boolean(request),
                        allowed: request?.focusAllowed,
                        sameElement: request?.focused === hud.clipboardFocusElement(),
                        sameEpoch: request?.interactionEpoch === host.interactionEpoch,
                        sameGeneration: request?.generation === hud.generation,
                        hostState: host.state, hostDisposed: Boolean(host.disposed),
                        hostSuspended: Boolean(host.suspended),
                        hudPresent: Boolean(hud.hudUI), hudDisposed: Boolean(hud.hudUI?.disposed),
                        find: Boolean(hud.findMode),
                        findActive: hud.findMode?.modeIsActive ?? null,
                        others: [...UIComponent.instances].filter((ui) => ui !== hud.hudUI)
                          .map((ui) => ({ showing: ui.showing, wantsFocus: ui.focusOptions?.focus,
                            sameRevision: request?.components.get(ui) === ui.revision })),
                      });
                    }
                    if (message.name === "clipboardComplete" && message.clipboardRequestId === requestId) {
                      hud.handleUIComponentMessage = receive;
                      globalThis.syntheticNextCopyResult = {
                        requestEvidence,
                        ok: message.ok === true,
                        code: message.ok === true ? "CLIPBOARD_WRITTEN" : "CLIPBOARD_DENIED",
                      };
                    }
                    return receive.call(this, event);
                  };
                  return copy.apply(this, args);
                };
                return true;
              }
              const copy = visual.copy;
              visual.copy = function (...args) {
                visual.copy = copy;
                const result = copy.apply(this, args);
                Promise.resolve(result).then((receipt) => {
                  globalThis.syntheticNextCopyResult = { ok: receipt.ok, code: receipt.code };
                }, () => {
                  globalThis.syntheticNextCopyResult = { ok: false, code: "CLIPBOARD_DENIED" };
                });
                return result;
              };
              return true;
            }
            if (operation === "init") {
              const mode = input.line ? new VisualLineMode() : new VisualMode();
              mode.init({ userLaunchedMode: true });
            }
            if (operation === "release-ui") HUD.destroy();
            if (operation === "copy") return await visual.copy(input.text);
            if (operation === "delayed-copy") {
              const original = HUD.init;
              HUD.init = async (...args) => {
                await new Promise((resolve) => setTimeout(resolve, 500));
                return original.apply(HUD, args);
              };
              globalThis.syntheticCopyResult = null;
              visual.copy("合成迟到复制").then((result) => globalThis.syntheticCopyResult = result);
            }
            const selection = getSelection();
            const mode = Mode.modes.find((mode) =>
              ["visual", "visual/line", "caret"].includes(mode.name)
            );
            const element = document.activeElement;
            return {
              active: host.state,
              plan: host.plan.planVersion,
              epoch: host.runtimeEpoch,
              documentId: host.context.documentId,
              failure: host.lastErrorCode,
              modes: Mode.modes.map((mode) => mode.name),
              selection: selection.toString(),
              selectionType: selection.type,
              anchorNode: selection.anchorNode?.parentElement?.id || selection.anchorNode?.nodeName,
              anchorOffset: selection.anchorOffset,
              focusNode: selection.focusNode?.parentElement?.id || selection.focusNode?.nodeName,
              focusOffset: selection.focusOffset,
              focus: element?.id || element?.tagName,
              hasFocus: document.hasFocus(),
              control: typeof element?.selectionStart === "number"
                ? {
                  start: element.selectionStart,
                  end: element.selectionEnd,
                  direction: element.selectionDirection,
                }
                : null,
              independent: Boolean(visual),
              independentMode: Boolean(
                mode && globalThis.BrowserToolboxVisualRuntime &&
                  mode instanceof BrowserToolboxVisualRuntime.VisualMode,
              ),
              resources: host.getDiagnostics().resources,
              pendingCopies: visual?.pendingCopies.size || 0,
              pendingClipboard: globalThis.HUD?.clipboardRequests?.size || 0,
              nextCopyResult: globalThis.syntheticNextCopyResult,
              copyResources: visual?.resources.counts() || {},
              syntheticCopyResult: globalThis.syntheticCopyResult,
              scrollY,
              find: FindMode.query?.rawQuery || null,
            };
          },
          args: [operation, input],
        });
        return operation === "frames"
          ? results.map((item) => item.result).filter(Boolean)
          : results[0]?.result;
      }, { url, operation, input });
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
    async function reset(
      start = 0,
      end = start,
      selector = "#text",
      focus = false,
      backwards = false,
    ) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.evaluate(({ start, end, selector, focus, backwards }) => {
        document.activeElement?.blur();
        scrollTo(0, 0);
        const element = document.querySelector(selector);
        if (focus) element.focus();
        if (typeof element.selectionStart === "number") {
          element.setSelectionRange(start, end, backwards ? "backward" : "forward");
        } else {
          const node = element.firstChild;
          getSelection().setBaseAndExtent(
            node,
            backwards ? end : start,
            node,
            backwards ? start : end,
          );
        }
      }, { start, end, selector, focus, backwards });
      await page.bringToFront();
    }
    async function enter(key = "v") {
      await page.keyboard.press(key);
      await wait(async () =>
        (await inspect()).modes.some((name) => ["visual", "visual/line", "caret"].includes(name))
      );
    }
    async function snapshot(label) {
      const state = await inspect();
      assert(state.active === "active" && !state.failure, "选择操作不得使引擎失效");
      values[label] = {
        selection: state.selection,
        type: state.selectionType,
        anchorNode: state.anchorNode,
        anchorOffset: state.anchorOffset,
        focusNode: state.focusNode,
        focusOffset: state.focusOffset,
        focus: state.focus,
        control: state.control,
        mode: state.modes.filter((name) => ["visual", "visual/line", "caret"].includes(name)),
        scrollY: state.scrollY,
      };
      return state;
    }
    async function clipboardMatches(expected) {
      // 只在已发起本轮合成复制后比较布尔值，不读取或记录用户先前的剪贴板内容。
      const probe = await page.evaluate(async (expected) => {
        globalThis.focus();
        try {
          return {
            matches: await navigator.clipboard.readText() === expected,
            focused: document.hasFocus(),
          };
        } catch (error) {
          return { matches: false, focused: document.hasFocus(), error: error.name };
        } finally {
          globalThis.focus();
        }
      }, expected);
      metadata.clipboardProbe = probe;
      return probe.matches;
    }
    async function startFind(query) {
      await page.keyboard.press("/");
      await wait(async () => (await inspect()).modes.includes("find"));
      await wait(async () => {
        const frame = page.frames().find((item) => item.url().endsWith("/pages/hud_page.html"));
        if (!frame?.mainRealm().context) return false;
        try {
          return await frame.evaluate(() => document.activeElement?.id === "hud-find-input");
        } catch (error) {
          if (!page.frames().includes(frame) || !frame.mainRealm().context) return false;
          throw error;
        }
      });
      await page.keyboard.type(query);
      await wait(async () => (await inspect()).find === query);
    }
    await wait(async () => (await inspect())?.active === "active");
    await check("原生方案、全部 frame 与独立模式所有权", async () => {
      // 顶层完成初始化不代表子frame已完成；记录原生状态，并在原超时内等待全部frame，保留下面的所有权断言。
      await wait(async () => {
        const states = await inspect("frames");
        metadata.initialFrames = states;
        return states.length >= 2 && states.every((state) => state.active === "active");
      }, "全部frame初始化未完成：" + plan);
      const frames = await inspect("frames");
      assert(
        frames.length >= 2 &&
          frames.every((state) =>
            state.plan === plan && state.independent === [4, 5, 6, 7, 8, 9].includes(plan) &&
            state.resources.events.listener === 13
          ),
        "全部 frame 必须同方案、唯一事件入口",
      );
      await reset(0, 1);
      await enter();
      assert(
        (await inspect()).independentMode === [4, 5, 6, 7, 8, 9].includes(plan),
        "必须运行指定 Visual 实现",
      );
    });
    await check("可见 Caret 入场与初始字符", async () => {
      await page.reload();
      await wait(async () => (await inspect())?.active === "active");
      await enter();
      const state = await snapshot("initialCaret");
      assert(
        state.modes.includes("caret") && state.selection === "a",
        "无选区应从第一个长可见文本建立 caret",
      );
      await page.keyboard.press("Escape");
    });
    await check("无选区 V 以及离屏选区采用可见 Caret 锚点", async () => {
      await page.reload();
      await wait(async () => (await inspect())?.active === "active");
      await enter("V");
      await snapshot("initialLineCaret");
      await reset(0, 5);
      await page.$eval("#deep", (node) => node.scrollIntoView());
      await enter();
      const state = await snapshot("offscreenCaret");
      assert(
        state.modes.includes("caret") && state.selection === "D",
        "离屏旧选区应改用可见长文本",
      );
    });
    await check("字符、三位次数和 Escape 折叠或保留选区", async () => {
      await reset();
      await enter();
      await page.keyboard.type("3l");
      assert((await snapshot("threeCharacters")).selection === "alph", "3l 应移动三个字符");
      await page.keyboard.press("Escape");
      assert((await snapshot("escapeFocus")).focusOffset === 4, "新建选区 Esc 应折叠至焦点");
      await reset(0, 2);
      await enter();
      await page.keyboard.type("3l");
      await page.keyboard.press("Escape");
      assert(
        (await snapshot("retainRange")).selection === "alpha",
        "用户已有选区退出后应保留扩展结果",
      );
      await reset();
      await enter();
      await page.keyboard.type("100l");
      await snapshot("hundredCharacters");
      await reset();
      await enter();
      await page.keyboard.type("3l2h");
      assert((await snapshot("backwardCharacters")).selection === "al", "h 应缩小实际字符选区");
    });
    await check("组合键前缀、第一次 Escape 重置和 CTRL-[ 退出", async () => {
      await reset();
      await enter();
      await page.keyboard.type("7g");
      await page.keyboard.press("Escape");
      assert((await inspect()).modes.includes("visual"), "首个 Esc 只重置部分序列");
      await page.keyboard.press("l");
      assert((await snapshot("prefixReset")).selection === "al", "旧次数不得残留");
      await page.keyboard.down("Control");
      await page.keyboard.press("[");
      await page.keyboard.up("Control");
      assert(!(await snapshot("controlEscape")).modes.includes("visual"), "CTRL-[ 应退出");
    });
    await check("词、分隔符、Unicode、别名与词句实体", async () => {
      for (
        const keys of [
          "e",
          "w",
          "2e",
          "2w",
          "W",
          "elB",
          "wB",
          "aw",
          "2aw",
          "as",
          "2as",
          "lllwb",
          "oooo",
          "eee",
        ]
      ) {
        await reset(0, 1, "#words");
        await enter();
        await page.keyboard.type(keys);
        await snapshot(`word:${keys}`);
      }
      assert(
        values["word:e"].selection === "alpha" && values["word:w"].selection === "alpha,--- ",
        "w/e 必须保留冻结的不同词尾语义",
      );
    });
    await check("正反选区、o 反转与反向字符扩展", async () => {
      for (const backwards of [false, true]) {
        await reset(0, 4, "#text", false, backwards);
        await enter();
        await page.keyboard.type("o3l");
        await snapshot(`reverse:${backwards}`);
      }
      assert(values["reverse:false"].selection === "h", "反转后应从相反端移动");
    });
    await check("行、句、段落与文档边界及零键", async () => {
      for (
        const keys of [
          "$",
          "0",
          "2j",
          "jk",
          ")",
          "2)",
          "}",
          "}{",
          "G",
          "Ggg",
          "jj0",
          "j$",
          "jkk",
          "gg",
        ]
      ) {
        await reset(6, 7);
        await enter();
        await page.keyboard.type(keys);
        await snapshot(`boundary:${keys}`);
      }
      assert(
        (values["boundary:0"].focusOffset === 0 || values["boundary:0"].anchorOffset === 0) &&
          values["boundary:0"].selection.startsWith("alpha "),
        "前导零必须扩展选区至实际行首",
      );
    });
    await check("Visual Line 扩展、方向改变与 Caret 模式互转", async () => {
      for (const keys of ["", "j", "jk", "k", "o", "c", "cllv", "cvV", "gg", "Ggg"]) {
        await reset(6, 7);
        await enter("V");
        await page.keyboard.type(keys);
        await snapshot(`line:${keys}`);
      }
      for (const keys of ["c3l", "cwv", "c2e", "caw", "cllo", "cV"]) {
        await reset(0, 1);
        await enter();
        await page.keyboard.type(keys);
        await snapshot(`caret:${keys}`);
      }
      assert(values["caret:c3l"].selection === "h", "Caret 应显示移动后三个字符处的单字符");
    });
    await check("文本控件、只读框和可编辑 DOM 的原生选择", async () => {
      for (const selector of ["#input", "#readonly", "#textarea", "#editor"]) {
        for (const keys of ["3l", "o", "oe", "c2l", "aw", "c2lo", "2w", "V", "Vj"]) {
          await reset(0, 3, selector, true);
          await inspect("init");
          assert(
            (await inspect()).independentMode === [4, 5, 6, 7, 8, 9].includes(plan),
            "公开兼容入口必须路由至当前控制器",
          );
          await page.keyboard.type(keys);
          await snapshot(`editable:${selector}:${keys}`);
        }
      }
    });
    await check("CTRL-e/y 滚动、原生输入与可聚焦点击退出", async () => {
      await reset(0, 2);
      await enter();
      await page.keyboard.down("Control");
      await page.keyboard.press("e");
      await page.keyboard.up("Control");
      assert((await snapshot("scrollDown")).scrollY === 60, "CTRL-e 应下滚一个步长");
      await page.keyboard.down("Control");
      await page.keyboard.press("y");
      await page.keyboard.up("Control");
      assert((await snapshot("scrollUp")).scrollY === 0, "CTRL-y 应恢复顶部");
      await page.click("#input");
      await page.keyboard.type("native");
      assert(!(await inspect()).modes.includes("visual"), "点击输入框退出 Visual");
      assert(
        await page.$eval("#input", (node) => node.value.includes("native")),
        "退出后必须保留原生输入",
      );
      values.clickNative = true;
    });
    await check("独立 Find 往返与 n/N 继续选择", async () => {
      await reset(0, 2);
      await enter();
      await startFind("中文目标");
      await page.keyboard.press("Enter");
      await wait(async () =>
        (await inspect()).modes.includes("visual") && !(await inspect()).modes.includes("find")
      );
      await snapshot("findReturn");
      await page.keyboard.press("n");
      await snapshot("findNext");
      await page.keyboard.press("N");
      await snapshot("findPrevious");
      assert(values.findNext.selection === "中文目标", "Visual n 应找到真实中文文本");
    });
    await check("y、Enter 与整行 Y 的实际合成剪贴板写入", async () => {
      for (const key of ["y", "Enter", "Y", "2Y"]) {
        await reset(0, 5);
        await enter();
        const observeCopy = await inspect("observe-next-copy");
        if (key === "2Y") await page.keyboard.type(key);
        else await page.keyboard.press(key);
        const expected = key.endsWith("Y") ? (await inspect()).selection : "alpha";
        assert(
          expected.startsWith("alpha") && (!key.endsWith("Y") || expected.length > 5),
          "整行复制必须覆盖可见行",
        );
        // 空请求表也可能表示按键动作尚未开始；独立实现必须收到本次真实结果后才读取。
        await wait(async () => {
          const state = await inspect();
          return (!observeCopy || state.nextCopyResult != null) &&
            state.pendingCopies === 0 && state.pendingClipboard === 0;
        }, `${key} 剪贴板写入未结束`);
        if (observeCopy) {
          const receipt = (await inspect()).nextCopyResult;
          (metadata.clipboardReceipts ||= []).push({ key, ...receipt });
          if (!receipt.ok) {
            metadata.clipboardFailure = {
              frames: await inspect("frames").catch(() => null),
              chrome: await evaluateWithoutActivation(options.mainFrame(), async (fixture) => {
                const tab = (await chrome.tabs.query({})).find((tab) => tab.url === fixture);
                if (!tab) return null;
                const window = await chrome.windows.get(tab.windowId, { populate: true });
                return {
                  tabId: tab.id,
                  active: tab.active,
                  windowId: window.id,
                  windowFocused: window.focused,
                  activeTabId: window.tabs.find((tab) => tab.active)?.id,
                };
              }, url).catch(() => null),
              matchesSyntheticText: await clipboardMatches(expected).catch(() => null),
            };
          }
          assert(receipt.ok, `${key} 真实复制回执失败：${receipt.code}`);
        }
        await wait(() => clipboardMatches(expected), `${key} 原生剪贴板未得到预期合成文本`);
        await wait(async () => (await inspect()).pendingCopies === 0);
        values[`clipboard:${key}`] = true;
        await snapshot(`yank:${key}`);
      }
    });
    if (plan === 3 && canaryPlan === 7) await check("连续 Find 往返后真实复制压力复验", async () => {
      metadata.stress = { completed: 0, requested: 100 };
      for (let round = 1; round <= 100; round++) {
        metadata.stress.round = round;
        await reset(0, 2);
        await enter();
        await startFind("中文目标");
        await page.keyboard.press("Enter");
        await wait(async () => (await inspect()).modes.includes("visual") &&
          !(await inspect()).modes.includes("find"));
        await page.keyboard.press("n");
        assert((await inspect()).selection === "中文目标", "n 未选中合成查找目标");
        await page.keyboard.press("N");
        await reset(0, 5);
        await enter();
        await inspect("observe-next-copy");
        await page.keyboard.press("y");
        await wait(async () => {
          const current = await inspect();
          return current.nextCopyResult != null && current.pendingClipboard === 0;
        }, "重复复制未收到真实回执");
        const state = await inspect();
        (metadata.stressReceipts ||= []).push({ round, ...state.nextCopyResult });
        assert(state.nextCopyResult.ok, `第${round}次真实复制被拒绝`);
        await wait(() => clipboardMatches("alpha"), `第${round}次合成剪贴板未匹配`);
        metadata.stress.completed = round;
      }
    });
    await check("p/P 选中文字导航只产生一次本机目标副作用", async () => {
      for (const key of ["p", "P"]) {
        const targetUrl = url + (key === "p" ? "#opened-current" : "#opened-new");
        await page.$eval(
          "#navigation",
          (node, targetUrl) => node.textContent = targetUrl,
          targetUrl,
        );
        await reset(0, targetUrl.length, "#navigation");
        await enter();
        const before = new Set(browser.targets().filter((target) => target.type() === "page"));
        await page.keyboard.press(key);
        if (key === "p") await wait(() => page.url() === targetUrl, "当前标签未导航至合成 URL");
        else {
          const target = await browser.waitForTarget((target) =>
            target.type() === "page" && !before.has(target) && target.url() === targetUrl
          );
          const opened = await target.page();
          assert(
            browser.targets().filter((target) => target.type() === "page" && !before.has(target))
              .length === 1,
            "P 不得创建重复标签",
          );
          await opened.close();
        }
        values[`navigation:${key}`] = true;
        await page.goto(url);
        await wait(async () => (await inspect())?.active === "active");
        await page.bringToFront();
      }
    });
    await check("已有选区的实际 BFCache 恢复及新代次重建", async () => {
      await reset(0, 5);
      await enter();
      await inspect("release-ui");
      const before = await inspect();
      await page.evaluate(() => {
        globalThis.syntheticVisualRestores = 0;
        addEventListener("pageshow", (event) => {
          if (event.persisted) globalThis.syntheticVisualRestores++;
        });
      });
      page._client().on(
        "Page.backForwardCacheNotUsed",
        (event) => metadata.bfcacheNotUsed = event.notRestoredExplanationsTree,
      );
      await page.goto(url.replace("127.0.0.1", "localhost") + "?visual-navigation=1", {
        waitUntil: "domcontentloaded",
      });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await wait(async () => (await inspect())?.active === "active");
      const after = await inspect();
      const persisted = await page.evaluate(() => globalThis.syntheticVisualRestores);
      assert(
        persisted > 0 && after.documentId === before.documentId && after.epoch > before.epoch,
        "必须实际 BFCache 恢复并授权新代次",
      );
      assert(
        after.selection === "alpha" && !after.modes.includes("visual"),
        "已有选区保留，旧模式资源必须注销",
      );
      await enter();
      assert(
        (await inspect()).independentMode === [4, 5, 6, 7, 8, 9].includes(plan),
        "恢复后应进入新代次的当前模式",
      );
      values.bfcache = true;
      metadata.bfcache = {
        persisted,
        sameDocument: true,
        epochBefore: before.epoch,
        epochAfter: after.epoch,
      };
    });
    await check("真实 worker 终止后新文档再次选择与复制", async () => {
      const client = await browser.target().createCDPSession();
      const worker = (await client.send("Target.getTargets")).targetInfos.find((item) =>
        item.type === "service_worker" && item.url === target.url()
      );
      assert(
        worker && (await client.send("Target.closeTarget", { targetId: worker.targetId })).success,
        "必须实际终止 worker",
      );
      await wait(async () =>
        !(await client.send("Target.getTargets")).targetInfos.some((item) =>
          item.targetId === worker.targetId
        )
      );
      await client.detach();
      await page.reload();
      await wait(async () => (await inspect())?.active === "active");
      await reset(0, 5);
      await enter();
      await page.keyboard.press("y");
      await wait(() => clipboardMatches("alpha"));
      values.worker = true;
    });
    await check("100 次真实模式切换没有监听、模式或复制等待泄漏", async () => {
      await reset(0, 1);
      await enter();
      await page.keyboard.press("Escape");
      await sleep(200);
      const before = await inspect();
      for (let index = 0; index < 100; index++) {
        await reset(0, 1);
        await enter();
        await page.keyboard.press("Escape");
      }
      const after = await inspect();
      assert(
        JSON.stringify(before.resources) === JSON.stringify(after.resources) &&
          after.modes.length === before.modes.length && after.pendingCopies === 0 &&
          Object.keys(after.copyResources).length === 0,
        "模式切换留下资源",
      );
      values.resources = true;
    });
    if ([4, 5, 6, 7, 8, 9].includes(plan)) {
      await check("原生拒绝剪贴板写入返回明确失败并清理请求", async () => {
        await page.goto(url + "?clipboard-denied=1");
        await wait(async () => (await inspect())?.active === "active");
        await reset(0, 1);
        await enter();
        await wait(() =>
          page.frames().some((frame) => frame.url().endsWith("/pages/hud_page.html"))
        );
        try {
          const frame = page.frames().find((frame) => frame.url().endsWith("/pages/hud_page.html"));
          metadata.clipboardDenyProbe = await evaluateWithoutActivation(frame, async () => ({
            policyAllowsWrite: document.permissionsPolicy?.allowsFeature("clipboard-write") ??
              document.featurePolicy.allowsFeature("clipboard-write"),
          }));
          assert(
            !metadata.clipboardDenyProbe.policyAllowsWrite,
            "必须实际限制扩展 iframe 的写入策略",
          );
          await page.keyboard.press("Escape");
          const result = await inspect("copy", { text: "合成拒绝复制" });
          metadata.clipboardDenyResult = result;
          assert(!result.ok && result.code === "CLIPBOARD_DENIED", "剪贴板拒绝不得报告成功");
          assert((await inspect()).pendingCopies === 0, "拒绝后必须清理请求和计时器");
        } finally {
          await page._client().send("Browser.resetPermissions");
          await page.goto(url);
          await wait(async () => (await inspect())?.active === "active");
        }
      });
      await check("整套回退取消迟到复制和 Find 返回模式，全部 frame 一致", async () => {
        await reset(0, 1);
        await enter();
        await startFind("alpha");
        await inspect("delayed-copy");
        assert((await inspect()).pendingCopies === 1, "必须先建立尚未完成的复制");
        const result = await options.evaluate(() =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.runtimeMaintenance",
            action: "restore",
          })
        );
        assert(
          result.ok && result.activeFrames >= 2 && result.failedFrames === 0 &&
            result.refreshRequiredFrames === 0,
          "整套回退必须完成",
        );
        await sleep(700);
        const frames = await inspect("frames");
        assert(
          frames.every((state) =>
            state.plan === 1 && !state.independent && !state.independentMode &&
            !state.modes.includes("visual")
          ),
          "旧 Find 回调不得在回退后重新创建新模式",
        );
        const cancelled = (await inspect()).syntheticCopyResult;
        assert(cancelled?.code === "CANCELLED", "待复制必须明确取消");
        await reset(0, 1);
        await enter();
        assert(!(await inspect()).independentMode, "回退后应使用旧模式");
        await page.keyboard.press("Escape");
      });
    }
    if (retainBrowser) {
      await page._client().send("Browser.resetPermissions");
      await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
      await page.reload();
      await wait(async () =>
        (await inspect())?.plan === canaryPlan && (await inspect()).independent
      );
      await reset(0, 0);
      metadata.manualState = await inspect();
      metadata.optionsUrl = `chrome-extension://${id}/pages/mouse_options.html#general`;
      await page.screenshot({
        path: path.join(path.dirname(reportPath), "Phase4-Visual-headed-合成入口.png"),
      });
    }
    return values;
  } catch (failure) {
    metadata.failure = failure.message;
    metadata.failureState = await inspect?.().catch(() => null);
    throw failure;
  } finally {
    if (retainBrowser) browser.disconnect();
    else {
      await browser.close();
      await Deno.remove(profile, { recursive: true });
    }
  }
}
try {
  const compat = await run("旧 Visual（方案3）", compatPath, 3);
  report.comparisons.compat = compat;
  const canary = await run(`独立 Visual（方案${canaryPlan}）`, canaryPath, canaryPlan);
  report.comparisons.canary = canary;
  const mismatches = Object.keys(compat).filter((key) =>
    JSON.stringify(compat[key]) !== JSON.stringify(canary[key])
  );
  report.comparisons.mismatches = mismatches;
  assert(!mismatches.length, `旧新选择结果不同：${mismatches.join(", ")}`);
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
  console.log(`独立 Visual 人工入口：${url}`);
  await new Promise(() => {});
}
