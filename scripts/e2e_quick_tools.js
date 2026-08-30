#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net --allow-run --allow-sys

// 快捷工具和原始文档格式化器的独立浏览器 E2E；只使用本地 fixture、独立 profile 和本地扩展目录。
import puppeteer from "npm:puppeteer";

const projectRoot = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/\/$/, "");
const extensionPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  `${projectRoot}/dist/browser-toolbox`;
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const headless = Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") === "false" ? "--headless=false" : "--headless=new";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate, timeout = 10000, interval = 50) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error("快捷工具 E2E 等待条件超时。");
}

function response(body, contentType) {
  return new Response(body, { headers: { "content-type": contentType } });
}

async function startFixtureServer() {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
    const path = new URL(request.url).pathname;
    switch (path) {
      case "/json":
        return response(
          '{"z":9007199254740993,"a":"<img src=x onerror=alert(1)>","a":3}',
          "application/json; charset=utf-8",
        );
      case "/xml":
        return response(
          '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE root [<!ELEMENT root ANY>]>\n<!-- keep -->\n<root xmlns:x="urn:test" a="x y">\n  <x:item><![CDATA[a < b]]></x:item>\n  <empty />\n  <value>&amp;  text  </value>\n</root>\n',
          "application/xml; charset=utf-8",
        );
      case "/css":
        return response('.card{content:"}";background:url("data:image/svg+xml,<svg>{}</svg>")}', "text/css; charset=utf-8");
      case "/javascript":
        return response('const re=/[{}]/g;function run(){return `${re}`;}', "application/javascript; charset=utf-8");
      case "/java":
        return response('public record Demo(String text){String value="}";}', "text/x-java-source; charset=utf-8");
      case "/html":
        return response(
          "<!doctype html><html><body><h1>ordinary page</h1><pre>{\"not\":\"a formatter target\"}</pre></body></html>",
          "text/html; charset=utf-8",
        );
      default:
        return new Response("Not found", { status: 404 });
    }
  });
  return { server, baseUrl: `http://127.0.0.1:${server.addr.port}` };
}

async function freePort() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  return port;
}

