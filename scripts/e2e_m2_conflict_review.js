// SPDX-License-Identifier: GPL-3.0-or-later
// 独立合成配置验证观察选择和备份导入，不访问或修改系统剪贴板。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_M2_REVIEW_REPORT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-m2-review-" });
const extension = path.join(temporary, "build", "browser-toolbox");
const download = path.join(temporary, "download");
await Deno.mkdir(download);
const report = { status: "running", source: "synthetic", checks: [] };
let browser;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, label) => {
  if (!condition) throw new Error(label);
};
const check = (name) => {
  report.checks.push({ name, status: "passed" });
  console.log(`逐项复核通过：${name}`);
};
const trace = (step) => {
  report.currentStep = step;
  console.log(`逐项复核步骤：${step}`);
};
async function until(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(50);
  }
  throw new Error(label);
}
async function launch(profile) {
  return await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 30000,
    userDataDir: path.join(temporary, profile),
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
    ],
  });
}
async function ready() {
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const id = new URL(target.url()).host;
  const worker = await target.worker();
  await until(
    () => worker.evaluate(() => Boolean(globalThis.BrowserToolboxConfigurationWriterInstance)),
    "后台配置写入器未就绪",
  );
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html#general`);
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50, timeout: 45000 },
  );
  return { id, worker, page };
}
async function request(page, action, input = {}) {
  return await page.evaluate(({ action, input }) =>
    chrome.runtime.sendMessage({
      handler: "browserToolbox.configuration",
      action,
      input,
    }), { action, input });
}
try {
  trace("构建并启动第一个合成浏览器");
  await buildArtifacts({ output: path.join(temporary, "build") });
  browser = await launch("conflict-profile");
  report.chrome = await browser.version();
  const { id, worker, page } = await ready();
  const baseline = await request(page, "read");
  assert(baseline.ok, "合成基线不可用");
  const syntheticKey = 'map x scrollUp\n# <img src=x onerror="window.syntheticExecuted=true">';
  await page.evaluate(({ toolbox, syntheticKey, smoothScroll }) => {
    toolbox.general.showHud = !toolbox.general.showHud;
    toolbox.mouse.bindings = [];
    toolbox.cursor.enabled = true;
    toolbox.cursor.localAssetId = "browserToolboxCursor-12345678";
    return chrome.storage.sync.set({
      keyMappings: syntheticKey,
      smoothScroll: !smoothScroll,
      browserToolboxSettings: toolbox,
    });
  }, {
    toolbox: baseline.value.toolboxSource.value,
    syntheticKey,
    smoothScroll: baseline.value.keyboard.smoothScroll,
  });
  await until(
    () => worker.evaluate(() => globalThis.BrowserToolboxConfigurationWriterInstance.dirty),
    "未观察到合成配置变化",
  );
  const conflict = await request(page, "preview");
  assert(conflict.ok && conflict.value.code === "CONFIGURATION_EXTERNAL_CONFLICT", "冲突未被阻断");
  const list = await request(page, "list-conflict-observations");
  assert(list.ok && list.value.length === 1 && list.value[0].status === "saved", "未保存合成观察");
  const key = list.value[0].key;
  const before = await page.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
  }));

  trace("在维护页选择已保存观察");
  await page.evaluate(() => {
    document.querySelector("#conflict-observation-refresh").closest("details").open = true;
  });
  trace("刷新合成观察列表");
  await page.$eval("#conflict-observation-refresh", (element) => element.click());
  await until(
    () => page.$eval("#conflict-observation-review", (element) => !element.disabled),
    "观察未列出",
  );
  const draftBefore = await page.$eval("#dirty-status", (element) => element.textContent);
  trace("打开逐项复核");
  await page.$eval("#conflict-observation-review", (element) => element.click());
  await until(() => page.$eval("#conflict-review", (element) => !element.hidden), "复核区未打开");
  const review = await page.evaluate(() => ({
    paths: [...document.querySelectorAll("#conflict-review fieldset")].map((field) =>
      field.dataset.path
    ),
    checked: document.querySelectorAll('#conflict-review input[type="radio"]:checked').length,
    exportDisabled: document.querySelector("#conflict-review-export").disabled,
    specialRecoveryHidden: document.querySelector("#conflict-search-default-recover").hidden,
    injectedNodes:
      document.querySelectorAll("#conflict-review img, #conflict-review script").length,
    text: document.querySelector("#conflict-review-fields").textContent,
    executed: Boolean(globalThis.syntheticExecuted),
  }));
  for (
    const expected of [
      "/keyboard/keyMappings",
      "/keyboard/smoothScroll",
      "/toolbox/general/showHud",
      "/toolbox/mouse/bindings",
      "/toolbox/cursor/enabled",
      "/toolbox/cursor/localAssetId",
    ]
  ) {
    assert(review.paths.includes(expected), `缺少差异 ${expected}`);
  }
  assert(review.checked === 0 && review.exportDisabled, "未选择全部差异时可导出");
  assert(review.specialRecoveryHidden, "其他冲突不应出现搜索默认值恢复入口");
  assert(
    review.injectedNodes === 0 && !review.executed && review.text.includes("<img src=x"),
    "观察文本被当成 HTML",
  );
  check("差异默认未选择，配置正文仅作为文本显示");
  await page.setViewport({ width: 320, height: 800 });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "320px 下复核区横向溢出",
  );
  const named = await page.evaluate(() =>
    [...document.querySelectorAll('#conflict-review input[type="radio"]')]
      .every((input) => input.labels?.length && input.closest("fieldset")?.querySelector("legend"))
  );
  assert(named, "差异选择缺少语义标签");
  check("窄屏和逐项选择的标签语义");
  await page.evaluate(() => {
    for (const field of document.querySelectorAll("#conflict-review fieldset")) {
      const side = [
          "/keyboard/keyMappings",
          "/toolbox/general/showHud",
          "/toolbox/mouse/bindings",
          "/toolbox/cursor/enabled",
          "/toolbox/cursor/localAssetId",
        ]
          .includes(field.dataset.path)
        ? "observed"
        : "committed";
      field.querySelector(`input[value="${side}"]`).click();
    }
  });
  assert(
    await page.$eval("#conflict-review-export", (element) => !element.disabled),
    "逐项选择后仍不能导出",
  );
  assert(
    draftBefore === await page.$eval("#dirty-status", (element) => element.textContent),
    "复核选择误改设置草稿",
  );
  check("显式选择每处差异且不改设置草稿");

  trace("导出候选备份");
  const cdp = await page.target().createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: download });
  await page.$eval("#conflict-review-export", (element) => element.click());
  const candidatePath = path.join(download, "browser-toolbox-conflict-candidate.json");
  await until(async () => {
    try {
      return (await Deno.stat(candidatePath)).isFile;
    } catch (_) {
      return false;
    }
  }, "候选备份未生成");
  const candidate = JSON.parse(await Deno.readTextFile(candidatePath));
  assert(candidate.format === "browser-toolbox-settings", "候选不是标准设置备份");
  assert(candidate.keyboardSettings.values.keyMappings === syntheticKey, "未保留所选键盘值");
  assert(
    candidate.keyboardSettings.values.smoothScroll === baseline.value.keyboard.smoothScroll,
    "未保留所选布尔值",
  );
  assert(
    candidate.settings.general.showHud !== baseline.value.toolboxSource.value.general.showHud,
    "未保留所选工具箱值",
  );
  assert(candidate.settings.mouse.bindings.length === 0, "未按整体保留所选数组");
  assert(
    candidate.settings.cursor.localAssetId === null && !candidate.settings.cursor.enabled &&
      !candidate.localAssets.length &&
      !JSON.stringify(candidate).includes("browserToolboxCursor-12345678"),
    "候选包含悬空的本机指针资源",
  );
  const after = await page.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
  }));
  assert(JSON.stringify(before) === JSON.stringify(after), "复核或导出改写了配置与观察存储");
  const blocked = await request(page, "commit", { legacyPatch: { smoothScroll: false } });
  assert(!blocked.ok && blocked.code === "CONFIGURATION_EXTERNAL_CONFLICT", "导出后冲突保护被绕过");
  check("导出实际候选文件且保留原数据与冲突保护");

  trace("检查正文访问权限");
  const other = await browser.newPage();
  await other.goto(`chrome-extension://${id}/pages/options.html`);
  const denied = await Promise.all(
    ["review-conflict-observation", "prepare-conflict-candidate", "recover-search-default-conflict"].map((action) =>
      request(other, action, { key })
    ),
  );
  assert(denied.every((item) => item.code === "PERMISSION_DENIED"), "其他顶层设置页能读取观察正文");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "synthetic-mouse-frame";
    frame.src = chrome.runtime.getURL("pages/mouse_options.html");
    document.body.append(frame);
  });
  const frame = await (await page.$("#synthetic-mouse-frame")).contentFrame();
  await frame.waitForSelector("#conflict-observation-review");
  const frameDenied = await frame.evaluate(async (key) =>
    await Promise.all(
      ["review-conflict-observation", "prepare-conflict-candidate", "recover-search-default-conflict"].map((action) =>
        chrome.runtime.sendMessage({
          handler: "browserToolbox.configuration",
          action,
          input: { key },
        })
      ),
    ), key);
  assert(frameDenied.every((item) => item.code === "PERMISSION_DENIED"), "子页面能读取观察正文");
  check("其他顶层页面与子页面不能访问复核请求");
  await browser.close();
  browser = null;

  trace("在第二个独立合成配置中实际导入候选");
  browser = await launch("import-profile");
  const clean = await ready();
  await clean.page.$eval("button[data-section='backupAbout']", (button) => button.click());
  await (await clean.page.$("#import-settings")).uploadFile(candidatePath);
  await clean.page.waitForFunction(() => document.querySelector("#import-preview-dialog")?.open);
  await clean.page.$eval("#import-preview-confirm", (element) => element.click());
  await clean.page.waitForFunction(() =>
    !document.querySelector("#import-preview-dialog")?.open &&
    document.querySelector(".browser-toolbox-main")?.getAttribute("aria-busy") !== "true"
  );
  const imported = await request(clean.page, "read");
  assert(imported.ok, "候选导入后无法读取配置");
  assert(
    imported.value.keyboard.keyMappings === syntheticKey,
    "候选键盘字段未通过正式导入队列写入",
  );
  assert(
    imported.value.keyboard.smoothScroll === baseline.value.keyboard.smoothScroll,
    "候选布尔字段丢失",
  );
  assert(
    imported.value.toolboxSource.value.general.showHud !==
      baseline.value.toolboxSource.value.general.showHud,
    "候选工具箱字段未导入",
  );
  assert(imported.value.toolboxSource.value.mouse.bindings.length === 0, "候选数组未导入");
  assert(
    imported.value.toolboxSource.value.cursor.localAssetId === null &&
      !imported.value.toolboxSource.value.cursor.enabled,
    "候选意外启用本机指针",
  );
  check("候选通过现有预览和后台队列导入独立配置");
  await browser.close();
  browser = null;

  trace("验证已知搜索默认值冲突的显式恢复");
  browser = await launch("search-default-profile");
  const search = await ready();
  const oldRule = "bd: https://www.baidu.com/s?wd=%s 百度";
  const newRule = "g: https://google.com/search?q=%s Google";
  const seed = await request(search.page, "commit", { legacyPatch: { searchEngines: oldRule } });
  assert(seed.ok, "未能建立旧搜索规则");
  await search.page.evaluate(() => chrome.storage.sync.remove("searchEngines"));
  const searchConflict = await request(search.page, "preview");
  assert(searchConflict.value?.code === "CONFIGURATION_EXTERNAL_CONFLICT", "未触发搜索冲突");
  const syncBeforeRecovery = await search.page.evaluate(() => chrome.storage.sync.get(null));
  await search.page.evaluate(() => {
    document.querySelector("#conflict-observation-refresh").closest("details").open = true;
  });
  await search.page.$eval("#conflict-observation-refresh", (element) => element.click());
  await until(
    () => search.page.$eval("#conflict-observation-review", (element) => !element.disabled),
    "搜索冲突观察未列出",
  );
  await search.page.$eval("#conflict-observation-review", (element) => element.click());
  await until(
    () => search.page.$eval("#conflict-search-default-recover", (element) => !element.hidden),
    "未出现搜索恢复入口",
  );
  assert(
    await search.page.$eval("#conflict-search-default-recover", (element) => element.disabled),
    "尚未选择当前值时可以恢复",
  );
  await search.page.$eval('#conflict-review-fields input[value="observed"]', (element) => element.click());
  await until(
    () => search.page.$eval("#conflict-search-default-recover", (element) => !element.disabled),
    "选择当前值后不能恢复",
  );
  await search.page.$eval("#conflict-search-default-recover", (element) => element.click());
  await until(async () => {
    const result = await request(search.page, "preview");
    return result.ok && result.value.code === null;
  }, "搜索默认冲突未解除");
  await until(
    () => search.page.evaluate((rule) =>
      !document.querySelector(".browser-toolbox-main").hasAttribute("inert") &&
      document.querySelector("#search-engines").value === rule, newRule),
    "恢复后表单未刷新到 Google 规则",
  );
  const recovered = await request(search.page, "read");
  const archives = await request(search.page, "list-conflict-observations");
  assert(recovered.value.keyboard.searchEngines === newRule, "未采用用户选择的 Google 规则");
  assert(archives.value.length === 1 && archives.value[0].status === "archived", "原观察未归档");
  assert(
    JSON.stringify(await search.page.evaluate(() => chrome.storage.sync.get(null))) ===
      JSON.stringify(syncBeforeRecovery),
    "恢复期间改写了同步数据",
  );
  const nextSave = await request(search.page, "commit", { legacyPatch: { smoothScroll: false } });
  assert(nextSave.ok && nextSave.value.keyboard.searchEngines === newRule, "恢复后仍不能正常保存");
  const priorHud = await search.page.$eval("#global-show-hud", (element) => element.checked);
  await search.page.$eval("#global-show-hud", (element) => element.click());
  await until(() => search.page.$eval("#save-settings", (element) => !element.disabled), "页面未记录新草稿");
  await search.page.$eval("#save-settings", (element) => element.click());
  await until(async () => {
    const current = await request(search.page, "read");
    return current.ok && current.value.toolboxSource.value.general.showHud !== priorHud &&
      current.value.keyboard.searchEngines === newRule;
  }, "恢复后从设置页保存失败或覆盖搜索规则");
  check("搜索默认变化需显式选择，保留观察且可再次保存");
  report.status = "passed";
} catch (failure) {
  report.status = "failed";
  report.error = failure?.stack || String(failure);
  console.error(report.error);
  Deno.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await Deno.remove(temporary, { recursive: true }).catch(() => {});
}
