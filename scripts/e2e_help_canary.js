// SPDX-License-Identifier: GPL-3.0-or-later
// 使用合成页面与独立profile做真实旧新帮助对照；不覆盖操作系统输入法验收。
import * as path from "@std/path";
import { launchCanaryBrowser, resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const current = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const compatible = Deno.env.get("BROWSER_TOOLBOX_HELP_COMPAT_PATH");
const compatiblePlan = Number(Deno.env.get("BROWSER_TOOLBOX_HELP_COMPAT_PLAN_VERSION") || 8);
const currentPlan = Number(Deno.env.get("BROWSER_TOOLBOX_HELP_PLAN_VERSION") || 8);
const reportPath = Deno.env.get("BROWSER_TOOLBOX_HELP_REPORT");
if (!executablePath || !current || !compatible) throw new Error("缺少CFT及帮助旧新构建路径");
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  checks: [],
  browsers: [],
  systemIme: "按用户安排延期，未执行系统输入法验收",
};
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(fn, message) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error(message);
}
async function check(name, action) {
  try {
    const data = await action();
    report.checks.push({ name, status: "passed", ...(data ? { data } : {}) });
    console.log(`帮助验收通过：${name}`);
  } catch (error) {
    report.checks.push({ name, status: "failed", error: error.message });
    throw error;
  }
}
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const child = new URL(request.url).pathname === "/child";
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>帮助页原生验收${
      child ? "子框架" : ""
    }</title>
