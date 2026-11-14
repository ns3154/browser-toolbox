// SPDX-License-Identifier: GPL-3.0-or-later
// 使用合成同步命名空间和真实后台终止验证独立发布的恢复方向。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_SYNC_PUBLISH_REPORT");
const scenario = Deno.env.get("BROWSER_TOOLBOX_SYNC_PUBLISH_SCENARIO") || "forward";
if (!executablePath || !["forward", "cancel"].includes(scenario)) {
  throw new Error("缺少 Chrome for Testing 路径或测试场景无效");
}
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-sync-publish-" });
const profile = path.join(temporary, "profile");
const report = { status: "running", source: "synthetic", scenario, checks: [] };
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  assert(
    (await client.send("Target.closeTarget", { targetId: active.targetId })).success,
    "后台终止失败",
  );
  await client.detach();
  await browser.close();
  browser = null;
}

async function waitBarrier(worker) {
  const deadline = Date.now() + 15000;
  do {
    const state = await worker.evaluate(() => ({
      reached: globalThis.__browserToolboxPublishBarrier === true,
      failure: globalThis.__browserToolboxPublishFailure,
    }));
    if (state.failure) throw new Error(`事务未到达中断点：${state.failure}`);
    if (state.reached) return;
    await wait(30);
  } while (Date.now() < deadline);
  throw new Error("未到达预定中断点");
}

