#!/usr/bin/env -S deno run -A
// 连接独立 Chrome for Testing，验证真实扩展的语言保存、重开、工具操作和内容页帮助。
import puppeteer from "npm:puppeteer";

const browserURL = Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL");
if (!browserURL) {
  throw new Error("请指定独立 Chrome for Testing 的 BROWSER_TOOLBOX_E2E_BROWSER_URL");
}
const browser = await puppeteer.connect({ browserURL, protocolTimeout: 20000 });
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
  if (["zh_TW", "ja", "es"].includes(locale)) {
    if (label === "settings" && width < 500) {
      await page.$eval("[data-panel='general']", (node) => node.scrollIntoView());
    }
    await page.screenshot({ path: new URL(`${locale}-${label}-${width}.png`, evidence).pathname });
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
    await tool.waitForSelector("#tool-input");
    assert(
      await tool.$eval("#tool-input", (node) => node.placeholder) ===
        catalog.toolJsonInputHint.message,
      "JSON 输入提示语言不一致",
    );
    await tool.type("#tool-input", '{"b":2,"a":"local"}');
    await tool.waitForFunction(() =>
      document.querySelector("#json-result-tree")?.textContent.includes("local")
    );
    await checkWidth(tool, "json", 1280, locale);
    await checkWidth(tool, "json", 390, locale);

    await tool.goto(`${extensionBase}/pages/tools/index.html?tool=time.convert`);
    await assertLocale(tool, locale);
    await tool.waitForSelector("#time-unix-unit[aria-label]");
    for (const [selector, key] of [
      ["#time-unix-unit", "toolTimeUnit"],
      ["#time-local-unit", "toolTimeUnit"],
      ["#time-unix-output", "toolTimeLocalOutput"],
      ["#time-local-output", "toolTimeUnixOutput"],
      ["#time-filetime-output", "toolTimeFiletimeOutput"],
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
      timestampLabels[0].includes(catalog.toolTimeCurrentUnix.message) &&
        timestampLabels[0].includes(catalog.toolTimeSecondsLabel.message) &&
        timestampLabels[1].includes(catalog.toolTimeMillisecondsLabel.message) &&
        timestampLabels[0] !== timestampLabels[1],
      "当前时间戳的秒和毫秒应有不同且本地化的无障碍名称",
    );
    await checkWidth(tool, "time", 1280, locale);
    await checkWidth(tool, "time", 390, locale);

    await tool.goto(`${extensionBase}/pages/onboarding.html`);
    await assertLocale(tool, locale);
    assert(
      await tool.$eval("[data-i18n='onboardingPause']", (node) => node.textContent) ===
        catalog.onboardingPause.message,
      "入门指引应使用已保存语言",
    );
    await checkWidth(tool, "onboarding", 1280, locale);
    await checkWidth(tool, "onboarding", 390, locale);

    await action.bringToFront();
    await action.goto(`${extensionBase}/pages/action.html`);
    await assertLocale(action, locale);
    assert(
      await action.$eval("[data-i18n='quickTools']", (node) => node.textContent) ===
        catalog.quickTools.message,
      "弹窗页语言不一致",
    );
    await checkWidth(action, "action", 440, locale);

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
}
