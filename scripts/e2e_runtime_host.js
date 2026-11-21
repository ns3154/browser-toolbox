// SPDX-License-Identifier: GPL-3.0-or-later
// 仅使用本地合成页面和独立 CFT。旧构建与当前构建复用同一性能与行为探针。
import puppeteer from "npm:puppeteer";
import { assertSafeTestBrowser } from "./test_browser_safety.js";

assertSafeTestBrowser({ headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false" });
import * as path from "@std/path";

const root = path.resolve(path.dirname(path.fromFileUrl(import.meta.url)), "..");
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const extensionPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  path.join(root, "dist/browser-toolbox");
const baseline = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_BASELINE") === "true";
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN") === "true";
const headless = Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false";
const reportPath = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_REPORT");
const baselineReportPath = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT");
const evidenceDir = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_EVIDENCE_DIR");
const trace = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_TRACE") === "true";
const canary = Deno.env.get("BROWSER_TOOLBOX_RUNTIME_CANARY") === "true";
const canaryPlanVersion = Number(Deno.env.get("BROWSER_TOOLBOX_RUNTIME_PLAN_VERSION") || 2);
const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-runtime-cft-" });
function html(performanceOnly = false) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>运行时合成验收</title>
<style>body{font:16px sans-serif;min-height:20000px;margin:16px}#links{display:grid;grid-template-columns:repeat(40,24px);gap:0}#links a{height:12px;font-size:10px}input,textarea{width:220px}iframe{width:300px;height:100px}</style></head>
<body><h1>浏览器工具箱运行时验收</h1><p>此页仅含合成数据。测试 j/k、100j、f、/、v、Esc 和输入框。</p>
${
    performanceOnly
      ? ""
      : `<input id="input" aria-label="测试输入框"><textarea id="textarea" aria-label="测试文本区"></textarea>
<div id="editor" contenteditable="true">合成编辑区</div><p id="find-target">合成目标文字</p>`
  }
<div id="links">${
    Array.from({ length: 1000 }, (_, index) => `<a href="#target-${index}">${index}</a>`).join("")
  }</div>
${
    performanceOnly
      ? ""
      : '<iframe id="child-frame" src="/child" title="子 frame 合成输入"></iframe>'
  }
<script>window.nativeKeys=0;window.addEventListener('keydown',()=>window.nativeKeys++);</script></body></html>`;
}
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const url = new URL(request.url);
  const child = url.pathname === "/child";
  return new Response(
    child
      ? '<!doctype html><html lang="zh-CN"><body><input id="child-input"><p>合成子 frame</p></body></html>'
      : html(url.hostname === "localhost" && url.pathname === "/performance"),
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
});
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/fixture`;
const performanceUrl = `http://localhost:${server.addr.port}/performance`;
let inspectedFixtureUrl = fixtureUrl;
const browser = await puppeteer.launch({
  executablePath,
  headless,
  userDataDir: profile,
  defaultViewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    // Linux CI 容器默认 /dev/shm 仅 64MB，高频跨页与双 frame 测试需避免共享内存耗尽导致 IPC 尖刺。
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    "--window-position=50,60",
  ],
});
const report = {
  startedAt: new Date().toISOString(),
  baseline,
  trace,
  canary,
  browser: await browser.version(),
  extensionPath,
  profile,
  fixtureUrl,
  status: "running",
  checks: [],
  performance: { protocol: "dual-frame-initialization-isolated-ready-hints-v4" },
};
let options;
let page;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value, message) {
  if (!value) throw new Error(message);
}
async function waitFor(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await sleep(10);
  }
  throw new Error("等待合成运行时状态超时");
}
function stats(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return {
    samples: ordered.length,
    p95: ordered[Math.ceil(ordered.length * .95) - 1],
    min: ordered[0],
    max: ordered.at(-1),
  };
}

