// SPDX-License-Identifier: GPL-3.0-or-later
import { copy } from "@std/fs";
import * as path from "@std/path";
import puppeteer from "npm:puppeteer";
import { launchCanaryBrowser, resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const current = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const compatible = Deno.env.get("BROWSER_TOOLBOX_SETTINGS_COMPAT_PATH");
const currentPlan = Number(Deno.env.get("BROWSER_TOOLBOX_SETTINGS_PLAN_VERSION") || 8);
const nativeInstall = currentPlan === 9;
const frozenIndependent = Deno.env.get("BROWSER_TOOLBOX_SETTINGS_COMPAT_INDEPENDENT") === "true";
const reportPath = Deno.env.get("BROWSER_TOOLBOX_SETTINGS_REPORT");
if (!executablePath || !current || !compatible) throw new Error("缺少设置对照构建或 CFT");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-settings-e2e-" });
const directory = nativeInstall ? await Deno.realPath(temporary) : temporary;
const profile = path.join(directory, "profile");
await Deno.mkdir(profile);
const extensionPath = path.join(directory, "extension");
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  baseline: compatible,
  current,
  checks: [],
  browsers: [],
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function until(fn, message) {
  const deadline = Date.now() + 10000;
  do {
    if (await fn()) return;
    await pause(35);
  } while (Date.now() < deadline);
  throw new Error(message);
}
async function check(name, run) {
  try {
    const data = await run();
    report.checks.push({ name, status: "passed", ...(data ? { data } : {}) });
    console.log(`设置验收通过：${name}`);
  } catch (error) {
    report.checks.push({ name, status: "failed", error: error.message });
    throw error;
  }
}
const status = "#browser-toolbox-options-status";
const marker = 'script[src="browser_toolbox/owned_page_entry.js"]';
const scroll = '[name="scrollStepSize"]';
const rules = [{ passKeys: "", pattern: "https://fixture.invalid/*" }];
const legacySeed = {
  settingsVersion: "2.4.2",
  keyMappings: "map zx scrollDown",
  scrollStepSize: 79,
  searchEngines: "",
  exclusionRules: rules,
  smoothScroll: false,
};
let id, session, options, maintenance;
const pageErrors = [];
async function install(source, label, previousSession) {
  try {
    await Deno.remove(extensionPath, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await copy(source, extensionPath);
  let currentId;
  if (nativeInstall) {
    // 文件替换后用 Chrome 原生安装 API 更新同一 ID。仅重启命令行装载的同版本扩展，
    // Chrome 可能保留旧 Service Worker；须真正重新安装，不能只检查新页面脚本。
    if (!session) {
      const browser = await puppeteer.launch({
        executablePath,
        headless: false,
        pipe: true,
        userDataDir: profile,
        defaultViewport: { width: 1280, height: 900 },
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          "--enable-unsafe-extension-debugging",
          "--no-first-run",
          "--no-default-browser-check",
          "--window-size=1280,1000",
          `--window-position=${Deno.env.get("BROWSER_TOOLBOX_CFT_WINDOW_POSITION") || "1960,213"}`,
        ],
      });
      session = {
        browser,
        metadata: { mode: "native-unpacked-install", headed: true, connection: "pipe" },
        newPage: () => browser.newPage(),
        activatePage: (page) => page.bringToFront(),
        close: () => browser.close(),
      };
    }
    const client = await session.browser.target().createCDPSession();
    try {
      ({ id: currentId } = await client.send("Extensions.loadUnpacked", { path: extensionPath }));
    } finally {
      await client.detach();
    }
  } else {
    session = await launchCanaryBrowser({
      label,
      plan: source === current ? currentPlan : 8,
      extensionPath,
      previousSession,
      launchOptions: {
        executablePath,
        headless: false,
        userDataDir: profile,
        defaultViewport: { width: 1280, height: 900 },
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--window-size=1280,1000",
        ],
      },
    });
    currentId = await resolveCanaryExtensionId(session.browser);
  }
  assert(!id || currentId === id, "同 profile 升级改变了扩展 ID");
  id = currentId;
  const { browserWsEndpoint: _endpoint, ...launch } = session.metadata;
  report.browsers.push({
    label,
    extensionId: id,
    version: await session.browser.version(),
    launch,
  });
  maintenance = await open("mouse_options");
  await maintenance.waitForSelector('main[data-settings-ready="true"]');
}
async function open(name, prepare) {
  const page = await session.newPage();
  page.on("pageerror", (error) => pageErrors.push({ page: name, message: error.message }));
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload" || dialog.type() === "alert") void dialog.accept();
  });
  if (prepare) await prepare(page);
  await page.goto(`chrome-extension://${id}/pages/${name}.html`);
  return page;
}
const read = () => maintenance.evaluate(() => BrowserToolboxConfigurationClientInstance.read());
const value = (page, selector) => page.$eval(selector, (input) => input.value);
const host = (page) => page.evaluate(() => BrowserToolboxRuntimeHostInstance?.getDiagnostics());
async function loadedModules(page) {
  const client = await page.createCDPSession();
  const modules = new Set();
  client.on("Debugger.scriptParsed", ({ url }) => {
    if (url.startsWith(`chrome-extension://${id}/`)) modules.add(new URL(url).pathname);
  });
  try {
    await client.send("Debugger.enable");
    return [...modules];
  } finally {
    await client.detach();
  }
}
async function ready(page, plan, independent) {
  await page.waitForFunction(() => !!document.querySelector("[name=settingsVersion]").value, {
    polling: 50,
  });
  await until(async () => {
    const diagnostics = await host(page);
    return diagnostics?.initializationState === "active" && diagnostics.planVersion === plan;
  }, `设置页宿主未启动为方案 ${plan}`);
  const loaded = await loadedModules(page);
  assert(loaded.includes("/pages/options.js") !== independent, "设置页控制器路径不符");
}
async function click(page, selector) {
  await session.activatePage(page, maintenance);
  await page.click(selector);
}
async function setField(page, selector, value) {
  await page.$eval(selector, (el, input) => {
    if (typeof input === "boolean") el.checked = input;
    else el.value = input;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function upload(page, payload, selector = "#upload-backup") {
  const file = path.join(directory, "input.json");
  await Deno.writeTextFile(file, typeof payload === "string" ? payload : JSON.stringify(payload));
  await (await page.$(selector)).uploadFile(file);
}
async function download(page, selector, filename) {
  const downloads = await Deno.makeTempDir({ dir: directory });
  const cdp = await session.browser.target().createCDPSession();
  let guid, progress;
  cdp.on("Browser.downloadWillBegin", (event) => {
    if (event.suggestedFilename === filename) guid = event.guid;
  });
  cdp.on("Browser.downloadProgress", (event) => {
    if (event.guid === guid) progress = event;
  });
  try {
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloads,
      eventsEnabled: true,
    });
    await click(page, selector);
    // 文件名出现时 Chrome 可能仍在写入；按本次下载 GUID 等浏览器确认完成。
    await until(() => {
      assert(progress?.state !== "canceled", `下载已取消：${filename}`);
      return progress?.state === "completed";
    }, `下载未完成：${filename}`);
    const bytes = await Deno.readFile(path.join(downloads, filename));
    assert(
      bytes.length === progress.receivedBytes,
      `下载文件字节数与 Chrome 回执不同：${filename}`,
    );
    (report.downloads ||= []).push({ name: filename, bytes: bytes.length, state: progress.state });
    return new TextDecoder().decode(bytes);
  } finally {
    await cdp.detach();
  }
}
async function verifyKeyboard(page, optionsPage = false) {
  await session.activatePage(page, maintenance);
  const selector = optionsPage ? '[name="keyMappings"]' : "#synthetic-editable";
  if (!optionsPage) {
    // 说明页没有文本框，用合成控件验证同一顶层宿主的输入保护。
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "synthetic-editable";
      document.body.prepend(input);
    });
  }
  await page.focus(selector);
  await page.$eval(selector, (el) => el.setSelectionRange(el.value.length, el.value.length));
  const before = await value(page, selector);
  await page.keyboard.type("jf/?");
  assert(await value(page, selector) === before + "jf/?", "输入控件吞掉 Vimium 快捷键字符");
  if (optionsPage) await setField(page, selector, before);
  await page.$eval(selector, (el) => el.blur());
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.keyboard.press("j");
  await until(() => page.evaluate(() => scrollY > 0), "j 没有滚动说明或设置页");
  await page.keyboard.press("?");
  await until(() => page.evaluate(() => HelpDialog.isShowing()), "问号没有打开帮助");
  await until(
    () => page.frames().some((frame) => frame.url().includes("/pages/help_dialog_page.html")),
    "帮助框未实际加载",
  );
  const help = page.frames().find((frame) => frame.url().includes("/pages/help_dialog_page.html"));
  await help.waitForSelector(".row");
  await until(() =>
    help.evaluate(() =>
      document.hasFocus() &&
      globalThis.BrowserToolboxRuntimeHostInstance?.state === "active"
    ), "帮助框未得到焦点或宿主未激活");
  await page.keyboard.press("Escape");
  await until(
    () => page.evaluate(() => !HelpDialog.isShowing() && document.hasFocus()),
    "Esc 没有关闭帮助并恢复焦点",
  );
}
async function docs(plan, independent) {
  const result = {};
  for (
    const [name, selector] of [
      ["command_listing", ".command[id]"],
      ["doc_search_completion", "#engine-list h4"],
    ]
  ) {
    const unexpected = [];
    const page = await open(name, (page) => {
      page.on("request", (request) => {
        if (/^https?:/.test(request.url())) unexpected.push(request.url());
      });
    });
    await page.waitForSelector(selector);
    await until(async () =>
      (await host(page))?.planVersion === plan &&
      (await host(page))?.initializationState === "active", `${name} 宿主没有就绪`);
    const rendered = await page.evaluate(({ name, selector }) => ({
      rows: [...document.querySelectorAll(selector)].map((
        el,
      ) => [
        el.id || el.dataset.engine,
        (name === "command_listing" ? el : el.nextElementSibling).textContent.trim(),
      ]),
      links: [...document.querySelectorAll("a[href]")].map((el) => el.getAttribute("href")),
    }), { name, selector });
    const modules = await loadedModules(page);
    assert(
      modules.includes("/pages/all_content_scripts.js") !== independent &&
        modules.includes(`/pages/${name}.js`) !== independent,
      `${name} 独立入口不符`,
    );
    if (name === "command_listing") {
      assert(
        rendered.rows.some(([id, text]) => id === "scrollDown" && text.includes("zx")),
        "命令列表未显示自定义键位",
      );
    }
    await verifyKeyboard(page);
    assert(unexpected.length === 0, "说明页请求了外部完成器");
    result[name] = { rows: rendered.rows, links: rendered.links };
    await page.close();
  }
  return result;
}
const summaries = {};
let frozenDocs, frozenBackup;
try {
  await install(compatible, "冻结旧版");
  options = await open("options");
  await check("冻结旧设置真实导入并重载", async () => {
    await ready(options, 8, frozenIndependent);
    await upload(options, legacySeed);
    await until(async () => (await read()).keyboard.scrollStepSize === 79, "冻结导入未保存");
    await options.reload();
    await ready(options, 8, frozenIndependent);
    assert(await value(options, scroll) === "79", "冻结设置重载丢失");
  });
  await check("冻结旧设置从草稿下载、旧版附属说明保留键盘", async () => {
    await verifyKeyboard(options, true);
    await setField(options, scroll, "81");
    frozenBackup = await download(options, "#download-backup", "vimium-options.json");
    assert(
      JSON.parse(frozenBackup).scrollStepSize === 81 &&
        (await read()).keyboard.scrollStepSize === 79,
      "冻结备份未读取草稿",
    );
    frozenDocs = await docs(8, frozenIndependent);
    summaries.frozen = Object.fromEntries(
      Object.entries(frozenDocs).map(([name, { rows }]) => [name, rows.length]),
    );
    return summaries.frozen;
  });
  await options.close({ runBeforeUnload: false });
  await maintenance.close();
  const previous = session;
  if (!nativeInstall) {
    await previous.close();
    session = null;
  }
  await install(current, "同 ID 升级独立设置", previous);
  options = await open("options");
  await check("升级后独立入口读取冻结旧版配置，URL 参数无法指定方案", async () => {
    assert(await options.$(marker), "设置 HTML 未使用隔离路由");
    await options.goto(options.url() + "?planVersion=1#vimium-compat");
    await ready(options, currentPlan, true);
    assert(
      await value(options, scroll) === "79" && await value(options, "[name=searchEngines]") === "",
      "升级丢失旧配置",
    );
    if (nativeInstall) {
      const background = await maintenance.evaluate(() => chrome.runtime.sendMessage({
        handler: "browserToolbox.runtimeMaintenance",
        action: "inspect",
      }));
      assert(background?.ok && background.planVersion === currentPlan, "原生重装后后台仍使用旧方案");
      return { backgroundPlan: background.planVersion, pagePlan: (await host(options)).planVersion };
    }
  });
  await check("独立旧 JSON 下载与冻结格式逐字一致，含未保存值和嵌套规则", async () => {
    await verifyKeyboard(options, true);
    await setField(options, scroll, "81");
    const raw = await download(options, "#download-backup", "vimium-options.json");
    if (raw !== frozenBackup) {
      // 两份文件都是测试生成的合成设置，保留差异所需的原始内容。
      report.backupMismatch = { frozen: frozenBackup, independent: raw };
      throw new Error("旧新 Vimium 备份字节不一致");
    }
    const data = JSON.parse(raw);
    assert(
      data.settingsVersion === "2.4.2" && equal(data.exclusionRules, rules) &&
        data.searchEngines === "" && data.smoothScroll === false &&
        !Object.hasOwn(data, "hideHud") &&
        equal(Object.keys(data), Object.keys(data).sort()),
      "备份格式或默认裁剪异常",
    );
    assert((await read()).keyboard.scrollStepSize === 79, "下载改变了持久配置");
  });
  await check("设置快捷键保存和重载，附属文档逐项对照", async () => {
    await session.activatePage(options, maintenance);
    await options.focus(scroll);
    await options.keyboard.down("Control");
    await options.keyboard.press("Enter");
    await options.keyboard.up("Control");
    await until(async () => (await read()).keyboard.scrollStepSize === 81, "快捷键没有提交");
    await options.waitForFunction(
      (selector) =>
        document.querySelector(selector).textContent === BrowserToolboxI18n.message("saved"),
      { polling: 50 },
      status,
    );
    await options.reload();
    await ready(options, currentPlan, true);
    assert(await value(options, scroll) === "81", "重载后读不到提交值");
    assert(equal(await docs(currentPlan, true), frozenDocs), "附属文档行、快捷键或链接与冻结版不一致");
  });
  await check("三种新标签配置值、显隐和自定义 CSS 可重载", async () => {
    const css = '[name="userDefinedLinkHintCss"]';
    await session.activatePage(options, maintenance);
    for (const destination of ["browserNewTabPage", "customUrl", "vimiumNewTabPage"]) {
      await click(options, `[name="newTabDestination"][value="${destination}"]`);
      assert(
        await options.$eval("[name=newTabCustomUrl]", (el) => el.style.display !== "none") ===
          (destination === "customUrl"),
        "自定义地址显隐不匹配",
      );
      assert(
        await options.$eval("#openVomnibarContainer", (el) => el.style.display !== "none") ===
          (destination === "vimiumNewTabPage"),
        "Vomnibar 选项显隐不匹配",
      );
      if (destination === "customUrl") {
        await setField(options, "[name=newTabCustomUrl]", "https://fixture.invalid/current");
      }
      await setField(options, css, "body { --settings-canary-css: preserved; }");
      await options.keyboard.down("Meta");
      await options.keyboard.press("Enter");
      await options.keyboard.up("Meta");
      await until(
        async () => (await read()).keyboard.newTabDestination === destination,
        "新标签配置未保存",
      );
      await options.waitForFunction(
        (selector) =>
          document.querySelector(selector).textContent === BrowserToolboxI18n.message("saved"),
        { polling: 50 },
        status,
      );
      await options.reload();
      await ready(options, currentPlan, true);
      assert(
        await value(options, "[name=newTabDestination]:checked") === destination,
        "重载丢失新标签配置",
      );
    }
    await until(() =>
      options.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue("--settings-canary-css").trim() === "preserved"
      ), "用户 CSS 未在重载后生效");
  });
  await check("两页同一字段冲突保留草稿，异字段提交可合并", async () => {
    const other = await open("options");
    await ready(other, currentPlan, true);
    await setField(other, scroll, "83");
    await setField(options, scroll, "85");
    await click(options, "#save");
    await until(async () => (await read()).keyboard.scrollStepSize === 85, "第一页面保存未完成");
    await click(other, "#save");
    await other.waitForFunction(
      (selector) =>
        document.querySelector(selector).textContent.includes("keyboard.scrollStepSize"),
      { polling: 50 },
      status,
    );
    assert(
      await value(other, scroll) === "83" && (await read()).keyboard.scrollStepSize === 85 &&
        !(await other.$eval("#save", (el) => el.disabled)),
      "冲突后草稿或已保存值丢失",
    );
    await other.reload();
    await ready(other, currentPlan, true);
    await setField(other, '[name="newTabCustomUrl"]', "https://fixture.invalid/new");
    await setField(options, scroll, "87");
    await click(options, "#save");
    await until(async () => (await read()).keyboard.scrollStepSize === 87, "第二次保存未完成");
    await click(other, "#save");
    await until(
      async () => (await read()).keyboard.newTabCustomUrl === "https://fixture.invalid/new",
      "非重叠修改未提交",
    );
    assert((await read()).keyboard.scrollStepSize === 87, "异字段提交覆盖另一页");
    await other.close();
    await options.reload();
    await ready(options, currentPlan, true);
  });
  await check("无效导入保留草稿，兼容旧版本和显式空数组", async () => {
    const before = await read();
    await setField(options, scroll, "89");
    for (const payload of ['{"broken":', { settingsVersion: "2.4.2", scrollStepSize: "invalid" }]) {
      await upload(options, payload);
      await options.waitForFunction(
        (selector) =>
          !!document.querySelector(selector).textContent &&
          document.querySelector(selector).textContent !== BrowserToolboxI18n.message("saved"),
        { polling: 50 },
        status,
      );
      assert(
        equal(await read(), before) && await value(options, scroll) === "89",
        "无效导入更改了持久值或草稿",
      );
    }
    let unknownWarning;
    options.once("dialog", (dialog) => {
      unknownWarning = dialog.type() === "confirm" ? dialog.message() : "";
      void dialog.accept();
    });
    await upload(options, {
      settingsVersion: "2.3",
      newTabUrl: "about:newtab",
      searchEngines: "",
      exclusionRules: [],
      smoothScroll: false,
      unrelatedHistory: "ignored",
    });
    await until(() => unknownWarning !== undefined, "未知字段没有提示");
    assert(unknownWarning.includes("unrelatedHistory"), "未知字段提示缺少字段名");
    await until(
      async () => (await read()).keyboard.exclusionRules.length === 0,
      "旧版本导入未提交",
    );
    await options.waitForFunction(
      (selector) =>
        document.querySelector(selector).textContent === BrowserToolboxI18n.message("saved"),
      { polling: 50 },
      status,
    );
    const raw = JSON.parse(await download(options, "#download-backup", "vimium-options.json"));
    assert(
      raw.newTabDestination === "browserNewTabPage" && equal(raw.exclusionRules, []) &&
        raw.searchEngines === "" && raw.smoothScroll === false &&
        !Object.hasOwn(raw, "unrelatedHistory"),
      "旧版迁移、未知字段或显式空值导出异常",
    );
  });
  await check("实际 sync 配额写入失败保留已提交配置和草稿", async () => {
    const before = await read();
    const css = '[name="userDefinedLinkHintCss"]';
    await setField(options, css, "/*" + "x".repeat(12000) + "*/");
    await click(options, "#save");
    await options.waitForFunction(
      (selector) =>
        !!document.querySelector(selector).textContent &&
        document.querySelector(selector).textContent !== BrowserToolboxI18n.message("saved"),
      { polling: 50 },
      status,
    );
    assert(
      (await value(options, css)).length === 12004 &&
        !(await options.$eval("#save", (el) => el.disabled)) &&
        equal(await read(), before),
      "写入失败显示成功或覆盖草稿/持久配置",
    );
    await options.reload();
    await ready(options, currentPlan, true);
    assert(
      await value(options, css) === before.keyboard.userDefinedLinkHintCss,
      "失败后重载读到草稿",
    );
  });
  await check("工具箱带格式备份继续使用维护页的独立通道", async () => {
    await maintenance.goto(maintenance.url().split("#")[0] + "#backupAbout");
    await session.activatePage(maintenance, maintenance);
    await maintenance.waitForSelector("#export-settings", { visible: true });
    const payload = JSON.parse(
      await download(maintenance, "#export-settings", "browser-toolbox-settings.json"),
    );
    assert(
      payload.format === "browser-toolbox-settings" && Number.isInteger(payload.formatVersion) &&
        Number.isInteger(payload.settings.schemaVersion) &&
        !Object.hasOwn(payload, "settingsVersion"),
      "工具箱带 schema 备份异常",
    );
    const before = await read();
    payload.settings.general.showHud = !before.toolboxSource.value.general.showHud;
    await upload(maintenance, payload, "#import-settings");
    await maintenance.waitForSelector("#import-preview-dialog[open]");
    await click(maintenance, "#import-preview-confirm");
    await until(
      async () =>
        (await read()).toolboxSource.value.general.showHud === payload.settings.general.showHud,
      "工具箱格式导入未提交",
    );
    assert(equal((await read()).keyboard, before.keyboard), "工具箱格式导入覆盖 Vimium 独立配置");
  });
  await check("页面键盘加载失败时设置仍可保存并访问维护入口", async () => {
    const broken = await open("options", async (page) => {
      await page.evaluateOnNewDocument(() => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = (request, ...args) =>
          request?.handler === "initializeFrame" || request?.kind === "lifecycle" &&
              request?.action === "initialize"
            ? Promise.reject(new Error("合成键盘握手失败"))
            : send(request, ...args);
      });
    });
    await broken.waitForFunction(() => !!document.querySelector("[name=settingsVersion]").value, {
      polling: 50,
    });
    await until(
      async () => (await host(broken))?.initializationState === "failed",
      "键盘握手失败未触发",
    );
    await setField(broken, scroll, "91");
    await click(broken, "#save");
    await until(async () => (await read()).keyboard.scrollStepSize === 91, "无键盘时无法提交设置");
    assert(await broken.$('a[href="mouse_options.html"]'), "维护入口丢失");
    await broken.close();
  });
  await check("维护恢复方案1后重开旧入口，配置、说明与快捷键保留", async () => {
    await maintenance.goto(maintenance.url().split("#")[0] + "#general");
    await maintenance.$eval("#runtime-maintenance", (el) => el.open = true);
    await click(maintenance, "#runtime-restore");
    await until(
      () =>
        maintenance.evaluate(async () =>
          (await chrome.storage.local.get("browserToolboxRuntimePlan")).browserToolboxRuntimePlan
            ?.planVersion === 1
        ),
      "维护入口没有恢复兼容方案",
    );
    const expected = await read();
    await options.reload();
    await ready(options, 1, false);
    assert(
      await value(options, scroll) === "91" && equal(await read(), expected) &&
        expected.keyboard.searchEngines === "" && equal(expected.keyboard.exclusionRules, []) &&
        expected.keyboard.smoothScroll === false,
      "恢复后配置漂移",
    );
    await verifyKeyboard(options, true);
    assert(equal(await docs(1, false), frozenDocs), "回退后附属文档不一致");
  });
  assert(pageErrors.length === 0, JSON.stringify(pageErrors));
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  if (options && !options.isClosed()) {
    try {
      report.diagnostics = await options.evaluate(() => ({
        state: globalThis.BrowserToolboxRuntimeHostInstance?.getDiagnostics(),
        modules: performance.getEntriesByType("resource").map((resource) =>
          new URL(resource.name).pathname
        ),
        status: document.querySelector("#browser-toolbox-options-status")?.textContent,
      }));
      if (reportPath) await options.screenshot({ path: reportPath + ".failure.png" });
    } catch (_) { /* 首个失败保留。 */ }
  }
  console.error(error);
} finally {
  report.pageErrors = pageErrors;
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  try {
    await session?.close();
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
if (report.status !== "passed") Deno.exit(1);
