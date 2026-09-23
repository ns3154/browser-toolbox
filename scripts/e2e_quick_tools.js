#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys

// 快捷工具和原始文档格式化器的独立浏览器 E2E；只使用本地 fixture、独立 profile 和本地扩展目录。
import puppeteer from "npm:puppeteer";

const projectRoot = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/\/$/, "");
const extensionPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  `${projectRoot}/dist/browser-toolbox`;
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
  puppeteer.executablePath();
const headless = Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false";

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

async function startBrowser(excludedPort) {
  const port = await freePort(excludedPort);
  const userDataDir = await Deno.makeTempDir({ prefix: "browser-toolbox-quick-tools-profile-" });
  const process = new Deno.Command(executablePath, {
    args: [
      ...(headless ? ["--headless=new"] : []),
      "--no-sandbox",
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
  await page.waitForFunction(() => {
    const button = document.querySelector("#tool-run");
    const status = document.querySelector("#tool-status");
    return Boolean(button && !button.disabled && status?.textContent.trim());
  }, { timeout: 10000 });
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
    await restricted.bringToFront();
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
    const toolbar = await page.evaluate(() => {
      const controls = document.querySelector("#tool-controls");
      const actions = document.querySelector(".browser-toolbox-tool-actions");
      const sort = document.querySelector('[data-tool-option="sortOrder"]');
      return {
        controlsWrap: controls && getComputedStyle(controls).flexWrap,
        controlsOverflow: controls && getComputedStyle(controls).overflowX,
        controlsDisplay: controls && getComputedStyle(controls).display,
        headerToolbarDisplay: getComputedStyle(document.querySelector("#tool-header-toolbar")).display,
        headerToolbarOverflow: getComputedStyle(document.querySelector("#tool-header-toolbar")).overflowX,
        actionsWrap: actions && getComputedStyle(actions).flexWrap,
        copyInActions: Boolean(actions?.querySelector("#tool-copy")),
        copyInResult: Boolean(document.querySelector(".browser-toolbox-result-heading #tool-copy")),
        localBadge: Boolean(document.querySelector(".browser-toolbox-tools-header .browser-toolbox-local-badge")),
        back: Boolean(document.querySelector("#tool-back")),
        settings: Boolean(document.querySelector("#tool-settings")),
        sortTag: sort?.tagName,
        sortValues: sort ? [...sort.options].map((option) => option.value) : [],
        sortLabels: sort ? [...sort.options].map((option) => option.textContent) : [],
      };
    });
    assert(toolbar.controlsWrap === "nowrap" && toolbar.actionsWrap === "nowrap" && toolbar.controlsOverflow === "visible", "宽屏工具栏和操作条应保持单行。 ");
    assert(toolbar.localBadge && !toolbar.back && !toolbar.settings, "独立工具页顶部只保留品牌、工具标题和本地处理标记。 ");
    assert(!toolbar.copyInActions && toolbar.copyInResult, "复制按钮应从操作条移到结果区。 ");
    assert(toolbar.sortTag === "SELECT" && toolbar.sortValues.join(",") === "original,ascending,descending", "排序应使用单独的三态下拉框。 ");
    assert(toolbar.sortLabels.join("/") === "原始/升序/降序" || toolbar.sortLabels.join("/") === "Original/Ascending/Descending", "排序下拉框文案应简洁明确。 ");
    const sortMenu = await page.evaluate(() => {
      const trigger = document.querySelector("#json-sort-trigger");
      const menu = document.querySelector("#json-sort-menu");
      const option = menu?.querySelector("[role=option]");
      if (!trigger || !menu || !option) return null;
      const triggerStyle = getComputedStyle(trigger);
      const optionStyle = getComputedStyle(option);
      return {
        trigger: trigger.getAttribute("aria-label"),
        role: menu.getAttribute("role"),
        options: [...menu.querySelectorAll("[role=option]")].map((item) => item.textContent.replace("✓", "").trim()),
        matchingStyle: ["fontFamily", "fontSize", "fontWeight", "lineHeight"].every((key) =>
          triggerStyle[key] === optionStyle[key]
        ),
      };
    });
    assert(
      sortMenu?.role === "listbox" && sortMenu.options.join("/") === "原始/升序/降序" && sortMenu.matchingStyle,
      `排序菜单应使用统一的本地控件样式：${JSON.stringify(sortMenu)}`,
    );
    await clickVisible(page, "#json-sort-trigger");
    await waitFor(() => page.$eval("#json-sort-trigger", (button) => button.getAttribute("aria-expanded") === "true")
      .catch(() => false));
    await page.screenshot({ path: "/tmp/browser-toolbox-json-sort-menu.png", fullPage: false });
    assert(
      await page.$eval("#json-sort-menu", (menu) => menu.classList.contains("is-open") && menu.getBoundingClientRect().height > 0),
      "排序菜单打开后应显示统一样式的选项。 ",
    );
    await page.click('#json-sort-menu [data-sort-value="ascending"]');
    assert(
      await page.$eval("#json-sort-trigger", (button) => button.getAttribute("aria-expanded") === "false" && button.textContent.includes("升序")),
      "选择排序选项后菜单应收起并更新当前文字。 ",
    );
    await clickVisible(page, ".browser-toolbox-json-advanced > summary");
    await waitFor(() => page.$eval(".browser-toolbox-json-advanced", (details) => details.open).catch(() => false));
    await page.screenshot({ path: "/tmp/browser-toolbox-json-more-options-open.png", fullPage: false });
    await page.mouse.click(20, 300);
    await waitFor(() => page.$eval(".browser-toolbox-json-advanced", (details) => !details.open).catch(() => false));
    assert(await page.$eval(".browser-toolbox-json-advanced", (details) => !details.open), "点击页面空白处应关闭更多选项。 ");
    await page.select('[data-tool-option="operation"]', "sort");
    await page.select('[data-tool-option="sortOrder"]', "ascending");
    await setTextarea(page, "#tool-input", '{"z":9007199254740993,"a":2,"nested":{"keep":true}}');
    await waitFor(() => page.$eval("#tool-output", (element) => element.textContent.includes("9007199254740993"))
      .catch(() => false));
    assert(await page.$eval("#tool-status", (element) => /自动解析|automatically/i.test(element.textContent)), "JSON 输入变化后应自动解析并更新状态。 ");
    const output = await page.$eval("#tool-output", (element) => element.textContent);
    assert(output.indexOf('"a": 2') < output.indexOf('"z": 9007199254740993'), "JSON 工具应稳定排序并保留大整数原文。 ");
    const tree = await page.evaluate(() => ({
      text: document.querySelector("#json-result-tree")?.textContent || "",
      toggles: document.querySelectorAll(".browser-toolbox-json-toggle").length,
      iconActions: [...document.querySelectorAll(".browser-toolbox-json-node-action")].map((button) => button.getAttribute("aria-label")),
      keys: [...document.querySelectorAll("#json-result-tree .browser-toolbox-json-key")].map((element) => element.textContent),
    }));
    assert(tree.text.includes("9007199254740993") && tree.toggles >= 2, "JSON 结果应以可折叠节点树展示。 ");
    assert(tree.iconActions.every((label) => label), "JSON 节点操作应通过可访问图标按钮提供。 ");
    assert(tree.keys.indexOf('"a"') < tree.keys.indexOf('"z"'), "JSON 结果树应与排序下拉框保持一致。 ");
    assert(await page.$eval("#json-copy-root", (button) => !button.hidden), "JSON 结果区应保留复制图标。 ");
    await page.setViewport({ width: 390, height: 820, deviceScaleFactor: 1 });
    const mobileToolbar = await page.$eval("#tool-header-toolbar", (element) => ({
      display: getComputedStyle(element).display,
      overflowX: getComputedStyle(element).overflowX,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      gridAreas: getComputedStyle(element.closest(".browser-toolbox-tools-header")).gridTemplateAreas,
      toolbarTop: Math.round(element.getBoundingClientRect().top),
      headingTop: Math.round(element.closest(".browser-toolbox-tools-header").querySelector(".browser-toolbox-tool-heading").getBoundingClientRect().top),
      badgeTop: Math.round(element.closest(".browser-toolbox-tools-header").querySelector(".browser-toolbox-local-badge").getBoundingClientRect().top),
    }));
    assert(
      mobileToolbar.display === "flex" && mobileToolbar.overflowX === "auto" &&
        mobileToolbar.scrollWidth > mobileToolbar.clientWidth && mobileToolbar.gridAreas.includes("toolbar toolbar") &&
        mobileToolbar.toolbarTop > Math.max(mobileToolbar.headingTop, mobileToolbar.badgeTop),
      `窄屏工具栏应收为两行，控制行可横向浏览：${JSON.stringify(mobileToolbar)}`,
    );
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
    await page.evaluate(() => {
      window.__browserToolboxDownload = "";
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__browserToolboxDownload = this.download;
        originalClick.call(this);
      };
    });
    await clickVisible(page, "#tool-download");
    assert(await page.evaluate(() => window.__browserToolboxDownload), "JSON 下载应触发本地链接。 ");
    assert(await page.evaluate(() => /^browser-toolbox-\d+\.json$/.test(window.__browserToolboxDownload)), "JSON 下载文件名应使用毫秒级时间戳前缀。 ");
  } finally {
    await page.close();
  }

  const codec = await openTool(browser, id, "codec.transform");
  try {
    assert(await codec.$("#tool-picker") === null, "编码页不应使用下拉框选择编码类型。 ");
    await clickVisible(codec, '[data-codec-operation="encode"]');
    await clickVisible(codec, '[data-codec-type="base64"]');
    await setTextarea(codec, "#tool-input", "hello");
    await waitFor(() => codec.$eval("#codec-output", (element) => element.textContent === "aGVsbG8=")
      .catch(() => false));
    assert(await codec.$eval("#codec-output", (element) => element.textContent) === "aGVsbG8=", "编码工具应在扩展页内本地运行。 ");
    await clickVisible(codec, '[data-codec-operation="decode"]');
    await setTextarea(codec, "#tool-input", "aGVsbG8=");
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
    await waitFor(() => diff.$eval("#diff-result-list", (element) => element.textContent.includes("new")));
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
      expectedAction: BrowserToolboxToolRegistry.list({ source: "action", surface: "popup" }).length,
      expectedContext: BrowserToolboxToolRegistry.list({ source: "selection", surface: "contextMenu" }).length,
      expectedDirectory: BrowserToolboxToolRegistry.entries.length,
    }));
    console.log(`设置页工具数量：${JSON.stringify(counts)}`);
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
    assert(counts.groups === 3 && counts.panels === 15, "设置页应收敛为三大分组和十五个功能分区。 ");
    assert(counts.directory === counts.expectedDirectory && counts.openLinks === counts.expectedDirectory, "工具总览应由注册表生成完整工具目录。 ");
    await page.screenshot({ path: "/tmp/browser-toolbox-settings-tools-overview.png", fullPage: true });
    await page.click("button[data-section='general']");
    await waitFor(() => page.$eval("#language", (element) => !element.closest("[hidden]")));
    assert(await page.$eval("#language", (element) => element.options.length === 6), "统一语言设置应提供五种语言和跟随浏览器。 ");
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
  try {
    ({ browser, process: chromeProcess, userDataDir } = await startBrowser(server.addr.port));
    const id = await extensionId(browser);
    await runStage(browser, "工具设置", () => testSettings(browser, id));
    await runStage(browser, "动作弹窗", () => testActionPopup(browser, id, baseUrl));
    await runStage(browser, "独立工具页", () => testToolPages(browser, id));
    await runStage(browser, "文档格式化器", () => testDocumentFormatter(browser, baseUrl));
    console.log(`快捷工具 E2E 通过：扩展 ${id}，目录、工具页、令牌失败闭环、五种文档格式和无限工具选择。`);
  } finally {
    if (Deno.build.os !== "windows") Deno.removeSignalListener("SIGTERM", onTerminate);
    await cleanup();
  }
}

if (import.meta.main) await main();