function installSyntheticAdapter({ barrier }) {
  const prefix = "browserToolboxSyntheticPublish:";
  const area = chrome.storage.sync;
  const original = globalThis.BrowserToolboxConfigurationWriterInstance;
  const store = globalThis.BrowserToolboxConfigurationStore;
  const sync = {
    async get(keys) {
      const wanted = keys === null ? null : Array.isArray(keys) ? keys : [keys];
      const values = await area.get(wanted ? wanted.map((key) => prefix + key) : null);
      return Object.fromEntries(
        Object.entries(values).filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
    },
    set: (items) =>
      area.set(
        Object.fromEntries(Object.entries(items).map(([key, value]) => [prefix + key, value])),
      ),
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
  const publisher = new BrowserToolboxKeyboardSyncPublisher.KeyboardSyncPublisher({
    writer,
    authorize: () => true,
    async afterStep(step) {
      if (step === barrier) {
        globalThis.__browserToolboxPublishBarrier = true;
        await new Promise(() => {});
      }
    },
  });
  globalThis.__browserToolboxPublishTest = { prefix, sync, writer, publisher };
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  await Deno.writeTextFile(
    path.join(extension, "background_scripts/main.js"),
    '\nimport "./browser_toolbox/keyboard_sync_publisher.js";\n',
    { append: true },
  );
  const first = await open(extension, true);
  report.chrome = await browser.version();
  const before = await first.worker.evaluate(async () => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    await writer.read();
    const committed = await writer.commit({ legacyPatch: { keyMappings: "map z scrollDown" } });
    const prefix = "browserToolboxSyntheticPublish:";
    await chrome.storage.sync.set({ [prefix + "keyMappings"]: "map old scrollUp" });
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
  await first.worker.evaluate(installSyntheticAdapter, {
    barrier: scenario === "forward" ? "chunks" : "index",
  });
  await first.worker.evaluate(async () => {
    const publisher = globalThis.__browserToolboxPublishTest.publisher;
    const plan = await publisher.preview();
    globalThis.__browserToolboxPublishPending = publisher.execute(plan).catch((failure) => {
      globalThis.__browserToolboxPublishFailure = failure.code || failure.message;
    });
  });
  await waitBarrier(first.worker);
  const interrupted = await first.worker.evaluate(async () => {
    const { sync } = globalThis.__browserToolboxPublishTest;
    const store = globalThis.BrowserToolboxConfigurationStore;
    const journal = (await chrome.storage.local.get(store.SYNC_PUBLISH_JOURNAL_KEY))[
      store.SYNC_PUBLISH_JOURNAL_KEY
    ];
    const values = await sync.get(null);
    return {
      phase: journal.phase,
      revision: journal.sourceRevision,
      backupPresent: Object.hasOwn(
        await chrome.storage.local.get(journal.backupKey),
        journal.backupKey,
      ),
      chunksPresent: Object.keys(journal.chunks).every((key) => Object.hasOwn(values, key)),
      indexPresent: Object.hasOwn(values, store.KEYS.index),
    };
  });
  assert(
    interrupted.phase === "PUBLISHING" && interrupted.revision === before.revision &&
      interrupted.backupPresent && interrupted.chunksPresent &&
      interrupted.indexPresent === (scenario === "cancel"),
    "发布中断点不符",
  );
  report.checks.push({
    name: "索引发布前后中断时分片和备份已持久化",
    status: "passed",
    ...interrupted,
  });
  await stopWorker(first.id);
  let restarted = await open(extension, false);
  assert(restarted.id === first.id, "重启后合成扩展 ID 变化");
  if (scenario === "cancel") {
    await restarted.worker.evaluate(installSyntheticAdapter, { barrier: "unpublish" });
    await restarted.worker.evaluate(() => {
      const publisher = globalThis.__browserToolboxPublishTest.publisher;
      globalThis.__browserToolboxPublishPending = publisher.cancel().catch((failure) => {
        globalThis.__browserToolboxPublishFailure = failure.code || failure.message;
      });
    });
    await waitBarrier(restarted.worker);
    const phase = await restarted.worker.evaluate(async () => {
      const store = BrowserToolboxConfigurationStore;
      return (await chrome.storage.local.get(store.SYNC_PUBLISH_JOURNAL_KEY))[
        store.SYNC_PUBLISH_JOURNAL_KEY
      ].phase;
    });
    assert(phase === "RECOVERING", "撤销前没有持久记录恢复方向");
    report.checks.push({ name: "删除索引后的撤销方向已持久化", status: "passed", phase });
    await stopWorker(restarted.id);
    restarted = await open(extension, false);
    assert(restarted.id === first.id, "再次重启后合成扩展 ID 变化");
  }
  await restarted.worker.evaluate(installSyntheticAdapter, { barrier: "" });
  const recovered = await restarted.worker.evaluate(async ({ expected, scenario }) => {
    const { prefix, sync, publisher } = globalThis.__browserToolboxPublishTest;
    const store = globalThis.BrowserToolboxConfigurationStore;
    const result = await publisher.recover();
    const values = await sync.get(null);
    const all = await chrome.storage.sync.get(null);
    const actual = Object.fromEntries(
      Object.entries(all).filter(([key]) => !key.startsWith(prefix)),
    );
    const state = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    const journal = (await chrome.storage.local.get(store.SYNC_PUBLISH_JOURNAL_KEY))[
      store.SYNC_PUBLISH_JOURNAL_KEY
    ];
    const generationValid = scenario === "forward"
      ? (await store.readGeneration(values[store.KEYS.index], sync)).keyMappings ===
        "map z scrollDown"
      : !Object.hasOwn(values, store.KEYS.index) &&
        Object.keys(journal.chunks).every((key) => !Object.hasOwn(values, key));
    return {
      phase: result.phase,
      code: result.code,
      revision: result.revision,
      generationValid,
      legacyPreserved: values.keyMappings === "map old scrollUp",
      realSyncUnchanged: await store.digest(actual) === expected.actualDigest,
      committedStateUnchanged: await store.digest(state) === expected.stateDigest,
      backupRetained: Object.hasOwn(
        await chrome.storage.local.get(result.backupKey),
        result.backupKey,
      ),
    };
  }, { expected: before, scenario });
  assert(
    (scenario === "forward"
      ? recovered.phase === "COMMITTED"
      : recovered.phase === "ABORTED" && recovered.code === "CONFIGURATION_SYNC_CANCELLED") &&
      recovered.revision === before.revision && recovered.generationValid &&
      recovered.legacyPreserved &&
      recovered.realSyncUnchanged && recovered.committedStateUnchanged && recovered.backupRetained,
    "重启恢复或原配置不符",
  );
  report.checks.push({ name: "重启后继续既定方向并保留既有配置", status: "passed", ...recovered });
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
