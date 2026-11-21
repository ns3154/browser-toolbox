#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys

// 快捷工具和原始文档格式化器的独立浏览器 E2E；只使用本地 fixture、独立 profile 和本地扩展目录。
import puppeteer from "npm:puppeteer";

const projectRoot = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/\/$/, "");
const extensionPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  `${projectRoot}/dist/browser-toolbox`;
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
  puppeteer.executablePath();
const headless = Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false";
if (!headless && Deno.env.get("BROWSER_TOOLBOX_ALLOW_HEADED_TESTS") !== "true") {
  throw new Error("有头测试须先获得用户明确授权；常规测试只使用无头浏览器。");
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withTimeout(task, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runStage(browser, name, task) {
  const started = Date.now();
  console.log(`快捷工具 E2E 阶段开始：${name}`);
  try {
    await withTimeout(task(), 90000, `快捷工具 E2E 阶段“${name}”超过 90000 毫秒。`);
    console.log(`快捷工具 E2E 阶段通过：${name}（${Date.now() - started} 毫秒）`);
  } catch (error) {
    console.error(`快捷工具 E2E 阶段失败：${name}；浏览器目标：${
      browser.targets().map((target) => `${target.type()} ${target.url()}`).join(" | ")
    }`);
    throw error;
  }
}

async function waitFor(predicate, timeout = 10000, interval = 50) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await withTimeout(
      predicate(), Math.max(1, deadline - Date.now()), "快捷工具 E2E 等待条件超时。",
    );
    if (result) return result;
    await sleep(interval);
  }
  throw new Error("快捷工具 E2E 等待条件超时。");
}

async function focusTargetPage(browser, page) {
  // 新 profile 安装扩展后后台可能异步打开引导页并抢占前台，截图前先关闭引导页并切回目标标签。
  for (const candidate of await browser.pages()) {
    if (candidate !== page && candidate.url().includes("/pages/onboarding.html")) {
      await candidate.close().catch(() => {});
    }
  }
  await page.bringToFront();
}

function response(body, contentType) {
  return new Response(body, { headers: { "content-type": contentType } });
}

export async function startFixtureServer() {
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

async function freePort(excludedPort = 0) {
  while (true) {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = listener.addr.port;
    listener.close();
    if (port !== excludedPort) return port;
  }
}

export async function startBrowser(excludedPort) {
  const port = await freePort(excludedPort);
  const userDataDir = await Deno.makeTempDir({ prefix: "browser-toolbox-quick-tools-profile-" });
  const process = new Deno.Command(executablePath, {
    args: [
      ...(headless ? ["--headless=new"] : []),
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
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
  await page.bringToFront();
  await page.goto(
    `chrome-extension://${id}/pages/tools/index.html?tool=${encodeURIComponent(toolId)}&source=${source}`,
    { waitUntil: "load" },
  );
  await page.waitForSelector("[data-tool-page='true']", { timeout: 10000 });
  await page.waitForSelector('body[data-tool-ready="true"]', { timeout: 10000 });
  return page;
}

async function setTextarea(page, selector, value) {
  await page.$eval(selector, (element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function clickVisible(page, selector) {
  await page.$eval(selector, (element) => {
    const scroller = element.closest(".browser-toolbox-tool-header-toolbar");
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      const elementBox = element.getBoundingClientRect();
      const scrollerBox = scroller.getBoundingClientRect();
      scroller.scrollLeft += elementBox.left < scrollerBox.left
        ? elementBox.left - scrollerBox.left
        : elementBox.right > scrollerBox.right
        ? elementBox.right - scrollerBox.right
        : 0;
    }
    element.click();
  });
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
            "browser-toolbox-tools",
            "browser-toolbox-enhancement-summary",
          ].some((name) => element.id === name || element.classList.contains(name)) ||
            element.classList.contains("browser-toolbox-action-footer"))
          .map((element) => element.id || [...element.classList].find((name) => name.startsWith("browser-toolbox-action-"))),
        cards: document.querySelectorAll("#browser-toolbox-tool-buttons [data-tool-id]").length,
        expectedCards: BrowserToolboxToolRegistry.list({ source: "action", surface: "popup" }).length,
        icons: document.querySelectorAll("#browser-toolbox-tool-buttons .browser-toolbox-tool-icon").length,
        footerEntries: [...document.querySelectorAll(".browser-toolbox-action-footer > *")]
          .map((element) => element.id),
        settingsLink: document.querySelector("#browser-toolbox-settings-link")?.getAttribute("href") || "",
        legacyDetails: Boolean(document.querySelector("#browser-toolbox-site-details")),
      };
    });
    assert(
      state.layers.includes("browser-toolbox-controls") &&
        state.layers.includes("browser-toolbox-enhancement-summary") &&
        state.layers.includes("browser-toolbox-tools") &&
        state.layers.includes("browser-toolbox-action-footer"),
      `动作弹窗主内容应按四层、底部另有入口栏渲染：${JSON.stringify(state)}`,
    );
    assert(
      state.layers.join(">") === [
        "browser-toolbox-action-brand",
        "browser-toolbox-controls",
        "browser-toolbox-tools",
        "browser-toolbox-enhancement-summary",
        "browser-toolbox-action-footer",
      ].join(">"),
      `动作弹窗菜单顺序应为快捷工具在浏览增强上方：${JSON.stringify(state.layers)}`,
    );
    assert(
      state.cards === state.expectedCards,
      `动作弹窗应显示所有已配置的可用快捷工具：${JSON.stringify(state)}`,
    );
    assert(state.cards === state.icons, "动作弹窗工具卡片应使用本地图标。 ");
    assert(
      state.footerEntries.join(",") === [
        "browser-toolbox-open-command-center", "browser-toolbox-all-tools",
        "browser-toolbox-settings-footer-link", "browser-toolbox-open-help",
      ].join(",") && !state.legacyDetails && state.settingsLink.includes("mouse_options.html"),
      `动作弹窗应保留命令中心、全部工具、设置与帮助四个底部入口：${JSON.stringify(state)}`,
    );
    await action.bringToFront();
    await action.screenshot({ path: "/tmp/browser-toolbox-quick-tools-popup.png", fullPage: true });

    await action.setViewport({ width: 350, height: 760, deviceScaleFactor: 1 });
    await sleep(100);
    const narrow = await action.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      doubleColumn: getComputedStyle(document.querySelector(".browser-toolbox-enhancement-grid")).gridTemplateColumns.split(" ").length === 2,
      brandTitleLines: Math.round(document.querySelector(".browser-toolbox-brand-copy h1").getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector(".browser-toolbox-brand-copy h1")).lineHeight)),
      siteTitleLines: Math.round(document.querySelector("#browser-toolbox-current-site-title").getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector("#browser-toolbox-current-site-title")).lineHeight)),
      enhancementCopyWidths: [...document.querySelectorAll(".browser-toolbox-enhancement-copy")].map((element) => Math.round(element.getBoundingClientRect().width)),
    }));
    assert(
      narrow.scrollWidth <= narrow.width && narrow.doubleColumn &&
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
    await restricted.bringToFront();
    await restricted.screenshot({ path: "/tmp/browser-toolbox-quick-tools-popup-restricted.png", fullPage: true });
  } finally {
    await restricted.close().catch(() => {});
  }
}

