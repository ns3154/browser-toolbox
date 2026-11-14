// SPDX-License-Identifier: GPL-3.0-or-later
// 临时构建使后台启动失败，在独立 CFT profile 验证维护页只读检查与脱敏下载。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_RECOVERY_DIAGNOSTICS_REPORT");
const screenshotPath = Deno.env.get("BROWSER_TOOLBOX_RECOVERY_DIAGNOSTICS_SCREENSHOT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-recovery-diagnostics-" });
const profile = path.join(temporary, "profile");
const downloads = path.join(temporary, "downloads");
await Deno.mkdir(downloads);
const report = { status: "running", source: "synthetic", checks: [] };
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let browser;

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  manifest.background.service_worker = "background_scripts/recovery_unavailable_test.js";
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await Deno.writeTextFile(
    path.join(extension, "background_scripts/recovery_unavailable_test.js"),
    'throw new Error("合成后台不可用");\n',
  );
  const realExtension = await Deno.realPath(extension);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(realExtension)),
  );
  const id = [...digest.slice(0, 16)].map((byte) =>
    String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))
  ).join("");
  browser = await puppeteer.launch({
    executablePath,
    headless: Deno.env.get("BROWSER_TOOLBOX_RECOVERY_HEADLESS") === "true",
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      "--window-size=1280,900",
      "--window-position=1960,213",
    ],
  });
  report.chrome = await browser.version();
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await page.waitForSelector("#runtime-maintenance summary");
  await page.click("#runtime-maintenance summary");
  const link = await page.$eval(
    '#runtime-maintenance a[href="configuration_recovery.html"]',
    (item) => item.href,
  );
  assert(
    link === `chrome-extension://${id}/pages/configuration_recovery.html`,
    "设置页缺少独立维护入口",
  );
  await page.click('#runtime-maintenance a[href="configuration_recovery.html"]');
  await page.waitForSelector("#recovery-inspect");
  const backgroundResponded = await page.evaluate(async () => {
    const response = chrome.runtime.sendMessage({
      handler: "browserToolbox.runtimeMaintenance",
      action: "inspect",
    }).then((value) => value?.ok === true, () => false);
    return await Promise.race([
      response,
      new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
  });
  assert(!backgroundResponded, "合成后台意外可用，不能验证独立路径");
  report.checks.push({ name: "设置入口和后台不可用的独立页面", status: "passed" });

  await page.evaluate(() =>
    chrome.storage.local.set({
      [BrowserToolboxConfigurationStore.KEYS.state]: {
        formatVersion: 1,
        phase: "ABORTED",
        code: "CONFIGURATION_EXTERNAL_CONFLICT",
        conflicts: [],
      },
    })
  );
  await page.click("#recovery-inspect");
  await page.waitForFunction(
    () =>
      document.querySelector("#recovery-configuration").textContent.includes(
        BrowserToolboxI18n.message("recoveryConflictLabel"),
      ) && document.querySelector("#recovery-summary").textContent ===
        BrowserToolboxI18n.message("recoveryBlocked"),
    { polling: 50 },
  );
  report.checks.push({ name: "旧版中止冲突没有新观察记录时仍提示阻断", status: "passed" });
  // 下一场景只保留合成观察标记；此处清理的是本测试刚写入的临时配置。
  await page.evaluate(() =>
    chrome.storage.local.remove(BrowserToolboxConfigurationStore.KEYS.state)
  );

  const observationKey = await page.evaluate(async () => {
    const key = `${BrowserToolboxConfigurationStore.M2_CONFLICT_CAPTURE_PREFIX}synthetic`;
    await chrome.storage.local.set({ [key]: { secret: "合成观察正文" } });
    return key;
  });
  await page.click("#recovery-inspect");
  await page.waitForFunction(
    () =>
      document.querySelector("#recovery-compatibility-conflicts").textContent.includes("1") &&
      document.querySelector("#recovery-summary").textContent ===
        BrowserToolboxI18n.message("recoveryBlocked"),
    { polling: 50 },
  );
  assert(
    !await page.evaluate(() => document.body.textContent.includes("合成观察正文")),
    "独立恢复页显示了冲突观察正文",
  );
  report.checks.push({ name: "仅有冲突观察时后台不可用仍提示阻断且不显示正文", status: "passed" });

  const synthetic = await page.evaluate(async (observationKey) => {
    const store = BrowserToolboxConfigurationStore;
    const secret = "合成配置正文_https://example.invalid/private";
    const values = {
      [store.KEYS.state]: {
        formatVersion: 1,
        phase: "APPLYING",
        beforeSnapshot: { keyMappings: secret },
      },
      [store.ROLLBACK_JOURNAL_KEY]: {
        formatVersion: 1,
        kind: "legacy-rollback",
        phase: "ABORTED",
        conflicts: [secret],
        cells: { secret },
      },
      [store.SYNC_PUBLISH_JOURNAL_KEY]: {
        formatVersion: 1,
        kind: "keyboard-sync-publish",
        phase: "PUBLISHING",
        chunks: { secret },
      },
      browserToolboxSyntheticUnrelated: { secret },
    };
    await chrome.storage.local.set(values);
    return {
      keys: [...Object.keys(values), observationKey],
      before: JSON.stringify(
        await chrome.storage.local.get([...Object.keys(values), observationKey]),
      ),
    };
  }, observationKey);
  await page.waitForFunction(() => !document.querySelector("#recovery-inspect").disabled);
  await page.click("#recovery-inspect");
  await page.waitForFunction(() =>
    document.querySelector("#recovery-configuration").textContent ===
      BrowserToolboxI18n.message("recoveryStatePending") &&
    document.querySelector("#recovery-rollback").textContent.includes(
      BrowserToolboxI18n.message("recoveryConflictLabel"),
    ) &&
    document.querySelector("#recovery-sync").textContent ===
      BrowserToolboxI18n.message("recoveryStatePending")
  );
  const screen = await page.evaluate(async ({ keys, before }) => ({
    blocked: document.querySelector("#recovery-summary").textContent ===
      BrowserToolboxI18n.message("recoveryBlocked"),
    redacted: !document.body.textContent.includes("合成配置正文_"),
    unchanged: JSON.stringify(await chrome.storage.local.get(keys)) === before,
  }), synthetic);
  assert(screen.blocked && screen.redacted && screen.unchanged, "页面状态、脱敏或只读行为不符");
  report.checks.push({ name: "恢复记录只读展示且配置正文不显示", status: "passed", ...screen });

  await page.click("#recovery-inspect-rollback-conflict");
  await page.waitForFunction(() =>
    document.querySelector("#recovery-conflict-result")?.dataset.status === "error"
  );
  const noBackground = await page.evaluate(async ({ keys, before }) => ({
    warning: document.querySelector("#recovery-conflict-result").textContent ===
      BrowserToolboxI18n.message("recoveryConflictUnavailable"),
    summary: document.querySelector("#recovery-summary").textContent ===
      BrowserToolboxI18n.message("recoveryBlocked"),
    unchanged: JSON.stringify(await chrome.storage.local.get(keys)) === before,
  }), synthetic);
  assert(Object.values(noBackground).every(Boolean), "后台不可用时分类未安全失败或影响独立诊断");
  report.checks.push({ name: "后台不可用时冲突分类安全失败且独立诊断保留", status: "passed" });

  const client = await page.createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await page.click("#recovery-export");
  const filename = path.join(downloads, "browser-toolbox-diagnostics.json");
  let text;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      text = await Deno.readTextFile(filename);
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await wait(50);
    }
  }
  assert(text, "没有收到诊断文件");
  const downloaded = JSON.parse(text);
  assert(
    !text.includes("合成配置正文_") && !text.includes("合成观察正文") &&
      !text.includes("example.invalid") &&
      downloaded.status === "available" && downloaded.transitionBlocksWrites === true &&
      downloaded.compatibilityConflictCount === 1 &&
      downloaded.records.configuration.phase === "APPLYING" &&
      downloaded.records.legacyRollback.hasConflicts === true,
    "下载内容没有正确脱敏",
  );
  const afterExport = await page.evaluate(
    async (keys) => JSON.stringify(await chrome.storage.local.get(keys)),
    synthetic.keys,
  );
  assert(afterExport === synthetic.before, "导出改变了本机记录");
  report.checks.push({ name: "用户主动下载脱敏 JSON 且不写入配置", status: "passed" });

  await page.setViewport({ width: 320, height: 700 });
  const narrow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    heading: document.querySelector("h1")?.textContent?.length > 0,
    rows: document.querySelectorAll("dl dt").length,
  }));
  assert(!narrow.overflow && narrow.heading && narrow.rows === 4, "窄屏布局或语义不符");
  report.checks.push({ name: "窄屏布局和语义结构", status: "passed", ...narrow });
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.evaluate(() => {
    const local = chrome.storage.local;
    const original = local.get;
    local.get = () => Promise.reject(new Error("合成隐私异常"));
    globalThis.__restoreRecoveryStorage = () => {
      local.get = original;
    };
  });
  await page.click("#recovery-inspect");
  await page.waitForFunction(() =>
    document.querySelector("#recovery-summary").textContent ===
      BrowserToolboxI18n.message("recoveryReadUnavailable")
  );
  const failedRead = await page.evaluate(() => ({
    noPrivateError: !document.body.textContent.includes("合成隐私异常"),
    unavailable: document.querySelector("#recovery-configuration").textContent ===
      BrowserToolboxI18n.message("recoveryReadUnavailable"),
  }));
  await page.evaluate(() => globalThis.__restoreRecoveryStorage());
  assert(failedRead.noPrivateError && failedRead.unavailable, "存储失败未正确提示或泄漏异常正文");
  report.checks.push({
    name: "存储读取失败不会误报无记录或暴露异常",
    status: "passed",
    ...failedRead,
  });
  await client.detach();
  report.status = "passed";
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  throw error;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close();
  await Deno.remove(temporary, { recursive: true });
}
