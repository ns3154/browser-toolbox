// SPDX-License-Identifier: GPL-3.0-or-later
// 两个独立 CFT profile 在相同合成页面执行真实按键，另行验收新输入模块；不替代系统输入法人工结果。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
const root = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)));
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const compatPath = Deno.env.get("BROWSER_TOOLBOX_INPUT_COMPAT_PATH") ||
  path.join(root, "dist/browser-toolbox");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_INPUT_REPORT");
const canaryPlanVersion = Number(Deno.env.get("BROWSER_TOOLBOX_INPUT_PLAN_VERSION") || 2);
if (!canaryPath) throw new Error("必须提供已隔离的 Canary 加载目录");
const html =
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>独立输入旧新对照</title>
<style>body{min-height:24000px;font:16px sans-serif;margin:16px}#nested{height:160px;width:400px;overflow:auto;border:1px solid}#nested-inner{height:1900px;width:1400px}#hidden-scroll{height:80px;overflow:hidden}#hidden-inner{height:800px}iframe{height:100px;width:400px}input,textarea{width:240px}</style>
<body><h1>输入旧新对照</h1><input id="input"><textarea id="textarea"></textarea><div id="editor" contenteditable="true">合成可编辑区</div>
<select id="select"><option>一</option><option>二</option></select><input id="readonly" readonly value="只读文本">
<div id="shadow"></div><div id="nested"><div id="nested-inner">内层滚动</div></div>
<div id="hidden-scroll"><div id="hidden-inner">隐藏溢出</div></div><iframe src="/child"></iframe><a href="#test">合成链接</a><p>查找目标</p>
<script>const sh=document.getElementById('shadow').attachShadow({mode:'open'});sh.innerHTML='<input id="shadow-input"><div id="shadow-editor" contenteditable="true">合成 Shadow 编辑区</div>';window.nativeCounts={keydown:0,keyup:0,keypress:0};for(const t of Object.keys(nativeCounts))window.addEventListener(t,()=>nativeCounts[t]++);</script></body></html>`;
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  (request) =>
    new Response(
      new URL(request.url).pathname === "/child"
        ? '<!doctype html><html><body><input id="child-input"><div contenteditable="true" id="child-editor">合成子页</div></body></html>'
        : html,
      { headers: { "content-type": "text/html;charset=utf-8" } },
    ),
);
const url = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  fixture: "synthetic",
  checks: [],
  browsers: [],
  comparisons: {},
  manualSystemIme: "pending",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
async function wait(predicate) {
  for (let index = 0; index < 300; index++) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error("等待输入状态超时");
}
async function run(name, extensionPath, expectedPlan) {
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-input-compare-" });
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  report.browsers.push({ implementation: name, version: await browser.version(), extensionPath });
  const values = {};
  try {
    const target = await browser.waitForTarget((item) =>
      item.type() === "service_worker" &&
      item.url().startsWith("chrome-extension://")
    );
    const id = new URL(target.url()).host;
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const page = await browser.newPage();
    page.on("pageerror", (error) => {
      report.pageErrors ||= [];
      report.pageErrors.push({ implementation: name, message: error.message });
    });
    async function config(legacyPatch) {
      const result = await options.evaluate((legacyPatch) =>
        chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action: "commit",
          input: { legacyPatch },
        }), legacyPatch);
      assert(result.ok, `配置保存失败 ${result.code}`);
    }
    async function inspect(operation, input = {}, allFrames = false) {
      return options.evaluate(async ({ operation, input, allFrames, url }) => {
        const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames },
          world: "ISOLATED",
          func: async (operation, input) => {
            if (
              operation === "state" && !["http:", "https:", "file:"].includes(location.protocol)
            ) return null;
            const host = BrowserToolboxRuntimeHostInstance;
            const normal = Mode.modes.find((mode) => mode.name === "normal");
            if (operation === "state") {
              return {
                active: host.state,
                plan: host.plan.planVersion,
                ready: Boolean(normal?.keyMapping && Settings.isLoaded()),
                modes: Mode.modes.map((mode) => mode.name),
                independent: Boolean(
                  globalThis.BrowserToolboxInputRuntime &&
                    normal instanceof BrowserToolboxInputRuntime.NormalMode,
                ),
                listeners: host.getDiagnostics().resources.events.listener,
                documentId: host.context.documentId,
                epoch: host.runtimeEpoch,
                passKeys: normal?.passKeys,
                failure: host.lastErrorCode,
                failureStage: host.lastFailureStage,
                initializationStage: host.initializationStage,
                settingsLoaded: Settings.isLoaded(),
                suspended: host.suspended,
                disposed: host.disposed,
                authorizedUI: Boolean(BrowserToolboxUIAuthorization.session),
                documentResources: host.documentResources.counts(),
                zCount: normal?.keyMapping?.z?.options?.count,
                inputEnabled: host.engine?.enabled?.(),
                scrollClosed: globalThis.BrowserToolboxScrollControllerInstance?.closed,
                gestureActive: Boolean(globalThis.BrowserToolboxMouseControllerInstance?.gesture),
              };
            }
            if (operation === "invoke") {
              const invocation = BrowserToolboxCommandInvocation.createV2(
                input.command,
                input.options || {},
                { type: "keyboard" },
                { sourceFrameId: host.context.frameId },
                input.count ?? 1,
                {
                  identity: {
                    documentId: host.context.documentId,
                    runtimeEpoch: host.runtimeEpoch,
                    incognito: host.context.incognito === true,
                  },
                },
              );
              return BrowserToolboxPageCommandExecutorInstance.invoke(invocation);
            }
            if (operation === "mixed-plan") {
              await host.activate(
                await host.prepare(BrowserToolboxRuntime.COMPAT_PLAN, host.lastSettingsRevision, {
                  ...host.context,
                  planVersion: 1,
                }),
              );
              return host.getDiagnostics();
            }
          },
          args: [operation, input],
        });
        return allFrames ? results.map((item) => item.result).filter(Boolean) : results[0].result;
      }, { operation, input, allFrames, url });
    }
    async function check(label, task) {
      const started = performance.now();
      await task();
      report.checks.push({
        implementation: name,
        name: label,
        status: "passed",
        durationMs: Math.round(performance.now() - started),
      });
      console.log(`${name}：${label} 通过`);
    }
    async function reset() {
      await page.evaluate(() => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        active?.blur();
        scrollTo(0, 0);
        document.getElementById("nested").scrollTo(0, 0);
      });
      await page.click("h1");
    }
    async function keys(text) {
      for (const key of text) await page.keyboard.press(key);
    }
    await config({ smoothScroll: false, scrollStepSize: 60, grabBackFocus: false });
    await page.goto(url);
    await page.bringToFront();
    await wait(async () => (await inspect("state"))?.ready);
    await check("真实引擎类型、每帧身份与单一事件入口", async () => {
      await wait(async () => {
        const frames = await inspect("state", {}, true);
        return frames.length === 2 &&
          frames.every((state) => state.ready && state.active === "active");
      });
      const frames = await inspect("state", {}, true);
      report.initialStates ||= {};
      report.initialStates[name] = frames;
      assert(
        frames.length === 2 &&
          frames.every((s) =>
            s.active === "active" && s.plan === expectedPlan && s.listeners === 13
          ),
        "frame 方案或所有权异常",
      );
      assert(
        frames.every((s) => s.independent === (expectedPlan !== 1)),
        "新旧普通模式必须有不同实现",
      );
    });
    await check("j/k、100j、3gg、7gj 和半屏滚动", async () => {
      for (
        const [text, expected] of [["j", 60], ["100j", 6000], ["3gg", 120], ["7gj", 60], ["d", 450]]
      ) {
        await reset();
        await keys(text);
        const y = await page.evaluate(() => scrollY);
        assert(y === expected, `${text} 的实际位置 ${y}，应为 ${expected}`);
        values[text] = y;
      }
      await page.keyboard.press("u");
      assert(await page.evaluate(() => scrollY) === 0, "u 应回到页首");
    });
    await check("嵌套纵横滚动与 overflow hidden 排除", async () => {
      await reset();
      await page.click("#nested", { offset: { x: 10, y: 10 } });
      await keys("2j");
      await page.keyboard.press("l");
      const nested = await page.$eval(
        "#nested",
        (node) => ({ y: node.scrollTop, x: node.scrollLeft }),
      );
      assert(
        nested.y === 120 && nested.x === 60 && await page.evaluate(() => scrollY) === 0,
        "嵌套滚动目标异常",
      );
      values.nested = nested;
      await reset();
      await page.click("#hidden-scroll", { offset: { x: 10, y: 10 } });
      await page.keyboard.press("j");
      assert(
        await page.$eval("#hidden-scroll", (node) => node.scrollTop) === 0,
        "hidden 容器不能滚动",
      );
      assert(await page.evaluate(() => scrollY) === 60, "不可滚动容器应回退外层");
    });
    await check("输入框、文本区、编辑区、只读框与 Shadow DOM 原生输入", async () => {
      for (
        const selector of [
          "#input",
          "#textarea",
          "#editor",
          "#readonly",
          "#select",
          "#shadow >>> #shadow-input",
          "#shadow >>> #shadow-editor",
        ]
      ) {
        await reset();
        if (selector === "#select") await page.focus(selector);
        else await page.click(selector);
        const before = await page.evaluate(() => scrollY);
        await page.keyboard.type("jk");
        assert(await page.evaluate(() => scrollY) === before, `${selector} 不应执行普通滚动`);
        await page.keyboard.press("Escape");
        const focused = await page.evaluate(() => {
          let a = document.activeElement;
          while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
          return a?.id;
        });
        assert(
          !["input", "textarea", "editor", "readonly", "select", "shadow-input", "shadow-editor"]
            .includes(focused),
          "Esc 应释放编辑焦点",
        );
      }
    });
    await check("全局 Insert 退出和一次放行的配对 keyup", async () => {
      await reset();
      await page.keyboard.press("i");
      await page.keyboard.press("j");
      assert(await page.evaluate(() => scrollY) === 0, "全局 Insert 应放行 j");
      await page.keyboard.press("Escape");
      await page.keyboard.press("j");
      assert(await page.evaluate(() => scrollY) === 60, "Insert 退出应恢复 j");
      await reset();
      await inspect("invoke", { command: "passNextKey" });
      const before = await page.evaluate(() => ({ ...nativeCounts }));
      await page.keyboard.press("j");
      const after = await page.evaluate(() => ({ ...nativeCounts }));
      assert(
        after.keydown === before.keydown + 1 && after.keyup === before.keyup + 1,
        "放行需包含 keyup",
      );
      assert(await page.evaluate(() => scrollY) === 0, "一次放行不能同时执行 j");
      await page.keyboard.press("j");
      assert(await page.evaluate(() => scrollY) === 60, "一次放行后应恢复");
    });
    await check("可自定义键序列、mapkey、count 选项和 pass keys", async () => {
      await config({
        keyMappings: "map z scrollDown count=2\nmapkey a j",
        exclusionRules: [{ pattern: url + "*", passKeys: "j" }],
      });
      await page.reload();
      await wait(async () => (await inspect("state"))?.ready);
      await reset();
      await page.keyboard.press("j");
      assert(await page.evaluate(() => scrollY) === 0, "配置 pass key 应放行");
      await keys("3j");
      assert(await page.evaluate(() => scrollY) === 180, "次数前缀忽略 pass key");
      await reset();
      await keys("3z");
      assert(await page.evaluate(() => scrollY) === 360, "映射 count 应乘前缀");
      await reset();
      await page.keyboard.press("a");
      assert(await page.evaluate(() => scrollY) === 0, "mapkey 后的 j 保留 pass 语义");
      await inspect("invoke", { command: "passNextKey", options: { normal: true } });
      await page.keyboard.press("j");
      assert(await page.evaluate(() => scrollY) === 60, "临时普通模式禁用 pass keys");
      await page.keyboard.press("Escape");
      await config({ keyMappings: "", exclusionRules: [] });
      await page.reload();
      await wait(async () => (await inspect("state"))?.ready);
    });
    await check("平滑滚动快速连按和持续按住均在 keyup 后停止", async () => {
      await config({ smoothScroll: true });
      await page.reload();
      await wait(async () => (await inspect("state"))?.ready);
      await reset();
      await page.keyboard.press("j");
      await page.keyboard.press("j");
      await sleep(300);
      assert(await page.evaluate(() => scrollY) === 120, "快速连按应保留两个步长");
      await reset();
      await page.keyboard.down("j");
      await sleep(230);
      await page.keyboard.down("j");
      await sleep(120);
      await page.keyboard.up("j");
      await sleep(200);
      const after = await page.evaluate(() => scrollY);
      await sleep(200);
      assert(
        after > 60 && await page.evaluate(() => scrollY) === after,
        "持续滚动应在 keyup 后停止",
      );
      values.smoothTap = 120;
      await config({ smoothScroll: false });
      await page.reload();
      await wait(async () => (await inspect("state"))?.ready);
    });
    await check("Find、Visual、Hints、Vomnibar 兼容依赖组仍能退出", async () => {
      for (const [key, mode] of [["/", "find"], ["v", "visual"], ["f", "hint/"], ["o", null]]) {
        await reset();
        if (key === "v") {
          await page.evaluate(() => {
            const node = document.querySelector("h1").firstChild;
            getSelection().setBaseAndExtent(node, 0, node, 2);
          });
        }
        await page.keyboard.press(key);
        await sleep(150);
        if (mode) {
          assert(
            (await inspect("state")).modes.some((name) => name.includes(mode)),
            `${key} 未进入模式`,
          );
        }
        await page.keyboard.press("Escape");
        await sleep(150);
        await reset();
        await page.keyboard.press("j");
        assert(await page.evaluate(() => scrollY) === 60, `${key} 退出后普通模式未恢复`);
      }
    });
    if (expectedPlan !== 1) {
      await check("Canary 热更新映射与按住滚动期间停用恢复", async () => {
        await config({ keyMappings: "map z scrollDown count=3" });
        await wait(async () => (await inspect("state"))?.zCount === 3);
        await reset();
        await inspect("invoke", { command: "passNextKey", options: { normal: true } });
        await page.keyboard.press("z");
        assert(await page.evaluate(() => scrollY) === 180, "临时普通模式必须使用最新映射");
        await page.keyboard.press("Escape");
        await config({ keyMappings: "", smoothScroll: true });
        async function enableKeyboard(enabled) {
          const result = await options.evaluate(async (enabled) => {
            const current = await chrome.runtime.sendMessage({
              handler: "browserToolbox.configuration",
              action: "read",
            });
            const toolbox = structuredClone(current.value.toolboxSource.value);
            toolbox.keyboard.enabled = enabled;
            return chrome.runtime.sendMessage({
              handler: "browserToolbox.configuration",
              action: "commit",
              input: { toolbox },
            });
          }, enabled);
          assert(result.ok, `切换键盘模块失败 ${result.code}`);
          await wait(async () => (await inspect("state"))?.inputEnabled === enabled);
        }
        await reset();
        await page.keyboard.down("j");
        await sleep(150);
        await enableKeyboard(false);
        assert((await inspect("state")).scrollClosed, "停用应取消动画所有权");
        const stopped = await page.evaluate(() => scrollY);
        await sleep(180);
        assert(await page.evaluate(() => scrollY) === stopped, "按住键停用后不得继续滚动");
        await page.keyboard.up("j");
        const before = await page.evaluate(() => nativeCounts.keydown);
        await page.keyboard.press("j");
        assert(
          await page.evaluate(() => nativeCounts.keydown) === before + 1,
          "停用后保留原生输入",
        );
        await enableKeyboard(true);
        await config({ smoothScroll: false });
        await reset();
        await page.keyboard.press("j");
        assert(await page.evaluate(() => scrollY) === 60, "恢复后应只执行一次且使用最新设置");
      });
      await check("Canary 工作线程原生终止后新输入引擎恢复", async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
          const client = await browser.target().createCDPSession();
          try {
            const targets = (await client.send("Target.getTargets")).targetInfos;
            const worker = targets.find((item) =>
              item.type === "service_worker" && item.url === target.url()
            );
            assert(
              worker &&
                (await client.send("Target.closeTarget", { targetId: worker.targetId })).success,
              "工作线程必须实际终止",
            );
            await wait(async () =>
              !(await client.send("Target.getTargets")).targetInfos
                .some((item) => item.targetId === worker.targetId)
            );
          } finally {
            await client.detach();
          }
          await page.reload();
          try {
            await wait(async () => {
              const frames = await inspect("state", {}, true);
              return frames.length === 2 && frames.every((state) =>
                state.active === "active" &&
                state.plan === expectedPlan && state.independent && state.listeners === 13
              );
            });
          } catch (error) {
            report.workerRecoveryAttempt = attempt + 1;
            report.workerRecoveryState = await inspect("state", {}, true);
            throw error;
          }
          assert((await inspect("state")).independent, "恢复必须仍使用独立引擎");
          await reset();
          await page.keyboard.press("j");
          assert(await page.evaluate(() => scrollY) === 60, "恢复后应只执行一次");
        }
        report.workerRecoveryIterations = 5;
      });
      await check("设备本机整套回退覆盖全部 frame 与后续新文档", async () => {
        await reset();
        await page.mouse.move(900, 130);
        await page.mouse.down({ button: "right" });
        await page.mouse.move(900, 210, { steps: 6 });
        await wait(async () => (await inspect("state"))?.gestureActive);
        const result = await options.evaluate(() =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.runtimeMaintenance",
            action: "restore",
          })
        );
        assert(
          result.ok && result.activeFrames >= 2 && result.failedFrames === 0 &&
            result.refreshRequiredFrames === 0,
          "回退应完成整套 frame 恢复",
        );
        const frames = await inspect("state", {}, true);
        assert(
          frames.every((state) => state.plan === 1 && !state.independent),
          "不能残留混合输入引擎",
        );
        assert(frames.every((state) => !state.gestureActive), "整套回退应取消所有旧手势");
        await page.mouse.up({ button: "right" });
        await sleep(100);
        assert(await page.evaluate(() => scrollY) === 0, "切换前的右键手势抬起不能执行滚动");
        assert(
          await options.evaluate(async () =>
            !("browserToolboxRuntimePlan" in await chrome.storage.sync.get(null))
          ),
          "试用选择不能同步",
        );
        await page.reload();
        await wait(async () => (await inspect("state"))?.ready);
        assert((await inspect("state")).plan === 1, "后续文档应保持设备兼容选择");
      });
    }
    return values;
  } finally {
    await browser.close();
    await Deno.remove(profile, { recursive: true });
  }
}
try {
  const compat = await run("兼容", compatPath, 1);
  const canary = await run("Canary", canaryPath, canaryPlanVersion);
  assert(JSON.stringify(compat) === JSON.stringify(canary), "旧新关键滚动结果不一致");
  report.comparisons = { compat, canary, equal: true };
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  Deno.exitCode = 1;
  console.error(error);
} finally {
  await server.shutdown();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
