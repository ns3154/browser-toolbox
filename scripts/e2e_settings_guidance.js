// SPDX-License-Identifier: GPL-3.0-or-later
// 在独立浏览器中验证搜索默认值、键盘引导及新增站点规则的可见性。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { assertSafeTestBrowser } from "./test_browser_safety.js";

assertSafeTestBrowser({ headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false" });

const root = path.resolve(path.dirname(path.fromFileUrl(import.meta.url)), "..");
const extension = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  path.join(root, "dist/browser-toolbox");
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const headless = Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false";
const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-settings-guidance-" });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () =>
  new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>键盘导航测试</title></head><body style="height:5000px"><h1>本地测试页面</h1></body></html>',
    { headers: { "content-type": "text/html; charset=utf-8" } },
  ));
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let browser;
try {
  browser = await puppeteer.launch({
    executablePath,
    headless,
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      ...(headless ? [] : [
        `--window-position=${Deno.env.get("BROWSER_TOOLBOX_CFT_WINDOW_POSITION") || "1960,211"}`,
        "--window-size=1280,900",
      ]),
    ],
  });
  const target = await browser.waitForTarget(
    (item) =>
      item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js"),
    {
      timeout: 30000,
    },
  );
  const extensionId = new URL(target.url()).hostname;
  const options = await browser.newPage();
  const errors = [];
  options.on("pageerror", (error) => errors.push(error.message));
  options.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await options.goto(`chrome-extension://${extensionId}/pages/mouse_options.html#search`, {
    waitUntil: "load",
  });
  const ready = async () => {
    try {
      await options.waitForFunction(
        () => document.querySelector(".browser-toolbox-main")?.dataset.settingsReady === "true",
        { polling: 100 },
      );
    } catch (error) {
      const state = await options.evaluate(() => ({
        url: location.href,
        ready: document.querySelector(".browser-toolbox-main")?.dataset.settingsReady,
        error: document.querySelector("#settings-error")?.textContent,
        saveStatus: document.querySelector("#save-status")?.textContent,
      }));
      throw new Error(`设置页未就绪：${JSON.stringify({ state, errors })}`, { cause: error });
    }
  };
  const openSection = async (section) => {
    await options.$eval(`button[data-section='${section}']`, (button) => button.click());
    await options.waitForFunction(
      (name) => !document.querySelector(`[data-panel='${name}']`)?.hidden,
      { polling: 100 },
      section,
    );
  };
  const edit = async (selector, value) => {
    await options.$eval(selector, (element, value) => {
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  const save = async () => {
    await options.waitForFunction(() => !document.querySelector("#save-settings")?.disabled, {
      polling: 100,
    });
    await options.$eval("#save-status", (element) => element.textContent = "");
    await options.$eval("#save-settings", (button) => button.click());
    await options.waitForFunction(() => {
      const save = document.querySelector("#save-settings");
      const error = document.querySelector("#settings-error")?.textContent.trim();
      const status = document.querySelector("#save-status")?.textContent.trim();
      return save?.disabled && !error && status === globalThis.BrowserToolboxI18n.message("saved");
    }, { polling: 100, timeout: 30000 });
  };
  await ready();
  await openSection("search");
  const search = await options.$eval("#search-engines", (element) => ({
    value: element.value,
    placeholder: element.placeholder,
  }));
  assert(
    search.value === "g: https://google.com/search?q=%s Google" &&
      search.placeholder === search.value,
    `新配置应默认使用 Google：${JSON.stringify(search)}`,
  );
  const network = await target.createCDPSession();
  await network.send("Network.enable");
  await network.send("Network.setBlockedURLs", { urls: ["*://suggestqueries.google.com/*"] });
  const suggestions = [];
  network.on("Network.requestWillBeSent", ({ request }) => {
    if (request.url.includes("suggestqueries.google.com")) suggestions.push(request.url);
  });
  const fixture = await browser.newPage();
  fixture.on("pageerror", (error) => errors.push(error.message));
  await fixture.goto(fixtureUrl, { waitUntil: "load" });
  await fixture.bringToFront();
  await delay(1000);
  await fixture.keyboard.press("o");
  let vomnibar;
  for (let attempt = 0; attempt < 100 && !vomnibar; attempt++) {
    vomnibar = fixture.frames().find((frame) => frame.url().includes("/pages/vomnibar_page.html"));
    if (!vomnibar) await delay(100);
  }
  assert(vomnibar, "普通网页应能通过 o 打开搜索栏");
  await vomnibar.waitForSelector("#vomnibar-search");
  await vomnibar.type("#vomnibar-search", "g synthetic query");
  await vomnibar.waitForFunction(
    () => document.querySelector("#vomnibar-completions")?.textContent.includes("synthetic query"),
    {
      polling: 100,
      timeout: 10000,
    },
  );
  await delay(1000);
  assert(
    suggestions.length === 0,
    `默认搜索输入期间不应请求在线联想：${JSON.stringify(suggestions)}`,
  );
  let submittedSearch = "";
  await fixture.setRequestInterception(true);
  const interceptSearch = (request) => {
    if (request.isNavigationRequest() && request.url().startsWith("https://google.com/search?")) {
      submittedSearch = request.url();
      request.abort();
    } else {
      request.continue();
    }
  };
  fixture.on("request", interceptSearch);
  await fixture.keyboard.press("Enter");
  for (let attempt = 0; attempt < 100 && !submittedSearch; attempt++) await delay(100);
  assert(
    submittedSearch && new URL(submittedSearch).searchParams.get("q") === "synthetic query",
    `提交时应打开 Google 搜索地址：${submittedSearch}`,
  );
  fixture.off("request", interceptSearch);
  await fixture.setRequestInterception(false);
  await options.bringToFront();
  const oldSearch = "bd: https://www.baidu.com/s?wd=%s 百度";
  await edit("#search-engines", oldSearch);
  await save();
  await options.reload({ waitUntil: "load" });
  await ready();
  await openSection("search");
  assert(
    await options.$eval("#search-engines", (element) => element.value) === oldSearch,
    "已保存的搜索引擎配置应在重载后保留",
  );
  console.log("通过：Google 默认搜索、本地候选与已有搜索配置保留");

  await openSection("keyboard");
  const guidance = await options.$eval("[data-panel='keyboard']", (panel) => ({
    steps: panel.querySelectorAll(".browser-toolbox-search-step").length,
    text: panel.innerText,
    link: panel.querySelector("[data-i18n='keyboardCommandsLink']")?.getAttribute("href"),
    enabled: panel.querySelector("#keyboard-enabled")?.checked,
  }));
  assert(
    guidance.steps === 3 && guidance.enabled && guidance.text.includes("j / k") &&
      guidance.text.includes("map J scrollDown") && guidance.text.includes("unmapAll") &&
      guidance.link === "command_listing.html",
    `键盘引导或命令入口不完整：${JSON.stringify(guidance)}`,
  );
  const initialLocale = await options.evaluate(() => globalThis.BrowserToolboxI18n.locale());
  for (const locale of ["zh_CN", "zh_TW", "en", "ja", "es"]) {
    const localized = await options.evaluate((locale) => {
      globalThis.BrowserToolboxI18n.setLocale(locale);
      globalThis.BrowserToolboxI18n.apply(document);
      return [
        ...document.querySelectorAll("[data-panel='keyboard'] .browser-toolbox-search-step strong"),
      ]
        .map((element) => element.textContent.trim());
    }, locale);
    assert(
      localized.length === 3 && localized.every((text) => text && !text.startsWith("keyboardStep")),
      `${locale} 键盘引导文案不完整：${JSON.stringify(localized)}`,
    );
  }
  await options.evaluate((locale) => {
    globalThis.BrowserToolboxI18n.setLocale(locale);
    globalThis.BrowserToolboxI18n.apply(document);
  }, initialLocale);
  for (const width of [1280, 390]) {
    await options.setViewport({ width, height: 844 });
    const layout = await options.$eval(
      "[data-panel='keyboard'] .browser-toolbox-search-steps",
      (guide) => ({
        width: guide.getBoundingClientRect().width,
        viewport: innerWidth,
        overflow: guide.scrollWidth > guide.clientWidth,
        cards: [...guide.children].map((card) => ({
          top: card.getBoundingClientRect().top,
          overflow: card.scrollWidth > card.clientWidth,
        })),
      }),
    );
    assert(
      layout.width <= layout.viewport && !layout.overflow &&
        layout.cards.every((card) => !card.overflow) &&
        (width === 390
          ? layout.cards[0].top < layout.cards[1].top
          : layout.cards[0].top === layout.cards[1].top),
      `键盘引导在 ${width}px 视口应正常排列：${JSON.stringify(layout)}`,
    );
  }
  await options.setViewport({ width: 1280, height: 720 });
  await edit("#key-mappings", "map q scrollDown");
  await save();
  await fixture.goto(fixtureUrl, { waitUntil: "load" });
  await fixture.bringToFront();
  await delay(1000);
  await fixture.keyboard.press("q");
  await fixture.waitForFunction(() => scrollY > 0, { polling: 100, timeout: 10000 });
  console.log("通过：键盘三步引导、命令入口和保存后自定义快捷键");

  await options.bringToFront();
  await openSection("siteRules");
  for (let index = 0; index < 6; index++) {
    await options.$eval("#add-site-rule", (button) => button.click());
    await edit(
      "#site-rules tr:last-child input[data-field='pattern']",
      `https://fixture-${index}.example/*`,
    );
  }
  const addAndCheck = async (width, height, pattern) => {
    await options.setViewport({ width, height });
    await options.$eval("#add-site-rule", (button) => button.scrollIntoView({ block: "center" }));
    const before = await options.evaluate(() => ({
      count: document.querySelectorAll("#site-rules tr[data-rule-id]").length,
      lastTop: document.querySelector("#site-rules tr:last-child input[data-field='pattern']")
        .getBoundingClientRect().top,
      height: innerHeight,
    }));
    assert(before.lastTop > before.height, `测试前应存在屏幕外的规则：${JSON.stringify(before)}`);
    await options.click("#add-site-rule");
    await options.waitForFunction(
      () =>
        document.activeElement ===
          document.querySelector("#site-rules tr:last-child input[data-field='pattern']"),
      { polling: 100 },
    );
    const after = await options.evaluate(() => {
      const input = document.querySelector("#site-rules tr:last-child input[data-field='pattern']");
      const rect = input.getBoundingClientRect();
      return {
        count: document.querySelectorAll("#site-rules tr[data-rule-id]").length,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: innerWidth,
        height: innerHeight,
        selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
        preserved: [...document.querySelectorAll("#site-rules input[data-field='pattern']")]
          .some((element) => element.value === "https://fixture-0.example/*"),
      };
    });
    assert(
      after.count === before.count + 1 && after.top >= 0 && after.bottom <= after.height &&
        after.left >= 0 && after.right <= after.width && after.selected && after.preserved,
      `新增规则应可见、聚焦、选中并保留既有草稿：${JSON.stringify(after)}`,
    );
    await options.keyboard.type(pattern);
    assert(
      await options.$eval(
        "#site-rules tr:last-child input[data-field='pattern']",
        (element) => element.value,
      ) === pattern,
      "新规则网址应可直接输入替换",
    );
  };
  await addAndCheck(1280, 720, "https://desktop.example/*");
  await addAndCheck(390, 844, "https://mobile.example/*");
  await save();
  await options.reload({ waitUntil: "load" });
  await ready();
  await openSection("siteRules");
  const patterns = await options.$$eval(
    "#site-rules input[data-field='pattern']",
    (elements) => elements.map((element) => element.value),
  );
  assert(
    ["https://fixture-0.example/*", "https://desktop.example/*", "https://mobile.example/*"].every((
      value,
    ) => patterns.includes(value)),
    `保存重载后规则应保留：${JSON.stringify(patterns)}`,
  );
  assert(errors.length === 0, `页面出现未处理错误：${JSON.stringify(errors)}`);
  console.log("通过：桌面与窄视口新增规则定位、编辑及保存");
  console.log(`设置引导 E2E 全部通过：${await browser.version()}`);
} finally {
  await browser?.close().catch(() => {});
  await server.shutdown();
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
