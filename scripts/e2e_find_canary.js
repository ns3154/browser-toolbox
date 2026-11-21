// SPDX-License-Identifier: GPL-3.0-or-later
// 相同合成文本在两个独立 CFT 里走真实查找 HUD 与按键；不使用模拟 DOM 代替可见结果。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { assertSafeTestBrowser } from "./test_browser_safety.js";
assertSafeTestBrowser({ headless: Deno.env.get("BROWSER_TOOLBOX_FIND_KEEP_OPEN") !== "true" });
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_FIND_COMPAT_PATH");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_FIND_REPORT");
const keepOpen = Deno.env.get("BROWSER_TOOLBOX_FIND_KEEP_OPEN") === "true";
const canaryPlan = Number(Deno.env.get("BROWSER_TOOLBOX_FIND_PLAN_VERSION") || 3);
if (![3, 4, 5, 6, 7, 8, 9].includes(canaryPlan)) throw new Error("未登记的查找测试方案");
if (!compatPath || !canaryPath) throw new Error("必须提供隔离方案 2 和方案 3 目录");
const html =
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>独立 Find 旧新验收</title>
<style>body{font:16px sans-serif;min-height:18000px;margin:16px}#hidden{display:none}iframe{height:100px;width:350px}</style>
<body><h1>独立查找旧新验收</h1><p id="p1">alpha ALPHA Alpha a.b 中文目标 alpha beta</p>
<p id="p2">alpha 中文目标 alpha beta</p><a id="link" href="#fixture-link">FindLink alpha</a>
<div id="editor" contenteditable="true">EditFind alpha</div><div id="split"><span>alpha </span><b>beta</b></div>
<div id="hidden">alpha 隐藏目标</div><input id="input"><textarea id="textarea"></textarea>
<iframe src="/child" title="查找子页"></iframe><p id="deep" style="margin-top:6500px">deep needle</p></body></html>`;
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  (request) =>
    new Response(
      new URL(request.url).pathname === "/child"
        ? '<!doctype html><html><body><p id="child-text">frame needle</p><input id="child-input"></body></html>'
        : html,
      { headers: { "content-type": "text/html;charset=utf-8" } },
    ),
);
const url = `http://127.0.0.1:${server.addr.port}/fixture`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  fixtureUrl: url,
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
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error("等待查找状态超时");
}
async function run(name, extensionPath, plan) {
  const independentFind = [3, 4, 5, 6, 7, 8, 9].includes(plan);
  const headed = plan === canaryPlan && keepOpen;
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-find-cft-" });
  const browser = await puppeteer.launch({
    executablePath,
    headless: !headed,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-dev-shm-usage",
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
    assert(configured.ok, "配置提交失败");
    const page = await browser.newPage();
    await page.goto(url);
    await page.bringToFront();
    page.on("pageerror", (error) => {
      report.pageErrors ||= [];
      report.pageErrors.push({ implementation: name, message: error.message });
    });
    async function inspect(operation = "state", input = {}) {
      return options.evaluate(async ({ url, operation, input }) => {
        const tab = (await chrome.tabs.query({})).find((tab) =>
          tab.url?.split("#")[0] === url || tab.pendingUrl?.split("#")[0] === url
        );
        if (!tab) return null;
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "ISOLATED",
          func: async (operation, input) => {
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            if (!host) return null;
            const controller = globalThis.BrowserToolboxFindControllerInstance;
            const find = Mode.modes.find((mode) => mode.name === "find");
            if (operation === "release-ui") {
              HUD.destroy();
              return {
                query: FindMode.query?.rawQuery,
                listeners: host.getDiagnostics().resources.events.listener,
              };
            }
            if (operation === "delayed-ui") {
              const original = HUD.init;
              HUD.init = async function (...args) {
                await new Promise((resolve) => setTimeout(resolve, 400));
                return original.apply(this, args);
              };
              return true;
            }
            if (operation === "state") {
              const selection = getSelection();
              return {
                active: host.state,
                plan: host.plan.planVersion,
                epoch: host.runtimeEpoch,
                documentId: host.context.documentId,
                failure: host.lastErrorCode,
                initializationStage: host.initializationStage,
                independent: Boolean(controller),
                independentMode: Boolean(
                  find && globalThis.BrowserToolboxFindRuntime &&
                    find instanceof BrowserToolboxFindRuntime.FindMode,
                ),
                mode: Mode.modes.map((mode) => mode.name),
                resources: host.getDiagnostics().resources,
                query: FindMode.query
                  ? {
                    raw: FindMode.query.rawQuery,
                    parsed: FindMode.query.parsedQuery,
                    count: FindMode.query.matchCount,
                    found: Boolean(FindMode.query.hasResults),
                  }
                  : null,
                selection: selection.toString(),
                node: selection.anchorNode?.parentElement?.id,
                offset: selection.anchorOffset,
                focus: document.activeElement?.id,
                scrollY,
                history: controller?.history.getQuery() ?? FindModeHistory.getQuery(),
                hudShowing: Boolean(HUD.hudUI?.showing),
                regexDefault: Settings.isLoaded() && Settings.get("regexFindMode"),
              };
            }
            if (operation === "late-session") {
              const before = controller.query.rawQuery;
              HUD.search({ query: "不能生效", findSessionId: "previous-session" });
              HUD.hideFindMode({ exitEventIsEscape: true, findSessionId: "previous-session" });
              return {
                same: controller.query.rawQuery === before,
                active: Boolean(find?.modeIsActive),
              };
            }
          },
          args: [operation, input],
        });
        return results[0].result;
      }, { url, operation, input });
    }
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
    async function reset() {
      await page.bringToFront();
      // 点击空白页边距并在评估前聚焦主文档，确保重载或切换后台页后按键一定会送达内容页。
      await page.mouse.click(4, 4);
      await page.evaluate(() => {
        window.focus();
        document.activeElement?.blur();
        scrollTo(0, 0);
        const selection = getSelection();
        const range = document.createRange();
        range.setStart(document.querySelector("#p1").firstChild, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      });
    }
    async function currentFindFrame() {
      let frame;
      await wait(async () => {
        frame = page.frames().find((item) =>
          item.url().split("?")[0].endsWith("/pages/hud_page.html")
        );
        if (!frame?.mainRealm().context) return false;
        try {
          return await frame.evaluate(() => document.activeElement?.id === "hud-find-input");
        } catch (error) {
          // 自然退出会销毁旧HUD；只重等已脱离的实例，不掩盖当前组件的错误。
          if (!page.frames().includes(frame) || !frame.mainRealm().context) return false;
          throw error;
        }
      });
      return frame;
    }
    async function startFind(text) {
      await reset();
      await page.keyboard.press("/");
      const frame = await currentFindFrame();
      if (text) await page.keyboard.type(text);
      await wait(async () => (await inspect()).query?.raw === text);
      return frame;
    }
    async function exitFind(key = "Escape") {
      // OOPIF Find 输入框在 Escape/Enter keydown 后立即失焦并隐藏；先等主文档接回焦点再发送 keyUp，避免 Chromium CDP 路由到切换中的 OOPIF 挂起。
      await page.keyboard.down(key);
      await wait(async () => !(await inspect()).mode.includes("find"));
      await sleep(20);
      await page.keyboard.up(key);
    }
    try {
      await wait(async () => (await inspect())?.active === "active");
    } catch (failure) {
      metadata.initialFailureState = await inspect();
      throw failure;
    }
    await check("原生方案身份与独立查找模式所有权", async () => {
      const state = await inspect();
      assert(
        state.plan === plan && state.independent === independentFind,
        "运行方案或查找控制器错误",
      );
      await startFind("alpha");
      const mode = await inspect();
      assert(
        mode.independentMode === independentFind && mode.resources.events.listener === 13,
        "模式实现或唯一入口异常",
      );
      await exitFind();
    });
    await check("真实 HUD 字面、中文、智能大小写和特殊字符", async () => {
      for (
        const [query, count] of [["alpha", 9], ["ALPHA", 1], ["Alpha", 1], ["中文目标", 2], [
          "a.b",
          1,
        ]]
      ) {
        await startFind(query);
        await wait(async () => (await inspect()).query.count === count);
        const state = await inspect();
        assert(state.query.found && state.selection.length > 0, `${query} 应选中实际文本`);
        values[query] = count;
        await exitFind();
      }
    });
    await check("正则开关、转义、无效和零长度表达式", async () => {
      for (const [query, count] of [["\\ra\\.b", 1], ["\\ralpha|beta", 12], ["\\Ra.b", 1]]) {
        await startFind(query);
        await wait(async () => (await inspect()).query.count === count);
        values[query] = count;
        await exitFind();
      }
      await startFind("\\r[");
      assert(!(await inspect()).query.found, "未完成正则不能选中错误范围");
      await exitFind();
      await startFind("\\r^$");
      assert(!(await inspect()).query.found, "空匹配不得卡住或选中错误范围");
      await exitFind();
      const changed = await options.evaluate(() =>
        chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action: "commit",
          input: { legacyPatch: { regexFindMode: true } },
        })
      );
      assert(changed.ok, "正则默认设置提交失败");
      await wait(async () => (await inspect()).regexDefault === true);
      await startFind("a.b");
      await wait(async () => (await inspect()).query.count === 3);
      await exitFind();
      await options.evaluate(() =>
        chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action: "commit",
          input: { legacyPatch: { regexFindMode: false } },
        })
      );
      await wait(async () => (await inspect()).regexDefault === false);
    });
    await check("Enter 后 n/N 与次数跨节点环绕", async () => {
      await startFind("alpha");
      await exitFind("Enter");
      await wait(async () => (await inspect()).history === "alpha");
      await page.keyboard.press("n");
      await wait(async () => (await inspect()).selection === "ALPHA");
      for (const key of "2n") await page.keyboard.press(key);
      await wait(async () =>
        (await inspect()).node === "p1" && (await inspect()).selection === "alpha"
      );
      await page.keyboard.press("n");
      await wait(async () => (await inspect()).node === "p2" && (await inspect()).offset === 0);
      await page.keyboard.press("N");
      await wait(async () => (await inspect()).node === "p1");
      values.next = (await inspect()).selection;
    });
    await check("选中文字正反查找与可编辑目标 PostFind", async () => {
      await reset();
      await page.evaluate(() => {
        const text = document.querySelector("#p1").firstChild;
        const range = document.createRange();
        range.setStart(text, text.textContent.indexOf("beta"));
        range.setEnd(text, text.textContent.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await page.keyboard.press("*");
      await wait(async () =>
        (await inspect()).node === "p2" && (await inspect()).selection === "beta"
      );
      await page.keyboard.press("#");
      await wait(async () => (await inspect()).node === "p1");
      await startFind("FindLink");
      await exitFind();
      assert((await inspect()).focus === "link", "Esc 应聚焦找到的链接");
      await startFind("EditFind");
      await exitFind("Enter");
      assert((await inspect()).mode.includes("post-find"), "找到编辑区后应保护选区");
      const before = await page.$eval("#editor", (element) => element.textContent);
      await page.keyboard.press("q");
      assert(
        await page.$eval("#editor", (element) => element.textContent) === before,
        "未映射字符不能改写找到的选区",
      );
      await page.click("h1");
      await startFind("EditFind");
      await exitFind("Enter");
      await page.keyboard.press("Escape");
      assert(
        !(await inspect()).mode.includes("post-find") && (await inspect()).focus === "editor",
        "第一个 Esc 应保留编辑焦点进入原生输入",
      );
      await page.keyboard.type("Z");
      assert(
        (await page.$eval("#editor", (element) => element.textContent)).includes("Z"),
        "PostFind 退出后原生输入可用",
      );
      await page.reload();
      await wait(async () => (await inspect())?.active === "active");
    });
    await check("查询历史上下键、部分输入恢复与普通 session", async () => {
      await options.evaluate(() =>
        chrome.storage.session.set({ findModeRawQueryList: ["alpha", "a.b", "中文目标"] })
      );
      const frame = await startFind("alp");
      for (
        const [key, query] of [["ArrowUp", "alpha"], ["ArrowUp", "a.b"], ["ArrowDown", "alpha"], [
          "ArrowDown",
          "alp",
        ]]
      ) {
        await page.keyboard.press(key);
        await wait(() =>
          frame.$eval("#hud-find-input", (node, query) => node.textContent === query, query)
        );
      }
      await exitFind("Enter");
      await wait(async () => (await inspect()).history === "alp");
    });
    await check("隐藏节点排除、跨节点限制和动态文本重查", async () => {
      await startFind("alpha beta");
      await wait(async () => (await inspect()).query.count === 2);
      await exitFind();
      await page.$eval("#p2", (node) => node.textContent = "omega");
      await startFind("alpha");
      await wait(async () => (await inspect()).query.count === 7);
      await exitFind();
      values.dynamic = 7;
      await page.reload();
      await wait(async () => (await inspect())?.active === "active");
    });
    await check("旧 Visual 查找接口仍接入对应 Find 实现", async () => {
      await reset();
      await page.evaluate(() => {
        const range = document.createRange();
        range.setStart(document.querySelector("#p1").firstChild, 0);
        range.setEnd(document.querySelector("#p1").firstChild, 2);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      await page.keyboard.press("v");
      assert((await inspect()).mode.includes("visual"), "应先进入 Visual");
      await page.keyboard.press("/");
      await wait(async () => (await inspect()).mode.includes("find"));
      assert((await inspect()).independentMode === independentFind, "Visual 不得绕回旧查找算法");
      const frame = await currentFindFrame();
      await page.keyboard.type("不存在的合成词");
      await wait(async () => (await inspect()).query.raw === "不存在的合成词");
      await exitFind();
      assert((await inspect()).mode.includes("visual"), "Esc 应恢复 Visual");
      await page.keyboard.press("Escape");
    });
    await check("实际 BFCache 恢复保留当前文档查询与 n 游标", async () => {
      await startFind("中文目标");
      await exitFind("Enter");
      await wait(async () => (await inspect()).history === "中文目标");
      // Chrome 的扩展 iframe 不进入 BFCache；显式注销共用 HUD 后测试仍活动的查询与 Host。
      const released = await inspect("release-ui");
      assert(
        released.query === "中文目标" && released.listeners === 13,
        "UI 注销不得清空查询或停用引擎",
      );
      const before = await inspect();
      page._client().on("Page.backForwardCacheNotUsed", (event) => {
        metadata.bfcacheNotUsed = event.notRestoredExplanationsTree ||
          event.notRestoredExplanations;
      });
      await page.evaluate(() => {
        globalThis.syntheticFindRestores = 0;
        addEventListener("pageshow", (event) => {
          if (event.persisted) globalThis.syntheticFindRestores++;
        });
      });
      // 两个本机站点触发真实 BrowsingInstance 切换，避免同站导航被浏览器判为不缓存。
      await page.goto(url.replace("127.0.0.1", "localhost") + "?find-navigation=1", {
        waitUntil: "domcontentloaded",
      });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await wait(async () => (await inspect())?.active === "active");
      const restored = await inspect();
      const persisted = await page.evaluate(() => globalThis.syntheticFindRestores);
      metadata.findBfcache = {
        persisted,
        documentSame: restored.documentId === before.documentId,
        epochBefore: before.epoch,
        epochAfter: restored.epoch,
      };
      assert(
        persisted > 0 && restored.documentId === before.documentId && restored.epoch > before.epoch,
        "必须实际恢复同一 BFCache 文档并重新握手",
      );
      await page.bringToFront();
      await page.keyboard.press("n");
      await sleep(120);
      const after = await inspect();
      metadata.findBfcache = {
        persisted,
        epochBefore: before.epoch,
        epochAfter: restored.epoch,
        queryRetained: after.query?.raw === "中文目标",
        nextNode: after.node,
        selection: after.selection,
      };
      assert(
        after.query?.raw === "中文目标" && after.node === "p2" && after.selection === "中文目标",
        "BFCache 恢复丢失当前文档查询或 n 游标",
      );
      values.bfcache = true;
      await page.reload();
      await wait(async () => (await inspect())?.active === "active");
    });
    if (independentFind) {
      await check("旧查询会话迟到消息不能改变新模式", async () => {
        await startFind("alpha");
        const result = await inspect("late-session");
        assert(result.same && result.active, "迟到查询或退出必须拒绝");
        await exitFind();
      });
      await check("晚到 HUD 与快速 Esc 取消保留普通输入", async () => {
        await page.reload();
        await wait(async () => (await inspect())?.active === "active");
        await inspect("delayed-ui");
        await reset();
        await page.keyboard.press("/");
        await page.keyboard.press("Escape");
        await sleep(700);
        const state = await inspect();
        assert(!state.mode.includes("find") && !state.hudShowing, "不能迟到重新显示 Find HUD");
        await page.keyboard.press("j");
        assert(await page.evaluate(() => scrollY) === 60, "取消后普通模式只执行一次");
        await page.reload();
        await wait(async () => (await inspect())?.active === "active");
      });
      await check("连续真实 Find 开关没有模式或资源净增长", async () => {
        const before = await inspect();
        for (let cycle = 0; cycle < 20; cycle++) {
          await startFind("alpha");
          await exitFind();
        }
        const after = await inspect();
        assert(
          JSON.stringify(before.resources) === JSON.stringify(after.resources) &&
            after.mode.length === before.mode.length,
          "查找开关留下监听、模式或订阅",
        );
      });
      await check("原生停止 worker 后新文档与查询历史恢复", async () => {
        await startFind("中文目标");
        await exitFind("Enter");
        await wait(async () => (await inspect()).history === "中文目标");
        const client = await browser.target().createCDPSession();
        const worker = (await client.send("Target.getTargets")).targetInfos.find((item) =>
          item.type === "service_worker" && item.url === target.url()
        );
        assert(
          worker &&
            (await client.send("Target.closeTarget", { targetId: worker.targetId })).success,
          "必须真实终止工作线程",
        );
        await wait(async () =>
          !(await client.send("Target.getTargets")).targetInfos.some((item) =>
            item.targetId === worker.targetId
          )
        );
        await client.detach();
        await page.reload();
        await wait(async () =>
          (await inspect())?.active === "active" && (await inspect()).independent
        );
        const frame = await startFind("");
        await page.keyboard.press("ArrowUp");
        await wait(() => frame.$eval("#hud-find-input", (node) => node.textContent === "中文目标"));
        await exitFind();
      });
      await check("整套回退撤销新查找实现与全部 frame 权限", async () => {
        const result = await options.evaluate(() =>
          chrome.runtime.sendMessage({
            handler: "browserToolbox.runtimeMaintenance",
            action: "restore",
          })
        );
        assert(
          result.ok && result.activeFrames >= 2 && result.refreshRequiredFrames === 0 &&
            result.failedFrames === 0,
          "整套回退失败",
        );
        assert(
          (await inspect()).plan === 1 && !(await inspect()).independent,
          "不得残留新查找控制器",
        );
        await page.keyboard.press("n");
        await wait(async () =>
          (await inspect()).node === "p2" && (await inspect()).selection === "中文目标"
        );
        await startFind("alpha");
        assert(!(await inspect()).independentMode, "恢复后必须使用旧查找");
        await exitFind();
      });
    }
    if (headed) {
      await options.evaluate(() => chrome.storage.local.remove("browserToolboxRuntimePlan"));
      await page.reload();
      await wait(async () =>
        (await inspect()).plan === canaryPlan && (await inspect()).independent
      );
      await reset();
      metadata.manualState = await inspect();
      metadata.optionsUrl = `chrome-extension://${id}/pages/mouse_options.html#general`;
      await page.screenshot({
        path: path.join(path.dirname(reportPath), "Phase4-Find-headed-合成入口.png"),
      });
    }
    return values;
  } catch (failure) {
    metadata.failure = failure.message;
    throw failure;
  } finally {
    if (headed) browser.disconnect();
    else {
      await browser.close();
      await Deno.remove(profile, { recursive: true });
    }
  }
}
try {
  const compat = await run("旧 Find（方案2）", compatPath, 2);
  const canary = await run(`独立 Find（方案${canaryPlan}）`, canaryPath, canaryPlan);
  assert(JSON.stringify(compat) === JSON.stringify(canary), "旧新查找关键结果不同");
  report.comparisons = { compat, canary, equal: true };
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
  console.log(`新查找人工入口：${url}`);
  await new Promise(() => {});
}