const toolSelector = (name, value) => `[data-segment="${name}"] [data-value="${value}"]`;
const textIn = (page, selector) => page.$eval(selector, (element) => element.textContent);

async function waitText(page, selector, value) {
  await page.waitForFunction((query, text) => document.querySelector(query)?.textContent.includes(text), {}, selector, value);
}

async function recordToolActions(page) {
  await page.evaluate(() => {
    const records = { copies: [], downloads: [] };
    window.__workbenchActions = records;
    navigator.clipboard.writeText = async (value) => { records.copies.push(value); };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) records.downloads.push({ filename: this.download, local: this.href.startsWith("blob:") });
    };
  });
}

function lastCopy(page) {
  return page.evaluate(() => window.__workbenchActions.copies.at(-1));
}

async function uploadToolInput(page, { fileSelector, inputSelector, suffix, text }) {
  const file = await Deno.makeTempFile({ prefix: "browser-toolbox-tool-input-", suffix });
  try {
    await Deno.writeTextFile(file, text);
    await (await page.$(fileSelector)).uploadFile(file);
    await page.waitForFunction((query, value) => document.querySelector(query).value === value, {}, inputSelector, text);
  } finally {
    await Deno.remove(file);
  }
}

async function testWorkbenchGeometry(page, tool) {
  for (const width of [1440, 1280, 390, 320]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    const geometry = await page.evaluate((wide) => {
      const group = document.querySelector(".workbench-toolbar");
      const toolbar = [...group.querySelectorAll("button.workbench-button, .segmented, select, .clock-copy")];
      const compact = [...document.querySelectorAll(".pane-header button.workbench-button, .pane-header .segmented")];
      const sizes = (controls) => controls.map((control) => control.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height);
      const toolbarBoxes = sizes(toolbar);
      const clipped = [...document.querySelectorAll(".segmented button, button.workbench-button")]
        .filter((button) => {
          const box = button.getBoundingClientRect();
          if (!box.width || !box.height) return false;
          const range = document.createRange();
          range.selectNodeContents(button);
          return [...range.getClientRects()].some((text) =>
            text.left < box.left - 1 || text.right > box.right + 1 ||
            text.top < box.top - 1 || text.bottom > box.bottom + 1
          );
        }).map((control) => control.textContent);
      return {
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        footerClear: [...document.querySelectorAll(".workbench-panes, .diff-list, .json-tree, .table-preview-scroll")]
          .every((layer) => layer.getBoundingClientRect().bottom <= document.querySelector(".workbench-foot").getBoundingClientRect().top + 1),
        singleToolbar: !wide || new Set(toolbarBoxes.map(({ top }) => Math.round(top))).size <= 1,
        toolbarHeight: toolbarBoxes.map(({ height }) => height),
        compactHeight: sizes(compact).map(({ height }) => height),
        clipped,
      };
    }, width >= 1280);
    assert(
      geometry.document === geometry.viewport && geometry.body === geometry.viewport &&
        geometry.singleToolbar && geometry.footerClear && geometry.clipped.length === 0 &&
        geometry.compactHeight.every((height) => height === 28) &&
        (width < 1280 || geometry.toolbarHeight.every((height) => height === 32)),
      `${tool}/${width} 工具页控件和页面尺寸异常：${JSON.stringify(geometry)}`,
    );
  }
}

