// SPDX-License-Identifier: GPL-3.0-or-later
// 真实 CFT 的共享 UI 生命周期专项；延迟/拒绝只注入测试环境，不修改产品算法或原性能预算。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { launchCanaryBrowser, resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_UI_COMPAT_PATH");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_UI_REPORT");
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_UI_KEEP_OPEN") === "true";
const group = Deno.env.get("BROWSER_TOOLBOX_UI_GROUP") || "both";
const externalBrowserUrl = Deno.env.get("BROWSER_TOOLBOX_UI_BROWSER_URL");
const preparationPath = Deno.env.get("BROWSER_TOOLBOX_UI_PREPARATION_REPORT");
const focusHandshakeDir = Deno.env.get("BROWSER_TOOLBOX_UI_FOCUS_HANDSHAKE_DIR");
const runId = crypto.randomUUID();
if (!["both", "compat", "canary"].includes(group)) throw new Error("未登记的共享UI测试组");
const canaryPlan = Number(Deno.env.get("BROWSER_TOOLBOX_UI_PLAN_VERSION") || 8);
if (![8, 9].includes(canaryPlan)) throw new Error("未登记的共享 UI 测试方案");
const selectedPlans = group === "both" ? [7, canaryPlan] : [group === "compat" ? 7 : canaryPlan];
if (selectedPlans.includes(7) && !compatPath || selectedPlans.includes(canaryPlan) && !canaryPath) {
  throw new Error("必须提供所选测试组对应的冻结方案7或独立方案目录");
}
if (externalBrowserUrl) {
  const endpoint = new URL(externalBrowserUrl);
  if (
    group === "both" || !preparationPath || endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    Deno.env.get("BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE")
  ) {
    throw new Error("外部模式必须选择单组、提供准备报告并使用无凭证的本机HTTP CDP地址");
  }
} else if (preparationPath || focusHandshakeDir) {
  throw new Error("准备报告和CUA焦点握手仅供外部浏览器接入使用");
}
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
async function fileHashes(directory, prefix = "") {
  const hashes = {};
  const entries = [...await Array.fromAsync(Deno.readDir(directory))]
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory) {
      Object.assign(hashes, await fileHashes(path.join(directory, entry.name), relative + "/"));
    } else if (entry.isFile) {
      hashes[relative] = await sha256(await Deno.readFile(path.join(directory, entry.name)));
    } else throw new Error(`构建目录含非普通文件：${relative}`);
  }
  return hashes;
}
async function wait(predicate, message = "等待共享UI状态超时", timeout = 12000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(25);
  }
  throw new Error(message + (lastError ? `：${lastError}` : ""));
}
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const route = new URL(request.url).pathname;
  const child = route.startsWith("/child") || route === "/tiny";
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>共享 UI 原生验收</title><body style="font:16px sans-serif;min-height:12000px;margin:16px">
<h1 id="heading">共享 UI 原生验收</h1><p id="text">alpha 中文目标 alpha beta</p>
<input id="input" aria-label="合成输入框"><a id="link" href="/target">合成本地链接</a>
${
      child
        ? ""
        : '<div><iframe id="child" src="/child" title="合成子框架" style="width:550px;height:220px"></iframe><iframe id="tiny" src="/tiny" title="过小框架" style="width:2px;height:2px;border:0"></iframe></div>'
    }
