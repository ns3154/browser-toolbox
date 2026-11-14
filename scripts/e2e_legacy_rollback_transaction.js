// SPDX-License-Identifier: GPL-3.0-or-later
// 临时构建显式导入隔离事务，并以合成同步命名空间验证后台中断与恢复。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_ROLLBACK_TRANSACTION_REPORT");
const scenario = Deno.env.get("BROWSER_TOOLBOX_ROLLBACK_TRANSACTION_SCENARIO") || "forward";
if (!["forward", "compensation"].includes(scenario)) throw new Error("未登记的回退测试场景");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-rollback-transaction-" });
const profile = path.join(temporary, "profile");
const report = { status: "running", source: "synthetic", scenario, checks: [] };
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let browser;

async function open(extension, initializePage) {
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
  if (initializePage) {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.settingsReady === "true",
      { polling: 50, timeout: 15000 },
    );
    await page.close();
  }
  return { id, worker: await target.worker() };
}

async function stopWorker(id) {
  const client = await browser.target().createCDPSession();
  const active = (await client.send("Target.getTargets")).targetInfos.find((target) =>
    target.type === "service_worker" &&
    target.url === `chrome-extension://${id}/background_scripts/main.js`
  );
  assert(active, "未找到事务执行中的后台");
  const stopped = await client.send("Target.closeTarget", { targetId: active.targetId });
  await client.detach();
  assert(stopped.success, "未能实际终止后台");
  await browser.close();
  browser = null;
}

async function waitBarrier(worker) {
  const deadline = Date.now() + 15000;
  do {
    const state = await worker.evaluate(() => ({
      reached: globalThis.__browserToolboxRollbackBarrier === true,
      failure: globalThis.__browserToolboxRollbackFailure,
    }));
    if (state.failure) throw new Error(`事务未到达中断点：${state.failure}`);
    if (state.reached) return;
    await wait(30);
  } while (Date.now() < deadline);
  throw new Error("未到达预定中断点");
}

