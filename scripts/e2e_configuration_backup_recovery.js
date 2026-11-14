// SPDX-License-Identifier: GPL-3.0-or-later
// 在独立合成 profile 中终止备份落盘后的后台，验证重启后仍可只读核验。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_BACKUP_RECOVERY_REPORT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-backup-recovery-" });
const profile = path.join(temporary, "profile");
const report = { status: "running", source: "synthetic", checks: [] };
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let browser;

async function open(extension) {
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
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50, timeout: 15000 },
  );
  await page.close();
  return { id, worker: await target.worker() };
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  const first = await open(extension);
  report.chrome = await browser.version();
  const before = await first.worker.evaluate(async () => {
    const original = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    await original.read();
    const committed = await original.commit({
      legacyPatch: { keyMappings: "map z scrollDown", smoothScroll: false },
    });
    const local = chrome.storage.local;
    const storage = {
      sync: chrome.storage.sync,
      onChanged: chrome.storage.onChanged,
      local: {
        QUOTA_BYTES: local.QUOTA_BYTES,
        get: (keys) => local.get(keys),
        getBytesInUse: (keys) => local.getBytesInUse(keys),
        set: async (items) => {
          await local.set(items);
          const key = Object.keys(items).find((name) =>
            name.startsWith(store.ROLLBACK_BACKUP_PREFIX)
          );
          if (key) {
            globalThis.__browserToolboxBackupBarrier = key;
            await new Promise(() => {});
          }
        },
      },
    };
    const isolated = new store.ConfigurationWriter({
      storage,
      defaults: original.defaults,
      migrateLegacy: original.migrateLegacy,
      migrateToolbox: original.migrateToolbox,
      validateToolbox: original.validateToolbox,
    });
    const state = (await local.get(store.KEYS.state))[store.KEYS.state];
    const sync = await chrome.storage.sync.get(null);
    globalThis.__browserToolboxPendingBackup = isolated.createLegacyRollbackBackup().catch(
      () => {},
    );
    return {
      revision: committed.revision,
      stateDigest: await store.digest(state),
      syncDigest: await store.digest(sync),
    };
  });
  let key;
  const deadline = Date.now() + 15000;
  while (!key && Date.now() < deadline) {
    key = await first.worker.evaluate(() => globalThis.__browserToolboxBackupBarrier || null);
    if (!key) await wait(30);
  }
  assert(key, "备份写入后没有到达读回前的中断点");
  const beforeStop = await first.worker.evaluate(async (backupKey) => {
    const stored = (await chrome.storage.local.get(backupKey))[backupKey];
    const verified = await BrowserToolboxConfigurationWriterInstance.inspectLegacyRollbackBackup(
      stored,
    );
    return {
      revision: verified.revision,
      backupDigest: stored.backupDigest,
      valuePreserved: verified.snapshot.keyboard.keyMappings === "map z scrollDown" &&
        verified.snapshot.keyboard.smoothScroll === false,
    };
  }, key);
  assert(beforeStop.revision === before.revision && beforeStop.valuePreserved, "中断前备份不完整");
  const client = await browser.target().createCDPSession();
  const active = (await client.send("Target.getTargets")).targetInfos.find((target) =>
    target.type === "service_worker" &&
    target.url === `chrome-extension://${first.id}/background_scripts/main.js`
  );
  assert(active, "未找到备份写入时的后台");
  const stopped = await client.send("Target.closeTarget", { targetId: active.targetId });
  await client.detach();
  assert(stopped.success, "未能实际终止后台");
  report.checks.push({ name: "备份落盘后、读回前终止后台", status: "passed" });
  await browser.close();
  browser = null;

  const restarted = await open(extension);
  assert(restarted.id === first.id, "同一路径重启后扩展 ID 变化");
  const after = await restarted.worker.evaluate(async ({ backupKey, expected }) => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    const saved = (await chrome.storage.local.get(backupKey))[backupKey];
    const checked = await writer.inspectLegacyRollbackBackup(saved);
    const state = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    const sync = await chrome.storage.sync.get(null);
    const next = await writer.createLegacyRollbackBackup();
    const old = (await chrome.storage.local.get(backupKey))[backupKey];
    return {
      revision: checked.revision,
      backupDigest: saved.backupDigest,
      stateUnchanged: await store.digest(state) === expected.stateDigest,
      syncUnchanged: await store.digest(sync) === expected.syncDigest,
      valuePreserved: checked.snapshot.keyboard.keyMappings === "map z scrollDown" &&
        checked.snapshot.keyboard.smoothScroll === false,
      oldBackupPreserved: old.backupDigest === saved.backupDigest,
      newBackupDistinct: next.key !== backupKey,
    };
  }, { backupKey: key, expected: before });
  assert(
    after.revision === before.revision && after.backupDigest === beforeStop.backupDigest &&
      after.stateUnchanged && after.syncUnchanged && after.valuePreserved &&
      after.oldBackupPreserved && after.newBackupDistinct,
    "重启后备份核验、保留或兼容数据不符",
  );
  report.checks.push({
    name: "完整重启后备份读回及再次备份不覆盖旧备份",
    status: "passed",
    ...after,
  });
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
