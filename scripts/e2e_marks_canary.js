// SPDX-License-Identifier: GPL-3.0-or-later
// 全部 URL、标记和 profile 均为本轮合成资料；原生浏览器测试不冒充系统输入法验收。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { launchCanaryBrowser, resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_MARKS_COMPAT_PATH");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_MARKS_REPORT");
const canaryPlan = Number(Deno.env.get("BROWSER_TOOLBOX_MARKS_PLAN_VERSION") || 7);
if (![7, 8, 9].includes(canaryPlan)) throw new Error("未登记的标记测试方案");
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_MARKS_KEEP_OPEN") === "true";
if (!compatPath || !canaryPath) throw new Error("必须提供冻结方案6及独立方案7目录");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
async function wait(predicate, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await predicate()) return;
    } catch (_) { /* 导航/扩展重启期间暂时没有上下文。 */ }
    await sleep(30);
  }
  throw new Error(label);
}
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const child = new URL(request.url).pathname === "/child";
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>独立标记验收</title><body style="min-height:18000px;font:16px sans-serif"><h1 id="heading">独立标记验收</h1><p>m 后按小写创建页面标记，Shift+字母创建全局标记；反引号后按寄存器跳转，Esc退出。</p><input id="input" aria-label="合成输入框"><div id="target" style="margin-top:40px">中文目标</div>${
      child
        ? ""
        : '<iframe id="child" src="/child" title="合成子框架" style="width:550px;height:220px"></iframe>'
    }<script>window.bfcRestores=0;addEventListener('pageshow',e=>{if(e.persisted)bfcRestores++});window.nativeKeys=0;addEventListener('keydown',()=>nativeKeys++);</script></body></html>`,
    { headers: { "content-type": "text/html;charset=utf-8" } },
  );
});
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  fixtureUrl,
  browsers: [],
  checks: [],
  frozenDefects: [],
  systemIme: "本组不验收操作系统输入法",
};
async function save() {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
async function run(extensionPath, plan) {
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-marks-cft-" });
  const session = await launchCanaryBrowser({
    label: "Marks",
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
        "--window-position=1960,213",
        "--no-proxy-server",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      ],
    },
  });
  const { browser } = session;
  const metadata = {
    plan,
    extensionPath,
    profile,
    browserPid: session.pid,
    browserSession: session.metadata,
    browserWsEndpoint: browser.wsEndpoint(),
    version: await browser.version(),
    headed: true,
  };
  report.browsers.push(metadata);
  let options, page, tabId, id;
  const check = async (name, action) => {
    console.log(`方案${plan}：开始${name}`);
    const start = performance.now();
    try {
      const data = await action();
      report.checks.push({
        plan,
        name,
        status: "passed",
        durationMs: performance.now() - start,
        ...(data ? { data } : {}),
      });
      console.log(`方案${plan}：${name} 通过`);
      await save();
    } catch (error) {
      report.checks.push({ plan, name, status: "failed", error: error.message });
      throw error;
    }
  };
  const tabs = () => options.evaluate(() => chrome.tabs.query({}));
  async function call(operation = "state", input = {}, targetTab = tabId, frameId = 0) {
    return options.evaluate(async ({ operation, input, targetTab, frameId }) => {
      const rows = await chrome.scripting.executeScript({
        target: { tabId: targetTab, frameIds: [frameId] },
        world: "ISOLATED",
        args: [operation, input],
        func: async (operation, input) => {
          const host = globalThis.BrowserToolboxRuntimeHostInstance;
          const identity = {
            documentId: host?.context.documentId,
            runtimeEpoch: host?.runtimeEpoch,
            incognito: host?.context.incognito === true,
          };
          const marks = globalThis.BrowserToolboxMarksControllerInstance;
          if (operation === "reset") {
            document.activeElement?.blur();
            getSelection().removeAllRanges();
            scrollTo(0, input.y ?? 0);
            return true;
          }
          if (operation === "poison") {
            for (
              const name of [
                "activateCreateMode",
                "activateGotoMode",
                "exit",
                "showMessage",
                "getMarkString",
                "getLocationKey",
                "isGlobalMark",
              ]
            ) {
              Marks[name] = () => {
                globalThis.syntheticLegacyMarkCalls = (globalThis.syntheticLegacyMarkCalls || 0) +
                  1;
                throw new Error("LEGACY_MARKS_FORBIDDEN");
              };
            }
            return true;
          }
          if (operation === "local") {
            return localStorage.getItem(`vimiumMark|${location.href.split("#")[0]}|${input.name}`);
          }
          if (operation === "corrupt") {
            localStorage.setItem(
              `vimiumMark|${location.href.split("#")[0]}|${input.name}`,
              "{broken",
            );
            return true;
          }
          if (operation === "request") {
            const message = input.message ||
              BrowserToolboxMessageProtocol.envelope(
                "lifecycle",
                "marks",
                input.payload,
                input.identity || identity,
              );
            globalThis.syntheticLastMarkMessage = message;
            return { message, result: await chrome.runtime.sendMessage(message) };
          }
          if (operation === "replay") {
            return chrome.runtime.sendMessage(globalThis.syntheticLastMarkMessage);
          }
          if (operation === "legacy") {
            return chrome.runtime.sendMessage({ handler: input.handler, markName: input.name });
          }
          if (operation === "command") {
            const invocation = BrowserToolboxCommandInvocation.createV2(
              input.name,
              input.options || {},
              { type: "keyboard" },
              { sourceFrameId: host.context.frameId },
              1,
              { identity },
            );
            return BrowserToolboxPageCommandExecutorInstance.invoke(invocation);
          }
          return {
            identity,
            plan: host?.plan.planVersion,
            state: host?.state,
            scrollY,
            own: Boolean(marks),
            mode: marks?.mode?.modeIsActive
              ? marks.mode.name
              : Marks.mode?.modeIsActive
              ? Marks.mode.name
              : null,
            modes: Mode.modes.map((mode) => mode.name),
            components: UIComponent.instances.size,
            focus: document.activeElement?.tagName,
            legacyCalls: globalThis.syntheticLegacyMarkCalls || 0,
            ignoreKeyboardLayout: Settings.get("ignoreKeyboardLayout"),
            resources: host?.getDiagnostics(),
          };
        },
      });
      return rows[0]?.result;
    }, { operation, input, targetTab, frameId });
  }
  const ready = (target = tabId) =>
    wait(async () => {
      const state = await call("state", {}, target);
      return state?.state === "active" && state.plan === plan;
    }, "等待标记运行时就绪超时");
  const press = async (keys, target = page) => {
    for (const value of keys) {
      if (/^[A-Z]$/.test(value)) {
        await target.keyboard.down("Shift");
        await target.keyboard.press(value);
        await target.keyboard.up("Shift");
      } else await target.keyboard.press(value);
    }
  };
  const create = (key, target = page) => press(["m", key], target);
  const goto = (key, target = page) => press(["`", key], target);
  const settle = () => wait(async () => (await call()).components === 0, "标记HUD未自然释放", 10000);
  try {
    id = metadata.extensionId = await resolveCanaryExtensionId(browser);
    options = await session.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const result = await options.evaluate(async () => {
      await BrowserToolboxConfigurationClientInstance.read();
      return chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: {
          legacyPatch: {
            smoothScroll: false,
            grabBackFocus: false,
            keyMappings: "map zc Marks.activateCreateMode swap\nmap zg Marks.activateGotoMode swap",
          },
        },
      });
    });
    assert(result.ok, "合成配置失败");
    page = await session.newPage();
    await page.goto(fixtureUrl);
    await session.activatePage(page, options);
    tabId = metadata.fixtureTabId = (await tabs()).find((tab) => tab.url === fixtureUrl).id;
    await ready();
    await wait(
      async () =>
        (await options.evaluate((tabId) => chrome.webNavigation.getAllFrames({ tabId }), tabId))
          .length === 2,
      "子框架尚未就绪",
    );
    const childFrameId = metadata.childFrameId = (await options.evaluate((tabId) =>
      chrome.webNavigation.getAllFrames({ tabId }), tabId)).find((frame) =>
        frame.frameId !== 0
      ).frameId;
    await wait(
      async () => (await call("state", {}, tabId, childFrameId))?.state === "active",
      "子框架运行时未就绪",
    );
    if ([7, 8, 9].includes(plan)) await call("poison");
    await check("真实按键创建、跳转、前位置往返和URL去hash兼容", async () => {
      await call("reset", { y: 430 });
      await create("a");
      await wait(async () => Boolean(await call("local", { name: "a" })), "页面标记未写入");
      assert(JSON.parse(await call("local", { name: "a" })).scrollY === 430, "保存位置错误");
      await call("reset", { y: 0 });
      await goto("a");
      await wait(() => page.evaluate(() => scrollY === 430), "页面跳转失败");
      await goto("'");
      await wait(() => page.evaluate(() => scrollY === 0), "前位置未返回");
      await goto("`");
      await wait(() => page.evaluate(() => scrollY === 430), "前位置往返错误");
      await settle();
      assert((await call()).legacyCalls === 0, "新标记调用旧交互算法");
    });
    await check("等待选择期间Esc、普通输入和100次开关资源无净增", async () => {
      await call("reset");
      await settle();
      const baseline = await call();
      for (let index = 0; index < 100; index++) {
        await press(["m", "Escape"]);
        assert(!(await call()).mode, "Esc未取消标记模式");
      }
      await settle();
      const after = await call();
      assert(
        after.modes.length === baseline.modes.length && after.components === 0 &&
          JSON.stringify(after.resources.resources) ===
            JSON.stringify(baseline.resources.resources),
        "开关后模式或资源净增长",
      );
      await page.click("#input");
      await page.keyboard.type("m synthetic");
      assert(
        await page.$eval("#input", (node) => node.value) === "m synthetic",
        "编辑器被标记截获",
      );
      await press(["Escape", "j"]);
      await wait(() => page.evaluate(() => scrollY === 60), "退出编辑后j滚动错误");
      return {
        iterations: 100,
        beforeModes: baseline.modes,
        afterModes: after.modes,
        beforeResources: baseline.resources,
        afterResources: after.resources,
      };
    });
    await check("真实Shift全局创建与原标签跳转保留旧兼容契约", async () => {
      await call("reset", { y: 630 });
      await create("A");
      await wait(
        async () =>
          (await options.evaluate(() => chrome.storage.local.get("vimiumGlobalMark|A")))[
            "vimiumGlobalMark|A"
          ]?.scrollY === 630,
        "全局标记未保存",
      );
      await call("reset");
      await goto("A");
      await wait(() => page.evaluate(() => scrollY === 630), "全局标记未恢复原标签");
      await settle();
    });
    if (![7, 8, 9].includes(plan)) return;
    await check("忽略布局时三种未完成字符键保持选择且不写标记", async () => {
      const configure = (value) =>
        options.evaluate((value) =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action: "commit",
            input: { legacyPatch: { ignoreKeyboardLayout: value } },
          }), value);
      assert((await configure(true)).ok, "忽略布局设置失败");
      await wait(async () => (await call()).ignoreKeyboardLayout === true, "页面未收到布局设置");
      await session.activatePage(page, options);
      await call("reset");
      await press(["m"]);
      const client = await page.createCDPSession();
      try {
        for (const key of ["Dead", "Process", "Unidentified"]) {
          await client.send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key,
            code: "KeyF",
            windowsVirtualKeyCode: 70,
          });
          await client.send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key,
            code: "KeyF",
            windowsVirtualKeyCode: 70,
          });
          assert(
            (await call()).mode === "create-mark" && await call("local", { name: "f" }) === null,
            `${key}按物理code意外提交标记`,
          );
        }
        await press(["Escape"]);
        await settle();
      } finally {
        await client.detach();
        assert((await configure(false)).ok, "未恢复布局设置");
        await wait(async () => (await call()).ignoreKeyboardLayout === false, "布局设置未恢复");
      }
      return {
        keys: ["Dead", "Process", "Unidentified"],
        ignoreKeyboardLayout: true,
        systemIme: false,
        source: "原生CDP键盘边界事件；不替代系统输入法",
      };
    });
    await check("子框架全局创建取顶层坐标，swap以及前位置语义", async () => {
      await call("reset", { y: 0 });
      const child = page.frames().find((frame) => frame.url().endsWith("/child"));
      await child.click("#heading");
      await call("reset", { y: 280 }, tabId, childFrameId);
      await create("B");
      await wait(
        async () =>
          Boolean(
            (await options.evaluate(() => chrome.storage.local.get("vimiumGlobalMark|B")))[
              "vimiumGlobalMark|B"
            ],
          ),
        "子框架全局标记未保存",
      );
      const saved = (await options.evaluate(() =>
        chrome.storage.local.get("vimiumGlobalMark|B")
      ))["vimiumGlobalMark|B"];
      assert(
        saved.scrollY === await page.evaluate(() =>
          scrollY
        ),
        "子框架坐标冒充顶层",
      );
      assert(saved.scrollY !== 280, "全局标记存了子框架位置");
      await page.click("#heading");
      await call("reset", { y: 320 });
      await press(["z", "c", "q"]);
      await wait(async () =>
        (await options.evaluate(() => chrome.storage.local.get("vimiumGlobalMark|q")))[
          "vimiumGlobalMark|q"
        ]?.scrollY === 320, "swap未创建全局标记");
      await call("reset");
      await press(["z", "g", "q"]);
      await wait(() =>
        page.evaluate(() =>
          scrollY === 320
        ), "swap未跳全局标记");
      await settle();
      return { childScrollY: 280, savedTopScrollY: saved.scrollY };
    });
    await check("统一命令入口及持久去重，坏值和旧代次不能导航或写标记", async () => {
      await call("reset");
      const opened = await call("command", { name: "Marks.activateCreateMode" });
      assert(opened.ok, "统一命令不能激活标记");
      await press(["Escape"]);
      const good = await call("request", {
        payload: { operation: "create", name: "Q", position: { scrollX: 0, scrollY: 710 } },
      });
      assert(good.result.ok, "后台合法标记请求失败");
      assert((await call("replay")).code === "DUPLICATE_REQUEST", "重复标记请求未去重");
      const stale = { ...(await call()).identity, runtimeEpoch: 0 };
      const bad = await call("request", {
        identity: stale,
        payload: { operation: "create", name: "X", position: { scrollX: 0, scrollY: 999 } },
      });
      assert(bad.result.ok === false, "旧代次请求被接受");
      for (const handler of ["createMark", "gotoMark"]) {
        assert(
          (await call("legacy", { handler, name: "A" })).code === "PERMISSION_DENIED",
          "新方案能绕过固定消息进入旧Marks后台",
        );
      }
      for (
        const payload of [{ operation: "create", name: "AA" }, {
          operation: "goto",
          name: "A",
          url: fixtureUrl,
        }, { operation: "goto", name: "'" }]
      ) {
        assert(
          (await call("request", { payload })).result.code === "INVALID_MARK_ACTION",
          "坏负载被接受",
        );
      }
      await call("corrupt", { name: "z" });
      await goto("z");
      assert((await call()).scrollY === 0 && !(await call()).mode, "坏存储值改变位置或遗留模式");
      await settle();
      metadata.savedReplay = good.message;
    });
    await check("关闭原标签后按URL创建一次并恢复，工作线程重启仍保留Mark及去重", async () => {
      const destination = fixtureUrl.replace("/fixture", "/marked-destination");
      const other = await session.newPage();
      await other.goto(destination);
      const otherId = (await tabs()).find((tab) => tab.url === destination).id;
      await ready(otherId);
      await session.activatePage(other, options);
      await call("reset", { y: 870 }, otherId);
      await create("C", other);
      await wait(
        async () =>
          (await options.evaluate(() => chrome.storage.local.get("vimiumGlobalMark|C")))[
            "vimiumGlobalMark|C"
          ]?.scrollY === 870,
        "关闭前标记尚未保存",
      );
      await other.close();
      await session.activatePage(page, options);
      await call("reset");
      await goto("C");
      await wait(
        async () => (await tabs()).filter((tab) => tab.url === destination).length === 1,
        "Mark未创建唯一目的标签",
      );
      const targetId = (await tabs()).find((tab) => tab.url === destination).id;
      await wait(
        async () => (await call("state", {}, targetId)).scrollY === 870,
        "新目的标签未恢复位置",
      );
      const target = (await browser.pages()).find((candidate) => candidate.url() === destination);
      await target.close();
      await session.activatePage(page, options);
      await settle();
      const worker = await browser.waitForTarget((target) =>
        target.type() === "service_worker" && target.url().startsWith(`chrome-extension://${id}/`)
      );
      const client = await browser.target().createCDPSession();
      const contexts = await client.send("Target.getTargets");
      const native = contexts.targetInfos.find((target) =>
        target.type === "service_worker" && target.url === worker.url()
      );
      await client.send("Target.closeTarget", { targetId: native.targetId });
      // 同一次请求启动新worker；没有重试导航。Puppeteer可能留在调试等待，用原生会话恢复。
      const replay = call("request", { message: metadata.savedReplay });
      await wait(async () => {
        const targets = (await client.send("Target.getTargets")).targetInfos;
        const fresh = targets.find((target) =>
          target.type === "service_worker" && target.url === worker.url() &&
          target.targetId !== native.targetId
        );
        if (!fresh) return false;
        const workerTarget = browser.targets().find((target) =>
          target.type() === "service_worker" && target.url() === fresh.url
        );
        if (workerTarget) {
          const session = await workerTarget.createCDPSession();
          await session.send("Runtime.runIfWaitingForDebugger");
          await session.detach();
        }
        return true;
      }, "实际工作线程没有重启");
      assert((await replay).result.code === "DUPLICATE_REQUEST", "worker重启丢失去重证据");
      await goto("A");
      await wait(() => page.evaluate(() => scrollY === 630), "worker重启丢失全局标记");
      await settle();
      await client.detach();
      return { workerClosedTarget: native.targetId, newTabRestored: targetId, position: 870 };
    });
    await check("真实BFCache恢复主子文档及前位置，恢复后直接m和j可用", async () => {
      await session.activatePage(page, options);
      await call("reset", { y: 250 });
      await create("d");
      await settle();
      const before = await call(), childBefore = await call("state", {}, tabId, childFrameId);
      const client = await page.createCDPSession();
      await client.send("Page.enable");
      const rejected = [];
      client.on("Page.backForwardCacheNotUsed", (event) => rejected.push(event));
      await page.goto(fixtureUrl.replace("127.0.0.1", "localhost") + "?away=1");
      await page.goBack({ waitUntil: "domcontentloaded" });
      await ready();
      const after = await call(), childAfter = await call("state", {}, tabId, childFrameId);
      assert(
        await page.evaluate(() => bfcRestores) === 1 && rejected.length === 0,
        "没有真实BFCache恢复",
      );
      assert(
        before.identity.documentId === after.identity.documentId &&
          after.identity.runtimeEpoch > before.identity.runtimeEpoch &&
          childBefore.identity.documentId === childAfter.identity.documentId &&
          childAfter.identity.runtimeEpoch > childBefore.identity.runtimeEpoch,
        "恢复没有保留原生文档或推进代次",
      );
      await call("reset");
      await goto("d");
      await wait(() => page.evaluate(() => scrollY === 250), "BFCache恢复丢失页面标记");
      await settle();
      await create("e");
      await settle();
      await press(["j"]);
      await wait(() => page.evaluate(() => scrollY === 310), "BFCache后j未只执行一次");
      await settle();
      await client.detach();
      return {
        before: before.identity,
        after: after.identity,
        childBefore: childBefore.identity,
        childAfter: childAfter.identity,
        persisted: 1,
        rejected,
      };
    });
    await check("真实无痕Mark保留旧持久化决定，身份不能伪造且关闭后释放文档与HUD", async () => {
      metadata.incognitoPreparation = [];
      const preparationStep = async (label, action) => {
        const step = { label, startedAt: new Date().toISOString() };
        metadata.incognitoPreparation.push(step);
        console.log(`方案${plan}：无痕准备开始${label}`);
        await save();
        const result = await action();
        step.finishedAt = new Date().toISOString();
        console.log(`方案${plan}：无痕准备完成${label}`);
        await save();
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
          "无痕权限UI未启用",
        ));
      const previous = options;
      options = await session.newPage();
      await wait(async () => {
        await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
        return options.evaluate(() =>
          new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve))
        );
      }, "新扩展上下文未取得实际无痕权限");
      await options.waitForSelector("#save-settings");
      await previous.close().catch(() => {});
      await management.close();
      await page.reload();
      await ready();
      await call("poison");
      const window = await options.evaluate(
        ({ url, windowOptions }) => chrome.windows.create({ url, incognito: true, ...windowOptions }),
        { url: fixtureUrl + "?private=1", windowOptions: session.windowCreateOptions },
      );
      const privateTab = window.tabs[0].id;
      await ready(privateTab);
      const privatePage = (await browser.pages()).find((candidate) =>
        candidate.url() === fixtureUrl + "?private=1"
      );
      assert(privatePage, "没有真实无痕测试页面");
      await session.activatePage(privatePage, options);
      await call("reset", { y: 540 }, privateTab);
      await create("I", privatePage);
      await wait(
        async () =>
          (await options.evaluate(() => chrome.storage.local.get("vimiumGlobalMark|I")))[
            "vimiumGlobalMark|I"
          ]?.scrollY === 540,
        "无痕Mark未按冻结决定写local",
      );
      const identity = (await call("state", {}, privateTab)).identity;
      assert(identity.incognito === true, "无痕文档身份错误");
      const forged = await call("request", {
        identity: { ...identity, incognito: false },
        payload: { operation: "create", name: "Z", position: { scrollX: 0, scrollY: 999 } },
      }, privateTab);
      assert(forged.result.code === "PERMISSION_DENIED", "无痕身份可以被负载降级");
      await call("reset", {}, privateTab);
      await goto("I", privatePage);
      await wait(
        async () => (await call("state", {}, privateTab)).scrollY === 540,
        "无痕全局Mark未实际恢复",
      );
      await wait(
        async () => (await call("state", {}, privateTab)).components === 0,
        "无痕HUD未释放",
      );
      await options.evaluate((id) => chrome.windows.remove(id), window.id);
      await wait(async () =>
        options.evaluate(async (id) => {
          const documents = (await chrome.storage.session.get("browserToolboxRuntimeDocuments"))
            .browserToolboxRuntimeDocuments?.documents || [];
          return !documents.some((record) => record.tabId === id);
        }, privateTab), "关闭无痕后授权文档仍残留");
      const mark = (await options.evaluate(() =>
        chrome.storage.local.get("vimiumGlobalMark|I")
      ))["vimiumGlobalMark|I"];
      assert(mark?.scrollY === 540, "静默改变了既定无痕Mark持久化行为");
      await session.activatePage(page, options);
      return {
        nativeIncognito: true,
        savedLocal: true,
        afterCloseRetainedByPhase0Decision: true,
        forgedIdentityCode: forged.result.code,
        documentsReleased: true,
      };
    });
    metadata.finalState = await call();
    assert(metadata.finalState.legacyCalls === 0, "独立标记调用过旧交互算法");
    await call("reset");
    await session.activatePage(page, options);
    if (keepOpen) {
      // 交付文档重新加载，移除仅供验收的旧算法毒化和调试钩子。
      await page.reload(); await ready(); await call("reset"); await settle();
      metadata.deliveryState = await call();
      metadata.testEntry = fixtureUrl;
      session.disconnect();
      return;
    }
  } catch (error) {
    metadata.failureState = await call().catch(() => null);
    throw error;
  } finally {
    if (!([7, 8, 9].includes(plan) && keepOpen && metadata.testEntry)) {
      await session.close();
      await Deno.remove(profile, { recursive: true });
    }
  }
}
try {
  await run(compatPath, 6);
  await run(canaryPath, canaryPlan);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack || error.message;
  console.error(report.error);
  Deno.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await save();
  if (!(keepOpen && report.status === "passed")) await server.shutdown();
}
