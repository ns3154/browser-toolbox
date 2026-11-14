// SPDX-License-Identifier: GPL-3.0-or-later
// 临时构建与合成同步命名空间中真实终止后台，验证归档、复核和冲突选择记录可重试。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_ARCHIVE_REPORT");
const scenario = Deno.env.get("BROWSER_TOOLBOX_ARCHIVE_SCENARIO") || "archive";
if (!executablePath || !["archive", "review", "case", "decision"].includes(scenario)) {
  throw new Error("缺少 Chrome for Testing 路径或测试场景无效");
}
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-transition-archive-" });
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
      reached: globalThis.__browserToolboxArchiveBarrier === true,
      failure: globalThis.__browserToolboxArchiveFailure,
    }));
    if (state.failure) throw new Error(`未到达中断点：${state.failure}`);
    if (state.reached) return;
    await wait(30);
  } while (Date.now() < deadline);
  throw new Error("未到达归档中断点");
}

function installSyntheticAdapter({ barrier }) {
  const prefix = "browserToolboxSyntheticArchive:";
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
  const transaction = new BrowserToolboxLegacyRollback.LegacyRollbackTransaction({
    writer,
    authorize: () => true,
  });
  const manager = new globalThis.__BrowserToolboxTransitionArchive({
    writer,
    authorize: () => true,
    async afterStep(step) {
      if (step === barrier) {
        globalThis.__browserToolboxArchiveBarrier = true;
        await new Promise(() => {});
      }
    },
  });
  const decisions = new globalThis.__BrowserToolboxTransitionConflictDecisions({
    writer,
    authorize: () => true,
    async afterStep(step) {
      if (step === barrier) {
        globalThis.__browserToolboxArchiveBarrier = true;
        await new Promise(() => {});
      }
    },
  });
  globalThis.__browserToolboxArchiveTest = {
    prefix,
    sync,
    writer,
    transaction,
    manager,
    decisions,
  };
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  await Deno.writeTextFile(
    path.join(extension, "background_scripts/main.js"),
    '\nimport { TransitionArchive } from "./browser_toolbox/transition_archive.js";\nimport { TransitionConflictDecisions } from "./browser_toolbox/transition_conflict_decisions.js";\nglobalThis.__BrowserToolboxTransitionArchive = TransitionArchive;\nglobalThis.__BrowserToolboxTransitionConflictDecisions = TransitionConflictDecisions;\n',
    { append: true },
  );
  const first = await open(extension, true);
  report.chrome = await browser.version();
  const before = await first.worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    await writer.read();
    const unsupportedRules = [{
      pattern: "https?://example.invalid/*",
      passKeys: "",
      enabled: false,
      futurePolicy: "synthetic-private-value",
    }];
    await writer.commit({ legacyPatch: { exclusionRules: unsupportedRules } });
    let warning;
    try {
      await writer.prepareLegacyRollback();
    } catch (failure) {
      warning = failure;
    }
    const retention = await writer.createLegacyRollbackBackup();
    const storedBackup = (await chrome.storage.local.get(retention.key))[retention.key];
    const backup = await writer.inspectLegacyRollbackBackup(storedBackup);
    const compatibility = {
      unsupportedWarning: warning?.code === "UNSUPPORTED_CONFIGURATION_FIELDS" &&
        warning.conflicts.includes("keyboard.exclusionRules[0].enabled") &&
        warning.conflicts.includes("keyboard.exclusionRules[0].futurePolicy") &&
        !JSON.stringify(warning.conflicts).includes("synthetic-private-value"),
      unsupportedRetained: await store.digest(backup.snapshot.keyboard.exclusionRules) ===
        await store.digest(unsupportedRules),
      syncUnchangedByPreviewAndBackup: await store.digest(
        (await chrome.storage.sync.get("exclusionRules")).exclusionRules,
      ) === await store.digest(unsupportedRules),
    };
    const committed = await writer.commit({
      legacyPatch: {
        keyMappings: Settings.defaultOptions.keyMappings,
        searchEngines: "s: https://example.invalid/new?q=%s",
        smoothScroll: false,
        exclusionRules: Settings.defaultOptions.exclusionRules,
      },
    });
    const prefix = "browserToolboxSyntheticArchive:";
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
      stateDigest: await store.digest(state),
      syncDigest: await store.digest(actual),
      compatibility,
    };
  });
  report.checks.push({
    name: "旧规则无法表达字段的提示与备份",
    status: Object.values(before.compatibility).every(Boolean) ? "passed" : "failed",
    ...before.compatibility,
  });
  assert(Object.values(before.compatibility).every(Boolean), "未知内层字段未被安全提示或保留");
  await first.worker.evaluate(installSyntheticAdapter, { barrier: scenario });
  await first.worker.evaluate((scenario) => {
    const { transaction, manager, decisions, sync } = globalThis.__browserToolboxArchiveTest;
    globalThis.__browserToolboxArchivePending = (async () => {
      await transaction.execute(await transaction.preview());
      const archive = await manager.archive("legacy-rollback");
      if (["archive", "review"].includes(scenario)) {
        await manager.recordReview("legacy-rollback", archive.key);
      } else {
        await sync.set({ keyMappings: "map synthetic-external scrollUp" });
        const captured = await decisions.capture(archive.key);
        const preview = await decisions.preview(captured.key);
        const choices = Object.fromEntries(
          Object.keys(preview.fields).map((key) => [key, "current"]),
        );
        await decisions.record(captured.key, choices);
      }
    })().catch((failure) => {
      globalThis.__browserToolboxArchiveFailure = failure.code || failure.message;
    });
  }, scenario);
  await waitBarrier(first.worker);
  const interrupted = await first.worker.evaluate(async () => {
    const store = BrowserToolboxConfigurationStore;
    const local = await chrome.storage.local.get(null);
    const journal = local[store.ROLLBACK_JOURNAL_KEY];
    const archives = Object.keys(local).filter((key) =>
      key.startsWith(`${store.TRANSITION_RECORD_PREFIX}archive:`)
    );
    const reviews = Object.keys(local).filter((key) =>
      key.startsWith(`${store.TRANSITION_RECORD_PREFIX}review:`)
    );
    const cases = Object.keys(local).filter((key) =>
      key.startsWith(`${store.TRANSITION_RECORD_PREFIX}conflict:`)
    );
    const decisions = Object.keys(local).filter((key) =>
      key.startsWith(`${store.TRANSITION_RECORD_PREFIX}decision:`)
    );
    return {
      phase: journal.phase,
      revision: journal.sourceRevision,
      backupPresent: Object.hasOwn(local, journal.backupKey),
      archives: archives.length,
      reviews: reviews.length,
      cases: cases.length,
      decisions: decisions.length,
    };
  });
  assert(
    interrupted.phase === "COMMITTED" && interrupted.revision === before.revision &&
      interrupted.backupPresent &&
      interrupted.archives === 1 && interrupted.reviews === Number(scenario === "review") &&
      interrupted.cases === Number(["case", "decision"].includes(scenario)) &&
      interrupted.decisions === Number(scenario === "decision"),
    "中断点持久状态不符",
  );
  report.checks.push({
    name: "终态、备份和已写归档在中断前保留",
    status: "passed",
    ...interrupted,
  });
  await stopWorker(first.id);
  const restarted = await open(extension, false);
  assert(restarted.id === first.id, "重启后扩展身份变化");
  await restarted.worker.evaluate(installSyntheticAdapter, { barrier: "" });
  const recovered = await restarted.worker.evaluate(async ({ expected, scenario }) => {
    const { prefix, sync, writer, manager, decisions } = globalThis.__browserToolboxArchiveTest;
    const store = BrowserToolboxConfigurationStore;
    const list = await manager.listArchives();
    const archive = await manager.archive("legacy-rollback");
    let decisionChecks = {};
    if (["case", "decision"].includes(scenario)) {
      const captured = await decisions.capture(archive.key);
      const preview = await decisions.preview(captured.key);
      const choices = Object.fromEntries(
        Object.keys(preview.fields).map((key) => [key, "current"]),
      );
      const saved = await decisions.record(captured.key, choices);
      const inspected = await decisions.inspect(saved.key);
      const proposal = await decisions.previewDecision(saved.key);
      const local = await chrome.storage.local.get(null);
      const externalRetained = local[captured.key].observed.keyMappings.value ===
        "map synthetic-external scrollUp";
      await sync.set({ keyMappings: "map synthetic-newer scrollDown" });
      let stale = false;
      try {
        await decisions.inspect(saved.key);
      } catch (failure) {
        stale = failure.code === "CONFIGURATION_EXTERNAL_CONFLICT";
      }
      decisionChecks = {
        caseReused: captured.reused,
        decisionReuseAsExpected: saved.reused === (scenario === "decision"),
        decisionCurrent: inspected.status === "current" && !inspected.releaseAllowed &&
          !inspected.lineageVerified,
        conflictValueAvailable: preview.fields.keyMappings.current.value ===
          "map synthetic-external scrollUp",
        choicePreviewOnly: proposal.cells.keyMappings.value === "map synthetic-external scrollUp" &&
          !proposal.writeAllowed && !proposal.releaseAllowed && !proposal.lineageVerified,
        externalRetained,
        staleDecisionRejected: stale,
        summariesRedacted: !JSON.stringify({ captured, saved, inspected }).includes(
          "synthetic-external",
        ),
      };
    }
    let reviewChecks = {};
    if (["archive", "review"].includes(scenario)) {
      const review = await manager.recordReview("legacy-rollback", archive.key);
      const ready = await manager.inspectReview("legacy-rollback", review.key);
      await sync.set({ searchEngines: "s: https://example.invalid/external?q=%s" });
      const stale = await manager.inspectReview("legacy-rollback", review.key);
      const conflict = await manager.inspectConflict("legacy-rollback");
      reviewChecks = {
        reviewReuseAsExpected: review.reused === (scenario === "review"),
        candidateReady: ready.ready,
        staleRejected: !stale.ready && stale.reason === "CONFIGURATION_EXTERNAL_CONFLICT",
        conflictClassified: conflict.fields.searchEngines === "external" &&
          !JSON.stringify(conflict).includes("example.invalid"),
      };
    }
    const locked = await writer.preview();
    const all = await chrome.storage.sync.get(null);
    const actual = Object.fromEntries(
      Object.entries(all).filter(([key]) => !key.startsWith(prefix)),
    );
    const local = await chrome.storage.local.get(null);
    const journal = local[store.ROLLBACK_JOURNAL_KEY];
    return {
      oneValidArchive: list.length === 1 && list[0].status === "valid",
      archiveReused: archive.reused,
      ...reviewChecks,
      ...decisionChecks,
      normalWriteStillBlocked: locked.code === "CONFIGURATION_TRANSITION_PENDING",
      journalRetained: journal.phase === "COMMITTED" &&
        journal.sourceRevision === expected.revision,
      backupRetained: Object.hasOwn(local, journal.backupKey),
      committedStateUnchanged: await store.digest(local[store.KEYS.state]) === expected.stateDigest,
      realSyncUnchanged: await store.digest(actual) === expected.syncDigest,
    };
  }, { expected: before, scenario });
  assert(Object.values(recovered).every(Boolean), "中断重试、旧确认失效或既有数据保留不符");
  report.checks.push({
    name: "重启复用归档并重新核验候选，原记录和兼容写保护保留",
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