function installSyntheticAdapter({ barrier }) {
  const prefix = "browserToolboxSyntheticRollback:";
  const area = chrome.storage.sync;
  const original = globalThis.BrowserToolboxConfigurationWriterInstance;
  const store = globalThis.BrowserToolboxConfigurationStore;
  const get = async (keys) => {
    const wanted = keys === null ? null : Array.isArray(keys) ? keys : [keys];
    const values = await area.get(wanted ? wanted.map((key) => prefix + key) : null);
    return Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
  };
  const sync = {
    get,
    async set(items) {
      await area.set(
        Object.fromEntries(Object.entries(items).map(([key, value]) => [prefix + key, value])),
      );
      const blockedValue = barrier === "compensation"
        ? "s: https://example.invalid/old?q=%s"
        : "s: https://example.invalid/new?q=%s";
      if (barrier && items.searchEngines === blockedValue) {
        globalThis.__browserToolboxRollbackBarrier = true;
        await new Promise(() => {});
      }
    },
    remove: (keys) => area.remove((Array.isArray(keys) ? keys : [keys]).map((key) => prefix + key)),
    QUOTA_BYTES: area.QUOTA_BYTES,
    QUOTA_BYTES_PER_ITEM: area.QUOTA_BYTES_PER_ITEM,
    MAX_ITEMS: area.MAX_ITEMS,
    MAX_WRITE_OPERATIONS_PER_MINUTE: area.MAX_WRITE_OPERATIONS_PER_MINUTE,
    MAX_WRITE_OPERATIONS_PER_HOUR: area.MAX_WRITE_OPERATIONS_PER_HOUR,
  };
  const writer = new store.ConfigurationWriter({
    storage: { local: chrome.storage.local, sync, onChanged: chrome.storage.onChanged },
    defaults: original.defaults,
    migrateLegacy: original.migrateLegacy,
    migrateToolbox: original.migrateToolbox,
    validateToolbox: original.validateToolbox,
  });
  const transaction = new BrowserToolboxLegacyRollback.LegacyRollbackTransaction({
    writer,
    authorize: () => true,
  });
  globalThis.__browserToolboxRollbackTest = { prefix, sync, writer, transaction };
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  const main = path.join(extension, "background_scripts/main.js");
  await Deno.writeTextFile(main, '\nimport "./browser_toolbox/legacy_rollback_transaction.js";\n', {
    append: true,
  });
  const first = await open(extension, true);
  report.chrome = await browser.version();
  const before = await first.worker.evaluate(async () => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    await writer.read();
    const committed = await writer.commit({
      legacyPatch: {
        keyMappings: Settings.defaultOptions.keyMappings,
        searchEngines: "s: https://example.invalid/new?q=%s",
        smoothScroll: false,
      },
    });
    const prefix = "browserToolboxSyntheticRollback:";
    await chrome.storage.sync.set({
      [prefix + "keyMappings"]: "map old scrollUp",
      [prefix + "searchEngines"]: "s: https://example.invalid/old?q=%s",
      [prefix + "settingsVersion"]: "2.4.2",
    });
    const sync = await chrome.storage.sync.get(null);
    const actual = Object.fromEntries(
      Object.entries(sync).filter(([key]) => !key.startsWith(prefix)),
    );
    const state = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    return {
      revision: committed.revision,
      actualDigest: await store.digest(actual),
      stateDigest: await store.digest(state),
    };
  });
  await first.worker.evaluate(installSyntheticAdapter, { barrier: "forward" });
  await first.worker.evaluate(async () => {
    const transaction = globalThis.__browserToolboxRollbackTest.transaction;
    const plan = await transaction.preview();
    globalThis.__browserToolboxRollbackPending = transaction.execute(plan).catch((failure) => {
      globalThis.__browserToolboxRollbackFailure = failure.code || failure.message;
    });
  });
  await waitBarrier(first.worker);
  const interrupted = await first.worker.evaluate(async () => {
    const { sync } = globalThis.__browserToolboxRollbackTest;
    const journal =
      (await chrome.storage.local.get(BrowserToolboxLegacyRollback.ROLLBACK_JOURNAL_KEY))[
        BrowserToolboxLegacyRollback.ROLLBACK_JOURNAL_KEY
      ];
    const values = await sync.get(null);
    return {
      phase: journal.phase,
      revision: journal.sourceRevision,
      backupPresent: Object.hasOwn(
        await chrome.storage.local.get(journal.backupKey),
        journal.backupKey,
      ),
      newValueWritten: values.searchEngines === "s: https://example.invalid/new?q=%s",
      oldKeyRetained: values.keyMappings === "map old scrollUp",
    };
  });
  assert(
    interrupted.phase === "APPLYING" && interrupted.revision === before.revision &&
      interrupted.backupPresent && interrupted.newValueWritten && interrupted.oldKeyRetained,
    "中断点的持久记录或前后像不符",
  );
  report.checks.push({
    name: "同步写入中断前已保留备份和恢复记录",
    status: "passed",
    ...interrupted,
  });
  await stopWorker(first.id);

  let restarted = await open(extension, false);
  assert(restarted.id === first.id, "重启后合成扩展 ID 变化");
  if (scenario === "compensation") {
    await restarted.worker.evaluate(installSyntheticAdapter, { barrier: "compensation" });
    await restarted.worker.evaluate(() => {
      const transaction = globalThis.__browserToolboxRollbackTest.transaction;
      globalThis.__browserToolboxRollbackPending = transaction.compensate().catch((failure) => {
        globalThis.__browserToolboxRollbackFailure = failure.code || failure.message;
      });
    });
    await waitBarrier(restarted.worker);
    const phase = await restarted.worker.evaluate(async () =>
      (await chrome.storage.local.get(BrowserToolboxLegacyRollback.ROLLBACK_JOURNAL_KEY))[
        BrowserToolboxLegacyRollback.ROLLBACK_JOURNAL_KEY
      ].phase
    );
    assert(phase === "RECOVERING", "补偿写入前没有持久记录恢复方向");
    report.checks.push({ name: "补偿写入中断前已记录恢复方向", status: "passed", phase });
    await stopWorker(restarted.id);
    restarted = await open(extension, false);
    assert(restarted.id === first.id, "补偿中断重启后合成扩展 ID 变化");
  }
  await restarted.worker.evaluate(installSyntheticAdapter, { barrier: false });
  const recovered = await restarted.worker.evaluate(async ({ expected, scenario }) => {
    const { prefix, sync, transaction } = globalThis.__browserToolboxRollbackTest;
    const store = globalThis.BrowserToolboxConfigurationStore;
    const result = await transaction.recover();
    const values = await sync.get(null);
    const all = await chrome.storage.sync.get(null);
    const actual = Object.fromEntries(
      Object.entries(all).filter(([key]) => !key.startsWith(prefix)),
    );
    const state = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    const backups = await transaction.listBackups();
    return {
      phase: result.phase,
      code: result.code,
      revision: result.revision,
      desiredValues: scenario === "compensation"
        ? values.keyMappings === "map old scrollUp" &&
          values.searchEngines === "s: https://example.invalid/old?q=%s" &&
          !Object.hasOwn(values, "smoothScroll")
        : !Object.hasOwn(values, "keyMappings") &&
          values.searchEngines === "s: https://example.invalid/new?q=%s" &&
          values.smoothScroll === false,
      realSyncUnchanged: await store.digest(actual) === expected.actualDigest,
      committedStateUnchanged: await store.digest(state) === expected.stateDigest,
      backupRetained: backups.some((entry) =>
        entry.key === result.backupKey && entry.status === "valid"
      ),
    };
  }, { expected: before, scenario });
  assert(
    (scenario === "compensation"
      ? recovered.phase === "ABORTED" && recovered.code === "CONFIGURATION_ROLLED_BACK"
      : recovered.phase === "COMMITTED") &&
      recovered.revision === before.revision &&
      recovered.desiredValues && recovered.realSyncUnchanged && recovered.committedStateUnchanged &&
      recovered.backupRetained,
    "重启恢复、旧字段读回或既有配置不符",
  );
  report.checks.push({
    name: scenario === "compensation"
      ? "再次重启后继续补偿并保留既有配置"
      : "浏览器重启后按恢复记录完成回写并保留既有配置",
    status: "passed",
    ...recovered,
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
