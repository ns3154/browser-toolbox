// SPDX-License-Identifier: GPL-3.0-or-later
// 合成同步命名空间中终止并重启后台，验证同步冲突现场和选择可复核。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_SYNC_CONFLICT_REPORT");
const scenario = Deno.env.get("BROWSER_TOOLBOX_SYNC_CONFLICT_SCENARIO") || "case";
if (!executablePath || !["case", "decision", "abort-case"].includes(scenario)) {
  throw new Error("缺少 Chrome for Testing 路径或测试场景无效");
}
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-sync-conflict-" });
const profile = path.join(temporary, "profile");
const report = { status: "running", source: "synthetic", scenario, checks: [] };
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;

async function open(extension, initialize) {
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
  if (initialize) {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await page.waitForFunction(
      () => document.querySelector("main")?.dataset.settingsReady === "true",
      {
        polling: 50,
        timeout: 15000,
      },
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
  assert(active, "未找到冲突记录执行中的后台");
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
      reached: globalThis.__browserToolboxSyncConflictBarrier === true,
      failure: globalThis.__browserToolboxSyncConflictFailure,
    }));
    if (state.failure) throw new Error(`未到达中断点：${state.failure}`);
    if (state.reached) return;
    await wait(30);
  } while (Date.now() < deadline);
  throw new Error("未到达同步冲突中断点");
}