async function startBrowser() {
  const port = await freePort();
  const userDataDir = await Deno.makeTempDir({ prefix: "browser-toolbox-quick-tools-profile-" });
  const process = new Deno.Command(executablePath, {
    args: [
      headless,
      "--no-sandbox",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch (_) {
      return false;
    }
  });
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  return { browser, process, userDataDir };
}

async function hasExtensionPage(browser, id) {
  const probe = await browser.newPage();
  try {
    const response = await probe.goto(`chrome-extension://${id}/pages/tools/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 2000,
    });
    return response?.status() === 200 && Boolean(await probe.$("[data-tool-page='true']"));
  } catch (_) {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

async function extensionId(browser) {
  return waitFor(async () => {
    const configuredId = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_ID");
    if (configuredId && await hasExtensionPage(browser, configuredId)) return configuredId;
    const workers = browser.targets().filter((target) =>
      target.type() === "service_worker" && target.url().startsWith("chrome-extension://")
    );
    for (const worker of workers) {
      const id = worker.url().split("/")[2];
      if (await hasExtensionPage(browser, id)) return id;
    }
    return null;
  });
}

async function openTool(browser, id, toolId, source = "action") {
  const page = await browser.newPage();
  await page.goto(
    `chrome-extension://${id}/pages/tools/index.html?tool=${encodeURIComponent(toolId)}&source=${source}`,
    { waitUntil: "load" },
  );
  await page.waitForSelector("[data-tool-page='true']", { timeout: 10000 });
  return page;
}

async function setTextarea(page, selector, value) {
  await page.$eval(selector, (element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function clickDocumentButton(page, action) {
  await page.click(`.browser-toolbox-document-toolbar [data-document-action="${action}"]`);
}

async function testActionPopup(browser, id, baseUrl) {
  const fixture = await browser.newPage();
  const action = await browser.newPage();
  try {
    action.on("pageerror", (error) => console.log(`动作弹窗 pageerror：${error}`));
    action.on("console", (message) => console.log(`动作弹窗 console：${message.text()}`));
    action.on("requestfailed", (request) => console.log(`动作弹窗 requestfailed：${request.url()} ${request.failure()?.errorText}`));
    await fixture.goto(`${baseUrl}/html`, { waitUntil: "load" });
    await fixture.bringToFront();
    await action.goto(`chrome-extension://${id}/pages/action.html`, { waitUntil: "load" });
    try {
      await waitFor(() =>
        action.$eval("#browser-toolbox-controls", (element) => getComputedStyle(element).display !== "none")
          .catch(() => false)
      );
    } catch (error) {
      const diagnostics = await action.evaluate(async () => ({
        activeTabs: (await chrome.tabs.query({ active: true, currentWindow: true })).map((tab) => ({
          id: tab.id,
          url: tab.url,
          status: tab.status,
        })),
        controls: getComputedStyle(document.querySelector("#browser-toolbox-controls")).display,
        restricted: getComputedStyle(document.querySelector("#not-enabled-error")).display,
      })).catch((diagnosticError) => ({ error: String(diagnosticError) }));
      console.log(`动作弹窗诊断：${JSON.stringify(diagnostics)}`);
      throw error;
    }
    const state = await action.evaluate(() => {
      const shell = document.querySelector(".browser-toolbox-action-shell");
      return {
        layers: [...shell.children]
          .filter((element) => [
            "browser-toolbox-action-brand",
            "browser-toolbox-controls",
            "browser-toolbox-enhancement-summary",
            "browser-toolbox-site-details",
            "browser-toolbox-tools",
          ].some((name) => element.id === name || element.classList.contains(name)) ||
            element.classList.contains("browser-toolbox-action-footer"))
          .map((element) => element.id || [...element.classList].find((name) => name.startsWith("browser-toolbox-action-"))),
        cards: document.querySelectorAll("#browser-toolbox-tool-buttons [data-tool-id]").length,
        icons: document.querySelectorAll("#browser-toolbox-tool-buttons .browser-toolbox-tool-icon").length,
        footerEntries: document.querySelectorAll(".browser-toolbox-action-footer > *").length,
        settingsLink: document.querySelector("#browser-toolbox-settings-link")?.getAttribute("href") || "",
        details: Boolean(document.querySelector("#browser-toolbox-site-details")),
      };
    });
    assert(
      state.layers.includes("browser-toolbox-controls") &&
        state.layers.includes("browser-toolbox-enhancement-summary") &&
        state.layers.includes("browser-toolbox-tools") &&
        state.layers.includes("browser-toolbox-action-footer"),
      `动作弹窗应按五层信息架构渲染：${JSON.stringify(state)}`,
    );
    assert(state.cards > 0 && state.cards <= 6, "动作弹窗工具卡片应遵守最多六项限制。 ");
    assert(state.cards === state.icons, "动作弹窗工具卡片应使用本地图标。 ");
    assert(state.footerEntries === 4 && state.details && state.settingsLink.includes("mouse_options.html"), "动作弹窗底部入口或设置链接缺失。 ");
    await action.screenshot({ path: "/tmp/browser-toolbox-quick-tools-popup.png", fullPage: true });

    await action.setViewport({ width: 350, height: 760, deviceScaleFactor: 1 });
    await sleep(100);
    const narrow = await action.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      singleColumn: getComputedStyle(document.querySelector(".browser-toolbox-enhancement-grid")).gridTemplateColumns.split(" ").length === 1,
      brandTitleLines: Math.round(document.querySelector(".browser-toolbox-brand-copy h1").getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector(".browser-toolbox-brand-copy h1")).lineHeight)),
      siteTitleLines: Math.round(document.querySelector("#browser-toolbox-current-site-title").getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector("#browser-toolbox-current-site-title")).lineHeight)),
      enhancementCopyWidths: [...document.querySelectorAll(".browser-toolbox-enhancement-copy")].map((element) => Math.round(element.getBoundingClientRect().width)),
    }));
    assert(
      narrow.scrollWidth <= narrow.width && narrow.singleColumn &&
        narrow.brandTitleLines === 1 && narrow.siteTitleLines === 1 &&
        narrow.enhancementCopyWidths.every((width) => width >= 120),
      `动作弹窗窄屏布局不应横向溢出或逐字换行：${JSON.stringify(narrow)}`,
    );
    await action.screenshot({ path: "/tmp/browser-toolbox-quick-tools-popup-narrow.png", fullPage: true });
  } finally {
    await action.close().catch(() => {});
    await fixture.close().catch(() => {});
  }

  const restricted = await browser.newPage();
  try {
    await restricted.goto(`chrome-extension://${id}/pages/action.html`, { waitUntil: "load" });
    await waitFor(() =>
      restricted.$eval("#not-enabled-error", (element) => getComputedStyle(element).display !== "none")
        .catch(() => false)
    );
    const restrictedState = await restricted.evaluate(() => ({
      notice: getComputedStyle(document.querySelector("#not-enabled-error")).display !== "none",
      controls: getComputedStyle(document.querySelector("#browser-toolbox-controls")).display,
      enhancements: getComputedStyle(document.querySelector("#browser-toolbox-enhancement-summary")).display,
      footer: getComputedStyle(document.querySelector(".browser-toolbox-action-footer")).display,
    }));
    assert(restrictedState.notice && restrictedState.controls === "none" && restrictedState.enhancements === "none", "受限页面应只隐藏站点控制，不得误显示增强开关。 ");
    await restricted.screenshot({ path: "/tmp/browser-toolbox-quick-tools-popup-restricted.png", fullPage: true });
  } finally {
    await restricted.close().catch(() => {});
  }
}

