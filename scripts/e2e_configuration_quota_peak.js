// SPDX-License-Identifier: GPL-3.0-or-later
// 在隔离 Chrome 中用真实存储值和较小的合成配额验证先写后删的峰值。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_QUOTA_PEAK_REPORT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-quota-peak-" });
const report = { status: "running", source: "synthetic", checks: [] };
let browser;
try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(temporary, "profile"),
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
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50, timeout: 15000 },
  );
  await page.close();
  const worker = await target.worker();
  const result = await worker.evaluate(async () => {
    const original = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    await original.read();
    await original.commit({ legacyPatch: { keyMappings: "旧".repeat(2000) } });
    const syncBefore = await chrome.storage.sync.get(null);
    const localBefore = await chrome.storage.local.get(null);
    const measured = await chrome.storage.sync.getBytesInUse(null);
    const calculate = (items) =>
      Object.entries(items).reduce((sum, [key, value]) => sum + store.itemBytes(key, value), 0);
    if (Object.hasOwn(syncBefore, "searchEngines") || measured !== calculate(syncBefore)) {
      throw new Error("合成前像或实际计量不符");
    }
    const nextSearch = "s: https://example.invalid/?q=%s " + "a".repeat(5900);
    const final = { ...syncBefore, searchEngines: nextSearch };
    delete final.keyMappings;
    const intermediate = { ...syncBefore, searchEngines: nextSearch };
    const byteLimit = Math.max(measured, calculate(final));
    const peakBytes = calculate(intermediate);
    if (peakBytes <= byteLimit) throw new Error("合成数据没有形成容量峰值");
    const run = async (quotaBytes, maxItems, searchEngines) => {
      const area = chrome.storage.sync;
      const storage = {
        local: chrome.storage.local,
        onChanged: chrome.storage.onChanged,
        sync: {
          get: (keys) => area.get(keys),
          set: (items) => area.set(items),
          remove: (keys) => area.remove(keys),
          QUOTA_BYTES: quotaBytes,
          QUOTA_BYTES_PER_ITEM: area.QUOTA_BYTES_PER_ITEM,
          MAX_ITEMS: maxItems,
          MAX_WRITE_OPERATIONS_PER_MINUTE: area.MAX_WRITE_OPERATIONS_PER_MINUTE,
          MAX_WRITE_OPERATIONS_PER_HOUR: area.MAX_WRITE_OPERATIONS_PER_HOUR,
        },
      };
      const writer = new store.ConfigurationWriter({
        storage,
        defaults: original.defaults,
        migrateLegacy: original.migrateLegacy,
        migrateToolbox: original.migrateToolbox,
        validateToolbox: original.validateToolbox,
      });
      let code;
      try {
        await writer.commit({
          legacyPatch: { keyMappings: Settings.defaultOptions.keyMappings, searchEngines },
        });
      } catch (failure) {
        code = failure.code;
      }
      if (
        await store.digest(syncBefore) !== await store.digest(await area.get(null)) ||
        await store.digest(localBefore) !== await store.digest(await chrome.storage.local.get(null))
      ) throw new Error("超额预检改变了合成配置");
      return code;
    };
    const bytesCode = await run(byteLimit, chrome.storage.sync.MAX_ITEMS, nextSearch);
    const itemsCode = await run(
      chrome.storage.sync.QUOTA_BYTES,
      Object.keys(syncBefore).length,
      "s: https://example.invalid/?q=%s",
    );
    if (bytesCode !== "browser-toolbox-sync-quota" || itemsCode !== "CONFIGURATION_SYNC_ITEMS") {
      throw new Error(`峰值未被正确拒绝：${bytesCode}, ${itemsCode}`);
    }
    return { measured, byteLimit, peakBytes, initialItems: Object.keys(syncBefore).length };
  });
  report.chrome = await browser.version();
  report.checks = [
    { name: "先写后删的总字节峰值", status: "passed", ...result },
    { name: "先写后删的项目数量峰值", status: "passed" },
  ];
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
