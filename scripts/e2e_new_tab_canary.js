// SPDX-License-Identifier: GPL-3.0-or-later
import * as path from "@std/path";
import { launchCanaryBrowser, resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const current = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const frozen = Deno.env.get("BROWSER_TOOLBOX_NEW_TAB_COMPAT_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_NEW_TAB_REPORT");
const nativeRequest = Deno.env.get("BROWSER_TOOLBOX_NEW_TAB_NATIVE_REQUEST");
if (!executablePath || !current || !frozen) throw new Error("缺少 CFT 或新标签对照构建");
const target = "https://vimium.github.io/new-tab/";
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-new-tab-e2e-" });
const report = {
  status: "running",
  checks: [],
  browsers: [],
  target,
  response: "本机 TLS 合成响应",
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(read, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (result) return result;
    await delay(35);
  } while (Date.now() < deadline);
  throw new Error(message);
}
async function check(name, action) {
  try {
    const data = await action();
    report.checks.push({ name, status: "passed", ...(data ? { data } : {}) });
    console.log(`新标签验收通过：${name}`);
  } catch (error) {
    report.checks.push({ name, status: "failed", error: error.message });
    throw error;
  }
}
async function openssl(args, input) {
  const child = new Deno.Command("openssl", {
    args,
    stdout: "piped",
    stderr: "piped",
    stdin: input ? "piped" : "null",
  }).spawn();
  if (input) {
    const writer = child.stdin.getWriter();
    await writer.write(input);
    await writer.close();
  }
  const output = await child.output();
  assert(output.success, `本机测试证书生成失败：${new TextDecoder().decode(output.stderr)}`);
  return output.stdout;
}
const keyPath = path.join(temporary, "fixture.key");
const certPath = path.join(temporary, "fixture.pem");
await openssl([
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "1",
  "-subj",
  "/CN=vimium.github.io",
  "-keyout",
  keyPath,
  "-out",
  certPath,
]);
const publicKey = await openssl(["x509", "-in", certPath, "-pubkey", "-noout"]);
const spki = await openssl(["pkey", "-pubin", "-outform", "DER"], publicKey);
const fingerprint = btoa(
  String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", spki))),
);
const fixture = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>新标签合成验收</title>
  <h1 id="source">浏览器工具箱新标签合成验收</h1><a href="/next">下一页</a>
  <script>window.restored = 0; addEventListener("pageshow", e => { if (e.persisted) restored++; });</script>`,
    {
      headers: { "content-type": "text/html;charset=utf-8" },
    },
  );
const http = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, fixture);
const tls = Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  onListen() {},
  cert: await Deno.readTextFile(certPath),
  key: await Deno.readTextFile(keyPath),
}, fixture);
const local = `http://127.0.0.1:${http.addr.port}`;
const originalNewTab = (tab) => /^chrome:\/\/(?:newtab|new-tab-page)\/?$/.test(tab.url);
const mappings = [
  `map zu createTab ${local}/one ${local}/two position=start`,
  `map zb createTab ${local}/before position=before`,
  `map ze createTab ${local}/end position=end`,
  `map zw createTab ${local}/window-one ${local}/window-two window`,
  `map zi createTab ${local}/incognito incognito`,
  "map zn createTab incognito",
].join("\n");

async function inBackground(browser, id, action) {
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" &&
    item.url() === `chrome-extension://${id}/background_scripts/main.js`
  );
  // 无痕开关会重新创建扩展 worker；直接使用该 Native target 的上下文，
  // 避免复用 Puppeteer 旧 WebWorker 对象保存的执行上下文。
  const client = await target.createCDPSession();
  try {
    await client.send("Runtime.enable", {}, { timeout: 5000 });
    await client.send("Runtime.runIfWaitingForDebugger", {}, { timeout: 5000 });
    const result = await client.send("Runtime.evaluate", {
      expression: `(${action.toString()})()`,
      awaitPromise: true,
      returnByValue: true,
    }, { timeout: 10000 });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    }
    return result.result.value;
  } finally {
    await client.detach();
  }
}

