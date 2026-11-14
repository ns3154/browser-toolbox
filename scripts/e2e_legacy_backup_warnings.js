// SPDX-License-Identifier: GPL-3.0-or-later
// 用独立合成 profile 检查兼容页和 Canary 页的旧备份提示，不访问系统剪贴板。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";
import { buildInputCanary } from "./build_runtime_canary.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_LEGACY_BACKUP_REPORT");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-legacy-backup-" });
const report = { status: "running", source: "synthetic", checks: [] };
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, label) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(30);
  }
  throw new Error(label);
};
let browser;
let canaryRoot;

async function testPlan(plan, extension) {
  const profile = path.join(temporary, `profile-${plan}`);
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: profile,
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
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const id = new URL(target.url()).host;
  report.chrome = await browser.version();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (failure) => pageErrors.push(failure.message));
  const dialogs = [];
  let acceptConfirmation = false;
  let holdConfirmation = false;
  let heldDialog;
  page.on("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === "confirm" && holdConfirmation) {
      heldDialog = dialog;
      return;
    }
    if (dialog.type() === "confirm" && !acceptConfirmation) await dialog.dismiss();
    else await dialog.accept();
  });
  await page.goto(`chrome-extension://${id}/pages/options.html`);
  try {
    await page.waitForFunction(
      (version) =>
        globalThis.BrowserToolboxRuntimeHostInstance?.state === "active" &&
        globalThis.BrowserToolboxRuntimeHostInstance?.plan?.planVersion === version &&
        document.querySelector('[name="settingsVersion"]')?.value === "2.4.2",
      { timeout: 15000, polling: 50 },
      plan,
    );
  } catch (failure) {
    report.startup = await page.evaluate(() => ({
      ready: document.readyState,
      settingsVersion: document.querySelector('[name="settingsVersion"]')?.value,
      hostState: globalThis.BrowserToolboxRuntimeHostInstance?.state || null,
      plan: globalThis.BrowserToolboxRuntimeHostInstance?.plan?.planVersion || null,
    }));
    report.pageErrors = pageErrors;
    throw failure;
  }
  const input = await page.$("#upload-backup");
  const read = () =>
    page.evaluate(async () =>
      (await globalThis.BrowserToolboxConfigurationClientInstance.read()).keyboard
    );
  const draft = () => page.$eval('[name="scrollStepSize"]', (element) => element.value);
  const setDraft = (value) =>
    page.$eval('[name="scrollStepSize"]', (element, next) => {
      element.value = next;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  const upload = async (name, payload) => {
    const file = path.join(temporary, `${plan}-${name}.json`);
    await Deno.writeTextFile(file, JSON.stringify(payload));
    await input.uploadFile(file);
  };
  const unknown = {
    settingsVersion: "2.4.2",
    scrollStepSize: 79,
    unrelatedHistory: "synthetic-private-value",
  };
  const before = await read();
  await setDraft("83");
  await upload("unknown", unknown);
  await until(() => dialogs.some((item) => item.type === "confirm"), "未显示未知字段确认");
  await page.waitForFunction(() => !document.querySelector("#upload-backup").value, {
    polling: 50,
  });
  const warning = dialogs.find((item) => item.type === "confirm").message;
  assert(
    warning.includes("unrelatedHistory") && warning.includes("scrollStepSize") &&
      !warning.includes("synthetic-private-value"),
    "未知字段提示缺少字段名或泄露字段值",
  );
  assert(
    (await read()).scrollStepSize === before.scrollStepSize && await draft() === "83",
    "取消导入时修改了设置或草稿",
  );
  report.checks.push({ plan, name: "未知字段取消后保留设置和草稿", status: "passed" });

  acceptConfirmation = true;
  await upload("unknown", unknown);
  await until(async () => (await read()).scrollStepSize === 79, "确认后的兼容导入未保存");
  const unknownStored = await page.evaluate(async () =>
    Object.hasOwn(await chrome.storage.sync.get("unrelatedHistory"), "unrelatedHistory")
  );
  assert(
    !unknownStored && dialogs.filter((item) => item.type === "confirm").length === 2,
    "未知字段被静默保存或确认缺失",
  );
  assert(
    await Deno.readTextFile(path.join(temporary, `${plan}-unknown.json`)) ===
      JSON.stringify(unknown),
    "导入更改了原始备份文件",
  );
  report.checks.push({ plan, name: "确认后导入已识别字段且原文件不变", status: "passed" });

  await setDraft("84");
  const oldDialogCount = dialogs.length;
  await upload("nested", {
    settingsVersion: "2.4.2",
    scrollStepSize: 91,
    exclusionRules: [{
      pattern: "https://example.invalid/*",
      passKeys: "",
      enabled: false,
      futurePolicy: "synthetic-private-value",
    }],
  });
  let ruleWarning;
  if (plan === 1) {
    await until(() => dialogs.length > oldDialogCount, "默认页未提示不可表达字段");
    ruleWarning = dialogs.at(-1).message;
  } else {
    await page.waitForFunction(
      () =>
        document.querySelector("#browser-toolbox-options-status")?.textContent.includes(
          "exclusionRules[0].enabled",
        ),
      { polling: 50 },
    );
    ruleWarning = await page.$eval(
      "#browser-toolbox-options-status",
      (element) => element.textContent,
    );
  }
  assert(
    ruleWarning.includes("exclusionRules[0].enabled") &&
      !ruleWarning.includes("synthetic-private-value"),
    "规则字段提示不正确",
  );
  assert(
    (await read()).scrollStepSize === 79 && await draft() === "84",
    "不支持的规则覆盖了设置或草稿",
  );
  report.checks.push({ plan, name: "规则附加字段阻止导入并保留草稿", status: "passed" });

  const beforeInvalidDialogs = dialogs.length;
  await upload("invalid", {
    settingsVersion: "2.4.2",
    scrollStepSize: "synthetic-private-value",
  });
  let invalidWarning;
  if (plan === 1) {
    await until(() => dialogs.length > beforeInvalidDialogs, "默认页没有列出无效字段");
    invalidWarning = dialogs.at(-1).message;
  } else {
    await page.waitForFunction(
      () =>
        document.querySelector("#browser-toolbox-options-status")?.textContent.includes(
          "scrollStepSize",
        ),
      { polling: 50 },
    );
    invalidWarning = await page.$eval(
      "#browser-toolbox-options-status",
      (element) => element.textContent,
    );
  }
  assert(
    invalidWarning.includes("scrollStepSize") &&
      !invalidWarning.includes("synthetic-private-value"),
    "无效字段提示不正确",
  );
  assert(
    (await read()).scrollStepSize === 79 && await draft() === "84",
    "无效导入覆盖了设置或草稿",
  );
  report.checks.push({ plan, name: "无效字段阻止导入并报告路径", status: "passed" });

  const beforeOldDialogs = dialogs.length;
  await upload("old", {
    settingsVersion: "2.3",
    newTabUrl: "about:newtab",
    searchEngines: "",
    exclusionRules: [],
    smoothScroll: false,
    scrollStepSize: 81,
  });
  await until(async () => (await read()).scrollStepSize === 81, "旧版有效备份没有导入");
  const oldPreview = dialogs.slice(beforeOldDialogs).find((item) => item.type === "confirm")
    ?.message;
  assert(
    oldPreview?.includes("newTabDestination") && oldPreview.includes("searchEngines"),
    "导入预览未列出转换和识别字段",
  );
  const restored = await read();
  assert(
    restored.newTabDestination === "browserNewTabPage" && restored.searchEngines === "" &&
      restored.exclusionRules.length === 0 && restored.smoothScroll === false,
    "旧版迁移或显式空值发生变化",
  );
  report.checks.push({ plan, name: "旧版本和显式空值仍可导入", status: "passed" });

  await page.waitForFunction(() => !document.querySelector("#upload-backup").value, {
    polling: 50,
  });
  await setDraft("85");
  holdConfirmation = true;
  const beforeConflictDialogs = dialogs.length;
  await upload("concurrent", {
    settingsVersion: "2.4.2",
    scrollStepSize: 90,
    unrelatedHistory: "synthetic-private-value",
  });
  await until(() => heldDialog != null, "并发场景没有打开导入确认");
  const worker = await target.worker();
  assert(worker, "未找到用于合成并发写入的后台");
  await worker.evaluate(async () => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const baseline = await writer.read();
    await writer.commit({
      legacyPatch: { scrollStepSize: 88 },
      baseline: { keyboard: baseline.keyboard },
    });
  });
  holdConfirmation = false;
  await heldDialog.accept();
  if (plan === 1) {
    await until(() => dialogs.length > beforeConflictDialogs + 1, "默认页没有提示并发冲突");
  } else {
    await page.waitForFunction(
      () =>
        document.querySelector("#browser-toolbox-options-status")?.textContent.includes(
          BrowserToolboxI18n.message("settingsConflict"),
        ),
      { polling: 50 },
    );
  }
  assert(
    (await read()).scrollStepSize === 88 && await draft() === "85",
    "并发导入覆盖了外部设置或草稿",
  );
  report.checks.push({ plan, name: "确认期间同字段变化会冲突并保留两边", status: "passed" });
  await browser.close();
  browser = null;
}

try {
  const built = path.join(temporary, "build");
  await buildArtifacts({ output: built });
  const canary = await buildInputCanary(Deno.cwd(), Deno.cwd(), { pages: true });
  canaryRoot = path.dirname(canary.extensionPath);
  await testPlan(1, path.join(built, "browser-toolbox"));
  await testPlan(9, canary.extensionPath);
  report.status = "passed";
  console.log(JSON.stringify(report, null, 2));
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
  throw failure;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close();
  if (canaryRoot) await Deno.remove(canaryRoot, { recursive: true });
  await Deno.remove(temporary, { recursive: true });
}