<style>body{font:18px/1.7 system-ui;margin:40px;min-height:8000px}iframe{height:240px;width:90%}</style>
<h1 id="heading">浏览器工具箱帮助页原生验收</h1><p>? / zh 打开帮助；Esc 关闭；j 滚动。</p><a href="#target">合成链接</a><input aria-label="输入保护">
${
      child
        ? ""
        : '<iframe src="/child" title="帮助来源子框架"></iframe>'
    }<p id="target" style="margin-top:3000px">中文目标</p></html>`,
    { headers: { "content-type": "text/html;charset=utf-8" } },
  );
});
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/fixture`;
let baseline;
async function run(directory, independent, forcedPlan = null) {
  const variant = forcedPlan ? `回退方案${forcedPlan}` : independent ? "独立" : "冻结";
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-help-cft-" });
  const session = await launchCanaryBrowser({
    label: "帮助页面",
    plan: forcedPlan || (independent ? currentPlan : compatiblePlan),
    extensionPath: directory,
    launchOptions: {
      executablePath,
      headless: false,
      userDataDir: profile,
      defaultViewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${directory}`,
        `--load-extension=${directory}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,1000",
      ],
    },
  });
  const browser = session.browser;
  const metadata = {
    independent,
    directory,
    profile,
    version: await browser.version(),
    session: session.metadata,
    errors: [],
  };
  report.browsers.push(metadata);
  let page;
  let optionsForTrace;
  let inspectFailure;
  try {
    const id = await resolveCanaryExtensionId(browser);
    const options = await session.newPage();
    optionsForTrace = options;
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    if (forcedPlan) {
      await options.evaluate((planVersion) =>
        chrome.storage.local.set({
          browserToolboxRuntimePlan: { formatVersion: 1, planVersion },
        }), forcedPlan);
    }
    await options.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "read",
      });
      if (!response?.ok) throw new Error("帮助测试配置读取失败");
      const result = await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: {
          baseline: { keyboard: response.value.keyboard },
          legacyPatch: {
            keyMappings: "map zh showHelp\nmap a reload\nmap <c-r> reload\nmap R reload hard",
            userDefinedLinkHintCss: "#dialog { --browser-toolbox-help-probe: preserved; }",
          },
        },
      });
      if (!result?.ok) throw new Error(`帮助测试配置提交失败：${JSON.stringify(result)}`);
    });
    await options.evaluate(() => {
      globalThis.syntheticHelpEvents = [];
      chrome.tabs.onCreated.addListener((tab) => {
        syntheticHelpEvents.push({ kind: "tab-created", at: Date.now(), id: tab.id,
          url: tab.url || tab.pendingUrl || "" });
      });
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.handler === "openOptionsPageInNewTab") {
          syntheticHelpEvents.push({ kind: "open-options-message", at: Date.now() });
        }
      });
    });
    page = await session.newPage();
    metadata.pointerEvents = [];
    await page.evaluateOnNewDocument(() => {
      for (const name of ["pointerdown", "click", "auxclick"]) {
        globalThis.addEventListener(name, (event) => {
          const target = event.composedPath()[0];
          console.log("PHASE4_POINTER " + JSON.stringify({
            at: Date.now(), path: location.pathname, name, trusted: event.isTrusted,
            button: event.button, tag: target?.tagName, id: target?.id,
            x: event.clientX, y: event.clientY, focus: document.hasFocus(),
          }));
        }, true);
      }
    });
    page.on("console", (message) => {
      const value = message.text();
      if (value.startsWith("PHASE4_POINTER ")) {
        try { metadata.pointerEvents.push(JSON.parse(value.slice(15))); } catch (_) { /* 仅保留有效事件。 */ }
      }
    });
    page.on("pageerror", (error) => metadata.errors.push(error.message));
    await page.goto(fixtureUrl);
    const tabId = await options.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      fixtureUrl,
    );
    async function isolated(operation, input = null) {
      return options.evaluate(async ({ tabId, operation, input }) => {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (operation, input) => {
            const ui = globalThis.BrowserToolboxUIControllerInstance;
            const component = ui?.help?.component || globalThis.HelpDialog?.helpUI;
            if (operation === "state") {
              return {
                state: BrowserToolboxRuntimeHostInstance.state,
                plan: BrowserToolboxRuntimeHostInstance.plan.planVersion,
                showing: Boolean(HelpDialog.isShowing()),
                componentShowing: component?.showing === true,
                counts: component?.resources?.counts(),
                components: ui?.components.size,
                focus: document.hasFocus(),
                scroll: scrollY,
                error: ui?.lastErrorCode || null,
              };
            }
            if (operation === "cancel") {
              const help = ui.help, original = help.summary;
              let release;
              help.summary = () => new Promise((resolve) => release = resolve);
              const first = help.toggle();
              await Promise.resolve();
              await Promise.resolve();
              help.abort(false);
              release({ stateAvailable: true });
              await first;
              help.summary = original;
              return !help.showing;
            }
            if (operation === "cycles") {
              for (let n = 0; n < input; n++) {
                await ui.help.toggle({ sourceFrameId: 0 });
                await ui.help.toggle();
              }
            }
          },
          args: [operation, input],
        });
        return results[0]?.result;
      }, { tabId, operation, input });
    }
    inspectFailure = async () => ({
      owner: await isolated("state"),
      frames: await Promise.all(
        page.frames().map(async (frame) => ({
          path: new URL(frame.url()).pathname,
          state: await frame.evaluate(() => ({
            focus: document.hasFocus(),
            active: document.activeElement?.tagName,
            host: globalThis.BrowserToolboxRuntimeHostInstance?.state,
            modes: globalThis.Mode?.modes.map((m) => m.name),
          })).catch(() => null),
        })),
      ),
    });
    await wait(async () => (await isolated("state")).state === "active", "帮助宿主未激活");
    assert((await isolated("state")).plan === (forcedPlan || (independent ? currentPlan : compatiblePlan)),
      "帮助宿主方案与构建不符");
    await session.activatePage(page, options);
    const helpFrame = async () => {
      await wait(
        () =>
          page.frames().some((frame) =>
            frame.url() === `chrome-extension://${id}/pages/help_dialog_page.html`
          ),
        "帮助iframe未加载",
      );
      return page.frames().find((frame) =>
        frame.url() === `chrome-extension://${id}/pages/help_dialog_page.html`
      );
    };
    const open = async (keys = "?") => {
      await page.keyboard.type(keys);
      await wait(async () => (await isolated("state")).componentShowing, "帮助没有显示");
      const frame = await helpFrame();
      await frame.waitForSelector(".row");
      await wait(() => frame.evaluate(() => document.hasFocus()), "帮助页未得到原生焦点");
      await wait(
        () =>
          frame.evaluate(() => globalThis.BrowserToolboxRuntimeHostInstance?.state === "active"),
        "帮助页面键盘宿主尚未就绪",
      );
      return frame;
    };
    const close = async () => {
      await page.keyboard.press("Escape");
      await wait(async () => !(await isolated("state")).showing, "Esc未关闭帮助");
      await wait(async () => (await isolated("state")).focus, "Esc关闭后原生焦点尚未恢复");
    };
    async function waitForPointerSurface(frame) {
      // 旧帮助重开时 DOM 已可命中，CFT 的合成命中区域仍可能停留在父框架。
      await frame.evaluate(() =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      );
      await page.screenshot();
    }
    let frame;
    await check(
      `${variant}帮助原生打开、命令渲染、用户CSS与ARIA`,
      async () => {
        frame = await open();
        const view = await frame.evaluate(() => ({
          rows: [...document.querySelectorAll(".row")].map((row) => ({
            keys: [...row.querySelectorAll(".key")].map((el) => el.textContent),
            description: row.querySelector(".help-description").textContent,
            advanced: row.classList.contains("advanced"),
          })),
          role: document.querySelector("#dialog").getAttribute("role"),
          css: getComputedStyle(document.querySelector("#dialog")).getPropertyValue(
            "--browser-toolbox-help-probe",
          ).trim(),
          resources: performance.getEntriesByType("resource").map((entry) =>
            new URL(entry.name).pathname
          ),
          independent: globalThis.HelpDialogPage?.constructor.name === "HelpController",
          host: globalThis.BrowserToolboxRuntimeHostInstance?.state,
        }));
        assert(
          view.role === "dialog" && view.css === "preserved" && view.host === "active",
          `帮助语义、CSS或唯一键盘宿主不正确：${
            JSON.stringify({ role: view.role, css: view.css, host: view.host })
          }`,
        );
        assert(view.rows.length > 30, "帮助命令列表不完整");
        const usesIndependent = !forcedPlan && (independent || compatiblePlan === 8);
        assert(view.independent === usesIndependent, "帮助控制器路径不符");
        if (usesIndependent) {
          assert(
            !view.resources.includes("/pages/all_content_scripts.js") &&
              !view.resources.includes("/pages/help_dialog_page.js"),
            "独立页面加载了旧页面算法",
          );
        }
        if (baseline) {
          assert(
            JSON.stringify(view.rows) === JSON.stringify(baseline),
            "旧新帮助命令、键位或高级分类不一致",
          );
        } else baseline = view.rows;
        return {
          rows: view.rows.length,
          controller: view.independent ? "HelpController" : "HelpDialogPage",
        };
      },
    );
    await check(`${variant}高级命令偏好保存及重开`, async () => {
      // 第4轮实测可信点击落在父文档的 iframe，等合成命中区域就绪后仍按原坐标点击。
      await waitForPointerSurface(frame);
      await frame.click("#toggle-advanced a");
      await wait(
        () =>
          frame.evaluate(() =>
            document.querySelector("#dialog").classList.contains("show-advanced")
          ),
        "高级命令未显示",
      );
      await wait(() =>
        options.evaluate(async () => {
          const result = await chrome.runtime.sendMessage({
            handler: "browserToolbox.configuration",
            action: "read",
          });
          return result.ok && result.value.keyboard.helpDialog_showAdvancedCommands === true;
        }), "高级命令偏好未完成持久提交");
      await close();
      // 新文档重新加载已提交映射和偏好，避免把提交后仍在发布的多键映射当作测试前置。
      await page.reload();
      await wait(
        async () => (await isolated("state")).state === "active",
        "重载后的帮助宿主未激活",
      );
      await session.activatePage(page, options);
      frame = await open("zh");
      await wait(
        () =>
          frame.evaluate(() =>
            document.querySelector("#dialog").classList.contains("show-advanced")
          ),
        "高级命令偏好未保存",
      );
      await page.keyboard.type("zh");
      await wait(async () => !(await isolated("state")).showing, "帮助内自定义映射未关闭");
    });
    await check(`${variant}关闭链接、空白关闭与主frame归焦`, async () => {
      frame = await open();
      // 使用真实 iframe 内容坐标；避免自动滚动关闭链接时移动测试目标。
      const closePoint = await frame.evaluate(() => {
        const close = document.querySelector("#close");
        const rect = close.getBoundingClientRect();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        return { x, y, valid: close.contains(document.elementFromPoint(x, y)) };
      });
      const closeFrame = await frame.frameElement();
      const closeBox = await closeFrame?.boundingBox();
      assert(closeBox && closePoint.valid, "关闭链接不在原生点击位置");
      await waitForPointerSurface(frame);
      await page.mouse.click(closeBox.x + closePoint.x, closeBox.y + closePoint.y);
      await wait(
        async () => !(await isolated("state")).showing && (await isolated("state")).focus,
        "关闭链接未恢复主frame焦点",
      );
      frame = await open();
      // 按实际 iframe 边界点击空白；旧 offset 相对于 html 的边框，
      // 其外边距折叠后可能与 viewport 原点不同。
      const hit = await frame.evaluate(() => {
        const x = Math.floor(innerWidth / 2), y = 24;
        const target = document.elementFromPoint(x, y);
        return { x, y, target: target?.tagName, outside: Boolean(target && !document.querySelector("#dialog").contains(target)) };
      });
      const frameElement = await frame.frameElement();
      const box = await frameElement?.boundingBox();
      assert(box && hit.outside, "没有可点击的帮助页空白区域");
      await waitForPointerSurface(frame);
      await page.mouse.click(box.x + hit.x, box.y + hit.y);
      await wait(async () => !(await isolated("state")).showing, "空白点击未关闭帮助");
      return hit;
    });
    await check(`${variant}子frame打开与Esc定向归焦`, async () => {
      const child = page.frames().find((f) => f.url().endsWith("/child"));
      await child.click("#heading");
      frame = await open();
      await close();
      await wait(() => child.evaluate(() => document.hasFocus()), "帮助未归还子frame焦点");
      await page.click("#heading");
    });
    await check(`${variant}主中键设置链接各只创建一个设置标签`, async () => {
      for (const button of ["left", "middle"]) {
        frame = await open();
        // 同一旧界面重开后也须完成绘制，主键和中键仍分别检查原生事件和建标签数。
        await waitForPointerSurface(frame);
        const before = (await browser.pages()).length;
        (metadata.pointerAttempts ||= []).push({ button, before, at: Date.now() });
        await frame.click("#options-page", { button });
        await wait(
          async () => (await browser.pages()).length === before + 1,
          "设置链接没有恰好创建一个标签",
        );
        const created = (await browser.pages()).find((p) =>
          p.url() === `chrome-extension://${id}/pages/options.html`
        );
        assert(created, "设置入口URL改变");
        await created.close();
        await session.activatePage(page, options);
        if ((await isolated("state")).showing) await close();
      }
    });
    if (independent || forcedPlan) {
      await check(`${variant}帮助底部设置与隐私链接保持对话框并打开新标签`, async () => {
        const visits = [];
        for (const [selector, destination] of [
          ['.browser-toolbox-help-links a[href="mouse_options.html"]', "mouse_options.html"],
          ['.browser-toolbox-help-links a[href="privacy.html"]', "privacy.html"],
        ]) {
          for (const action of ["left", "middle", "keyboard"]) {
            frame = await open();
            await frame.$eval(selector, (link) => link.scrollIntoView({ block: "center" }));
            await waitForPointerSurface(frame);
            const before = new Set(await browser.pages());
            if (action === "keyboard") {
              await frame.focus(selector);
              await page.keyboard.press("Enter");
            } else {
              await frame.click(selector, { button: action });
            }
            await wait(async () =>
              frame.url() !== `chrome-extension://${id}/pages/help_dialog_page.html` ||
              (await browser.pages()).some((candidate) => !before.has(candidate)),
              `帮助底部${destination}没有打开新标签`);
            assert(frame.url() === `chrome-extension://${id}/pages/help_dialog_page.html`,
              `帮助底部${destination}把帮助框架导航到其他页面`);
            const created = (await browser.pages()).filter((candidate) => !before.has(candidate));
            assert(created.length === 1, `帮助底部${destination}应只创建一个标签`);
            await wait(() => created[0].url() === `chrome-extension://${id}/pages/${destination}`,
              `帮助底部${destination}的新标签网址不正确`);
            visits.push({ destination, action });
            await created[0].close();
            await session.activatePage(page, options);
            await close();
          }
        }
        return { visits };
      });
    }
    await check(`${variant}帮助内Find和Hints保留键盘行为`, async () => {
      frame = await open();
      await page.keyboard.press("/");
      await wait(
        () => frame.evaluate(() => Mode.modes.some((mode) => mode.name === "find")),
        "帮助内Find未激活",
      );
      await page.keyboard.type("reload");
      await page.keyboard.press("Escape");
      await wait(
        () => frame.evaluate(() => !Mode.modes.some((mode) => mode.name === "find")),
        "帮助内Find未退出",
      );
      assert((await isolated("state")).showing, "退出Find误关闭帮助");
      await page.keyboard.press("f");
      await wait(
        () => frame.evaluate(() => Mode.modes.some((mode) => mode.name.startsWith("hint/"))),
        "帮助内Hints未激活",
      );
      await page.keyboard.press("Escape");
      await wait(
        () => frame.evaluate(() => !Mode.modes.some((mode) => mode.name.startsWith("hint/"))),
        "帮助内Hints未退出",
      );
      assert((await isolated("state")).showing, "退出Hints误关闭帮助");
      await close();
    });
    if (independent) {
      await check("摘要迟到取消不能重开帮助", async () => {
        assert(await isolated("cancel"), "在途帮助未取消");
        await sleep(50);
        assert(!(await isolated("state")).showing, "迟到摘要重新打开了帮助");
      });
      await check("100次真实组件会话后监听器及DOM注册无净增长", async () => {
        const before = await isolated("state");
        await isolated("cycles", 100);
        const after = await isolated("state");
        assert(
          !after.showing && after.components === before.components &&
            JSON.stringify(after.counts) === JSON.stringify(before.counts),
          "100次帮助会话资源发生净增长",
        );
      });
      await check("帮助内j滚动、关闭后页面键盘与导航后恢复", async () => {
        frame = await open();
        await page.keyboard.press("j");
        await wait(
          () =>
            frame.evaluate(() => document.querySelector("#container").scrollTop > 0 || scrollY > 0),
          "帮助页j不能滚动",
        );
        await close();
        await page.click("#heading");
        const before = await page.evaluate(() => scrollY);
        await page.keyboard.press("j");
        await wait(async () => await page.evaluate(() => scrollY) > before, "关闭后页面键盘未恢复");
        await page.goto(fixtureUrl + "?navigation=1");
        await wait(async () => (await isolated("state")).state === "active", "新文档宿主未恢复");
        await session.activatePage(page, options);
        frame = await open();
        await close();
      });
    }
    await check(`${variant}关闭同步后帮助沿用本地语言偏好`, async () => {
      await options.evaluate(async () => {
        const before = await chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action: "read",
        });
        if (!before?.ok) throw new Error("语言对照读取失败");
        const toolbox = structuredClone(before.value.toolboxSource.value);
        toolbox.general.language = "ja";
        toolbox.general.browserSyncEnabled = false;
        const written = await chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action: "commit",
          input: { baseline: { toolbox: before.value.toolboxSource.value }, toolbox },
        });
        if (!written?.ok) throw new Error("语言对照提交失败");
      });
      await session.activatePage(page, options);
      frame = await open();
      await wait(
        () => frame.evaluate(() => document.documentElement.lang === "ja"),
        "帮助没有采用本地保存的日语偏好",
      );
      await close();
    });
    assert(metadata.errors.length === 0, `页面异常：${metadata.errors.join(", ")}`);
    if (reportPath) {
      frame = await open();
      await page.screenshot({
        path: reportPath.replace(/\.json$/, `-${variant}.png`),
      });
      await close();
    }
  } catch (error) {
    if (inspectFailure) metadata.failureState = await inspectFailure().catch(() => null);
    if (page && reportPath) {
      await page.screenshot({ path: reportPath + ".failure.png" }).catch(() => {});
    }
    throw error;
  } finally {
    metadata.nativeHelpEvents = await optionsForTrace?.evaluate(() => syntheticHelpEvents || []).catch(() => null);
    await session.close();
    await Deno.remove(profile, { recursive: true });
  }
}
try {
  await run(path.resolve(compatible), false);
  await run(path.resolve(current), true);
  await run(path.resolve(current), false, 1);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack || error.message;
  Deno.exitCode = 1;
  console.error(report.error);
} finally {
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await server.shutdown();
}