async function withWorkbench(browser, id, tool, test) {
  const page = await browser.newPage();
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
  });
  try {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.bringToFront();
    await page.goto(`chrome-extension://${id}/pages/tools/index.html?tool=${tool}&source=action`);
    await page.waitForSelector(`body[data-tool-ready="true"][data-tool-id="${tool}"]`);
    assert(await page.title() === await textIn(page, "h1"), `${tool} 页面标题需匹配工具名称。`);
    assert(await page.$("#tool-run") === null, `${tool} 不应包含手动提交按钮。`);
    await recordToolActions(page);
    await test(page);
    await testWorkbenchGeometry(page, tool);
    assert(!errors.length && !externalRequests.length, `${tool} 出现控制台错误或外部请求：${JSON.stringify({ errors, externalRequests })}`);
  } finally {
    await page.close();
  }
}

async function testWorkbenchPages(browser, id) {
  await withWorkbench(browser, id, "json.format", async (page) => {
    await page.click("#tool-restore");
    await page.waitForSelector("#json-result-tree [data-json-key='app']");
    assert(await page.$eval(".workbench-breadcrumb a", (link) => link.hash) === "#toolsOverview", "全部工具应指向真实目录。");
    await setTextarea(page, "#tool-input", '{"z":9007199254740993,"a":"<strong>text</strong>","nested":"{\\"ok\\":true}"}');
    await page.select("#json-sort", "ascending");
    await page.select("#json-indent", "4");
    await waitText(page, "#tool-output", '    "a"');
    const output = await textIn(page, "#tool-output");
    assert(output.indexOf('"a"') < output.indexOf('"z"') && output.includes("9007199254740993"), "JSON 键排序及大整数需保真。");
    assert(await page.$("#json-result-tree strong") === null, "JSON 文字不得变成 HTML。");
    await page.click("#json-expand-escaped");
    await page.waitForSelector("#json-result-tree [data-json-key='ok']");
    await page.click("#json-fold-all");
    assert(await page.$('#json-result-tree .json-toggle[aria-expanded="true"]') === null, "全部折叠后应关上所有节点。");
    await page.click("#json-fold-all");
    await page.waitForSelector("#json-result-tree [data-json-key='ok']");
    const nested = "#json-result-tree [data-json-key='nested']";
    await page.hover(nested);
    await page.click(`${nested} .json-copy-node`);
    assert(JSON.parse(await lastCopy(page)).ok === true, "复制节点应复制展开后的局部 JSON。");
    await page.click(toolSelector("json-view", "source"));
    await page.waitForSelector("#tool-output", { visible: true });
    await page.click(toolSelector("json-mode", "compact"));
    await waitText(page, "#tool-output", '{"a":');
    await page.click("#tool-download");
    const download = await page.evaluate(() => window.__workbenchActions.downloads.at(-1));
    assert(download.local && /^browser-toolbox-\d+\.json$/.test(download.filename), "JSON 下载需使用本地 Blob 与时间戳文件名。");
    await setTextarea(page, "#tool-input", '{\n  "x": "bad\\q"\n}');
    await page.waitForSelector('#tool-status[data-state="error"]');
    assert((await textIn(page, "#tool-status")).includes("2") && (await textIn(page, "#tool-status")).includes("13"), "校验应反馈转义错误的真实行列。");
    assert(await page.$eval("#tool-copy", (button) => button.disabled), "无效 JSON 不允许复制旧结果。");
    await setTextarea(page, "#tool-input", '{"x":"cafÃ©"}');
    await page.waitForSelector('#tool-status[data-state="valid"]');
    page.once("dialog", (dialog) => void dialog.accept());
    await page.click("#json-repair");
    await waitText(page, "#tool-output", "café");
    await page.click(toolSelector("json-view", "tree"));
    await page.click("#tool-restore");
    await page.waitForSelector("#json-result-tree [data-json-key='app']");
    await page.click(".workbench-breadcrumb a");
    await page.waitForSelector("[data-panel='toolsOverview']:not([hidden]) #browser-tool-directory a");
    assert(new URL(page.url()).hash === "#toolsOverview", "面包屑应真正打开工具目录。");
    await page.goBack();
    await page.waitForSelector('body[data-tool-ready="true"]');
    await page.click("#tool-restore");
    await page.waitForSelector("#json-result-tree [data-json-key='app']");
  });

  await withWorkbench(browser, id, "config.convert", async (page) => {
    await page.click("#tool-restore");
    await waitText(page, "#tool-output", 'port: "8080"');
    assert((await textIn(page, "#tool-status")).includes("4"), "配置转换应统计键值数。");
    assert((await textIn(page, "#tool-status")).includes("1"), "配置转换应统计跳过的注释。");
    assert(await page.$(".editor-highlight .token-comment"), "配置输入应显示注释高亮。");
    await page.select("#config-indent", "4");
    await waitText(page, "#tool-output", '    port: "8080"');
    await page.click("#config-swap");
    await waitText(page, "#tool-output", "server.port=8080");
    assert(await page.$eval("#config-indent", (control) => control.disabled), "YAML 转 Properties 不应修改空格缩进。");
    await page.click("#tool-copy");
    assert((await lastCopy(page)).includes("spring.application.name=browser-toolbox"), "配置复制应使用反向转换的内容。");
    await page.click("#tool-download");
    assert(await page.evaluate(() => window.__workbenchActions.downloads.at(-1).filename === "application.properties"), "配置下载应跟随输出格式。");
    await uploadToolInput(page, {
      fileSelector: "#tool-file", inputSelector: "#tool-input", suffix: ".properties", text: "from.file=value",
    });
    await waitText(page, "#tool-output", "file: value");
    assert(await page.$eval("#config-indent", (control) => !control.disabled), "扩展名应切换配置转换方向。");
    await page.click(toolSelector("config-direction", "yamlToProperties"));
    await setTextarea(page, "#tool-input", "a: 1\na: 2");
    await page.waitForSelector('#tool-status[data-state="error"]');
    assert(await page.$eval("#config-swap", (button) => button.disabled), "转换错误后不能回填旧结果。");
    await page.click("#tool-restore");
    await waitText(page, "#tool-output", "server:");
  });

  await withWorkbench(browser, id, "table.convert", async (page) => {
    await page.click("#tool-restore");
    await page.waitForSelector("#table-preview tbody tr");
    assert(await textIn(page, "#tool-status") === "", "普通表格不应显示安全提示。");
    await page.click(toolSelector("table-input", "tsv"));
    assert(await textIn(page, toolSelector("table-output", "Delimited")) === "CSV", "TSV 输入应将互转目标变为 CSV。");
    await setTextarea(page, "#tool-input", 'name\tnote\n<strong>text</strong>\t"two\nlines"');
    await page.click(toolSelector("table-output", "Delimited"));
    await waitText(page, "#table-preview", "two\nlines");
    assert(await page.$("#table-preview strong") === null, "表格预览必须使用纯文本节点。");
    await page.click(toolSelector("table-view", "source"));
    await waitText(page, "#tool-output", 'name,note\n<strong>text</strong>,"two\nlines"');
    await page.click("#tool-download");
    assert(await page.evaluate(() => window.__workbenchActions.downloads.at(-1).filename.endsWith(".csv")), "表格下载扩展名需随选择变化。");
    await setTextarea(page, "#tool-input", "name\tnote\nvalue\t=SUM(A1)");
    await page.waitForSelector('#tool-status[data-state="warning"]');
    assert((await textIn(page, "#tool-status")).includes("1"), "表格应报告真实公式计数。");
    await page.click(toolSelector("table-output", "Mysql"));
    await waitText(page, "#tool-output", "INSERT INTO");
    await waitText(page, "#tool-status", "SQL");
    await page.click("#tool-restore");
    await page.waitForSelector("#table-preview tbody tr", { visible: true });
    await page.waitForFunction(() => document.querySelector("#tool-status").textContent === "");
    assert(await textIn(page, "#tool-status") === "", "切回普通样例应清除安全提示。");
  });

  await withWorkbench(browser, id, "text.diff", async (page) => {
    await setTextarea(page, "#tool-input", "same\ntheme = item01");
    await setTextarea(page, "#tool-input-right", "same\ntheme = item02\nextra");
    await waitText(page, "#diff-result-list", "item02");
    const rows = await page.$$eval(".diff-line", (nodes) => nodes.map((row) => ({
      marker: row.querySelector(".diff-marker").textContent,
      change: row.querySelector("mark")?.textContent,
    })));
    assert(rows.map(({ marker }) => marker).join() === ",−,+,+", "相邻变更应先删后增，未变行不显示符号。");
    assert(rows[1].change === "1" && rows[2].change === "2", "行内高亮应精确到变化的字符。");
    await page.click(toolSelector("diff-view", "side"));
    assert(await page.$(".diff-side-line .diff-remove + .diff-add"), "并排差异应对齐旧行与新行。");
    await page.click("#diff-only-changes");
    assert(!(await textIn(page, "#diff-result-list")).includes("same"), "仅看变更应过滤相同行。");
    await page.click("#tool-copy");
    assert(await lastCopy(page) === "- theme = item01\n+ theme = item02\n+ extra", "差异复制应匹配筛选和旧新顺序。");
    await page.click("#diff-fold-input");
    assert(await page.$eval("#diff-inputs", (element) => element.hidden), "应支持收起输入。");
    await page.click("#diff-fold-input");
    await page.click("#diff-swap");
    await page.waitForFunction(() => document.querySelector("#tool-input").value.endsWith("extra"));
    await page.click("#tool-input-right-clear");
    assert(await page.$eval("#tool-input-right", (input) => input.value) === "", "应能清空右侧。");
    await uploadToolInput(page, {
      fileSelector: "#tool-file-right", inputSelector: "#tool-input-right", suffix: ".txt", text: "from local file",
    });
    await waitText(page, "#diff-result-list", "from local file");
    const longText = Array.from({ length: 700 }, (_, index) => `line-${index}`).join("\n");
    await page.click("#diff-only-changes");
    await setTextarea(page, "#tool-input", longText);
    await setTextarea(page, "#tool-input-right", `${longText}\nend-of-diff`);
    await waitText(page, "#diff-result-list", "end-of-diff");
    assert(await page.$eval("#diff-result-list", (element) => element.scrollHeight > element.clientHeight), "长差异应在结果区内滚动。");
    await page.click(toolSelector("diff-view", "unified"));
    await page.click("#tool-restore");
    await waitText(page, "#diff-result-list", "sage-mist");
  });

  await withWorkbench(browser, id, "time.convert", async (page) => {
    await setTextarea(page, "#time-input", "2026-11-20T04:30:00Z");
    const result = (id) => `[data-time-result="${id}"] code`;
    const world = '[data-world-zone="America/New_York"] code';
    await waitText(page, result("iso"), "2026-11-20T04:30:00.000Z");
    assert((await textIn(page, world)) === "2026-11-19 23:30:00", "全球时区应使用输入时间和当日冬令时。");
    assert((await textIn(page, result("seconds"))) === "1795149000", "时间格式应同步更新。");
    await page.click("#time-current-toggle");
    const paused = await textIn(page, "#time-current-milliseconds");
    await sleep(1100);
    assert(paused === await textIn(page, "#time-current-milliseconds"), "独立时钟暂停后应冻结。");
    await page.click("#time-current-milliseconds");
    assert(await lastCopy(page) === paused, "参考条中的毫秒值应可直接复制。");
    await page.click("#time-current-toggle");
    await page.waitForFunction((last) => document.querySelector("#time-current-milliseconds").textContent !== last, {}, paused);
    assert((await textIn(page, world)) === "2026-11-19 23:30:00", "参考时钟不应驱动全球时区区块。");
    await page.click('[data-zone="Asia/Shanghai"]');
    await waitText(page, result("zone"), "2026-11-20 12:30:00 (UTC+08:00)");
    await page.click('[data-time-result="iso"]');
    assert(await lastCopy(page) === "2026-11-20T04:30:00.000Z", "整行点击应复制时间。");
    await page.click('[data-world-zone="America/New_York"]');
    assert(await lastCopy(page) === "2026-11-19 23:30:00", "全球时区单元格应可复制。");
    await page.click("#tool-copy");
    assert((await lastCopy(page)).split("\n").length === 6, "复制全部应包含六种格式。");
    await page.click(toolSelector("time-parse", "filetime"));
    await setTextarea(page, "#time-input", "0");
    await waitText(page, result("iso"), "1601-01-01T00:00:00.000Z");
    await page.click("#time-clear");
    assert(await page.$eval("#tool-copy", (button) => button.disabled), "清空后应禁用结果复制。");
    await page.click("#time-fill-now");
    assert(/^\d{13}$/.test(await page.$eval("#time-input", (input) => input.value)), "应按当前时间填入毫秒值。");
  });

  await withWorkbench(browser, id, "id.generate", async (page) => {
    assert((await page.$$("#id-values li")).length === 5, "ID 应按设计默认生成 5 个。");
    await page.click(toolSelector("id-count", "20"));
    await page.click('input[name="id-kind"][value="nanoid"]');
    const first = await page.$$eval("#id-values code", (values) => values.map((value) => value.textContent));
    assert(first.length === 20 && first.every((value) => value.length === 21), "ID 类型和数量应立即生效。");
    await page.click("#id-values .copy-row");
    assert(await lastCopy(page) === first[0], "ID 行应复制当前 ID。");
    await page.click("#tool-regenerate");
    assert(await textIn(page, "#id-values code") !== first[0], "重新生成应刷新结果。");
    await page.click("#tool-copy");
    assert((await lastCopy(page)).split("\n").length === 20, "应能复制全部 ID。");
  });

  await withWorkbench(browser, id, "password.generate", async (page) => {
    const code = ".password-main-value code";
    const sizes = [];
    for (const length of [12, 20, 32, 64]) {
      await page.click(toolSelector("password-length", length));
      assert((await textIn(page, code)).length === length, "主密码应跟随长度即时刷新。");
      assert(await page.$eval("#password-entropy", (value, size) => Number(value.dataset.bits) === Math.round(size * Math.log2(79)), length),
        "含符号的理论熵应使用 79 字符集。");
      sizes.push(await page.$eval(code, (node) => parseFloat(getComputedStyle(node).fontSize)));
    }
    assert(sizes[1] > sizes[2] && sizes[2] > sizes[3], "32 位和 64 位密码应逐级缩小字号。");
    await page.click("#password-symbols");
    assert(await page.$eval("#password-entropy", (value) =>
      Number(value.dataset.bits) === Math.round(64 * Math.log2(57)) && Number(value.dataset.charsetSize) === 57),
    "关闭符号后理论熵应使用 57 字符集。");
    assert(await page.$eval(code, (value) => !/[0O1lI]/.test(value.textContent) && /^[A-Za-z0-9]+$/.test(value.textContent)), "密码应排除设计要求中的易混淆字符。");
    assert((await page.$$("#password-alternatives li")).length === 3, "密码应提供三条独立备选。");
    await page.click("#password-alternatives .copy-row");
    assert(await lastCopy(page) === await textIn(page, "#password-alternatives code"), "备选密码应整行复制。");
    const previous = await textIn(page, code);
    await page.click("#tool-regenerate");
    assert(await textIn(page, code) !== previous, "换一组应刷新主密码。");
  });
}