async function testToolPages(browser, id) {
  const page = await openTool(browser, id, "json.format");
  try {
    assert(await page.$("#tool-catalog") === null, "独立工具页不应再次堆叠工具目录。 ");
    assert(await page.$("#tool-picker") === null, "独立工具页不应显示工具选择器。 ");
    await page.select('[data-tool-option="operation"]', "sort");
    await page.select('[data-tool-option="sortOrder"]', "ascending");
    await setTextarea(page, "#tool-input", '{"z":9007199254740993,"a":2,"nested":{"keep":true}}');
    await page.click("#tool-run");
    await waitFor(() => page.$eval("#tool-output", (element) => element.textContent.includes("9007199254740993"))
      .catch(() => false));
    const output = await page.$eval("#tool-output", (element) => element.textContent);
    assert(output.indexOf('"a": 2') < output.indexOf('"z": 9007199254740993'), "JSON 工具应稳定排序并保留大整数原文。 ");
    const tree = await page.evaluate(() => ({
      text: document.querySelector("#json-result-tree")?.textContent || "",
      toggles: document.querySelectorAll(".browser-toolbox-json-toggle").length,
      iconActions: [...document.querySelectorAll(".browser-toolbox-json-node-action")].map((button) => button.getAttribute("aria-label")),
    }));
    assert(tree.text.includes("9007199254740993") && tree.toggles >= 2, "JSON 结果应以可折叠节点树展示。 ");
    assert(tree.iconActions.every((label) => label), "JSON 节点操作应通过可访问图标按钮提供。 ");
    const toggleBefore = await page.$eval(".browser-toolbox-json-toggle", (button) => button.getAttribute("aria-expanded"));
    await page.$eval(".browser-toolbox-json-toggle", (button) => button.click());
    await sleep(100);
    assert(await page.$eval(".browser-toolbox-json-toggle", (button, before) => button.getAttribute("aria-expanded") !== before, toggleBefore), "JSON 节点应支持折叠和展开。 ");
    await page.$eval(".browser-toolbox-json-toggle", (button) => button.click());
    await sleep(100);
    await page.click('.browser-toolbox-json-row[data-json-key="a"] [data-action="delete"]');
    await waitFor(() => page.$eval("#tool-output", (element) => !element.textContent.includes('"a": 2'))
      .catch(() => false));
    assert(await page.$eval("#tool-output", (element) => !element.textContent.includes('"a": 2')), "JSON 删除图标应从结果中移除字段。 ");
  } finally {
    await page.close();
  }

  const codec = await openTool(browser, id, "codec.transform");
  try {
    assert(await codec.$("#tool-picker") === null, "编码页不应使用下拉框选择编码类型。 ");
    await codec.click('[data-codec-operation="encode"]');
    await codec.click('[data-codec-type="base64"]');
    await setTextarea(codec, "#tool-input", "hello");
    await codec.click("#tool-run");
    await waitFor(() => codec.$eval("#codec-output", (element) => element.textContent === "aGVsbG8=")
      .catch(() => false));
    assert(await codec.$eval("#codec-output", (element) => element.textContent) === "aGVsbG8=", "编码工具应在扩展页内本地运行。 ");
    await codec.click('[data-codec-operation="decode"]');
    await setTextarea(codec, "#tool-input", "aGVsbG8=");
    await codec.click("#tool-run");
    await waitFor(() => codec.$eval("#codec-output", (element) => element.textContent === "hello")
      .catch(() => false));
  } finally {
    await codec.close();
  }

  const diff = await openTool(browser, id, "text.diff");
  try {
    await setTextarea(diff, "#tool-input", "same\nold");
    await setTextarea(diff, "#tool-input-right", "same\nnew");
    await diff.click("#tool-run");
    await waitFor(() => diff.$eval("#diff-result-list", (element) => element.textContent.includes("new"))
      .catch(() => false));
    const diffState = await diff.$eval("#diff-result-list", (element) => ({
      rows: element.querySelectorAll("[role=listitem]").length,
      height: element.clientHeight,
      scrollHeight: element.scrollHeight,
      panel: getComputedStyle(element).overflowY,
    }));
    assert(diffState.rows >= 3 && diffState.panel === "auto", "对比差异应固定在独立的底部滚动面板。 ");
    const longText = Array.from({ length: 700 }, (_, index) => `line-${index}`).join("\n");
    await setTextarea(diff, "#tool-input", longText);
    await setTextarea(diff, "#tool-input-right", `${longText}\nextra`);
    await diff.click("#tool-run");
    await waitFor(() => diff.$eval("#diff-result-list", (element) => element.scrollHeight > element.clientHeight)
      .catch(() => false));
    assert(await diff.$eval("#diff-result-list", (element) => element.scrollHeight > element.clientHeight), "长差异文本应在结果面板内部滚动。 ");
  } finally {
    await diff.close();
  }

  const invalidToken = await openTool(browser, id, "json.format", "selection");
  try {
    await invalidToken.goto(
      `chrome-extension://${id}/pages/tools/index.html?tool=json.format&source=selection&inputToken=${"0".repeat(32)}`,
      { waitUntil: "load" },
    );
    await invalidToken.waitForSelector("#tool-status");
    await waitFor(() => invalidToken.$eval("#tool-status", (element) => /invalid|expired|无效|过期/i.test(element.textContent))
      .catch(() => false));
    assert(await invalidToken.$eval("#tool-input", (element) => element.value) === "", "无效令牌不得填充工具输入。 ");
  } finally {
    await invalidToken.close();
  }
}