async function run(directory, plan) {
  const profile = await Deno.makeTempDir({ dir: temporary, prefix: `plan-${plan}-` });
  let session, options, source, id;
  const observe = (func, ...args) => options.evaluate(func, ...args);
  const tabs = () => observe(() => chrome.tabs.query({}));
  const state = (tabId) =>
    observe(async (tabId) => {
      try {
        const [entry] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            const vomnibar = globalThis.BrowserToolboxVomnibarControllerInstance;
            return host && {
              state: host.state,
              plan: host.plan.planVersion,
              epoch: host.runtimeEpoch,
              documentId: host.context.documentId,
              showing: globalThis.Vomnibar?.vomnibarUI?.showing === true,
              component: Boolean(globalThis.Vomnibar?.vomnibarUI),
              interaction: vomnibar?.interactionId || null,
              independent: typeof globalThis.BrowserToolboxNewTabRuntime !== "undefined",
              configuredDestination: globalThis.Settings?.get("newTabDestination"),
            };
          },
        });
        return entry.result;
      } catch (_) {
        return null;
      }
    }, tabId);
  const activeRuntime = (tabId, version = plan) =>
    wait(async () => {
      const value = await state(tabId);
      return value?.state === "active" && value.plan === version && value;
    }, `方案 ${version} 文档未激活：${tabId}`);
  const tabIdOf = async (url) =>
    (await tabs()).find((tab) => tab.url === url && !tab.incognito)?.id;
  async function configure(keyboard, startup) {
    await observe(async ({ keyboard, startup }) => {
      const read = await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "read",
      });
      if (!read?.ok) throw new Error("配置读取失败");
      const input = { baseline: {} };
      if (keyboard) {
        input.baseline.keyboard = read.value.keyboard;
        input.legacyPatch = keyboard;
      }
      if (startup) {
        input.baseline.toolbox = read.value.toolboxSource.value;
        input.toolbox = { ...read.value.toolboxSource.value, browserStartup: startup };
      }
      const result = await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input,
      });
      if (!result?.ok) throw new Error(`配置提交失败：${JSON.stringify(result)}`);
    }, { keyboard, startup });
  }
  const watch = () =>
    options.evaluate(() => {
      globalThis.newTabObservations = [];
      if (globalThis.newTabListener) chrome.tabs.onCreated.removeListener(newTabListener);
      globalThis.newTabListener = ({ id, active, incognito, windowId }) =>
        newTabObservations.push({ id, active, incognito, windowId });
      chrome.tabs.onCreated.addListener(newTabListener);
    });
  async function launch() {
    session = await launchCanaryBrowser({
      label: "新标签页面",
      plan,
      extensionPath: directory,
      launchOptions: {
        executablePath,
        headless: false,
        userDataDir: profile,
        defaultViewport: { width: 1200, height: 850 },
        ignoreDefaultArgs: ["--disable-extensions", "--disable-back-forward-cache"],
        args: [
          `--disable-extensions-except=${directory}`,
          `--load-extension=${directory}`,
          "--window-size=1280,950",
          "--no-proxy-server",
          "--disable-quic",
          `--host-resolver-rules=MAP vimium.github.io 127.0.0.1:${tls.addr.port}`,
          `--ignore-certificate-errors-spki-list=${fingerprint}`,
        ],
      },
    });
    const nextId = await resolveCanaryExtensionId(session.browser);
    assert(!id || id === nextId, "重启改变扩展 ID");
    id = nextId;
    report.browsers.push({
      plan,
      directory,
      version: await session.browser.version(),
      launch: session.metadata,
    });
    options = await session.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector('main[data-settings-ready="true"]');
    await watch();
  }
  async function fixturePage(url) {
    const page = await session.newPage();
    await page.goto(url);
    return page;
  }
  async function freshSource(version = plan) {
    if (source && !source.isClosed()) await source.close();
    source = await fixturePage(local + "/source");
    const tabId = await tabIdOf(source.url());
    await activeRuntime(tabId, version);
    return tabId;
  }
  async function capture(action, count, predicate, timeout) {
    const before = new Set((await tabs()).map((tab) => tab.id));
    await observe(() => newTabObservations.splice(0));
    await action();
    const added = await wait(
      async () => {
        const created = (await tabs()).filter((tab) => !before.has(tab.id));
        return created.length === count && predicate(created) && created;
      },
      `创建次数或导航不符，期望 ${count} 张`,
      timeout,
    ).catch(async (error) => {
      report.lastObserved = (await tabs()).filter((tab) => !before.has(tab.id));
      throw error;
    });
    const events = await observe(() => newTabObservations.slice());
    assert(
      events.length === count && events.every((entry) => added.some((tab) => tab.id === entry.id)),
      `实际 onCreated 次数不符：${JSON.stringify(events)}`,
    );
    return { added, events };
  }
  async function keys(sequence) {
    await session.activatePage(source, options);
    // Chrome 刚关闭活动标签时可能还在迁移焦点。准备阶段点击来源页，
    // 后续不补焦点，实际按键、创建次数和前后台结果仍独立断言。
    await source.click("#source");
    await wait(() => source.evaluate(() => document.hasFocus()), "来源页未获得原生按键焦点");
    await source.keyboard.type(sequence);
  }
  const closeTabs = (added) =>
    observe((ids) => chrome.tabs.remove(ids), added.map((tab) => tab.id));
  async function testKeyboard(sequence, urls, verify, version = plan) {
    const from = await freshSource(version);
    const result = await capture(
      () => keys(sequence),
      urls.length,
      (list) =>
        urls.every((url, index) => list.sort((a, b) => a.index - b.index)[index].url === url),
    );
    await verify?.(result, from);
    await closeTabs(result.added);
    return result;
  }
  async function enableIncognito() {
    const management = await fixturePage(`chrome://extensions/?id=${id}`);
    await session.activatePage(management, options);
    const developer = await management.waitForSelector("pierce/#devMode");
    if (!(await developer.evaluate((element) => element.checked))) await developer.click();
    const row = await management.waitForSelector("pierce/#allow-incognito");
    const geometry = await row.evaluate((element) => {
      element.scrollIntoView({ block: "center" });
      const toggle = element.shadowRoot.querySelector("cr-toggle");
      const rect = toggle.getBoundingClientRect();
      return { checked: toggle.checked, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    if (!geometry.checked) await management.mouse.click(geometry.x, geometry.y);
    await wait(
      () => row.evaluate((element) => element.shadowRoot.querySelector("cr-toggle").checked),
      "无痕权限测试开关未开启",
    );
    const previous = options;
    options = await session.newPage();
    await wait(async () => {
      try {
        await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
        return await options.evaluate(() =>
          new Promise((resolve) => chrome.extension.isAllowedIncognitoAccess(resolve))
        );
      } catch (error) {
        // 无痕开关会重建扩展；仅在本次导航或权限读取遇到该重建时继续原有有界等待。
        if (
          error.message.includes("ERR_BLOCKED_BY_CLIENT") ||
          error.message.includes("Execution context was destroyed")
        ) {
          (report.incognitoPreparationRetries ||= []).push({ plan, reason: error.message.includes("ERR_BLOCKED_BY_CLIENT")
            ? "extension-reloading" : "execution-context-destroyed" });
          return false;
        }
        throw error;
      }
    }, "重建后的扩展没有取得无痕权限");
    await previous.close().catch(() => {});
    await management.close();
    await options.waitForSelector('main[data-settings-ready="true"]');
    await watch();
  }
  try {
    await launch();
    if (plan === 9) {
      await inBackground(session.browser, id, () => {
        if (typeof globalThis.BrowserToolboxNewTabCommands?.createTab !== "function") {
          throw new Error("方案 9 未加载独立后台命令");
        }
        BackgroundCommands.createTab = () => {
          throw new Error("方案 9 错误进入旧 createTab");
        };
      });
    }
    await configure({
      keyMappings: mappings,
      newTabDestination: "customUrl",
      newTabCustomUrl: local + "/custom",
      openVomnibarOnNewTabPage: true,
    });
    await check(`方案 ${plan}：实际 t 与 2t 读取自定义目的地并恰好创建指定数量`, async () => {
      await testKeyboard("t", [local + "/custom"]);
      return await testKeyboard("2t", Array(2).fill(local + "/custom"), ({ added }, from) => {
        assert(
          added[0].active && !added[1].active && added[0].openerTabId === from &&
            added[1].openerTabId === added[0].id,
          "重复创建时前后台或 opener 顺序异常",
        );
      });
    });
    await check(`方案 ${plan}：多 URL、次数、start/before/end 位置与前后台`, async () => {
      const repeated = await testKeyboard(
        "2zu",
        ["/one", "/two", "/one", "/two"].map((part) => local + part),
        ({ added, events }) => {
          assert(
            added[0].index === 0 && added.every((tab, i) =>
              tab.index === i && tab.active === (i === 0)
            ) &&
              events.every((entry, i) => entry.id === added[i].id && entry.active === (i === 0)),
            "多 URL 的位置、创建顺序或活动标签不符",
          );
        },
      );
      await testKeyboard("zb", [local + "/before"], async ({ added }, from) => {
        const origin = (await tabs()).find((tab) => tab.id === from);
        assert(added[0].index === origin.index - 1, "before 位置错误");
      });
      await testKeyboard("ze", [local + "/end"], async ({ added }) => {
        const members = (await tabs()).filter((tab) => tab.windowId === added[0].windowId);
        assert(added[0].index === members.length - 1, "end 位置错误");
      });
      return repeated;
    });
    await check(
      `方案 ${plan}：显式 URL 优先于映射和设置，经 Native 命令入口只创建一张`,
      async () => {
        const tabId = await freshSource();
        let response;
        const result = await capture(
          async () => {
            response = await observe(async ({ tabId, explicit, mapped }) => {
              const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId },
                func: async (explicit, mapped) => {
                  const host = BrowserToolboxRuntimeHostInstance;
                  const identity = {
                    documentId: host.context.documentId,
                    runtimeEpoch: host.runtimeEpoch,
                    incognito: host.context.incognito === true,
                  };
                  const invocation = BrowserToolboxCommandInvocation.createV2(
                    "createTab",
                    { [mapped]: true },
                    { type: "keyboard" },
                    { sourceFrameId: 0, linkUrl: explicit },
                    1,
                    { identity },
                  );
                  const request = BrowserToolboxMessageProtocol.envelope("command", "invoke", {
                    invocation,
                  }, identity);
                  request.requestId = invocation.requestId;
                  return await chrome.runtime.sendMessage(request);
                },
                args: [explicit, mapped],
              });
              return result;
            }, { tabId, explicit: local + "/explicit", mapped: local + "/mapped" });
            assert(response?.ok, `显式 URL Native 命令失败：${JSON.stringify(response)}`);
          },
          1,
          ([tab]) => tab.url === local + "/explicit",
        );
        await closeTabs(result.added);
        return result;
      },
    );
    await check(
      `方案 ${plan}：实际按键在新窗口打开有序列表`,
      async () =>
        await testKeyboard(
          "zw",
          [local + "/window-one", local + "/window-two"],
          async ({ added }, from) => {
            const origin = (await tabs()).find((tab) => tab.id === from);
            assert(
              added[0].windowId !== origin.windowId && added[0].windowId === added[1].windowId &&
                added.every((tab) => !tab.incognito),
              "新窗口的类型或成员错误",
            );
          },
        ),
    );
    await check(`方案 ${plan}：浏览器目的地和空自定义 URL 都创建原生新标签`, async () => {
      for (const newTabDestination of ["browserNewTabPage", "customUrl"]) {
        await configure({ newTabDestination, newTabCustomUrl: "" });
        await freshSource();
        const result = await capture(() => keys("t"), 1, ([tab]) => originalNewTab(tab));
        await closeTabs(result.added);
      }
    });
    await check(
      `方案 ${plan}：精确 Vimium URL 自动打开，关闭与 BFCache 回退不会再次弹出`,
      async () => {
        await configure({ newTabDestination: "vimiumNewTabPage" });
        await freshSource();
        const { added } = await capture(() => keys("t"), 1, ([tab]) => tab.url === target);
        const tabId = added[0].id;
        const page = await wait(
          async () => (await session.browser.pages()).find((page) => page.url() === target),
          "找不到已创建的 Vimium 标签",
        );
        try {
          await page.waitForSelector("#source", { timeout: 10000 });
        } catch (error) {
          report.fixtureFailure = await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            text: document.body?.innerText?.slice(0, 500),
          })).catch(() => null);
          throw error;
        }
        const opened = await wait(async () => {
          const value = await state(tabId);
          return value?.showing && value;
        }, "精确 Vimium URL 没有自动打开");
        assert(opened.plan === plan && opened.independent === (plan === 9), "新标签模块选择错误");
        await session.activatePage(page, options);
        await page.keyboard.press("Escape");
        await wait(async () => {
          const value = await state(tabId);
          return value?.showing === false && value.component === false;
        }, "Esc 后自动面板没有销毁");
        // 等待真实页面导航提交；回退必须恢复原文档，重新加载也不能冒充 BFCache。
        const cdp = await page.createCDPSession();
        await cdp.send("Page.enable");
        cdp.on("Page.backForwardCacheNotUsed", (event) => report.backForwardCacheNotUsed = event);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.click("a"),
        ]);
        assert(new URL(page.url()).pathname === "/next", "链接没有导航到下一文档");
        await page.goBack({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => location.pathname === "/new-tab/" && window.restored === 1,
          { timeout: 12000, polling: 50 },
        );
        await cdp.detach();
        const restored = await activeRuntime(tabId);
        assert(
          restored.documentId === opened.documentId && restored.epoch > opened.epoch &&
            !restored.showing,
          `回退文档或面板状态异常：${JSON.stringify({ opened, restored })}`,
        );
        await closeTabs(added);
        return { opened, restored };
      },
    );
    await check(`方案 ${plan}：URL 变体和关闭设置时不自动打开`, async () => {
      for (const url of [target + "?variant=1", target + "#variant", target + "other"]) {
        const page = await fixturePage(url);
        const tabId = await tabIdOf(url);
        await activeRuntime(tabId);
        await delay(350);
        assert((await state(tabId)).showing === false, `错误触发：${url}`);
        await page.close();
      }
      await configure({ openVomnibarOnNewTabPage: false });
      const page = await fixturePage(target);
      const tabId = await tabIdOf(target);
      await activeRuntime(tabId);
      await delay(350);
      assert((await state(tabId)).showing === false, "关闭设置后仍自动打开");
      await page.close();
    });
    await check(`方案 ${plan}：原生重定向与键盘创建原生标签组合，普通网页不受影响`, async () => {
      await configure({ newTabDestination: "browserNewTabPage" }, {
        enabled: false,
        url: local + "/redirect",
        newTabEnabled: true,
      });
      await testKeyboard("t", [local + "/redirect"]);
      const result = await capture(
        () => observe(() => chrome.tabs.create({})),
        1,
        ([tab]) => tab.url === local + "/redirect",
      );
      await closeTabs(result.added);
      if (nativeRequest && plan === 9) {
        await freshSource();
        await session.activatePage(source, options);
        const native = await capture(
          () =>
            Deno.writeTextFile(
              nativeRequest,
              JSON.stringify({
                pid: session.pid,
                mode: session.metadata.mode,
                appPath: session.metadata.appPath,
                url: source.url(),
              }),
              { createNew: true },
            ),
          1,
          ([tab]) => tab.url === local + "/redirect",
          90000,
        );
        await closeTabs(native.added);
        report.nativeBrowserEntry = native;
      }
      assert(
        (await tabs()).filter((tab) => tab.url === local + "/redirect").length === 0,
        "仅开启原生新标签重定向时不应产生额外标签",
      );
      return result;
    });
    if (plan === 9) {
      await check("方案 9：启动导航器使用原生标签 API、去重且与原生新标签开关独立", async () => {
        const url = local + "/startup";
        await configure(null, { enabled: true, url, newTabEnabled: false });
        let startupResults;
        const opened = await capture(
          async () => {
            // 这里只触发导航器。浏览器重启事件另由持久安装的真实 CFT 验收。
            startupResults = await inBackground(session.browser, id, async () => {
              const settings = browserToolboxSettingsRepository.getSettings();
              const navigator = new BrowserToolboxBrowserStartup.BrowserStartupNavigator();
              return [
                await navigator.openConfiguredPage(settings),
                await navigator.openConfiguredPage(settings),
              ];
            });
          },
          1,
          ([tab]) => tab.url === url && !tab.incognito,
        );
        assert(
          startupResults[0].opened && startupResults[1].reason === "already-handled",
          "启动导航器未按既有规则去重",
        );
        const native = await capture(
          () => observe(() => chrome.tabs.create({})),
          1,
          ([tab]) => originalNewTab(tab),
        );
        await closeTabs([...opened.added, ...native.added]);
        return { startupResults, created: opened.events, native: native.added[0].url };
      });
      await check("方案 9：真实无痕窗口、多余导航及无痕原生重定向隔离", async () => {
        await configure(null, { enabled: false, url: local + "/redirect", newTabEnabled: true });
        await enableIncognito();
        await testKeyboard("zi", [local + "/incognito"], ({ added }) => {
          assert(added[0].incognito, "映射没有创建无痕窗口");
        });
        await freshSource();
        const result = await capture(
          () => keys("zn"),
          1,
          ([tab]) => originalNewTab(tab) && tab.incognito,
        );
        await closeTabs(result.added);
        return result;
      });
      await check("回退方案 1：维护按钮恢复，键盘目的地及原 Vimium 自动打开可用", async () => {
        await configure({
          newTabDestination: "vimiumNewTabPage",
          openVomnibarOnNewTabPage: true,
        });
        await options.goto(options.url().split("#")[0] + "#general");
        await options.$eval("#runtime-maintenance", (node) => node.open = true);
        await session.activatePage(options, options);
        await options.click("#runtime-restore");
        await wait(
          () =>
            observe(async () =>
              (await chrome.storage.local.get("browserToolboxRuntimePlan"))
                .browserToolboxRuntimePlan?.planVersion === 1
            ),
          "未恢复方案 1",
        );
        await watch();
        await freshSource(1);
        const { added } = await capture(() => keys("t"), 1, ([tab]) => tab.url === target);
        await wait(async () => {
          const value = await state(added[0].id);
          return value?.plan === 1 && value.showing;
        }, "回退后的旧新标签入口失效");
        await closeTabs(added);
      });
    }
  } finally {
    await session?.close();
  }
}
try {
  await run(frozen, 8);
  await run(current, 9);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack || error.message;
  Deno.exitCode = 1;
  console.error(report.error);
} finally {
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await Promise.all([http.shutdown(), tls.shutdown()]);
  await Deno.remove(temporary, { recursive: true });
}