<script>window.bfcRestores=0;addEventListener('pageshow',e=>{if(e.persisted)bfcRestores++});
window.nativeKeys=[];addEventListener('keydown',e=>nativeKeys.push({key:e.key,trusted:e.isTrusted}));</script>
</body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8" } },
  );
});
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  status: "running",
  runId,
  scope: group === "both" ? "full" : "partial",
  selectedGroup: group,
  selectedPlans,
  completedPlans: [],
  expectedChecks: group === "both" ? 18 : group === "compat" ? 4 : 14,
  fullSuitePassed: false,
  startedAt: new Date().toISOString(),
  fixtureUrl,
  checks: [],
  browsers: [],
  systemIme: "本专项不验收操作系统输入法；中文文本提交不计为系统IME证据",
  performance: "原性能预算由既有专项独立执行；本组保留100次真实资源循环，不替代原预算",
};
async function save() {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
async function run(extensionPath, plan) {
  const external = Boolean(externalBrowserUrl);
  let preparation, launchRecord;
  if (external) {
    preparation = JSON.parse(await Deno.readTextFile(preparationPath));
    assert(
      path.resolve(preparation.extensionPath) === extensionPath,
      "外部准备报告与所选构建目录不匹配",
    );
    const buildBytes = await Deno.readFile(preparation.buildReport);
    const build = JSON.parse(new TextDecoder().decode(buildBytes));
    assert(
      await sha256(buildBytes) === preparation.buildReportSha256 &&
        build.planVersion === plan && path.resolve(build.extensionPath) === extensionPath,
      "外部准备报告的构建方案或SHA256不匹配",
    );
    const hashes = await fileHashes(extensionPath);
    assert(
      JSON.stringify(hashes) === JSON.stringify(preparation.extensionFileHashes),
      "外部浏览器使用的冻结构建已变化，不能沿用既有加载实例",
    );
    assert(
      await sha256(new TextEncoder().encode(JSON.stringify(hashes))) ===
        preparation.extensionTreeSha256,
      "外部构建树SHA256不匹配",
    );
    launchRecord = JSON.parse(
      await Deno.readTextFile(preparation.launchRecordPath || preparation.pidRecord),
    );
    assert(
      Number.isInteger(launchRecord.pid) && launchRecord.pid > 0 &&
        launchRecord.configurationSha256 === preparation.configurationSha256,
      "外部启动PID或配置身份不匹配",
    );
    assert(
      await sha256(await Deno.readFile(preparation.configurationPath)) ===
        preparation.configurationSha256,
      "外部启动配置已变化",
    );
    assert(
      await sha256(await Deno.readFile(preparation.executablePath)) ===
        preparation.copiedBinarySha256,
      "外部CFT可执行文件与准备记录不匹配",
    );
  }
  const profile = external
    ? preparation.profile
    : await Deno.makeTempDir({ prefix: "browser-toolbox-ui-cft-" });
  const session = external ? null : await launchCanaryBrowser({
    label: "共享UI",
    plan,
    extensionPath,
    launchOptions: {
      executablePath,
      headless: false,
      userDataDir: profile,
      defaultViewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,1000",
        `--window-position=${Deno.env.get("BROWSER_TOOLBOX_UI_WINDOW_POSITION") || "50,60"}`,
        "--no-proxy-server",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      ],
    },
  });
  const browser = external
    ? await puppeteer.connect({ browserURL: externalBrowserUrl, defaultViewport: null })
    : session.browser;
  const metadata = {
    ...(session?.metadata || {}),
    plan,
    extensionPath,
    profile,
    headed: true,
    version: await browser.version(),
    browserPid: external ? launchRecord.pid : session.pid,
    browserWsEndpoint: browser.wsEndpoint(),
    pageErrors: [],
    mode: external ? "external-cua-background" : session.metadata.mode,
    connection: external ? "borrowed" : session.metadata.connection,
    profileLifecycle: external
      ? "外部独立合成profile；不声称本轮fresh启动"
      : "本轮fresh独立profile",
    ...(external
      ? {
        preparationPath,
        appPath: preparation.appPath,
        keepOpen: "外部浏览器始终保留；本轮创建target在结束时关闭",
        focusHandshakes: [],
      }
      : {}),
  };
  report.browsers.push(metadata);
  let options, page, worker, tabId, id;
  let authorityProbeInstalled = false;
  const ownedTargets = new Map();
  async function newPage() {
    if (!external) return session.newPage();
    const client = await browser.target().createCDPSession();
    try {
      const { targetId } = await client.send("Target.createTarget", {
        url: "about:blank",
        background: true,
        newWindow: false,
      });
      ownedTargets.set(targetId, null);
      const target = await browser.waitForTarget((item) => item._targetId === targetId);
      const created = await target.page();
      assert(created, "后台target没有创建页面");
      ownedTargets.set(targetId, created);
      await created.setViewport({ width: 1280, height: 900 });
      return created;
    } finally {
      await client.detach();
    }
  }
  async function selectFixture() {
    if (!external) return session.activatePage(page, options);
    const selected = await options.evaluate(
      (tabId) => chrome.tabs.update(tabId, { active: true }),
      tabId,
    );
    assert(selected?.id === tabId && selected.active, "未选中本轮fixture标签页");
  }
  async function ensureFixtureFocus(reason) {
    if (!external || await page.evaluate(() => document.hasFocus())) return;
    assert(focusHandshakeDir, "EXTERNAL_NATIVE_FOCUS_REQUIRED：请提供CUA焦点握手目录");
    const directory = path.resolve(focusHandshakeDir);
    assert(
      directory.startsWith(path.join(Deno.cwd(), "local-development") + path.SEPARATOR),
      "CUA握手资料只能放在当前项目local-development中",
    );
    await Deno.mkdir(directory, { recursive: true });
    const requestId = crypto.randomUUID();
    const requestFile = path.join(directory, `${requestId}.request.json`);
    const responseFile = path.join(directory, `${requestId}.response.json`);
    const current = await state();
    const request = {
      runId,
      requestId,
      action: "focus-fixture-top",
      reason,
      plan,
      browserPid: metadata.browserPid,
      appPath: preparation.appPath,
      tabId,
      targetId: [...ownedTargets].find(([, value]) => value === page)?.[0],
      fixtureUrl: page.url(),
      documentId: current.documentId,
      selector: "#heading",
      text: "共享 UI 原生验收",
      createdAt: new Date().toISOString(),
      responseFile,
    };
    await Deno.writeTextFile(requestFile, JSON.stringify(request, null, 2) + "\n", {
      createNew: true,
    });
    console.log(`CUA焦点请求：${requestFile}`);
    const started = Date.now();
    let response;
    while (Date.now() - started < 120000) {
      try {
        response = JSON.parse(await Deno.readTextFile(responseFile));
        break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      await sleep(100);
    }
    assert(
      response?.requestId === requestId && response?.runId === runId &&
        response?.browserPid === metadata.browserPid && response?.source === "cua" &&
        response?.ok === true,
      "CUA焦点握手未得到同一请求/实例的成功回执",
    );
    await wait(() => page.evaluate(() => document.hasFocus()), "CUA操作后fixture仍没有真实焦点");
    assert((await state()).documentId === request.documentId, "CUA焦点握手期间fixture文档被替换");
    metadata.focusHandshakes.push({
      requestFile,
      responseFile,
      requestId,
      reason,
      elapsedMs: Date.now() - started,
      nativeFocusVerified: true,
    });
    await save();
  }
  const check = async (name, action) => {
    console.log(`方案${plan}：开始${name}`);
    const started = performance.now();
    try {
      const data = await action();
      report.checks.push({
        plan,
        name,
        status: "passed",
        durationMs: performance.now() - started,
        ...(data === undefined ? {} : { data }),
      });
      console.log(`方案${plan}：${name} 通过`);
      await save();
    } catch (error) {
      report.checks.push({ plan, name, status: "failed", error: error.message });
      throw error;
    }
  };
  async function inspect(operation = "state", input = {}, frameId = null) {
    return options.evaluate(async ({ operation, input, frameId, tabId }) => {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, ...(frameId == null ? { allFrames: true } : { frameIds: [frameId] }) },
        world: "ISOLATED",
        args: [operation, input],
        func: async (operation, input) => {
          const host = globalThis.BrowserToolboxRuntimeHostInstance;
          if (!host || !location.href.startsWith("http")) return null;
          const controller = globalThis.BrowserToolboxUIControllerInstance;
          const hud = controller?.hud;
          if (operation === "reset") {
            document.activeElement?.blur();
            getSelection().removeAllRanges();
            scrollTo(0, 0);
            return true;
          }
          if (operation === "poison") {
            for (const key of Object.getOwnPropertyNames(UIComponent.prototype)) {
              if (key === "constructor" || typeof UIComponent.prototype[key] !== "function") {
                continue;
              }
              UIComponent.prototype[key] = () => {
                globalThis.syntheticLegacyUiCalls = (globalThis.syntheticLegacyUiCalls || 0) + 1;
                throw new Error("LEGACY_UI_ALGORITHM_FORBIDDEN");
              };
            }
            return true;
          }
          if (operation === "show-hud") {
            await HUD.show(input.text || "合成提示");
            return true;
          }
          if (operation === "hide-hud") {
            HUD.hide(input.immediate === true, false);
            return true;
          }
          if (operation === "hud-reopen") {
            HUD.hide(false, false);
            await HUD.show("本轮新提示");
            return true;
          }
          if (operation === "clipboard-probe") {
            globalThis.syntheticClipboardReceipts = [];
            const original = hud.handleUIComponentMessage.bind(hud);
            hud.handleUIComponentMessage = (event) => {
              if (["clipboardComplete", "pasteResponse"].includes(event.data?.name)) {
                syntheticClipboardReceipts.push({ name: event.data.name, ok: event.data.ok });
              }
              return original(event);
            };
            globalThis.syntheticPasteCallbacks = 0;
            await HUD.pasteFromClipboard(() => syntheticPasteCallbacks++);
            return true;
          }
          if (operation === "prepare-race") {
            const probe = globalThis.syntheticUiProbe = { phase: input.phase, messages: [] };
            const original = controller.send;
            probe.restore = () => {
              controller.send = original;
            };
            controller.send = async (request) => {
              const result = await original(request);
              if (request.kind === "ui" && request.action === input.phase) {
                probe.received = true;
                probe.componentId = result.grant?.componentId || request.payload.componentId;
                await new Promise((resolve) => probe.resume = resolve);
              }
              return result;
            };
            const component = probe.component = new UIComponent();
            probe.own = component instanceof BrowserToolboxUIComponent &&
              !(component instanceof UIComponent);
            probe.loaded = component.load("pages/hud_page.html", "vimium-hud-frame", (event) => {
              probe.messages.push(event.data?.name || event.data);
            });
            probe.shown = component.show({ name: "show", text: "已取消显示不得出现" }, {
              focus: true,
            });
            return true;
          }
          if (operation === "cancel-race") {
            const probe = globalThis.syntheticUiProbe;
            if (input.destroy) probe.component.destroy();
            else await probe.component.hide(false);
            probe.restore();
            probe.resume();
            await probe.loaded;
            probe.showResult = await probe.shown;
            return true;
          }
          if (operation === "finish-race") {
            globalThis.syntheticUiProbe.component.destroy();
            return true;
          }
          if (operation === "stale-hide") {
            const component = Vomnibar.vomnibarUI;
            await component.hide(undefined, input.interactionId);
            return true;
          }
          const probe = globalThis.syntheticUiProbe;
          const component = HUD.hudUI;
          return {
            frameId: host.context.frameId,
            documentId: host.context.documentId,
            epoch: host.runtimeEpoch,
            plan: host.plan.planVersion,
            state: host.state,
            own: Boolean(controller),
            focus: document.hasFocus(),
            active: document.activeElement?.id,
            focusStatus: controller?.focus.status(),
            scrollY,
            components: UIComponent.instances.size,
            componentTypes: [...UIComponent.instances].map((ui) => ({
              own: Boolean(
                globalThis.BrowserToolboxUIComponent && ui instanceof BrowserToolboxUIComponent,
              ),
              legacy: ui instanceof UIComponent,
              showing: ui.showing,
              ready: ui.ready,
              resources: ui.resources?.counts(),
            })),
            hudShowing: Boolean(component?.showing),
            hudReady: Boolean(component?.ready),
            find: Mode.modes.some((mode) => mode.name === "find"),
            findSession: hud?.findMode?.sessionId,
            query: FindMode.query?.rawQuery,
            modes: Mode.modes.map((mode) => mode.name),
            handlers: handlerStack.stack.length,
            vomnibar: Boolean(Vomnibar.vomnibarUI?.showing),
            interactionId: Vomnibar.vomnibarUI?.interactionId,
            resources: host.getDiagnostics().resources,
            observers: Object.fromEntries(
              [...host.observers].map(([key, value]) => [key, value.size]),
            ),
            clipboardRequests: hud?.clipboardRequests.size,
            pendingFindExit: Boolean(hud?.pendingFindExit),
            clipboardReceipts: globalThis.syntheticClipboardReceipts || [],
            pasteCallbacks: globalThis.syntheticPasteCallbacks || 0,
            legacyCalls: globalThis.syntheticLegacyUiCalls || 0,
            probe: probe
              ? {
                phase: probe.phase,
                received: probe.received,
                own: probe.own,
                componentId: probe.componentId,
                showResult: probe.showResult,
                disposed: probe.component.disposed,
                showing: probe.component.showing,
                connected: probe.component.iframeElement?.isConnected,
                resourceCount: probe.component.resources.counts(),
                messages: probe.messages,
              }
              : null,
          };
        },
      });
      return rows.filter((row) => row.result).map((row) => ({
        ...row.result,
        nativeDocumentId: row.documentId,
        nativeFrameId: row.frameId,
      }));
    }, { operation, input, frameId, tabId });
  }
  const state = async (frameId = 0) => (await inspect("state", {}, frameId))[0];
  const ready = () =>
    wait(async () => {
      const rows = await inspect();
      return rows.length === 3 && rows.every((row) => row.state === "active" && row.plan === plan);
    }, "三个原生文档没有就绪");
  const idle = () =>
    wait(
      async () =>
        (await inspect()).every((row) => !row.components && !row.find && !row.pendingFindExit),
      "自然退出后UI资源没有释放",
    );
  const componentFrame = (name) =>
    page.frames().find((frame) =>
      frame.url().split("?")[0] === `chrome-extension://${id}/pages/${name}_page.html`
    );
  const childFrame = () =>
    page.frames().find((frame) => new URL(frame.url()).pathname === "/child");
  async function reset() {
    await idle();
    await inspect("reset");
    await selectFixture();
    await ensureFixtureFocus("reset-before-case");
    await page.click("#heading");
  }
  async function openFind(frame = page) {
    await frame.click("#heading");
    await page.keyboard.press("/");
    await wait(async () => {
      const hud = componentFrame("hud");
      return hud &&
        await hud.evaluate(() =>
          document.hasFocus() && document.activeElement?.id === "hud-find-input"
        );
    }, "真实Find未获得输入焦点");
  }
  async function closeFind() {
    await page.keyboard.press("Escape");
    await idle();
  }
  async function openVomnibar() {
    await page.keyboard.press("o");
    await wait(async () => {
      const frame = componentFrame("vomnibar");
      return (await state()).vomnibar && frame &&
        await frame.evaluate(() =>
          document.hasFocus() && document.activeElement?.tagName === "INPUT"
        );
    }, "真实Vomnibar未获得输入焦点");
  }
  async function focusIndex(index) {
    await page.keyboard.type("gf");
    await wait(async () => {
      const rows = await inspect();
      return rows.filter((row) => row.focus && row.active !== "child").some((row) =>
        row.frameId === index
      );
    }, "gf未到达预期框架");
  }
  try {
    if (external) {
      const client = await browser.target().createCDPSession();
      try {
        const [commandLine, processes] = await Promise.all([
          client.send("Browser.getBrowserCommandLine"),
          client.send("SystemInfo.getProcessInfo"),
        ]);
        const actualPid = processes.processInfo.find((process) => process.type === "browser")?.id;
        assert(
          actualPid === launchRecord.pid &&
            commandLine.arguments.includes(`--user-data-dir=${preparation.profile}`) &&
            commandLine.arguments.includes(`--load-extension=${extensionPath}`) &&
            !commandLine.arguments.some((argument) => argument.startsWith("--headless")) &&
            metadata.version.endsWith("/" + preparation.cftVersion),
          "CDP实际浏览器PID、profile、构建目录或headed CFT版本与准备记录不匹配",
        );
        metadata.externalIdentityVerified = true;
        metadata.extensionTreeSha256 = preparation.extensionTreeSha256;
      } finally {
        await client.detach();
      }
    }
    if (!external) id = metadata.extensionId = await resolveCanaryExtensionId(browser);
    // CUA 自身也有扩展 worker；借用实例休眠时只从唯一产品页面恢复扩展身份。
    else {await wait(() => {
        const identities = browser.targets().flatMap((target) => {
          let url;
          try {
            url = new URL(target.url());
          } catch {
            return [];
          }
          if (url.protocol !== "chrome-extension:") return [];
          const mainWorker = target.type() === "service_worker" &&
            url.pathname === "/background_scripts/main.js";
          const productPage = external && target.type() === "page" &&
            ["/pages/onboarding.html", "/pages/mouse_options.html"].includes(url.pathname);
          return mainWorker || productPage ? [{ id: url.host, url: target.url() }] : [];
        });
        const ids = [...new Set(identities.map((identity) => identity.id))];
        assert(ids.length <= 1, "发现多个产品扩展身份，不能确定待测实例");
        if (!ids.length) return false;
        id = metadata.extensionId = ids[0];
        metadata.extensionIdentityTargets = identities.map((identity) => identity.url);
        return true;
      }, "没有找到唯一产品main.js worker或借用实例的产品页面");}
    options = await newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const configured = await options.evaluate(async () => {
      globalThis.syntheticTopNavigations = [];
      chrome.webNavigation.onCommitted.addListener((event) => {
        if (!event.frameId) syntheticTopNavigations.push({ tabId: event.tabId, url: event.url });
      });
      return chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: { legacyPatch: { smoothScroll: false, grabBackFocus: false, regexFindMode: false } },
      });
    });
    assert(configured.ok, "合成设置提交失败");
    const workerUrl = `chrome-extension://${id}/background_scripts/main.js`;
    const workerTarget = await browser.waitForTarget((target) =>
      target.type() === "service_worker" && target.url() === workerUrl
    );
    worker = await workerTarget.worker();
    metadata.workerUrl = workerUrl;
    page = await newPage();
    page.on("pageerror", (error) => metadata.pageErrors.push(error.message));
    await page.goto(fixtureUrl);
    tabId = metadata.fixtureTabId = (await options.evaluate(() => chrome.tabs.query({})))
      .find((tab) => tab.url === fixtureUrl).id;
    await ready();
    await selectFixture();
    await ensureFixtureFocus("initial-fixture");
    const nativeFrames = await options.evaluate(
      (tabId) => chrome.webNavigation.getAllFrames({ tabId }),
      tabId,
    );
    let childId = nativeFrames.find((frame) => new URL(frame.url).pathname === "/child").frameId;
    const tinyId = nativeFrames.find((frame) => new URL(frame.url).pathname === "/tiny").frameId;
    if (plan === canaryPlan) await inspect("poison");
    await check("原生方案身份、独立组件所有权和HUD可见文本", async () => {
      await reset();
      await inspect("show-hud", { text: "合成中文提示" }, 0);
      await wait(async () =>
        componentFrame("hud") &&
        await componentFrame("hud").evaluate(() =>
          document.getElementById("hud")?.textContent === "合成中文提示"
        )
      );
      const current = await state();
      assert(current.own === (plan === canaryPlan), "方案共享UI所有者错误");
      assert(
        current.componentTypes.length === 1 &&
          current.componentTypes.every((item) =>
            item.own === (plan === canaryPlan) && item.legacy === (plan === 7)
          ),
        "组件调用了错误实现",
      );
      await inspect("hide-hud", { immediate: true }, 0);
      await idle();
      return { componentTypes: current.componentTypes, legacyCalls: current.legacyCalls };
    });
    await check("主子Find与Vomnibar退出后归还焦点且j只滚动源框架", async () => {
      const results = [];
      for (const source of [0, childId]) {
        for (const kind of ["find", "vomnibar"]) {
          await reset();
          const frame = source ? childFrame() : page;
          await frame.click("#heading");
          if (kind === "find") await openFind(frame);
          else await openVomnibar();
          await page.keyboard.press("Escape");
          await idle();
          await wait(
            async () =>
              (await state(source)).focus && (source || (await state()).active !== "child"),
            "退出后原生焦点没有归还源文档",
          );
          await page.keyboard.press("j");
          await wait(async () => (await state(source)).scrollY === 60, "j没有滚动源文档60px");
          assert((await state(source ? 0 : childId)).scrollY === 0, "j滚动了其他框架");
          results.push({ source, kind, scrollY: (await state(source)).scrollY });
        }
      }
      await reset();
      return results;
    });
    await check("真实gf、count循环及过小框架过滤", async () => {
      await reset();
      await focusIndex(childId);
      await focusIndex(0);
      await page.keyboard.type("2gf");
      await sleep(250);
      assert(
        (await state()).active !== "child" && !(await state(tinyId)).focus,
        "2gf未循环回原框架或错误聚焦过小框架",
      );
      await page.keyboard.type("3gf");
      await wait(async () => (await state(childId)).focus, "3gf未按可用框架数量循环");
      await focusIndex(0);
      if (plan === canaryPlan) {
        assert((await state(tinyId)).focusStatus.focusable === false, "过小框架仍可聚焦");
      }
      await wait(async () => (await inspect()).every((row) => !row.components));
      return {
        childId,
        tinyId,
        counts: [1, 2, 3],
        nativeKeys: await page.evaluate(() => nativeKeys),
      };
    });
    await check(
      plan === 7
        ? "冻结方案7记录Vomnibar源框架替换后的原生归焦行为"
        : "Vomnibar源框架替换后Esc不得归焦到新的原生文档",
      async () => {
        await reset();
        await childFrame().click("#heading");
        await openVomnibar();
        const before = await state(childId);
        await page.evaluate(() =>
          document.getElementById("child").src = "/child?source-replaced=1"
        );
        await wait(async () =>
          (await state(childId)).state === "active" &&
          (await state(childId)).documentId !== before.documentId, "源框架没有实际替换Native文档");
        const replaced = await state(childId);
        assert(!replaced.focus && (await state()).vomnibar, "源框架替换前置条件没有保持组件焦点");
        await page.keyboard.press("Escape");
        await idle();
        await sleep(100);
        const after = await state(childId);
        const result = { before, replaced, after, refocusedReplacement: after.focus };
        metadata.replacedSourceFocus = result;
        if (plan === canaryPlan) assert(!after.focus, "旧UI会话把焦点归还给同frameId的新文档");
        await page.reload();
        await ready();
        if (plan === canaryPlan) await inspect("poison");
        const frames = await options.evaluate(
          (tabId) => chrome.webNavigation.getAllFrames({ tabId }),
          tabId,
        );
        childId = frames.find((frame) => new URL(frame.url).pathname === "/child").frameId;
        return result;
      },
    );
    if (plan === 7) return;
    await worker.evaluate(() => {
      const prototype = BrowserToolboxDocumentAuthority.prototype;
      const original = prototype.authorize;
      globalThis.syntheticOriginalAuthorize = original;
      prototype.authorize = function (...args) {
        globalThis.syntheticAuthority = this;
        return original.apply(this, args);
      };
    });
    authorityProbeInstalled = true;
    await check("Native授权回包晚于销毁时未消费grant与全部组件资源撤销", async () => {
      await reset();
      await inspect("prepare-race", { phase: "authorize" }, 0);
      await wait(async () => (await state()).probe?.received);
      const before = (await state()).probe;
      const liveGrant = await worker.evaluate(
        (componentId) =>
          [...syntheticAuthority.grants.values()].some((grant) =>
            grant.componentId === componentId
          ),
        before.componentId,
      );
      assert(liveGrant, "没有建立真实待消费Native授权");
      await inspect("cancel-race", { destroy: true }, 0);
      await wait(
        () =>
          worker.evaluate(
            (componentId) =>
              ![...syntheticAuthority.grants.values()].some((grant) =>
                grant.componentId === componentId
              ),
            before.componentId,
          ),
        "销毁后真实未消费grant仍残留",
      );
      const after = (await state()).probe;
      assert(
        after.own && after.disposed && !after.showResult && !after.connected &&
          !Object.keys(after.resourceCount).length,
        "迟到授权使组件复活或遗留资源",
      );
      await idle();
      return { liveGrant, after, fault: "真实authorize回包在测试层挂起" };
    });
    await check("Native握手中hide取消待显示且重复ready不增加观察者", async () => {
      await reset();
      await inspect("prepare-race", { phase: "attest" }, 0);
      await wait(async () => (await state()).probe?.received);
      await inspect("cancel-race", {}, 0);
      const after = (await state()).probe;
      assert(!after.showResult && !after.showing && !after.disposed, "hide未取消握手期间的show");
      const result = await options.evaluate(async (tabId) => {
        const [row] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: "ISOLATED",
          func: () => {
            const component = syntheticUiProbe.component, host = BrowserToolboxRuntimeHostInstance;
            const count = () =>
              [...host.observers.values()].reduce((sum, set) => sum + set.size, 0);
            const before = count();
            component.receive(
              { data: { name: "uiComponentIsReady" } },
              component.messageChannelPorts[0],
            );
            return { ready: component.ready, before, after: count() };
          },
        });
        return row.result;
      }, tabId);
      assert(result.ready && result.before === result.after, "重复ready创建重复观察者");
      await inspect("finish-race", {}, 0);
      await idle();
      return {
        after,
        duplicateReady: result,
        fault: "真实attest回包挂起；重复ready为协议边界注入",
      };
    });
    await check("HUD渐隐期间重开和Find旧会话迟到消息不关闭新交互", async () => {
      await reset();
      await inspect("show-hud", {}, 0);
      await inspect("hud-reopen", {}, 0);
      await sleep(220);
      assert(
        (await state()).hudShowing &&
          await componentFrame("hud").evaluate(() =>
            document.getElementById("hud").textContent === "本轮新提示"
          ),
        "旧渐隐结束关闭了新提示",
      );
      await inspect("hide-hud", { immediate: true }, 0);
      await idle();
      await openFind();
      const previous = (await state()).findSession;
      await page.keyboard.press("Escape");
      await page.keyboard.press("/");
      await wait(async () =>
        (await state()).find && (await state()).findSession !== previous &&
        componentFrame("hud") && await componentFrame("hud").evaluate(() =>
          document.activeElement?.id === "hud-find-input"
        )
      );
      await options.evaluate(async ({ tabId, previous }) =>
        chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: "ISOLATED",
          args: [previous],
          func: (previous) => {
            HUD.search({ query: "旧会话不能覆盖", findSessionId: previous });
            HUD.hideFindMode({ exitEventIsEscape: true, findSessionId: previous });
          },
        }), { tabId, previous });
      await page.keyboard.type("alpha");
      await wait(async () => (await state()).query === "alpha");
      assert((await state()).find, "旧会话消息关闭了新Find");
      await closeFind();
      await openVomnibar();
      const oldInteraction = (await state()).interactionId;
      await page.keyboard.press("Escape");
      // 旧新页面均异步发送 hide；先证明按键收件焦点已归还，再注入旧交互的迟到退出消息。
      await idle();
      await wait(async () => (await state()).focusStatus?.focused,
        "Vomnibar退出后源框架没有恢复实际焦点");
      await openVomnibar();
      await inspect("stale-hide", { interactionId: oldInteraction }, 0);
      assert(
        (await state()).vomnibar && (await state()).interactionId !== oldInteraction,
        "旧组件退出消息关闭了新Vomnibar",
      );
      await page.keyboard.press("Escape");
      await idle();
    });
    await check("剪贴板拒绝经真实私有端口回执并立即释放租约", async () => {
      await reset();
      await inspect("show-hud", {}, 0);
      await wait(async () => (await state()).hudReady && componentFrame("hud"));
      await componentFrame("hud").evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            readText: () => Promise.reject(new DOMException("合成拒绝", "NotAllowedError")),
            writeText: () => Promise.reject(new DOMException("合成拒绝", "NotAllowedError")),
          },
        })
      );
      const started = performance.now();
      await inspect("clipboard-probe", {}, 0);
      await wait(
        async () =>
          (await state()).clipboardReceipts.some((item) =>
            item.name === "clipboardComplete" && item.ok === false
          ),
        "拒绝没有返回clipboardComplete",
        2000,
      );
      const current = await state();
      assert(
        current.clipboardRequests === 0 && current.pasteCallbacks === 0,
        "拒绝仍占用剪贴板租约或调用了成功回调",
      );
      await inspect("hide-hud", { immediate: true }, 0);
      await idle();
      return {
        receipts: current.clipboardReceipts,
        elapsedMs: performance.now() - started,
        fault: "真实HUD iframe中的Clipboard API Promise拒绝；不冒充系统权限拒绝",
      };
    });
    await check("旧HUD剪贴板等待任务不能抢走新Vomnibar的实际输入焦点", async () => {
      await reset();
      await inspect("show-hud", {}, 0);
      await wait(async () => (await state()).hudReady && componentFrame("hud"));
      const hudFrame = componentFrame("hud");
      await hudFrame.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            readText: () => Promise.reject(new DOMException("合成拒绝", "NotAllowedError")),
            writeText: () => Promise.reject(new DOMException("合成拒绝", "NotAllowedError")),
          },
        });
        const original = globalThis.setTimeout;
        globalThis.setTimeout = function (callback, delay, ...args) {
          if (delay !== 17 || globalThis.syntheticClipboardGate) {
            return original(callback, delay, ...args);
          }
          const timer = original(() => {}, 10000);
          globalThis.syntheticClipboardGate = {
            held: true,
            release() {
              clearTimeout(timer);
              globalThis.setTimeout = original;
              this.held = false;
              callback(...args);
            },
          };
          return timer;
        };
      });
      await inspect("clipboard-probe", {}, 0);
      await wait(
        () => hudFrame.evaluate(() => globalThis.syntheticClipboardGate?.held),
        "没有挂起真实HUD剪贴板等待任务",
      );
      await openVomnibar();
      const before = await state();
      await hudFrame.evaluate(() => syntheticClipboardGate.release());
      await wait(
        async () => (await state()).clipboardRequests === 0,
        "迟到剪贴板任务没有完成释放",
        2000,
      );
      await sleep(60);
      const after = await state();
      const inputFocused = Boolean(componentFrame("vomnibar")) &&
        await componentFrame("vomnibar").evaluate(() =>
          document.hasFocus() && document.activeElement?.tagName === "INPUT"
        );
      metadata.clipboardFocusRace = { before, after, inputFocused };
      assert(after.vomnibar && inputFocused, "旧HUD剪贴板任务抢走新Vomnibar焦点或使其关闭");
      await page.keyboard.press("Escape");
      await inspect("hide-hud", { immediate: true }, 0);
      await idle();
      return { before, after, inputFocused, fault: "仅延迟真实HUD的17ms等待，再拒绝Clipboard API" };
    });
    await check("100次真实Find开关后组件、授权、观察者与模式无净增", async () => {
      await reset();
      const before = await inspect();
      const records = () =>
        options.evaluate(async (tabId) => {
          const rows = (await chrome.storage.session.get("browserToolboxRuntimeDocuments"))
            .browserToolboxRuntimeDocuments?.documents || [];
          return rows.filter((row) => row.tabId === tabId && row.component).length;
        }, tabId);
      assert(await records() === 0, "循环前仍有组件授权");
      for (let index = 0; index < 100; index++) {
        await openFind();
        await page.keyboard.type("alpha");
        await wait(async () => (await state()).query === "alpha");
        await closeFind();
        if ((index + 1) % 20 === 0) console.log(`方案8：Find资源循环 ${index + 1}/100`);
      }
      await wait(async () => await records() === 0, "循环后组件授权残留");
      const after = await inspect();
      for (const current of after) {
        const prior = before.find((row) => row.frameId === current.frameId);
        assert(
          current.components === 0 && current.handlers === prior.handlers &&
            JSON.stringify(current.modes) === JSON.stringify(prior.modes) &&
            JSON.stringify(current.resources) === JSON.stringify(prior.resources) &&
            JSON.stringify(current.observers) === JSON.stringify(prior.observers),
          "100次后资源净增长",
        );
      }
      assert(
        !page.frames().some((frame) => frame.url().startsWith(`chrome-extension://${id}/`)),
        "100次后隐藏扩展iframe残留",
      );
      return { iterations: 100, before, after, componentAuthorizations: await records() };
    });
    async function frameRace(kind) {
      await reset();
      if (kind === "source") await childFrame().click("#heading");
      await worker.evaluate(() => {
        const prototype = BrowserToolboxFrameFocusService.prototype;
        const originalSend = prototype.send, originalNext = prototype.next;
        const race = globalThis.syntheticFrameRace = {
          statuses: [],
          focusSends: [],
          errors: [],
          done: false,
        };
        const gate = new Promise((resolve) => race.release = resolve);
        race.timer = setTimeout(() => {
          race.expired = true;
          race.release();
        }, 12000);
        prototype.send = async function (tabId, identity, message) {
          if (message.handler === "focusFrame") {
            race.focusSends.push({ documentId: identity.documentId });
          }
          const value = await originalSend.call(this, tabId, identity, message);
          if (message.handler === "getFocusStatus") {
            const frames = await chrome.webNavigation.getAllFrames({ tabId });
            const native = frames.find((frame) => frame.documentId === identity.documentId);
            race.statuses.push({
              frameId: native?.frameId,
              documentId: identity.documentId,
              status: value,
            });
            await gate;
          }
          return value;
        };
        prototype.next = async function (...args) {
          try {
            return await originalNext.apply(this, args);
          } catch (error) {
            race.errors.push(error.code || error.message);
            throw error;
          } finally {
            race.done = true;
          }
        };
        race.restore = () => {
          clearTimeout(race.timer);
          prototype.send = originalSend;
          prototype.next = originalNext;
        };
      });
      const read = () =>
        worker.evaluate(() => ({
          statuses: syntheticFrameRace.statuses,
          focusSends: syntheticFrameRace.focusSends,
          errors: syntheticFrameRace.errors,
          done: syntheticFrameRace.done,
          expired: Boolean(syntheticFrameRace.expired),
        }));
      try {
        await page.keyboard.type("gf");
        await wait(
          async () => (await read()).statuses.length === 3,
          "没有捕获三个真实原生焦点状态",
        );
        const before = await read();
        if (kind === "target") {
          await page.evaluate(() => document.getElementById("child").src = "/child-replaced");
          await wait(
            async () =>
              (await state(childId)).state === "active" &&
              (await state(childId)).documentId !==
                before.statuses.find((row) => row.frameId === childId).documentId,
            "目标框架未真正导航替换原生documentId",
          );
        } else await page.evaluate(() => document.getElementById("child").remove());
        await worker.evaluate(() => syntheticFrameRace.release());
        await wait(async () => (await read()).done, "失效焦点请求未结束");
        const after = await read();
        assert(
          !after.expired && after.errors.length === 1 &&
            after.errors[0] === "STALE_DOCUMENT" &&
            after.focusSends.length === 0,
          "框架身份失效仍交付了焦点，或测试没有捕获失效拒绝",
        );
        return { kind, before, after, fault: "真实Native状态读取后挂起回复，再实际导航/移除文档" };
      } finally {
        await worker.evaluate(() => {
          syntheticFrameRace.release();
          syntheticFrameRace.restore();
        });
        await page.reload();
        await ready();
        await inspect("poison");
        const frames = await options.evaluate(
          (tabId) => chrome.webNavigation.getAllFrames({ tabId }),
          tabId,
        );
        childId = frames.find((frame) => new URL(frame.url).pathname === "/child").frameId;
      }
    }
    await check("gf读取后目标frame导航替换不能接收旧焦点", () => frameRace("target"));
    await check("gf读取后来源frame销毁不得移动任何目标焦点", () => frameRace("source"));
    for (const kind of ["Find", "Hints"]) {
      await check(`${kind}退出后Vomnibar一次Enter与真实主子BFCache恢复`, async () => {
        await reset();
        if (kind === "Find") {
          await openFind();
          await page.keyboard.type("alpha");
        } else {
          await page.keyboard.press("f");
          await wait(
            async () =>
              (await inspect()).some((row) =>
                row.modes.some((name) => name.startsWith("hint")) && row.hudShowing
              ),
            "没有实际显示Hints和HUD",
          );
        }
        await page.keyboard.press("Escape");
        await idle();
        const target = fixtureUrl.replace("127.0.0.1", "localhost").replace(
          "/fixture",
          `/target-${kind}`,
        );
        const client = await page.createCDPSession(), notUsed = [];
        await client.send("Page.enable");
        client.on("Page.backForwardCacheNotUsed", (event) => notUsed.push(event));
        try {
          await openVomnibar();
          await page.keyboard.type(target);
          await wait(async () =>
            componentFrame("vomnibar") &&
            await componentFrame("vomnibar").evaluate(
              (target) => document.querySelector("input")?.value === target,
              target,
            )
          );
          const before = await inspect(), persistedBefore = await page.evaluate(() => bfcRestores);
          const offset = await options.evaluate(() => syntheticTopNavigations.length);
          const navigation = page.waitForNavigation({ waitUntil: "load", timeout: 12000 });
          navigation.catch(() => {});
          await page.keyboard.press("Enter");
          await navigation;
          assert(page.url() === target, "Enter未到达合成本地跨站目标");
          const submissions = await options.evaluate(
            ({ offset, tabId }) =>
              syntheticTopNavigations.slice(offset).filter((row) => row.tabId === tabId),
            { offset, tabId },
          );
          assert(
            submissions.filter((row) => row.url === target).length === 1,
            "Enter发生重复Native导航",
          );
          await page.goBack({ waitUntil: "domcontentloaded" });
          await ready();
          await idle();
          const after = await inspect(), persisted = await page.evaluate(() => bfcRestores);
          assert(
            persisted === persistedBefore + 1 && !notUsed.length &&
              after.length === before.length &&
              after.every((row) => {
                const prior = before.find((item) => item.frameId === row.frameId);
                return prior?.documentId === row.documentId &&
                  row.documentId === row.nativeDocumentId &&
                  prior.nativeDocumentId === row.nativeDocumentId && row.epoch > prior.epoch &&
                  !row.components;
              }),
            "没有真实恢复所有原生文档、推进代次或清理旧组件",
          );
          await openFind();
          await closeFind();
          await openVomnibar();
          await page.keyboard.press("Escape");
          await idle();
          await page.keyboard.press("j");
          await wait(async () => (await state()).scrollY > 0);
          return { before, after, persistedBefore, persisted, notUsed, submissions, target };
        } finally {
          await client.detach();
        }
      });
    }
    metadata.finalState = await inspect();
    assert(metadata.finalState.every((row) => row.legacyCalls === 0), "新组件调用了旧UI算法");
    assert(metadata.pageErrors.length === 0, "页面发生未捕获异常");
    await worker.evaluate(() => {
      BrowserToolboxDocumentAuthority.prototype.authorize = syntheticOriginalAuthorize;
      delete globalThis.syntheticAuthority;
    });
    authorityProbeInstalled = false;
    if (plan === canaryPlan && keepOpen && !external) {
      await page.reload();
      await ready();
      await reset();
      metadata.deliveryState = await inspect();
      metadata.testEntry = fixtureUrl;
      await session.disconnect();
    }
  } catch (error) {
    // 先保存原始失败；进程收尾异常不能覆盖尚未进入断言时的真正阻塞。
    metadata.runError = error.stack || error.message;
    metadata.failureTargets = browser.targets().map((target) => ({
      type: target.type(),
      url: target.url(),
    }));
    metadata.failureState = await inspect().catch(() => null);
    if (page && reportPath) {
      const screenshotPath = `${reportPath}.plan-${plan}-failure.png`;
      await page.screenshot({ path: screenshotPath }).then(() => {
        metadata.failureScreenshot = screenshotPath;
      }).catch(() => {});
    }
    throw error;
  } finally {
    if (external) {
      if (authorityProbeInstalled) {
        await worker.evaluate(() => {
          BrowserToolboxDocumentAuthority.prototype.authorize = syntheticOriginalAuthorize;
          delete globalThis.syntheticAuthority;
        }).catch((error) => metadata.probeCleanupError = error.message);
      }
      const client = await browser.target().createCDPSession().catch(() => null);
      metadata.closedTargets = [];
      if (client) {
        try {
          for (const targetId of ownedTargets.keys()) {
            const result = await client.send("Target.closeTarget", { targetId }).catch(() => null);
            metadata.closedTargets.push({ targetId, success: result?.success === true });
          }
        } finally {
          await client.detach().catch(() => {});
        }
      }
      await browser.disconnect();
      metadata.externalBrowserRetained = true;
    } else if (!(plan === canaryPlan && keepOpen && metadata.testEntry)) {
      try {
        await session.close();
        await Deno.remove(profile, { recursive: true });
      } catch (error) {
        metadata.cleanupError = error.stack || error.message;
        if (!metadata.runError) throw error;
      }
    }
  }
}
try {
  for (const plan of selectedPlans) {
    await run(path.resolve(plan === 7 ? compatPath : canaryPath), plan);
    report.completedPlans.push(plan);
  }
  assert(
    report.checks.length === report.expectedChecks &&
      report.checks.every((check) => check.status === "passed"),
    "所选组没有完整执行全部既定断言",
  );
  report.status = "passed";
  report.fullSuitePassed = group === "both";
} catch (error) {
  report.status = "failed";
  report.error = error.stack || error.message;
  console.error(report.error);
  Deno.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await save();
  if (!(!externalBrowserUrl && keepOpen && group !== "compat" && report.status === "passed")) {
    await server.shutdown();
  }
}
