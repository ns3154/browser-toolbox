// SPDX-License-Identifier: GPL-3.0-or-later
// 仅在临时合成 profile 演练只读预演与候选分片，不操作系统剪贴板。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-config-preparation-" });
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
    ],
  });
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const extensionId = new URL(target.url()).host;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/pages/mouse_options.html`);
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50, timeout: 10000 },
  );
  await page.close();
  const worker = await target.worker();
  const result = await worker.evaluate(async () => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = globalThis.BrowserToolboxConfigurationStore;
    if (!writer || !store) throw new Error("配置提交器未初始化");
    const probes = {
      testQuotaLess: "<",
      testQuotaGreater: ">",
      testQuotaAmpersand: "&",
      testQuotaSeparators: "\u2028\u2029",
      testQuotaMultibyte: "中😀",
      testQuotaEscaped: '\\"\n\r\t\b\f\u0000',
      testQuotaSlash: "/",
      testQuotaObject: { "<": "\u2028<", list: ["中", "\u2029"] },
      testQuotaSmall: 0.0000001,
      testQuotaLarge: 1e21,
      testQuotaFraction: 1.23456789012345,
      testQuotaNegativeZero: -0,
      "testQuota<Key": "合成",
      "testQuota\u2028Key": "合成",
    };
    await chrome.storage.sync.set(probes);
    const probeDifferences = [];
    for (const [key, value] of Object.entries(probes)) {
      const actual = await chrome.storage.sync.getBytesInUse(key);
      const estimated = store.itemBytes(key, value);
      const adapter = globalThis.BrowserToolboxSettingsStorage.serializedItemSize(key, value);
      if (actual !== estimated || actual !== adapter) {
        probeDifferences.push({ key, actual, estimated, adapter });
      }
    }
    await chrome.storage.sync.remove(Object.keys(probes));
    if (probeDifferences.length) {
      throw new Error(`字符容量差异：${JSON.stringify(probeDifferences)}`);
    }
    const initial = await writer.read();
    const baseline = structuredClone(initial.keyboard);
    delete baseline.settingsVersion;
    const css = "/*" + "<".repeat(1200) + "*/";
    const committed = await writer.commit({
      legacyPatch: {
        keyMappings: "",
        searchEngines: "",
        exclusionRules: [],
        smoothScroll: false,
        userDefinedLinkHintCss: css,
      },
    });
    // 独立合成旧版分片；不改动已提交索引或真实迁移状态。
    const legacyOperation = "synthetic-legacy";
    const legacyName = `${store.CHUNK_PREFIX}${legacyOperation}:userDefinedLinkHintCss:0`;
    const legacyChunk = { operationId: legacyOperation, part: 0, text: JSON.stringify(css) };
    if (store.itemBytes(legacyName, legacyChunk) <= store.MAX_CHUNK_BYTES) {
      throw new Error("旧分片样本没有跨越新上限");
    }
    const legacyIndex = {
      formatVersion: store.FORMAT_VERSION,
      operationId: legacyOperation,
      revision: 1,
      fields: { userDefinedLinkHintCss: { chunks: [legacyName], digest: await store.digest(css) } },
    };
    await chrome.storage.local.set({ [legacyName]: legacyChunk });
    const legacyRead = await store.readGeneration(legacyIndex, chrome.storage.local, {
      legacyLocalChunks: true,
    });
    let strictRejected = false;
    try {
      await store.readGeneration(legacyIndex, chrome.storage.local);
    } catch (_) {
      strictRejected = true;
    }
    await chrome.storage.local.remove(legacyName);
    if (legacyRead.userDefinedLinkHintCss !== css || !strictRejected) {
      throw new Error("旧本机分片兼容或新同步分片限制不符");
    }
    const syncBefore = await chrome.storage.sync.get(null);
    const localBefore = await chrome.storage.local.get(null);
    const plan = await writer.prepareKeyboardSyncMigration();
    const rollback = await writer.prepareLegacyRollback();
    const backup = await writer.prepareLegacyRollbackBackup();
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (
      !same(syncBefore, await chrome.storage.sync.get(null)) ||
      !same(localBefore, await chrome.storage.local.get(null))
    ) {
      throw new Error("只读准备改变了存储");
    }
    if (
      plan.index.fields.userDefinedLinkHintCss.chunks.length < 2 ||
      rollback.target.keyMappings !== "" || backup.backup.snapshot.keyboard.keyMappings !== ""
    ) {
      throw new Error("分片或显式空值不符");
    }
    // 仅在本次合成 profile 调用未接入的备份入口，验证真实落盘、读回和浏览器计量。
    const savedBackup = await writer.createLegacyRollbackBackup();
    const backupBytes = await chrome.storage.local.getBytesInUse(savedBackup.key);
    const storedBackup = (await chrome.storage.local.get(savedBackup.key))[savedBackup.key];
    const inspectedBackup = await writer.inspectLegacyRollbackBackup(storedBackup);
    await chrome.storage.local.remove(savedBackup.key);
    if (
      backupBytes !== backup.capacity.backupBytes ||
      savedBackup.sourceDigest !== backup.backup.sourceDigest ||
      inspectedBackup.snapshot.keyboard.userDefinedLinkHintCss !== css ||
      !same(localBefore, await chrome.storage.local.get(null))
    ) throw new Error("回退备份的浏览器计量、读回或清理不符");
    // 以下写入只存在于本次创建的合成 profile，用于模拟候选分片到齐和缺片。
    await chrome.storage.sync.set(plan.chunks);
    await chrome.storage.sync.set({ [store.KEYS.index]: plan.index });
    const candidate = await writer.inspectKeyboardSyncGeneration();
    if (
      candidate.keyboard.userDefinedLinkHintCss !== css || candidate.keyboard.keyMappings !== "" ||
      candidate.keyboard.smoothScroll !== false || candidate.keyboard.exclusionRules.length !== 0
    ) {
      throw new Error("候选同步代次未完整还原");
    }
    const actualBytes = await chrome.storage.sync.getBytesInUse(null);
    if (actualBytes !== plan.capacity.peakBytes) {
      const values = await chrome.storage.sync.get(null);
      const differences = [];
      for (const [key, value] of Object.entries(values)) {
        const actual = await chrome.storage.sync.getBytesInUse(key);
        const estimated = store.itemBytes(key, value);
        if (actual !== estimated) {
          differences.push({ key: key.replace(/:[^:]+:/, ":代次:"), actual, estimated });
        }
      }
      throw new Error(
        `同步容量预演 ${plan.capacity.peakBytes}，浏览器 ${actualBytes}，逐项差异 ${
          JSON.stringify(differences)
        }`,
      );
    }
    // 合成两端离线修改，只预演合并；索引和分片仍由测试直接写入独立 profile。
    const baseDigest = await store.digest(baseline);
    const remoteKeyboard = { ...baseline, scrollStepSize: 83 };
    const remote = await store.createGeneration(remoteKeyboard, "synthetic-merge", 999);
    remote.index.kind = "keyboard-sync";
    remote.index.sourceDigest = await store.digest(remoteKeyboard);
    await chrome.storage.sync.set(remote.chunks);
    await chrome.storage.sync.set({ [store.KEYS.index]: remote.index });
    const syncBeforeMerge = await chrome.storage.sync.get(null);
    const localBeforeMerge = await chrome.storage.local.get(null);
    const mergeInput = {
      baseline,
      localBaseDigest: baseDigest,
      incomingBaseDigest: baseDigest,
    };
    const merged = await writer.prepareKeyboardSyncReconciliation(mergeInput);
    const unproven = await writer.prepareKeyboardSyncReconciliation();
    if (
      merged.status !== "candidate" || merged.lineageVerified ||
      merged.candidate.keyMappings !== "" || merged.candidate.scrollStepSize !== 83 ||
      unproven.status !== "unproven" || Object.hasOwn(unproven, "candidate") ||
      !same(syncBeforeMerge, await chrome.storage.sync.get(null)) ||
      !same(localBeforeMerge, await chrome.storage.local.get(null))
    ) throw new Error("跨设备只读合并或缺失共同基线处理不符");
    const conflictKeyboard = { ...remoteKeyboard, keyMappings: "map z scrollDown" };
    const conflict = await store.createGeneration(conflictKeyboard, "synthetic-conflict", 1);
    conflict.index.kind = "keyboard-sync";
    conflict.index.sourceDigest = await store.digest(conflictKeyboard);
    await chrome.storage.sync.set(conflict.chunks);
    await chrome.storage.sync.set({ [store.KEYS.index]: conflict.index });
    const syncBeforeConflict = await chrome.storage.sync.get(null);
    const pending = await writer.prepareKeyboardSyncReconciliation(mergeInput);
    const selected = await writer.prepareKeyboardSyncReconciliation({
      ...mergeInput,
      choices: { "keyboard.keyMappings": "incoming" },
    });
    if (
      pending.status !== "conflict" || !same(pending.conflicts, ["keyboard.keyMappings"]) ||
      Object.hasOwn(pending, "candidate") || selected.status !== "candidate" ||
      selected.candidate.keyMappings !== "map z scrollDown" ||
      selected.candidate.scrollStepSize !== 83 ||
      !same(syncBeforeConflict, await chrome.storage.sync.get(null)) ||
      !same(localBeforeMerge, await chrome.storage.local.get(null))
    ) throw new Error("跨设备冲突选择或只读性不符");
    await chrome.storage.sync.set({ [store.KEYS.index]: plan.index });
    await chrome.storage.sync.remove([
      ...Object.keys(remote.chunks),
      ...Object.keys(conflict.chunks),
    ]);
    const chunk = plan.index.fields.userDefinedLinkHintCss.chunks[0];
    await chrome.storage.sync.remove(chunk);
    let missingRejected = false;
    try {
      await writer.inspectKeyboardSyncGeneration();
    } catch (_) {
      missingRejected = true;
    }
    if (!missingRejected) throw new Error("缺失候选分片时未拒绝");
    await chrome.storage.sync.set({ [chunk]: plan.chunks[chunk] });
    const legacyAfter = await chrome.storage.sync.get([
      "keyMappings",
      "searchEngines",
      "exclusionRules",
      "smoothScroll",
    ]);
    if (
      legacyAfter.keyMappings !== "" || legacyAfter.searchEngines !== "" ||
      !Array.isArray(legacyAfter.exclusionRules) || legacyAfter.exclusionRules.length !== 0 ||
      legacyAfter.smoothScroll !== false
    ) {
      throw new Error("候选演练改变了旧兼容键");
    }
    const stillCommitted = await writer.read();
    if (
      stillCommitted.revision !== committed.revision ||
      stillCommitted.keyboard.userDefinedLinkHintCss !== css
    ) {
      throw new Error("候选代次改变了当前权威配置");
    }
    return {
      checks: [
        "预演不写存储",
        "旧本机分片兼容并重新切片",
        "候选分片完整读取",
        "浏览器容量读数一致",
        "回退备份的浏览器计量与完整读回",
        "跨设备不同字段只读合并与缺失基线阻止",
        "跨设备同字段冲突与明确选择",
        "缺片拒绝",
        "旧兼容键与本机权威不变",
      ],
      capacity: plan.capacity,
      actualBytes,
      backupBytes,
      cssChunks: plan.index.fields.userDefinedLinkHintCss.chunks.length,
    };
  });
  console.log(JSON.stringify({ version: await browser.version(), ...result }, null, 2));
} finally {
  if (browser) await browser.close();
  await Deno.remove(temporary, { recursive: true });
}