// 扩展隔离世界的操作是固定分支；不接收任意源码，不读取个人浏览内容。
async function inspect(operation, input = {}) {
  return options.evaluate(async ({ operation, input, fixtureUrl }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === fixtureUrl);
    if (!tab) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: operation === "frames" },
      world: "ISOLATED",
      func: async (operation, input) => {
        if (operation === "initialization") {
          // 在同一次原生调用内等原就绪条件，避免跨进程轮询每次额外等10ms而放大短初始化差值。
          const deadline = performance.now() + 10000;
          for (;;) {
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            const normal = globalThis.Mode?.modes?.find((mode) => mode.name === "normal");
            if (normal?.keyMapping && globalThis.Settings?.isLoaded() &&
              (input.baseline || host?.state === "active")) break;
            if (performance.now() >= deadline) throw new Error("等待合成运行时状态超时");
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          operation = "state";
        }
        const host = globalThis.BrowserToolboxRuntimeHostInstance;
        const normal = globalThis.Mode?.modes?.find((mode) => mode.name === "normal");
        const probe = globalThis.BrowserToolboxRuntimeTestProbe;
        if (operation === "state" || operation === "frames") {
          return {
            documentRole: ["http:", "https:", "file:"].includes(location.protocol)
              ? "content"
              : "ui",
            ready: Boolean(normal?.keyMapping && Settings.isLoaded()),
            host: host?.getDiagnostics({ includeIdentity: true }),
            modes: Mode.modes.length,
            handlers: handlerStack.stack.length,
            components: UIComponent.instances?.size ?? null,
            scrollY: globalThis.scrollY,
            passKeys: normal?.passKeys,
            independentInput: Boolean(
              globalThis.BrowserToolboxInputRuntime &&
                normal instanceof BrowserToolboxInputRuntime.NormalMode,
            ),
            independentScroll: Boolean(globalThis.BrowserToolboxScrollControllerInstance),
          };
        }
        if (operation === "probe") {
          if (probe) return;
          const next = globalThis.BrowserToolboxRuntimeTestProbe = {
            keys: [],
            hints: [],
            commandFeedback: [],
            hintDetails: [],
            longTasks: [],
          };
          if (input.trace) {
            const observer = new PerformanceObserver((records) => {
              for (const record of records.getEntries()) {
                next.longTasks.push({ start: record.startTime, duration: record.duration });
              }
            });
            observer.observe({ entryTypes: ["longtask"] });
          }
          const owner = host || handlerStack;
          const method = host ? "dispatch" : "bubbleEvent";
          const original = owner[method];
          owner[method] = function (type, event, ...rest) {
            const start = performance.now();
            const result = original.call(this, type, event, ...rest);
            if (type.startsWith("key") && next.keys.length < 2000) {
              next.keys.push(performance.now() - start);
            }
            return result;
          };
          const prepare = HintCoordinator.prepareToActivateMode;
          HintCoordinator.prepareToActivateMode = function (...args) {
            next.hintStart = performance.now();
            if (input.trace) performance.mark(`BrowserToolboxHintStart-${next.hints.length}`);
            return prepare.apply(this, args);
          };
          const activate = HintCoordinator.activateMode;
          HintCoordinator.activateMode = function (...args) {
            const start = performance.now();
            if (input.trace) performance.mark(`BrowserToolboxHintRender-${next.hints.length}`);
            const result = activate.apply(this, args);
            next.hints.push(performance.now() - next.hintStart);
            next.hintDetails.push({
              total: performance.now() - next.hintStart,
              start: next.hintStart,
              startedAt: performance.timeOrigin + next.hintStart,
              renderingAt: performance.timeOrigin + start,
              render: performance.now() - start,
              scan: next.scan,
              candidates: next.candidates,
            });
            return result;
          };
          const descriptors = HintCoordinator.getHintDescriptors;
          HintCoordinator.getHintDescriptors = function (...args) {
            const start = performance.now();
            const result = descriptors.apply(this, args);
            next.scan = performance.now() - start;
            next.candidates = result.length;
            return result;
          };
          return;
        }
        if (operation === "probe-results") return probe;
        if (operation === "hints-ready") {
          return Boolean(HintCoordinator.linkHintsMode?.hintMode?.modeIsActive);
        }
        if (operation === "refresh") {
          await globalThis.checkIfEnabledForUrl?.();
          return;
        }
        if (operation === "pass-next") {
          if (host) {
            BrowserToolboxPageCommandExecutorInstance.executeCompatibility({
              command: "passNextKey",
              options: {},
            }, 1);
          } else NormalModeCommands.passNextKey(1, { registryEntry: { options: {} } });
          return;
        }
        if (operation === "feedback") {
          for (let index = 0; index < 30; index++) {
            const start = performance.now();
            if (host) {
              BrowserToolboxPageCommandExecutorInstance.executeCompatibility({
                command: "scrollDown",
                options: {},
              }, 1);
            } else NormalModeCommands.scrollDown(1);
            probe.commandFeedback.push(performance.now() - start);
          }
          return;
        }
        if (operation === "cycles") {
          const counts = [];
          for (let index = 0; index < (input.cycles || 101); index++) {
            // 等实际端口握手和显示完成，再检查方案切换是否释放可见 UI 的全部资源。
            await HUD.init(false);
            const component = HUD.hudUI;
            const port = await component.iframePort;
            if (!port) throw new Error("合成浮层握手失败");
            await component.show({ name: "show", text: "合成切换验收" });
            if (!component.showing) throw new Error("合成浮层未显示");
            await host.activate(
              await host.prepare(
                host.plan,
                host.lastSettingsRevision,
                host.context,
              ),
            );
            await host.setEffectiveSettings(
              BrowserToolboxSettingsProviderInstance.getEffective(),
              "test-cycle",
            );
            await new Promise((resolve) => setTimeout(resolve, 5));
            counts.push({
              modes: Mode.modes.length,
              handlers: handlerStack.stack.length,
              components: UIComponent.instances.size,
              resources: host.getDiagnostics().resources,
            });
          }
          return counts;
        }
        if (operation === "failure") {
          await host.deactivate("test-failure");
          const original = host.engineFactory;
          host.engineFactory = () => ({
            initialize() {
              throw new Error("合成初始化失败");
            },
            destroy() {},
          });
          try {
            await globalThis.checkIfEnabledForUrl();
          } finally {
            host.engineFactory = original;
          }
          return host.getDiagnostics();
        }
        if (operation === "dispose") {
          await host.dispose("test-dispose");
          return {
            host: host.getDiagnostics(),
            modes: Mode.modes.length,
            handlers: handlerStack.stack.length,
            components: UIComponent.instances.size,
          };
        }
        if (operation === "diagnostics") return host?.getDiagnostics();
        if (operation === "delay-component-css") {
          const get = chrome.storage.session.get.bind(chrome.storage.session);
          chrome.storage.session.get = async (keys) => {
            const result = await get(keys);
            if (keys === "vimiumCSSInChromeStorage") {
              chrome.storage.session.get = get;
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            return result;
          };
          return;
        }
        if (operation === "reconnect-read") {
          const read = await Promise.allSettled([
            BrowserToolboxFrameRuntimeBridgeInstance.initializeFrame(),
            BrowserToolboxSettingsProviderInstance.load(),
          ]);
          return read.map((entry) =>
            entry.status === "fulfilled"
              ? {
                status: "fulfilled",
                frameId: entry.value.frameId,
                revision: entry.value.revision,
              }
              : { status: "rejected", name: entry.reason.name, error: entry.reason.message }
          );
        }
        if (operation === "memory-cycle") {
          await HUD.init(false);
          await new Promise((resolve) => setTimeout(resolve, 5));
          HUD.hide(true, false);
          return;
        }
      },
      args: [operation, input],
    });
    if (operation === "frames") {
      return results.filter((item) => item.result?.documentRole === "content").map((item) => ({
        frameId: item.frameId,
        documentId: item.documentId,
        ...item.result,
      }));
    }
    return results[0]?.result;
  }, { operation, input, fixtureUrl: inspectedFixtureUrl });
}