async function testDocumentFormatter(browser, baseUrl) {
  const json = await browser.newPage();
  try {
    await json.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await json.goto(`${baseUrl}/json`, { waitUntil: "load" });
    await json.waitForSelector(".browser-toolbox-document-toolbar", { timeout: 10000 });
    assert(await json.$eval(".browser-toolbox-json-toggle", (element) => Boolean(element)), "JSON 应出现节点折叠控件。 ");
    assert(await json.$eval("body", (body) => !body.querySelector("img")), "JSON 文本不得被解释为 HTML。 ");
    assert(await json.$eval(".browser-toolbox-document-output", (element) => element.textContent.includes("<img")), "JSON 输出应以文本节点显示源码。 ");
    assert(await json.$('.browser-toolbox-document-toolbar [data-document-action="repair-mojibake"]'), "JSON 应有专属修复工具栏。 ");
    assert(await json.$eval(".browser-toolbox-document-brand", (element) => /JSON/.test(element.textContent)), "JSON 工具栏应显示格式品牌。 ");
    assert(await json.$eval(".browser-toolbox-document-status", (element) => getComputedStyle(element).color !== "rgb(0, 0, 0)"), "JSON 工具栏应显示状态色。 ");
    await json.screenshot({ path: "/tmp/browser-toolbox-document-json.png", fullPage: true });
    await clickDocumentButton(json, "toggle-original");
    assert(await json.$eval(".browser-toolbox-document-output", (element) => element.textContent.includes("9007199254740993")), "查看原文应保留原始文本。 ");
    await clickDocumentButton(json, "toggle-original");
    await clickDocumentButton(json, "restore-original");
    assert(await json.$(".browser-toolbox-document-toolbar") === null, "恢复原文应释放格式化视图。 ");
  } finally {
    await json.close();
  }

  for (const [path, label] of [["xml", "xml"], ["css", "css"], ["javascript", "javascript"], ["java", "java"]]) {
    const page = await browser.newPage();
    try {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
      await page.goto(`${baseUrl}/${path}`, { waitUntil: "load" });
      try {
        await page.waitForSelector(".browser-toolbox-document-toolbar", { timeout: 10000 });
      } catch (error) {
        const diagnostics = await page.evaluate(() => ({
          contentType: document.contentType,
          characterSet: document.characterSet,
          bodyText: document.body?.textContent?.slice(0, 160),
          scripts: [...document.scripts].map((script) => script.src).filter(Boolean).slice(-8),
          formatterLoaded: Boolean(globalThis.BrowserToolboxDocumentFormatters),
          settingsLoaded: Boolean(globalThis.BrowserToolboxSettingsRuntimeClientInstance),
        }));
        console.log(`文档格式化器诊断 ${path}: ${JSON.stringify(diagnostics)}`);
        throw error;
      }
      assert(await page.$eval(".browser-toolbox-document-status", (element, expected) => element.textContent.startsWith(expected), label), `${label} 应能被直接文档格式化器识别。 `);
      if (path === "xml") {
        const output = await page.$eval(".browser-toolbox-document-output", (element) => element.textContent);
        assert(output.includes("<root"), "XML 格式化输出应来自源码节点而不是查看器说明文字。 ");
        assert(!output.includes("This XML file does not appear"), "XML 输出不得混入浏览器查看器说明。 ");
      }
      assert(await page.$(".browser-toolbox-json-toggle") === null, `${label} 不应显示 JSON 专属折叠树。 `);
      assert(await page.$('[aria-label="Sort JSON keys"]') === null, `${label} 不应显示 JSON 排序控件。 `);
      await page.screenshot({ path: `/tmp/browser-toolbox-document-${path}.png`, fullPage: true });
    } finally {
      await page.close();
    }
  }

  const ordinary = await browser.newPage();
  try {
    await ordinary.goto(`${baseUrl}/html`, { waitUntil: "load" });
    await sleep(800);
    assert(await ordinary.$(".browser-toolbox-document-toolbar") === null, "普通 HTML 页面不得被文档格式化器接管。 ");
  } finally {
    await ordinary.close();
  }
}