async function testToolPages(browser, id) {
  const codec = await openTool(browser, id, "codec.transform");
  try {
    await codec.waitForSelector('[data-codec-type="base64"][aria-pressed="true"]', {
      visible: true,
    });
    assert(await codec.$("[data-codec-operation]") === null, "编码页应直接显示两个方向的结果。");
    assert(
      await codec.$eval("#tool-run", (button) => button.getClientRects().length === 0),
      "编码页应自动转换。",
    );
    await setTextarea(codec, "#tool-input", "hello");
    await codec.waitForFunction(() =>
      document.querySelector("#codec-output").textContent === "aGVsbG8="
    );
    assert(
      await codec.evaluate(() =>
        Boolean(document.querySelector("#codec-decode-note").textContent) &&
        document.querySelector("#codec-decode-download").disabled &&
        !document.querySelector("#codec-encode-download").disabled
      ),
      "解码格式错误应留在解码区，编码结果仍可下载。",
    );

    await setTextarea(codec, "#tool-input", "aGVsbG8=");
    await codec.waitForFunction(() =>
      document.querySelector("#codec-output").textContent === "YUdWc2JHOD0=" &&
      document.querySelector("#codec-decode-output").textContent === "hello"
    );
    await clickVisible(codec, '[data-codec-type="url"]');
    await codec.waitForFunction(() =>
      document.querySelector("#codec-output").textContent === "aGVsbG8%3D" &&
      document.querySelector("#codec-decode-output").textContent === "aGVsbG8="
    );

    await clickVisible(codec, '[data-codec-type="md5"]');
    await setTextarea(codec, "#tool-input", "abc");
    await codec.waitForFunction(() =>
      document.querySelector("#codec-output").textContent === "900150983cd24fb0d6963f7d28e17f72"
    );
    assert(
      await codec.$eval("#codec-decode-copy", (button) => button.disabled),
      "MD5 摘要没有解码结果。",
    );

    await clickVisible(codec, '[data-codec-type="dataUrl"]');
    await setTextarea(codec, "#tool-input", "data:application/octet-stream;base64,AP9h");
    await codec.waitForFunction(() =>
      document.querySelector("#codec-decode-output").textContent === "00 ff 61"
    );
    assert(
      await codec.evaluate(() =>
        document.querySelector("#codec-decode-copy").disabled &&
        !document.querySelector("#codec-decode-download").disabled &&
        !document.querySelector("#codec-encode-copy").disabled
      ),
      "Data URL 的二进制结果仅可下载，编码结果仍可复制。",
    );

    await clickVisible(codec, "#codec-clear");
    await codec.waitForFunction(() =>
      document.querySelector("#tool-input").value === "" &&
      document.querySelector("#codec-output").hidden &&
      document.querySelector("#codec-decode-output").hidden &&
      document.querySelector("#codec-encode-download").disabled &&
      document.querySelector("#codec-decode-download").disabled
    );
    await clickVisible(codec, "#tool-restore");
    await codec.waitForFunction(() =>
      document.querySelector("#tool-input").value.includes("Base64 · UTF-8") &&
      document.querySelector('[data-codec-type="base64"]').getAttribute("aria-pressed") ===
        "true" &&
      !document.querySelector("#codec-output").hidden
    );
  } finally {
    await codec.close();
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

export async function testDocumentFormatter(browser, baseUrl) {
  const json = await browser.newPage();
  try {
    await json.bringToFront();
    await json.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    await json.goto(`${baseUrl}/json`, { waitUntil: "load" });
    await json.waitForSelector(".browser-toolbox-document-toolbar", { timeout: 10000 });
    await json.bringToFront();
    assert(await json.$eval(".browser-toolbox-json-toggle", (element) => Boolean(element)), "JSON 应出现节点折叠控件。 ");
    assert(await json.$eval("body", (body) => !body.querySelector("img")), "JSON 文本不得被解释为 HTML。 ");
    assert(await json.$eval(".browser-toolbox-document-output", (element) => element.textContent.includes("<img")), "JSON 输出应以文本节点显示源码。 ");
    assert(await json.$('.browser-toolbox-document-toolbar [data-document-action="repair-mojibake"]'), "JSON 应有专属修复工具栏。 ");
    assert(await json.$eval(".browser-toolbox-document-brand", (element) => /JSON/.test(element.textContent)), "JSON 工具栏应显示格式品牌。 ");
    assert(await json.$eval(".browser-toolbox-document-status", (element) => getComputedStyle(element).color !== "rgb(0, 0, 0)"), "JSON 工具栏应显示状态色。 ");
    const documentToolbar = await json.evaluate(() => {
      const toolbar = document.querySelector(".browser-toolbox-document-toolbar");
      const actions = document.querySelector(".browser-toolbox-document-actions");
      return {
        wrap: getComputedStyle(toolbar).flexWrap,
        actionWrap: getComputedStyle(actions).flexWrap,
        actionDisplay: getComputedStyle(actions).display,
      };
    });
    assert(documentToolbar.wrap === "nowrap" && documentToolbar.actionWrap === "nowrap" && documentToolbar.actionDisplay === "flex", "自动美化桌面工具栏应保持严格单行。 ");
    await json.setViewport({ width: 390, height: 820, deviceScaleFactor: 1 });
    const narrowDocumentToolbar = await json.evaluate(() => {
      const toolbar = document.querySelector(".browser-toolbox-document-toolbar");
      const brand = document.querySelector(".browser-toolbox-document-brand-group");
      const actions = document.querySelector(".browser-toolbox-document-actions");
      const brandBox = brand.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      return {
        display: getComputedStyle(toolbar).display,
        wrap: getComputedStyle(toolbar).flexWrap,
        brandCenter: brandBox.top + brandBox.height / 2,
        actionsCenter: actionsBox.top + actionsBox.height / 2,
        overflowX: getComputedStyle(toolbar).overflowX,
        scrollWidth: toolbar.scrollWidth,
        clientWidth: toolbar.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    assert(
      narrowDocumentToolbar.display === "flex" && narrowDocumentToolbar.wrap === "nowrap" &&
        Math.abs(narrowDocumentToolbar.brandCenter - narrowDocumentToolbar.actionsCenter) <= 1 &&
        ["auto", "scroll"].includes(narrowDocumentToolbar.overflowX) &&
        narrowDocumentToolbar.scrollWidth > narrowDocumentToolbar.clientWidth &&
        narrowDocumentToolbar.pageWidth <= narrowDocumentToolbar.viewportWidth,
      `自动美化窄屏工具栏应保持单行、独立横滚且整页不横向溢出：${JSON.stringify(narrowDocumentToolbar)}`,
    );
    // 逐个滚入视口并进行真实命中检查，避免仅凭 overflow 样式误判控件可用。
    const narrowControls = await json.$$(".browser-toolbox-document-actions button, .browser-toolbox-document-actions select");
    assert(narrowControls.length > 0, "自动美化工具栏应有可操作控件。 ");
    for (const control of narrowControls) {
      await control.scrollIntoView();
      const reachable = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(centerX, centerY);
        return {
          label: element.getAttribute("aria-label") || element.textContent,
          visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth,
          hit: hit === element || element.contains(hit),
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      assert(
        reachable.visible && reachable.hit && reachable.pageWidth <= reachable.viewportWidth,
        `窄屏横滚后每个工具栏控件都应可命中且不撑宽页面：${JSON.stringify(reachable)}`,
      );
    }
    await json.setViewport({ width: 1280, height: 820, deviceScaleFactor: 1 });
    // 内容脚本在隔离 world 中创建下载，使用浏览器事件和实际落盘内容验收。
    const downloadDir = await Deno.makeTempDir({ prefix: "browser-toolbox-document-download-" });
    const downloadClient = await browser.target().createCDPSession();
    let download;
    const completedDownloads = new Set();
    downloadClient.on("Browser.downloadWillBegin", (event) => { download = event; });
    downloadClient.on("Browser.downloadProgress", (event) => {
      if (event.state === "completed") completedDownloads.add(event.guid);
    });
    try {
      await downloadClient.send("Browser.setDownloadBehavior", {
        behavior: "allow", downloadPath: downloadDir, eventsEnabled: true,
      });
      await clickDocumentButton(json, "download");
      await waitFor(() => download && completedDownloads.has(download.guid));
      assert(
        /^browser-toolbox-\d+\.json$/.test(download.suggestedFilename),
        `自动美化 JSON 下载文件名应使用毫秒级时间戳前缀：${download.suggestedFilename}`,
      );
      const downloadedText = await Deno.readTextFile(`${downloadDir}/${download.suggestedFilename}`);
      assert(downloadedText.includes("9007199254740993") && downloadedText.includes("<img"), "实际 JSON 下载应保留大整数和原始文本。 ");
    } finally {
      await downloadClient.send("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => {});
      await downloadClient.detach().catch(() => {});
      await Deno.remove(downloadDir, { recursive: true }).catch(() => {});
    }
    await focusTargetPage(browser, json);
    await json.screenshot({ path: "/tmp/browser-toolbox-document-json.png", fullPage: true });
    await clickDocumentButton(json, "toggle-original");
    assert(await json.$eval(".browser-toolbox-document-output", (element) => element.textContent.includes("9007199254740993")), "查看原文应保留原始文本。 ");
    await clickDocumentButton(json, "toggle-original");
    await clickDocumentButton(json, "restore-original");
    assert(await json.$(".browser-toolbox-document-toolbar") === null, "恢复原文应释放格式化视图。 ");
  } finally {
    await json.close();
  }

  for (const [path, label] of [["xml", "XML"], ["css", "CSS"], ["javascript", "JavaScript"], ["java", "Java"]]) {
    const page = await browser.newPage();
    try {
      await page.bringToFront();
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
      await focusTargetPage(browser, page);
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

export async function testSettings(browser, id) {
  const page = await browser.newPage();
  try {
    await page.bringToFront();
    await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 1 });
    await page.goto(`chrome-extension://${id}/pages/mouse_options.html#toolsOverview`, { waitUntil: "load" });
    await page.waitForSelector('[data-settings-ready="true"]', { timeout: 10000 });
    await waitFor(() =>
      page.$$eval(
        ".browser-toolbox-nav-item:not([hidden])",
        (items) => items.length === 12,
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
      expectedAction: BrowserToolboxToolRegistry.list({ source: "action", surface: "popup" }).length,
      expectedContext: BrowserToolboxToolRegistry.list({ source: "selection", surface: "contextMenu" }).length,
      expectedDirectory: BrowserToolboxToolRegistry.entries.length,
    }));
    console.log(`设置页工具数量：${JSON.stringify(counts)}`);
    await focusTargetPage(browser, page);
    assert(counts.action === counts.expectedAction, "动作弹窗设置应列出全部支持弹窗的工具。 ");
    assert(counts.context === counts.expectedContext, "右键菜单设置应列出全部支持右键菜单的工具。 ");
    const actionInputs = await page.$$("#action-tool-list input");
    for (const input of actionInputs) {
      if (!await input.evaluate((element) => element.checked)) await input.click();
    }
    assert(
      await page.$$eval("#action-tool-list input:checked", (inputs) => inputs.length) === counts.action,
      "动作弹窗工具应能选择所有支持该入口的工具，不受数量限制。 ",
    );
    assert(await page.$eval("#action-tool-list-status", (element) => element.textContent) === "", "全选动作弹窗工具后不应显示数量上限错误。 ");
    const contextInputs = await page.$$("#context-menu-tool-list input");
    assert(contextInputs.length >= 4, "右键菜单工具设置应有可测试的第四个选项。 ");
    for (const input of contextInputs) {
      if (!await input.evaluate((element) => element.checked)) await input.click();
    }
    assert(
      await page.$$eval("#context-menu-tool-list input:checked", (inputs) => inputs.length) === counts.context,
      "右键菜单工具应能全部勾选，不受三个工具的限制。 ",
    );
    assert(await page.$eval("#context-menu-tool-list-status", (element) => element.textContent) === "", "全选后不应显示数量上限错误。 ");
    if (!await page.$eval("#save-settings", (element) => element.disabled)) {
      await page.click("#save-settings");
      await waitFor(() => page.evaluate(() =>
        document.querySelector("#save-settings").disabled &&
        document.querySelector("#save-status").textContent === BrowserToolboxI18n.message("saved") &&
        document.querySelector("#dirty-status").textContent === ""
      ));
    }
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-settings-ready="true"]', { timeout: 10000 });
    assert(
      await page.$$eval("#action-tool-list input:checked", (inputs) => inputs.length) === counts.action,
      "保存并刷新后应保留全部动作弹窗工具。 ",
    );
    assert(
      await page.$$eval("#context-menu-tool-list input:checked", (inputs) => inputs.length) === counts.context,
      "保存并刷新后应保留全部右键菜单工具。 ",
    );
    assert(counts.auto === 5, "设置页应有五种自动格式化开关。 ");
    assert(counts.groups === 4 && counts.panels === 12, "设置页应收敛为四大分组和十二个功能分区。 ");
    assert(counts.directory === counts.expectedDirectory && counts.openLinks === counts.expectedDirectory, "工具总览应由注册表生成完整工具目录。 ");
    await focusTargetPage(browser, page);
    await page.screenshot({ path: "/tmp/browser-toolbox-settings-tools-overview.png", fullPage: true });
    await page.click("button[data-section='general']");
    await waitFor(() => page.$eval("#language", (element) => !element.closest("[hidden]")));
    assert(await page.$eval("#language", (element) => element.options.length === 6), "统一语言设置应提供五种语言和跟随浏览器。 ");
    await page.click("button[data-section='jsonFormatter']");
    await waitFor(() => page.$eval("[data-panel='jsonFormatter']", (element) => !element.hidden));
    await focusTargetPage(browser, page);
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
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    await withTimeout(Promise.resolve(browser?.disconnect()), 2000, "断开浏览器超时").catch(() => {});
    if (chromeProcess) {
      try { chromeProcess.kill("SIGTERM"); } catch (_) { /* 浏览器可能已自行退出。 */ }
      await withTimeout(chromeProcess.status, 2000, "浏览器退出超时").catch(async () => {
        try { chromeProcess.kill("SIGKILL"); } catch (_) { /* 仅结束本次测试创建的进程。 */ }
        await chromeProcess.status.catch(() => {});
      });
    }
    await server.shutdown();
    if (userDataDir) await Deno.remove(userDataDir, { recursive: true }).catch(() => {});
  })();
  const onTerminate = () => { cleanup().finally(() => Deno.exit(143)); };
  if (Deno.build.os !== "windows") Deno.addSignalListener("SIGTERM", onTerminate);
  const closeOnboarding = async (target) => {
    if (target.type() !== "page" || !target.url().includes("/pages/onboarding.html")) return;
    const onboardingPage = await target.page().catch(() => null);
    await onboardingPage?.close().catch(() => {});
  };
  try {
    ({ browser, process: chromeProcess, userDataDir } = await startBrowser(server.addr.port));
    browser.on("targetcreated", closeOnboarding);
    browser.on("targetchanged", closeOnboarding);
    const id = await extensionId(browser);
    await runStage(browser, "工具设置", () => testSettings(browser, id));
    await runStage(browser, "动作弹窗", () => testActionPopup(browser, id, baseUrl));
    await runStage(browser, "七个 V3 工具工作台", () => testWorkbenchPages(browser, id));
    await runStage(browser, "编码转换与无效令牌", () => testToolPages(browser, id));
    await runStage(browser, "文档格式化器", () => testDocumentFormatter(browser, baseUrl));
    console.log(`快捷工具 E2E 通过：扩展 ${id}，目录、工具页、令牌失败闭环、五种文档格式和无限工具选择。`);
  } finally {
    browser?.off("targetcreated", closeOnboarding);
    browser?.off("targetchanged", closeOnboarding);
    if (Deno.build.os !== "windows") Deno.removeSignalListener("SIGTERM", onTerminate);
    await cleanup();
  }
}

if (import.meta.main) await main();