async function check(name, task) {
  const start = Date.now();
  await task();
  report.checks.push({ name, status: "passed", durationMs: Date.now() - start });
  console.log(`运行时验收通过：${name}`);
}

try {
  const target = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
  );
  const extensionId = target.url().split("/")[2];
  report.extensionId = extensionId;
  const worker = trace ? await target.worker() : null;

  options = await browser.newPage();
  await options.goto(`chrome-extension://${extensionId}/pages/mouse_options.html#general`);
  await options.waitForSelector("#save-settings");
  await options.evaluate(async () => {
    await Settings.onLoaded();
    await Settings.set("smoothScroll", false);
    await Settings.set("keyMappings", "");
  });
  const backgroundTraceAvailable = trace &&
    await worker.evaluate(() => typeof chrome !== "undefined");
  if (backgroundTraceAvailable) {
    await worker.evaluate(() => {
      const events = globalThis.BrowserToolboxRuntimeTimingProbe = [];
      for (
        const [owner, name] of [
          [chrome.webNavigation, "getAllFrames"],
          [chrome.webNavigation, "getFrame"],
          [chrome.scripting, "executeScript"],
          [chrome.tabs, "sendMessage"],
        ]
      ) {
        const original = owner[name];
        owner[name] = function (...args) {
          const observe = name !== "sendMessage" || args[1]?.handler === "linkHintsMessage" ||
            args[1]?.kind === "lifecycle" && args[1]?.action === "hints";
          const start = performance.now();
          const result = original.apply(this, args);
          if (!observe) return result;
          return result.then((value) => {
            events.push({
              name,
              start,
              startedAt: performance.timeOrigin + start,
              end: performance.now(),
              elapsed: performance.now() - start,
              type: args[1]?.messageType || args[1]?.payload?.message?.messageType,
              count: Array.isArray(value) ? value.length : null,
            });
            return value;
          });
        };
      }
      if (globalThis.BrowserToolboxDocumentAuthority) {
        for (
          const name of [
            "active",
            "records",
            "target",
            "verify",
            "register",
            "mutate",
            "frames",
            "frameIds",
            "contentFrames",
          ]
        ) {
          const owner = BrowserToolboxDocumentAuthority.prototype;
          const original = owner[name];
          owner[name] = function (...args) {
            const start = performance.now();
            return original.apply(this, args).then((value) => {
              events.push({
                name,
                start,
                startedAt: performance.timeOrigin + start,
                end: performance.now(),
                elapsed: performance.now() - start,
              });
              return value;
            });
          };
        }
      }
    });
  }
  page = await browser.newPage();
  const metrics = await page.target().createCDPSession();
  await metrics.send("Performance.enable");
  const initialization = [];
  const script = [];
  const compile = [];
  const initializationTimings = [];
  await check("30 个新文档与 30 次热缓存重载的初始化采样", async () => {
    for (let index = 0; index < 60; index++) {
      if (index < 30 && index > 0) {
        await page.close();
        page = await browser.newPage();
      }
      if (trace && index === 29) {
        const tracePath = reportPath?.replace(/\.json$/, ".trace.json");
        await page.tracing.start({
          path: tracePath,
          categories: [
            "toplevel",
            "devtools.timeline",
            "blink.user_timing",
            "renderer.scheduler",
            "loading",
            "ipc",
            "sequence_manager",
          ],
        });
        report.performance.chromeTrace = tracePath;
      }
      const client = await page.target().createCDPSession();
      await client.send("Performance.enable");
      const start = performance.now();
      await page.goto(fixtureUrl, { waitUntil: "load" });
      const initialized = await inspect("initialization", { baseline });
      assert(
        initialized?.ready && (baseline || initialized.host?.initializationState === "active"),
        "原生初始化观测必须实际达到原ready/active条件",
      );
      initialization.push(performance.now() - start);
      initializationTimings.push({
        sample: index,
        timings: initialized?.host?.initializationTimings || null,
      });
      const measured = (await client.send("Performance.getMetrics")).metrics;
      script.push((measured.find((entry) => entry.name === "ScriptDuration")?.value || 0) * 1000);
      const compiled = measured.find((entry) => entry.name === "V8CompileDuration");
      if (compiled) compile.push(compiled.value * 1000);
      await client.detach();
    }
    report.performance.initializationObservedMs = {
      coldDocuments: stats(initialization.slice(0, 30)),
      warmCacheReloads: stats(initialization.slice(30)),
      rawSamples: initialization,
      includes: "本地导航、fixture解析、脚本初始化和一次原生观测往返；隔离世界有界等待原ready/active条件，不等同于纯注入耗时",
    };
    report.performance.scriptExecutionMs = stats(script);
    report.performance.v8CompileMs = compile.length ? stats(compile) : { status: "unavailable" };
    report.performance.initializationTimings = initializationTimings;
  });
  await waitFor(async () => {
    const frames = await inspect("frames");
    return frames?.length === 2 &&
      frames.every((frame) =>
        frame.ready && (baseline || frame.host?.initializationState === "active")
      );
  });
  report.performance.initializationFixtureFrames = 2;
  // 原初始化仍测双框架；交互采样另用本地不同站点的新文档，避免复用正在清理旧Widget的渲染进程。
  inspectedFixtureUrl = performanceUrl;
  await page.goto(performanceUrl, { waitUntil: "load" });
  await waitFor(async () => {
    const state = await inspect("state");
    return state?.ready && (baseline || state.host?.initializationState === "active");
  });
  await page.bringToFront();
  await inspect("probe", { trace });
  await check("1000 次真实键盘输入的同步处理采样", async () => {
    for (let index = 0; index < 500; index++) await page.keyboard.press("Control");
    const probe = await inspect("probe-results");
    assert(probe.keys.length >= 1000, "同步输入样本不足 1000");
    report.performance.inputSyncMs = stats(probe.keys.slice(0, 1000));
  });
  await check("1000 个候选元素的 Hints 完整激活 30 次", async () => {
    // 性能页从加载起只有一个内容文档，避免前项反复销毁测试子框架的浏览器清理混入激活。
    let performanceFrames;
    await waitFor(async () => {
      performanceFrames = await inspect("frames");
      return performanceFrames?.length === 1 && performanceFrames[0]?.documentRole === "content" &&
        performanceFrames[0].ready &&
        (baseline || performanceFrames[0].host?.initializationState === "active");
    });
    report.performance.hintsFixtureSetup = {
      nativeContentFrames: performanceFrames.length,
      source: "chrome.scripting.executeScript allFrames",
      warmedHintActivations: 0,
      fixtureUrl: performanceUrl,
    };
    for (let index = 0; index < 30; index++) {
      await page.keyboard.press("f");
      await waitFor(() => inspect("hints-ready"));
      await page.keyboard.press("Escape");
      // 退出依赖后台广播；上一会话仍活动时发送下一次 f 不是一次新的独立激活。
      await waitFor(async () => !await inspect("hints-ready"));
    }
    const probe = await inspect("probe-results");
    if (trace) await page.tracing.stop();
    assert(probe.hints.length >= 30, "Hints 样本不足 30");
    report.performance.hintDetails = probe.hintDetails;
    assert(
      probe.hintDetails.every((sample) => sample.candidates === 1000),
      "候选规模应固定为 1000",
    );
    report.performance.hintsActivationMs = stats(probe.hints.slice(0, 30));
    report.performance.hintDetails = probe.hintDetails;
    if (trace) report.performance.longTasks = probe.longTasks;
    if (backgroundTraceAvailable) {
      report.performance.backgroundTimings = await worker.evaluate(() =>
        globalThis.BrowserToolboxRuntimeTimingProbe
      );
    }
  });
  await check("30 次页面滚动命令开始反馈采样", async () => {
    await inspect("feedback");
    report.performance.commandFeedbackMs = stats((await inspect("probe-results")).commandFeedback);
  });
  // 行为场景仍覆盖原有编辑器和子框架，不能以单文档性能页替代多框架验收。
  inspectedFixtureUrl = fixtureUrl;
  await page.goto(fixtureUrl, { waitUntil: "load" });
  await waitFor(async () => {
    const frames = await inspect("frames");
    return frames?.length === 2 &&
      frames.every((frame) =>
        frame.ready && (baseline || frame.host?.initializationState === "active")
      );
  });
  report.performance.behaviorFixtureFrames = 2;
  await page.evaluate(() => scrollTo(0, 0));
  await check("普通滚动、100j、输入框、文本区和编辑区行为对照", async () => {
    await page.keyboard.type("100j");
    assert(await page.evaluate(() => scrollY) === 6000, "100j 的旧键盘位移应为 6000");
    await page.evaluate(() => scrollTo(0, 0));
    for (const selector of ["#input", "#textarea", "#editor"]) {
      await page.click(selector);
      const before = await page.evaluate(() => scrollY);
      await page.keyboard.type("j100k");
      assert(await page.evaluate(() => scrollY) === before, "编辑输入不应被普通滚动命令接管");
      await page.keyboard.press("Escape");
    }
  });
  if (!baseline) {
    await check("组件样式延迟时仍在可见后正确聚焦书签搜索输入", async () => {
      await page.evaluate(() => document.activeElement.blur());
      await inspect("delay-component-css");
      await page.keyboard.down("Shift");
      await page.keyboard.press("KeyB");
      await page.keyboard.up("Shift");
      await waitFor(async () => {
        const frame = page.frames().find((frame) => frame.url().includes("vomnibar_page.html"));
        return frame &&
          await frame.evaluate(() =>
            innerWidth > 300 &&
            document.activeElement === document.querySelector("#vomnibar-search")
          );
      });
      await page.keyboard.press("Escape");
      await waitFor(() =>
        page.evaluate(() =>
          ![...document.querySelectorAll(".vimium-reset")]
            .some((wrapper) =>
              wrapper.shadowRoot?.querySelector("iframe.vomnibar-frame.vimium-ui-component-visible")
            )
        )
      );
    });
  }
  await check("一次放行保留配对 keyup，随后恢复普通模式", async () => {
    await page.evaluate(() => {
      document.activeElement.blur();
      scrollTo(0, 0);
    });
    await inspect("pass-next");
    const before = await page.evaluate(() => nativeKeys);
    await page.keyboard.press("j");
    assert(await page.evaluate(() => scrollY) === 0, "放行的 j 不应滚动");
    assert(await page.evaluate(() => nativeKeys) === before + 1, "放行的 j 应到达网页监听器");
    await page.keyboard.press("j");
    assert(await page.evaluate(() => scrollY) === 60, "放行结束后 j 应恢复滚动");
  });
  await check("浏览器 composition 与 IME Escape 229 保护对照", async () => {
    const client = await page.target().createCDPSession();
    try {
      await page.evaluate(() => scrollTo(0, 0));
      await page.click("#input");
      await client.send("Input.imeSetComposition", {
        text: "合成中文",
        selectionStart: 4,
        selectionEnd: 4,
      });
      assert(
        await page.$eval("#input", (input) => input.value.includes("合成中文")),
        "composition 文本应进入原生输入框",
      );
      for (const type of ["keyDown", "keyUp"]) {
        await client.send("Input.dispatchKeyEvent", {
          type,
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 229,
          nativeVirtualKeyCode: 229,
        });
      }
      assert(
        await page.evaluate(() => document.activeElement.id) === "input",
        "IME Escape 不应退出输入框",
      );
      await client.send("Input.imeSetComposition", {
        text: "",
        selectionStart: 0,
        selectionEnd: 0,
      });
      await client.send("Input.insertText", { text: "中文确认" });
      assert(
        await page.$eval("#input", (input) => input.value.includes("中文确认")),
        "提交的中文应保留",
      );
      await page.keyboard.press("Escape");
    } finally {
      await client.detach();
    }
  });
  const memoryClient = await page.target().createCDPSession();
  await memoryClient.send("Performance.enable");
  const memory = [];
  async function sampleMemory(cycle, samples = memory) {
    await memoryClient.send("HeapProfiler.collectGarbage");
    const measured = (await memoryClient.send("Performance.getMetrics")).metrics;
    samples.push({
      cycle,
      heapBytes: measured.find((entry) => entry.name === "JSHeapUsedSize").value,
      domNodes: measured.find((entry) => entry.name === "Nodes").value,
    });
  }
  async function retainedRuntimeObjects() {
    // 堆快照仅在内存中解析；只保留固定构造器的数量和字节，不落盘字符串、DOM 或令牌。
    const constructors = [
      "RuntimeHost",
      "ResourceScope",
      "KeyboardEngine",
      "SettingsProvider",
      "FrameRuntimeBridge",
      "UIComponent",
      "NormalMode",
      "InsertMode",
      "GrabBackFocus",
      "SuppressAllKeyboardEvents",
      "CacheAllKeydownEvents",
      "Tween",
      "Mode",
    ];
    let snapshotText = "";
    const receive = ({ chunk }) => snapshotText += chunk;
    memoryClient.on("HeapProfiler.addHeapSnapshotChunk", receive);
    try {
      await memoryClient.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      const snapshot = JSON.parse(snapshotText);
      const fields = snapshot.snapshot.meta.node_fields;
      const width = fields.length;
      const typeIndex = fields.indexOf("type");
      const nameIndex = fields.indexOf("name");
      const sizeIndex = fields.indexOf("self_size");
      const types = snapshot.snapshot.meta.node_types[typeIndex];
      const objects = Object.fromEntries(
        constructors.map((name) => [name, { count: 0, bytes: 0 }]),
      );
      for (let offset = 0; offset < snapshot.nodes.length; offset += width) {
        if (types[snapshot.nodes[offset + typeIndex]] !== "object") continue;
        const name = snapshot.strings[snapshot.nodes[offset + nameIndex]];
        if (!Object.hasOwn(objects, name)) continue;
        objects[name].count++;
        objects[name].bytes += snapshot.nodes[offset + sizeIndex];
      }
      return objects;
    } finally {
      memoryClient.off("HeapProfiler.addHeapSnapshotChunk", receive);
      snapshotText = "";
    }
  }
  await sampleMemory(0);
  await check("多 frame 浮层开关持续采样并排除 GC 波动", async () => {
    for (let index = 1; index <= 100; index++) {
      await inspect("memory-cycle");
      if (index % 10 === 0) await sampleMemory(index);
    }
    report.performance.memory = {
      samples: [...memory],
      stableHeapBytes: stats(memory.slice(1).map((sample) => sample.heapBytes)),
      finalToFirstRatio: memory.at(-1).heapBytes / memory[1].heapBytes,
      scope: "固定顶层与子 frame 页面，CDP 强制 GC 后的页面进程 JS 堆与 DOM 节点",
    };
  });
  if (!baseline) {
    await check("每个 frame 的可信文档身份与唯一监听所有者", async () => {
      const frames = await inspect("frames");
      assert(frames.length === 2, "应覆盖顶层与子 frame");
      for (const frame of frames) {
        assert(
          frame.ready && frame.host.listenerOwner === "BrowserToolbox.RuntimeHost",
          "每个 frame 应只有 RuntimeHost 输入所有者",
        );
        assert(frame.documentId === frame.host.documentId, "文档身份应来自浏览器 sender");
        if (canary) {
          assert(
            frame.host.planVersion === canaryPlanVersion && frame.independentInput &&
              frame.independentScroll,
            "输入 Canary 必须真正使用独立普通模式与滚动控制器",
          );
        }
      }
      const diagnostics = await inspect("diagnostics");
      assert(
        !("documentId" in diagnostics) && !JSON.stringify(diagnostics).includes(fixtureUrl),
        "默认诊断应脱敏",
      );
    });
    await check("100 次实际浮层与已登记整套方案切换无资源净增长", async () => {
      const counts = [];
      const switchMemory = [];
      // 单例 UI 已在前项创建，先清理到切换后的相同稳态，再比较存活对象。
      await inspect("cycles", { cycles: 1 });
      const initialObjects = await retainedRuntimeObjects();
      await sampleMemory(0, switchMemory);
      for (let index = 0; index < 10; index++) {
        counts.push(...await inspect("cycles", { cycles: 10 }));
        await sampleMemory((index + 1) * 10, switchMemory);
      }
      const initial = JSON.stringify(counts[0]);
      assert(
        counts.every((count) => JSON.stringify(count) === initial),
        "模式、监听器或 UI 资源随切换增长",
      );
      assert(counts.at(-1).components === 0, "切换后 UI 组件、port 与 observer 应清理");
      report.resourceCycles = { samples: 100, initial: counts[0], final: counts.at(-1) };
      report.performance.switchMemory = {
        samples: switchMemory,
        finalToFirstRatio: switchMemory.at(-1).heapBytes / switchMemory[1].heapBytes,
      };
      const finalObjects = await retainedRuntimeObjects();
      report.retainedRuntimeObjects = { initial: initialObjects, final: finalObjects };
      for (const name of Object.keys(initialObjects)) {
        assert(
          finalObjects[name].count <= initialObjects[name].count,
          `切换后 ${name} 存活对象持续增加`,
        );
      }
      assert(
        report.performance.switchMemory.finalToFirstRatio <= 1.25,
        "切换后的 GC 稳定内存不应持续增长",
      );
    });
    await check("初始化失败释放页面输入，重新握手可恢复已登记整套引擎", async () => {
      const state = await inspect("failure");
      assert(state.initializationState === "failed", "故障注入应进入失败状态");
      await page.click("#input");
      await page.keyboard.type("native-safe");
      assert(
        await page.$eval("#input", (input) => input.value.includes("native-safe")),
        "失败后原生输入应可用",
      );
      await inspect("refresh");
      assert(
        (await inspect("state")).host.initializationState === "active",
        "恢复应重新安装完整已登记引擎",
      );
    });
    await check("独立设置页维护入口可检查并恢复整套兼容方案", async () => {
      const result = await options.evaluate(async () => {
        document.querySelector("#runtime-maintenance").open = true;
        document.querySelector("#runtime-inspect").click();
        while (document.querySelector("#runtime-inspect").disabled) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return chrome.runtime.sendMessage({
          handler: "browserToolbox.runtimeMaintenance",
          action: "restore",
        });
      });
      report.maintenanceRestore = result;
      assert(result?.ok && result.activeFrames >= 2, "维护恢复应包含顶层与子 frame");
      assert(
        result.failedFrames === 0 && result.refreshRequiredFrames === 0,
        "维护恢复不应留下失败 frame",
      );
      const status = await options.$eval("#runtime-maintenance-status", (node) => node.textContent);
      assert(status.length > 0 && !status.includes(fixtureUrl), "设置页应显示脱敏检查结果");
      await page.bringToFront();
    });
    await check("实际终止 Service Worker 后键盘与 frame 握手仍可恢复", async () => {
      if (backgroundTraceAvailable) {
        report.performance.backgroundTimings = await worker.evaluate(() =>
          globalThis.BrowserToolboxRuntimeTimingProbe
        );
      }
      // 诊断时附着的 worker CDP 会阻止正常终止；必须先解除本探针的调试附着。
      await worker?.client.detach().catch(() => {});
      const client = await browser.target().createCDPSession();
      try {
        const targets = (await client.send("Target.getTargets")).targetInfos;
        const current = targets.find((item) =>
          item.type === "service_worker" && item.url === target.url()
        );
        assert(current, "应存在正在运行的扩展后台");
        await client.send("Target.closeTarget", { targetId: current.targetId });
      } finally {
        await client.detach();
      }
      await inspect("refresh");
      report.workerRestartDiagnostics = await inspect("diagnostics");
      if (report.workerRestartDiagnostics.initializationState !== "active") {
        report.workerRestartReads = await inspect("reconnect-read");
        console.error("后台重启合成读取结果", report.workerRestartReads);
      }
      assert(
        (await inspect("state")).host.initializationState === "active",
        `后台重启应恢复握手：${JSON.stringify(report.workerRestartDiagnostics)}`,
      );
      await page.bringToFront();
      await page.evaluate(() => {
        document.activeElement.blur();
        scrollTo(0, 0);
      });
      await page.keyboard.press("j");
      assert(await page.evaluate(() => scrollY) === 60, "后台重启后的 j 应只执行一次");
    });
    await check("销毁后模式、资源与浮层清零，原生按键不被吞掉", async () => {
      const state = await inspect("dispose");
      assert(
        state.modes === 0 && state.handlers === 0 && state.components === 0,
        "销毁未清理完整兼容资源",
      );
      assert(
        Object.values(state.host.resources).every((counts) => Object.keys(counts).length === 0),
        "文档资源注销后应清零",
      );
      await page.click("#textarea");
      await page.keyboard.type("native-after-dispose");
      assert(
        await page.$eval("#textarea", (input) => input.value.includes("native-after-dispose")),
        "销毁后原生输入应可用",
      );
    });
    await page.reload({ waitUntil: "load" });
    await waitFor(async () => (await inspect("state"))?.host?.initializationState === "active");
  }
  await memoryClient.detach();
  report.performance.budget = {
    inputSyncP95Ms: 2,
    hintsActivationP95Ms: 100,
    commandFeedbackP95Ms: 100,
    relativeRegressionPercent: 25,
    noiseFloorMs: .25,
    phase0FrozenBeforeComparison: true,
  };
  report.performance.absoluteBudgetPassed = report.performance.inputSyncMs.p95 <= 2 &&
    report.performance.hintsActivationMs.p95 <= 100 &&
    report.performance.commandFeedbackMs.p95 <= 100;
  if (baselineReportPath && !baseline) {
    const previous = JSON.parse(await Deno.readTextFile(baselineReportPath)).performance;
    assert(previous.protocol === report.performance.protocol, "旧新性能测量协议必须一致");
    const comparisons = [
      [
        "冷文档初始化观测",
        report.performance.initializationObservedMs.coldDocuments.p95,
        previous.initializationObservedMs.coldDocuments.p95,
      ],
      [
        "热缓存初始化观测",
        report.performance.initializationObservedMs.warmCacheReloads.p95,
        previous.initializationObservedMs.warmCacheReloads.p95,
      ],
      ["脚本执行", report.performance.scriptExecutionMs.p95, previous.scriptExecutionMs.p95],
      ["V8 编译", report.performance.v8CompileMs.p95, previous.v8CompileMs.p95],
      ["同步输入", report.performance.inputSyncMs.p95, previous.inputSyncMs.p95],
      [
        "稳定内存",
        report.performance.memory.stableHeapBytes.p95,
        previous.memory.stableHeapBytes.p95,
      ],
    ].map(([name, current, previous]) => ({
      name,
      current,
      previous,
      regressionPercent: (current / previous - 1) * 100,
      passed: name === "稳定内存"
        ? current <= previous * 1.25
        : current <= Math.max(previous * 1.25, .25),
    }));
    report.performance.relativeComparisons = comparisons;
    report.performance.relativeBudgetPassed = comparisons.every((item) => item.passed);
  }
  if (evidenceDir) {
    await Deno.mkdir(evidenceDir, { recursive: true });
    await page.evaluate(() => {
      document.activeElement.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(evidenceDir, "合成行为页面.png") });
    const snapshot = await page.evaluate(() => ({
      title: document.title,
      links: document.querySelectorAll("#links a").length,
      inputs: ["input", "textarea", "editor"].map((id) => ({
        id,
        text: document.getElementById(id).textContent,
        value: document.getElementById(id).value,
      })),
      frames: document.querySelectorAll("iframe").length,
      runtimeUi: document.querySelectorAll(".vimiumUIComponent").length,
    }));
    await Deno.writeTextFile(
      path.join(evidenceDir, "合成DOM快照.json"),
      JSON.stringify(snapshot, null, 2) + "\n",
    );
  }
  if (canary && keepOpen) {
    await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
    await page.reload({ waitUntil: "load" });
    await waitFor(async () => (await inspect("state"))?.host?.planVersion === canaryPlanVersion);
    report.manualCanaryState = await inspect("state");
  }
  report.status = report.performance.absoluteBudgetPassed &&
      report.performance.relativeBudgetPassed !== false &&
      report.performance.memory.finalToFirstRatio <= 1.25
    ? "passed"
    : "failed";
  if (report.status === "failed") {
    report.error = "行为检查通过，但冻结性能或内存预算未通过";
    Deno.exitCode = 1;
  }
  console.log(
    `运行时门禁：${report.status}；性能绝对预算：${report.performance.absoluteBudgetPassed}`,
  );
  if (report.status === "failed") {
    console.error("运行时性能诊断：", JSON.stringify({
      inputSyncP95: report.performance.inputSyncMs?.p95,
      hintsActivationP95: report.performance.hintsActivationMs?.p95,
      commandFeedbackP95: report.performance.commandFeedbackMs?.p95,
      relativeBudgetPassed: report.performance.relativeBudgetPassed,
      relativeComparisons: report.performance.relativeComparisons,
      finalToFirstRatio: report.performance.memory?.finalToFirstRatio,
    }));
  }
  if (keepOpen) {
    await page.bringToFront();
    report.browserPid = browser.process()?.pid;
    report.browserWsEndpoint = browser.wsEndpoint();
  }
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  console.error(error);
  Deno.exitCode = 1;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (!keepOpen) {
    await browser.close();
    await server.shutdown();
    await Deno.remove(profile, { recursive: true });
  } else {
    // 保留独立 headed 窗口与合成页面服务，交由用户手工复核。
    browser.disconnect();
    console.log(`人工测试入口：${fixtureUrl}；扩展：${report.extensionId}；加载：${extensionPath}`);
  }
}