async function testSettings(browser, id) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
    await page.goto(`chrome-extension://${id}/pages/mouse_options.html#toolsOverview`, { waitUntil: "load" });
    await page.waitForSelector('[data-settings-ready="true"]', { timeout: 10000 });
    await waitFor(() =>
      page.$$eval(
        ".browser-toolbox-nav-item:not([hidden])",
        (items) => items.length === 15,
      )
    );
    const counts = await page.evaluate(() => ({
      action: document.querySelectorAll("#action-tool-list input").length,
      context: document.querySelectorAll("#context-menu-tool-list input").length,
      auto: document.querySelectorAll("#document-auto-json, #document-auto-xml, #document-auto-css, #document-auto-javascript, #document-auto-java").length,
      groups: document.querySelectorAll("[data-nav-group]").length,
      panels: document.querySelectorAll("[data-panel]").length,
      directory: document.querySelectorAll("#browser-tool-directory .browser-toolbox-tool-directory-item").length,
      openLinks: document.querySelectorAll("#browser-tool-directory a").length,
    }));
    console.log(`设置页工具数量：${JSON.stringify(counts)}`);
    assert(counts.action === 6, "动作弹窗设置最多显示六个工具。 ");
    assert(counts.context === 5, "右键菜单设置应列出全部五个可选工具。 ");
    const contextInputs = await page.$$("#context-menu-tool-list input");
    assert(contextInputs.length >= 4, "右键菜单工具设置应有可测试的第四个选项。 ");
    await contextInputs[3].click();
    assert(await contextInputs[3].evaluate((input) => !input.checked), "右键菜单工具选择不得超过三个。 ");
    assert(counts.auto === 5, "设置页应有五种自动格式化开关。 ");
    assert(counts.groups === 3 && counts.panels === 15, "设置页应收敛为三大分组和十五个功能分区。 ");
    assert(counts.directory === 7 && counts.openLinks === 7, "工具总览应由注册表生成完整工具目录。 ");
    await page.click("button[data-section='general']");
    await waitFor(() => page.$eval("#language", (element) => !element.closest("[hidden]")));
    assert(await page.$eval("#language", (element) => element.options.length === 3), "统一语言设置应在常规分区可见。 ");
    await page.screenshot({ path: "/tmp/browser-toolbox-settings-tools-overview.png", fullPage: true });
    await page.click("button[data-section='jsonFormatter']");
    await waitFor(() => page.$eval("[data-panel='jsonFormatter']", (element) => !element.hidden));
    await page.screenshot({ path: "/tmp/browser-toolbox-settings-json.png", fullPage: true });
  } finally {
    await page.close();
  }
}

async function main() {
  const { server, baseUrl } = await startFixtureServer();
  let browser;
  let chromeProcess;
  let userDataDir;
  try {
    ({ browser, process: chromeProcess, userDataDir } = await startBrowser());
    const id = await extensionId(browser);
    await testActionPopup(browser, id, baseUrl);
    await testToolPages(browser, id);
    await testDocumentFormatter(browser, baseUrl);
    await testSettings(browser, id);
    console.log(`快捷工具 E2E 通过：扩展 ${id}，目录、工具页、令牌失败闭环、五种文档格式和设置容量。`);
  } finally {
    await browser?.disconnect().catch(() => {});
    chromeProcess?.kill("SIGTERM");
    await chromeProcess?.status.catch(() => {});
    await server.shutdown();
    if (userDataDir) await Deno.remove(userDataDir, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) await main();
