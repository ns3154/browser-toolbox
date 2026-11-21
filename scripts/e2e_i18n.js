#!/usr/bin/env -S deno run -A
// 复用快捷工具测试的独立无头浏览器，避免连接或抢占用户的现有窗口。
import { startBrowser } from "./e2e_quick_tools.js";

if (Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") === "false" ||
  Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL")) {
  throw new Error("多语言测试只允许自行启动独立无头浏览器，不接受有头或外部连接。");
}
const { browser, process: chromeProcess, userDataDir } = await startBrowser(0);
const errors = [];
const evidence = new URL(
  Deno.env.get("BROWSER_TOOLBOX_E2E_EVIDENCE_URL") ||
    "../local-development/features/localization/evidence/",
  import.meta.url,
);
await Deno.mkdir(evidence, { recursive: true });
const fixture = Deno.serve({ hostname: "127.0.0.1", port: 0 }, () =>
  new Response(
    '<!doctype html><meta charset="utf-8"><title>多语言测试页</title><h1>多语言测试页</h1><a href="#sample">本地链接</a><p id="sample">按 ? 打开扩展帮助。</p>',
    { headers: { "content-type": "text/html; charset=utf-8" } },
  ));
const results = [];

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function newPage() {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  return page;
}

async function assertLocale(page, locale) {
  await page.waitForFunction(
    (expected) => document.documentElement.lang === expected && document.body.innerText.length > 30,
    { timeout: 10000 },
    locale.replaceAll("_", "-"),
  );
}

async function checkWidth(page, label, width, locale) {
  await page.setViewport({ width, height: width < 500 ? 844 : 800, deviceScaleFactor: 1 });
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    geometry.document <= geometry.viewport + 1,
    `${label}/${locale}/${width} 页面横向溢出：${JSON.stringify(geometry)}`,
  );
  if (label === "settings") {
    const clippedButtons = await page.$$eval(
      ".browser-toolbox-save-bar button",
      (buttons) =>
        buttons.filter((button) => {
          const bounds = button.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          return [...range.getClientRects()].some((text) =>
            text.left < bounds.left - 1 || text.right > bounds.right + 1 ||
            text.top < bounds.top - 1 || text.bottom > bounds.bottom + 1
          );
        }).map((button) => button.textContent),
    );
    assert(clippedButtons.length === 0, `${locale}/${width} 按钮文字溢出：${clippedButtons}`);
  }
  if (["zh_TW", "ja", "es"].includes(locale) ||
    label === "action" && [320, 360, 400].includes(width)) {
    if (label === "settings" && width < 500) {
      await page.$eval("[data-panel='general']", (node) => node.scrollIntoView());
    }
    const screenshot = { path: new URL(`${locale}-${label}-${width}.png`, evidence).pathname };
    if (label === "action") {
      const size = await page.evaluate(() => ({
        width: innerWidth, height: Math.ceil(document.body.getBoundingClientRect().height),
      }));
      screenshot.clip = { x: 0, y: 0, width: size.width, height: size.height };
    }
    await page.screenshot(screenshot);
  }
  return geometry;
}