function installSyntheticAdapter({ barrier, injectDuringPublish = false }) {
  const prefix = "browserToolboxSyntheticSyncConflict:";
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
  const injectIncoming = async () => {
    const { current } = await writer.readPreparationSnapshot();
    const incoming = structuredClone(current.keyboard);
    incoming.keyMappings = "map remote scrollUp";
    incoming.smoothScroll = true;
    const generation = await store.createGeneration(
      incoming,
      crypto.randomUUID(),
      current.revision + 17,
    );
    generation.index.kind = "keyboard-sync";
    generation.index.sourceDigest = await store.digest(incoming);
    await sync.set({
      ...generation.chunks,
      [store.KEYS.index]: generation.index,
      unrelatedSynthetic: "synthetic-private-unrelated",
    });
  };
  const publisher = new globalThis.BrowserToolboxKeyboardSyncPublisher.KeyboardSyncPublisher({
    writer,
    authorize: () => true,
    async afterStep(step) {
      if (step === "chunks" && injectDuringPublish) await injectIncoming();
    },
  });
  const archive = new globalThis.__BrowserToolboxTransitionArchive({
    writer,
    authorize: () => true,
  });
  const decisions = new globalThis.__BrowserToolboxSyncConflictDecisions({
    writer,
    authorize: () => true,
    async afterStep(step) {
      if (step === barrier) {
        globalThis.__browserToolboxSyncConflictBarrier = true;
        await new Promise(() => {});
      }
    },
  });
  globalThis.__browserToolboxSyncConflictTest = {
    prefix,
    sync,
    writer,
    publisher,
    archive,
    decisions,
    injectIncoming,
  };
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  await Deno.writeTextFile(
    path.join(extension, "background_scripts/main.js"),
    '\nimport "./browser_toolbox/keyboard_sync_publisher.js";\nimport { TransitionArchive } from "./browser_toolbox/transition_archive.js";\nimport { SyncTransitionConflictDecisions } from "./browser_toolbox/sync_transition_conflict_decisions.js";\nglobalThis.__BrowserToolboxTransitionArchive = TransitionArchive;\nglobalThis.__BrowserToolboxSyncConflictDecisions = SyncTransitionConflictDecisions;\n',
    { append: true },
  );
  const first = await open(extension, true);
  report.chrome = await browser.version();
  const before = await first.worker.evaluate(async () => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    await writer.read();
    const committed = await writer.commit({
      legacyPatch: { keyMappings: "map local scrollDown", smoothScroll: false },
    });
    const prefix = "browserToolboxSyntheticSyncConflict:";
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
    barrier: scenario === "decision" ? "sync-decision" : "sync-case",
    injectDuringPublish: scenario === "abort-case",
  });
  await first.worker.evaluate((scenario) => {
    const { publisher, archive, decisions, injectIncoming } =
      globalThis.__browserToolboxSyncConflictTest;
    globalThis.__browserToolboxSyncConflictPending = (async () => {
      const result = await publisher.execute(await publisher.preview());
      if (scenario === "abort-case") {
        if (result.phase !== "ABORTED" || result.code !== "CONFIGURATION_EXTERNAL_CONFLICT") {
          throw new Error("发布中外部写入未触发冲突终态");
        }
      } else {
        if (result.phase !== "COMMITTED") throw new Error("发布未完成");
        await injectIncoming();
      }
      const archived = await archive.archive("keyboard-sync-publish");
      const captured = await decisions.capture(archived.key);
      await decisions.record(captured.key, { keyMappings: "incoming", smoothScroll: "local" });
    })().catch((failure) =>
      globalThis.__browserToolboxSyncConflictFailure = failure.code || failure.message
    );
  }, scenario);
  await waitBarrier(first.worker);
  const interrupted = await first.worker.evaluate(async () => {
    const store = globalThis.BrowserToolboxConfigurationStore;
    const local = await chrome.storage.local.get(null);
    const journal = local[store.SYNC_PUBLISH_JOURNAL_KEY];
    return {
      phase: journal.phase,
      revision: journal.sourceRevision,
      backupPresent: Object.hasOwn(local, journal.backupKey),
      archives: Object.keys(local).filter((key) =>
        key.startsWith(`${store.TRANSITION_RECORD_PREFIX}archive:`)
      ).length,
      cases: Object.keys(local).filter((key) =>
        key.startsWith(`${store.TRANSITION_RECORD_PREFIX}sync-conflict:`)
      ).length,
      decisions: Object.keys(local).filter((key) =>
        key.startsWith(`${store.TRANSITION_RECORD_PREFIX}sync-decision:`)
      ).length,
    };
  });
  assert(
    interrupted.phase === (scenario === "abort-case" ? "ABORTED" : "COMMITTED") &&
      interrupted.revision === before.revision &&
      interrupted.backupPresent && interrupted.archives === 1 && interrupted.cases === 1 &&
      interrupted.decisions === Number(scenario === "decision"),
    "中断点持久状态不符",
  );
  report.checks.push({
    name: "同步冲突现场落盘后事务与备份保留",
    status: "passed",
    ...interrupted,
  });
  await stopWorker(first.id);
  const restarted = await open(extension, false);
  assert(restarted.id === first.id, "重启后扩展身份变化");
  await restarted.worker.evaluate(installSyntheticAdapter, { barrier: "" });
  const recovered = await restarted.worker.evaluate(async ({ expected, scenario }) => {
    const { prefix, sync, writer, archive, decisions } =
      globalThis.__browserToolboxSyncConflictTest;
    const store = globalThis.BrowserToolboxConfigurationStore;
    const listed = await archive.listArchives();
    const archived = await archive.archive("keyboard-sync-publish");
    const inspection = await decisions.inspectIncoming(archived.key);
    const captured = await decisions.capture(archived.key);
    const preview = await decisions.preview(captured.key);
    const receipt = await decisions.record(captured.key, {
      keyMappings: "incoming",
      smoothScroll: "local",
    });
    const proposal = await decisions.previewDecision(receipt.key);
    const local = await chrome.storage.local.get(null);
    const journal = local[store.SYNC_PUBLISH_JOURNAL_KEY];
    const saved = local[captured.key];
    const foreignRetained = saved.incomingIndex.kind === "keyboard-sync" &&
      Object.keys(saved.incomingChunks).length > 0 &&
      !JSON.stringify(saved).includes("synthetic-private-unrelated");
    await sync.set({ unrelatedSynthetic: "later-external-value" });
    let staleRejected = false;
    try {
      await decisions.previewDecision(receipt.key);
    } catch (failure) {
      staleRejected = failure.code === "CONFIGURATION_EXTERNAL_CONFLICT";
    }
    const missingChunk = Object.keys(saved.incomingChunks)[0];
    await sync.remove(missingChunk);
    const missingBefore = await store.digest(await sync.get(null));
    const missingInspection = await decisions.inspectIncoming(archived.key);
    let missingRejected = false;
    try {
      await decisions.capture(archived.key);
    } catch (failure) {
      missingRejected = failure.code === "INCOMPLETE_CONFIGURATION_GENERATION";
    }
    const missingUnchanged = await store.digest(await sync.get(null)) === missingBefore;
    const all = await chrome.storage.sync.get(null);
    const actual = Object.fromEntries(
      Object.entries(all).filter(([key]) => !key.startsWith(prefix)),
    );
    let blocked = false;
    try {
      await writer.commit({ legacyPatch: { keyMappings: "map q scrollUp" } });
    } catch (failure) {
      blocked = failure.code === "CONFIGURATION_TRANSITION_PENDING";
    }
    return {
      validArchive: listed.length === 1 && listed[0].status === "valid" && archived.reused,
      inspectionComplete: inspection.status === "complete" && !inspection.lineageVerified &&
        !inspection.writeAllowed && !inspection.releaseAllowed,
      caseReused: captured.reused,
      decisionReuseAsExpected: receipt.reused === (scenario === "decision"),
      explicitFields: preview.fields.keyMappings.local === "map local scrollDown" &&
        preview.fields.keyMappings.incoming === "map remote scrollUp" &&
        preview.fields.smoothScroll.local === false &&
        preview.fields.smoothScroll.incoming === true,
      proposalOnly: proposal.candidate.keyMappings === "map remote scrollUp" &&
        proposal.candidate.smoothScroll === false && !proposal.writeAllowed &&
        !proposal.releaseAllowed && !proposal.lineageVerified && proposal.possibleOtherSyncChange &&
        !proposal.localDomainChanged && !proposal.journalHasOtherConflicts,
      foreignRetained,
      summariesRedacted: !JSON.stringify({ captured, receipt }).includes("map remote"),
      staleRejected,
      missingDiagnosed: missingInspection.status === "incomplete" && missingRejected &&
        missingUnchanged,
      normalWriteStillBlocked: blocked,
      journalRetained: journal.phase === (scenario === "abort-case" ? "ABORTED" : "COMMITTED") &&
        journal.sourceRevision === expected.revision,
      backupRetained: Object.hasOwn(local, journal.backupKey),
      committedStateUnchanged: await store.digest(local[store.KEYS.state]) === expected.stateDigest,
      realSyncUnchanged: await store.digest(actual) === expected.actualDigest,
    };
  }, { expected: before, scenario });
  assert(Object.values(recovered).every(Boolean), "中断重启、冲突选择或数据保留不符");
  report.checks.push({
    name: "重启复用现场和选择，过期拒绝并保留原数据",
    status: "passed",
    ...recovered,
  });
  report.status = "passed";
  console.log(JSON.stringify(report, null, 2));
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
  throw failure;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close();
  await Deno.remove(temporary, { recursive: true });
}