try {
  const configuredId = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_ID");
  // 扩展工作线程可能已经休眠；已知安装 ID 时直接打开设置页，由页面唤醒工作线程。
  const targetUrl = configuredId
    ? `chrome-extension://${configuredId}/`
    : (await browser.waitForTarget(
      (target) =>
        target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js"),
      { timeout: 15000 },
    )).url();
  const base = new URL(targetUrl).origin;
  // 自定义协议的 URL.origin 可能为 null，直接从已发现的扩展工作线程提取前缀。
  const extensionBase = base === "null" ? targetUrl.split("/").slice(0, 3).join("/") : base;
  const options = await newPage();
  const tool = await newPage();
  const action = await newPage();
  const content = await newPage();
  await options.bringToFront();
  await options.goto(`${extensionBase}/pages/mouse_options.html#general`);
  await options.waitForSelector("button[data-section='general']");
  const choices = await options.$$eval(
    "#language option",
    (nodes) => nodes.map((node) => node.value),
  );
  assert(
    JSON.stringify(choices) === JSON.stringify(["auto", "en", "zh_CN", "zh_TW", "ja", "es"]),
    "语言选项不完整",
  );

  for (const locale of ["zh_TW", "ja", "es", "en", "zh_CN"]) {
    console.log(`开始检查：${locale}`);
    const catalog = JSON.parse(
      await Deno.readTextFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url)),
    );
    await options.bringToFront();
    await options.setViewport({ width: 1280, height: 800 });
    await options.click("button[data-section='general']");
    await options.select("#language", locale);
    if (await options.$eval("#save-settings", (node) => !node.disabled)) {
      await options.click("#save-settings");
      await options.waitForFunction(
        (expected) => document.querySelector("#save-status").textContent === expected,
        { timeout: 10000 },
        catalog.saved.message,
      );
    }
    assert(await options.$eval("#settings-error", (node) => !node.textContent), "设置保存出现错误");
    await options.reload();
    await assertLocale(options, locale);
    assert(await options.$eval("#language", (node) => node.value) === locale, "重开后语言未保留");
    assert(
      await options.$eval("#save-settings", (node) => node.textContent.trim()) ===
        catalog.saveSettings.message,
      "保存按钮语言不一致",
    );
    const wide = await checkWidth(options, "settings", 1280, locale);
    const medium = await checkWidth(options, "settings", 900, locale);
    const narrow = await checkWidth(options, "settings", 390, locale);

    console.log(`设置保存与布局通过：${locale}`);
    await tool.bringToFront();
    await tool.goto(`${extensionBase}/pages/tools/index.html?tool=json.format`);
    await assertLocale(tool, locale);
    await tool.waitForSelector('body[data-tool-ready="true"]');
    await tool.waitForSelector("#tool-input");
    assert(
      await tool.$eval("#tool-input", (node) => node.placeholder) ===
        catalog.toolJsonInputHint.message,
      "JSON 输入提示语言不一致",
    );
    await tool.$eval("#tool-input", (input) => {
      input.value = '{"b":2,"a":"local"}';
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tool.waitForFunction(() =>
      document.querySelector("#json-result-tree")?.textContent.includes("local")
    );
    console.log(`JSON 工具通过：${locale}`);
    await checkWidth(tool, "json", 1280, locale);
    await checkWidth(tool, "json", 390, locale);

    await tool.goto(`${extensionBase}/pages/tools/index.html?tool=time.convert`);
    console.log(`检查时间工具：${locale}`);
    await assertLocale(tool, locale);
    await tool.waitForSelector("#time-zone[aria-label]");
    for (const [selector, key] of [
      ["#time-zone", "toolTimezone"],
      ['[data-segment="time-parse"]', "toolTimeParseMode"],
    ]) {
      assert(
        await tool.$eval(selector, (node) => node.getAttribute("aria-label")) ===
          catalog[key].message,
        `${locale} 时间工具的无障碍名称不一致：${selector}`,
      );
    }
    const timestampLabels = await tool.$$eval(
      "#time-current-seconds, #time-current-milliseconds",
      (nodes) => nodes.map((node) => (node.getAttribute("aria-labelledby") || "")
        .split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")),
    );
    assert(
      timestampLabels[0].includes(catalog.toolTimeUnixSeconds.message) &&
        timestampLabels[1].includes(catalog.toolTimeUnixMillis.message) &&
        timestampLabels[0] !== timestampLabels[1],
      "当前时间戳的秒和毫秒应有不同且本地化的无障碍名称",
    );
    await checkWidth(tool, "time", 1280, locale);
    await checkWidth(tool, "time", 390, locale);

    for (const [id, key] of [
      ["config.convert", "toolConfigConvert"],
      ["table.convert", "toolTableConvert"],
      ["text.diff", "toolTextDiff"],
      ["id.generate", "toolIdGenerate"],
      ["password.generate", "toolPasswordGenerate"],
    ]) {
      await tool.goto(`${extensionBase}/pages/tools/index.html?tool=${id}`);
      await tool.waitForSelector('body[data-tool-ready="true"]');
      await assertLocale(tool, locale);
      assert(await tool.title() === catalog[key].message, `${locale} 工具标题不一致：${id}`);
      assert(
        await tool.$eval(".workbench-breadcrumb a", (link) => link.textContent) === catalog.allTools.message,
        `${locale} 面包屑未翻译：${id}`,
      );
      await checkWidth(tool, id, 1280, locale);
      await checkWidth(tool, id, 390, locale);
    }

    await tool.goto(`${extensionBase}/pages/onboarding.html`);
    await assertLocale(tool, locale);
    assert(
      await tool.$eval("[data-i18n='onboardingPause']", (node) => node.textContent) ===
        catalog.onboardingPause.message,
      "入门指引应使用已保存语言",
    );
    await checkWidth(tool, "onboarding", 1280, locale);
    await checkWidth(tool, "onboarding", 390, locale);

    await content.goto(`http://127.0.0.1:${fixture.addr.port}/`, { waitUntil: "networkidle0" });
    console.log(`检查动作弹窗：${locale}`);
    await content.bringToFront();
    await action.goto(`${extensionBase}/pages/action.html`);
    await assertLocale(action, locale);
    await action.waitForFunction(() =>
      getComputedStyle(document.querySelector("#browser-toolbox-enhancement-summary")).display !== "none",
      { polling: 50, timeout: 10000 },
    );
    assert(
      await action.$eval("[data-i18n='quickTools']", (node) => node.textContent) ===
        catalog.quickTools.message,
      "弹窗页语言不一致",
    );
    await checkWidth(action, "action", 440, locale);
    const popupWidths = [];
    for (const width of [320, 360, 400]) {
      await checkWidth(action, "action", width, locale);
      const grid = await action.$eval("#browser-toolbox-tool-buttons", (element) => {
        const cards = [...element.children].map((item) => item.getBoundingClientRect())
          .filter((item) => item.width > 0 && item.height > 0);
        return cards.slice(0, 2).map((item) => ({ left: item.left, right: item.right, top: item.top }));
      });
      assert(grid.length === 2 && Math.abs(grid[0].top - grid[1].top) < 1 &&
        grid[1].left >= grid[0].right, `${locale}/${width} 快捷工具未按双列排列`);
      const enhancements = await action.$eval(".browser-toolbox-enhancement-grid", (element) => {
        const cards = [...element.children].map((item) => item.getBoundingClientRect())
          .filter((item) => item.width > 0 && item.height > 0)
          .sort((left, right) => left.top - right.top || left.left - right.left);
        return cards.slice(0, 2).map((item) => ({ left: item.left, right: item.right, top: item.top }));
      });
      assert(enhancements.length === 2 && Math.abs(enhancements[0].top - enhancements[1].top) < 1 &&
        enhancements[1].left >= enhancements[0].right, `${locale}/${width} 浏览增强未按双列排列`);
      {
        const clipped = await action.$$eval(
          ".browser-toolbox-enhancement-copy strong, .browser-toolbox-tool-card-copy strong, " +
            ".browser-toolbox-footer-link > span:last-child, .browser-toolbox-session-heading-row h2, " +
            ".browser-toolbox-site-status, .browser-toolbox-session-status, " +
            ".browser-toolbox-secondary-button, .browser-toolbox-section-heading h2, .browser-toolbox-text-link",
          (nodes) => nodes.filter((node) => {
            const bounds = node.getBoundingClientRect();
            if (bounds.width === 0 || bounds.height === 0) return false;
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()].some((rect) => rect.left < bounds.left - 1 ||
              rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1);
          }).map((node) => node.textContent.trim()),
        );
        assert(clipped.length === 0, `${locale}/${width} 弹窗文字越界：${clipped}`);
      }
      const geometry = await action.evaluate(() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
        };
        const collisions = [];
        for (const selector of [
          ".browser-toolbox-action-brand", ".browser-toolbox-site-heading-row",
          ".browser-toolbox-site-main", ".browser-toolbox-session-heading-row",
          "#browser-toolbox-tools .browser-toolbox-section-heading",
          ".browser-toolbox-enhancement-grid", "#browser-toolbox-tool-buttons",
          ".browser-toolbox-action-footer",
        ]) {
          const nodes = [...document.querySelector(selector).children].filter(visible);
          for (let left = 0; left < nodes.length; left++) {
            for (let right = left + 1; right < nodes.length; right++) {
              const a = nodes[left].getBoundingClientRect(), b = nodes[right].getBoundingClientRect();
              if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
                collisions.push(`${selector}: ${nodes[left].textContent.trim()} / ${nodes[right].textContent.trim()}`);
              }
            }
          }
        }
        const brokenWords = [];
        for (const element of document.querySelectorAll(
          ".browser-toolbox-enhancement-copy strong, .browser-toolbox-tool-card-copy strong, " +
            ".browser-toolbox-footer-link > span:last-child, .browser-toolbox-session-status, " +
            ".browser-toolbox-site-status, .browser-toolbox-secondary-button, " +
            ".browser-toolbox-session-heading-row h2, .browser-toolbox-section-heading h2, .browser-toolbox-text-link",
        )) {
          if (!visible(element)) continue;
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            for (const match of node.data.matchAll(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g)) {
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              if (range.getClientRects().length > 1) brokenWords.push(match[0]);
            }
          }
        }
        return { collisions, brokenWords, height: document.body.scrollHeight,
          viewport: innerWidth, documentWidth: document.documentElement.clientWidth,
          bodyWidth: document.body.getBoundingClientRect().width, bodyClientWidth: document.body.clientWidth,
          copyWidths: [...document.querySelectorAll(".browser-toolbox-enhancement-copy")]
            .map((node) => node.getBoundingClientRect().width) };
      });
      assert(geometry.collisions.length === 0, `${locale}/${width} 控件碰撞：${geometry.collisions}`);
      assert(geometry.brokenWords.length === 0, `${locale}/${width} 单词被从中间拆开：${geometry.brokenWords}`);
      assert(geometry.copyWidths.every((value) => value >= 126), `${locale}/${width} 瓦片文案宽度不足：${JSON.stringify(geometry)}`);
      if (width >= 360) assert(geometry.height <= 600, `${locale}/${width} 常规弹窗超过 600px：${geometry.height}`);
      const longHostname = "console.cloud.enterprise-production.long-name.example.com";
      const longTitle = await action.evaluate((hostname) => {
        const title = document.querySelector("#browser-toolbox-current-site-title");
        const original = { text: title.textContent, title: title.title };
        title.textContent = hostname;
        title.title = hostname;
        const result = { title: title.title, clipped: title.scrollWidth > title.clientWidth,
          overflow: getComputedStyle(title).textOverflow };
        title.textContent = original.text;
        title.title = original.title;
        return result;
      }, longHostname);
      assert(longTitle.title === longHostname && longTitle.clipped && longTitle.overflow === "ellipsis",
        `${locale}/${width} 长域名应保留完整提示并单行省略：${JSON.stringify(longTitle)}`);
      await action.$eval("#browser-toolbox-disable-session", (button) => button.click());
      await action.waitForFunction((expected) => {
        const button = document.querySelector("#browser-toolbox-disable-session");
        return !button.disabled &&
          document.querySelector(".browser-toolbox-section-count").textContent === expected &&
          document.querySelector("#browser-toolbox-enhancement-summary").classList.contains("is-paused-by-scope");
      }, { timeout: 10000 }, catalog.actionScopeSessionPaused.message);
      if (locale === "zh_CN" && width === 360) {
        const bounds = await action.$eval("body", (body) => body.getBoundingClientRect().height);
        await action.screenshot({ path: new URL("zh_CN-session-paused-360.png", evidence).pathname,
          clip: { x: 0, y: 0, width, height: Math.ceil(bounds) } });
      }
      await action.$eval("#browser-toolbox-disable-session", (button) => button.click());
      await action.waitForFunction(() => {
        const button = document.querySelector("#browser-toolbox-disable-session");
        return !button.disabled &&
          !document.querySelector("#browser-toolbox-enhancement-summary").classList.contains("is-paused-by-scope") &&
          /^\d\/4$/.test(document.querySelector(".browser-toolbox-section-count").textContent);
      }, { timeout: 10000 });
      popupWidths.push(width);
    }

    await content.goto(`http://127.0.0.1:${fixture.addr.port}/`);
    await content.bringToFront();
    await content.click("h1");
    await content.waitForFunction(() => document.hasFocus());
    // Vimium 按实体键与修饰键识别快捷键；仅输入问号文本不会等同于 Shift + /。
    await content.keyboard.down("Shift");
    await content.keyboard.press("Slash");
    await content.keyboard.up("Shift");
    const frame = await content.waitForFrame(
      (frame) => frame.url().endsWith("/pages/help_dialog_page.html"),
      { timeout: 10000 },
    );
    await frame.waitForFunction(
      (tag) => document.documentElement.lang === tag,
      {},
      locale.replaceAll("_", "-"),
    );
    assert(
      await frame.$eval("#close", (node) => node.getAttribute("aria-label")) ===
        catalog.close.message,
      "网页内帮助未使用保存的语言",
    );
    await content.keyboard.press("Escape");
    results.push({
      locale,
      wide,
      medium,
      narrow,
      persisted: true,
      json: true,
      timeAccessibility: true,
      onboarding: true,
      action: true,
      popupWidths,
      contentHelp: true,
    });
    console.log(`通过：${locale} 保存与重开、JSON 操作、弹窗页、网页内帮助、宽窄屏布局。`);
  }

  await options.bringToFront();
  await options.setViewport({ width: 1280, height: 800 });
  await options.select("#language", "auto");
  await options.click("#save-settings");
  await options.waitForFunction(() =>
    document.querySelector("#save-status").textContent === BrowserToolboxI18n.message("saved")
  );
  const automatic = await options.evaluate(() => ({
    browserLanguage: chrome.i18n.getUILanguage(),
    resolved: BrowserToolboxI18n.locale(),
    selected: document.querySelector("#language").value,
  }));
  assert(automatic.selected === "auto", "未恢复跟随浏览器");
  assert(errors.length === 0, `浏览器错误：${errors.join("\n")}`);
  const report = { version: await browser.version(), extensionBase, results, automatic, errors };
  await Deno.writeTextFile(
    new URL("report.json", evidence),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  await options.bringToFront();
  await action.close();
  await content.close();
} finally {
  await fixture.shutdown();
  browser.disconnect();
  try { chromeProcess.kill("SIGTERM"); } catch (_) { /* 浏览器可能已自行退出。 */ }
  await chromeProcess.status.catch(() => {});
  await Deno.remove(userDataDir, { recursive: true }).catch(() => {});
}
