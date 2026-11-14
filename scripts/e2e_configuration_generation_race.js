// SPDX-License-Identifier: GPL-3.0-or-later
// 在临时构建中只记录异常类型与字段名，复现同一代次被外部改写时的读取交错。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_GENERATION_RACE_REPORT");
const instrumented = Deno.env.get("BROWSER_TOOLBOX_GENERATION_RACE_INSTRUMENTED") !== "false";
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-generation-race-" });
const report = {
  status: "running",
  source: "synthetic",
  instrumented,
  natural: [],
  controlled: null,
  writes: [],
  missingRestart: null,
};
let browser;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};

async function instrument(build) {
  const file = path.join(build, "background_scripts/browser_toolbox/configuration_writer.js");
  let text = await Deno.readTextFile(file);
  const parser = "      const value = JSON.parse(text);";
  const caught = "      } catch (failure) {\n        // 分片不完整时";
  if (text.split(parser).length !== 2 || text.split(caught).length !== 2) {
    throw new Error("诊断注入锚点不唯一");
  }
  text = text.replace(
    parser,
    `      let value;
      try { value = JSON.parse(text); } catch (failure) {
        (globalThis.__browserToolboxParseTrace ||= []).push({ field, name: failure.name, parts: descriptor.chunks.length });
        throw failure;
      }`,
  );
  text = text.replace(
    caught,
    `      } catch (failure) {
        (globalThis.__browserToolboxLoadTrace ||= []).push({
          name: failure.name, code: failure.code || null,
          owner: this === globalThis.BrowserToolboxConfigurationWriterInstance,
          revision: committedIndex.revision,
        });
        // 分片不完整时`,
  );
  await Deno.writeTextFile(file, text);
}

async function open(build, label) {
  const profile = path.join(temporary, `profile-${label}`);
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: profile,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${build}`,
      `--load-extension=${build}`,
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
  return { worker: await target.worker(), id };
}

async function closeBrowser() {
  if (!browser) return;
  const current = browser;
  browser = null;
  await current.close();
}

async function naturalAttempt(worker) {
  const details = await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    const css = "/*" + "<".repeat(1200) + "*/";
    await writer.read();
    const committed = await writer.commit({ legacyPatch: { userDefinedLinkHintCss: css } });
    const local = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
    const oldIndex = structuredClone(local[store.KEYS.index]);
    const index = structuredClone(oldIndex);
    const state = structuredClone(local[store.KEYS.state]);
    const names = oldIndex.fields.userDefinedLinkHintCss.chunks;
    if (names.length < 2) throw new Error("未生成多片当前代次");
    const first = names[0];
    const chunk = { operationId: index.operationId, part: 0, text: JSON.stringify(css) };
    index.fields.userDefinedLinkHintCss.chunks = [first];
    state.committedIndex = structuredClone(index);
    state.afterIndex = structuredClone(index);
    await chrome.storage.local.set({
      [first]: chunk,
      [store.KEYS.index]: index,
      [store.KEYS.state]: state,
    });
    const afterSet = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    await store.readGeneration(index, chrome.storage.local, { legacyLocalChunks: true });
    const reader = new store.ConfigurationWriter({
      storage: chrome.storage,
      defaults: writer.defaults,
      migrateLegacy: writer.migrateLegacy,
      migrateToolbox: writer.migrateToolbox,
      validateToolbox: writer.validateToolbox,
    });
    const fields = await store.readGeneration(index, chrome.storage.local, {
      legacyLocalChunks: true,
    });
    reader.validateKeyboard(fields);
    reader.validateToolbox(fields.toolbox);
    const stateBeforeRead = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    const view = await reader.read();
    const final = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    return {
      revision: committed.revision,
      originalParts: names.length,
      injectedParts: index.fields.userDefinedLinkHintCss.chunks.length,
      afterSet: afterSet.phase,
      beforeRead: stateBeforeRead.phase,
      phase: final.phase,
      code: final.code,
      valuePreserved: view.keyboard.userDefinedLinkHintCss === css,
      parseTrace: globalThis.__browserToolboxParseTrace || [],
      loadTrace: globalThis.__browserToolboxLoadTrace || [],
    };
  });
  return details;
}

async function controlledAttempt(worker) {
  await worker.evaluate(async () => {
    const original = BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    const css = "/*" + "<".repeat(1200) + "*/";
    await original.read();
    await original.commit({ legacyPatch: { userDefinedLinkHintCss: css } });
    const local = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
    const oldIndex = structuredClone(local[store.KEYS.index]);
    const names = oldIndex.fields.userDefinedLinkHintCss.chunks;
    if (names.length < 2) throw new Error("受控场景未生成多片代次");
    const replacement = structuredClone(oldIndex);
    replacement.fields.userDefinedLinkHintCss.chunks = [names[0]];
    const state = structuredClone(local[store.KEYS.state]);
    state.committedIndex = structuredClone(replacement);
    state.afterIndex = structuredClone(replacement);
    const chunk = { operationId: oldIndex.operationId, part: 0, text: JSON.stringify(css) };
    const raw = chrome.storage.local;
    let held = false;
    const localProxy = {
      QUOTA_BYTES: raw.QUOTA_BYTES,
      get(keys) {
        if (!held && Array.isArray(keys) && names.every((name) => keys.includes(name))) {
          held = true;
          globalThis.__browserToolboxReadHeld = true;
          return new Promise((resolve, reject) => {
            globalThis.__browserToolboxReleaseRead = () => raw.get(keys).then(resolve, reject);
          });
        }
        return raw.get(keys);
      },
      set: (items) => raw.set(items),
      remove: (keys) => raw.remove(keys),
      getBytesInUse: (keys) => raw.getBytesInUse(keys),
    };
    const reader = new store.ConfigurationWriter({
      storage: { local: localProxy, sync: chrome.storage.sync, onChanged: { addListener() {} } },
      defaults: original.defaults,
      migrateLegacy: original.migrateLegacy,
      migrateToolbox: original.migrateToolbox,
      validateToolbox: original.validateToolbox,
    });
    globalThis.__browserToolboxRaceReader = reader;
    globalThis.__browserToolboxRace = { oldIndex, replacement, state, chunk, first: names[0], css };
    globalThis.__browserToolboxRaceResult = reader.read().then((view) => ({
      resolved: true,
      valuePreserved: view.keyboard.userDefinedLinkHintCss === css,
      generationFailure: reader.generationFailure,
      readCode: reader.lastReadCode,
      dirty: reader.dirty,
    })).catch((error) => ({ resolved: false, code: error.code || null, name: error.name }));
  });
  const deadline = Date.now() + 10000;
  while (
    Date.now() < deadline && !await worker.evaluate(() => !!globalThis.__browserToolboxReadHeld)
  ) {
    await pause(25);
  }
  assert(
    await worker.evaluate(() => !!globalThis.__browserToolboxReadHeld),
    "受控读取没有到达分片屏障",
  );
  return await worker.evaluate(async () => {
    const store = BrowserToolboxConfigurationStore;
    const sample = globalThis.__browserToolboxRace;
    await chrome.storage.local.set({
      [sample.first]: sample.chunk,
      [store.KEYS.index]: sample.replacement,
      [store.KEYS.state]: sample.state,
    });
    let staleIndexFailure;
    try {
      await store.readGeneration(sample.oldIndex, chrome.storage.local, {
        legacyLocalChunks: true,
      });
    } catch (error) {
      staleIndexFailure = { name: error.name, code: error.code || null };
    }
    globalThis.__browserToolboxReleaseRead();
    const outcome = await globalThis.__browserToolboxRaceResult;
    const local = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
    const state = local[store.KEYS.state];
    const retry = await globalThis.__browserToolboxRaceReader.read();
    const retryState = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    return {
      staleIndexFailure,
      outcome,
      phase: state.phase,
      code: state.code,
      stateParts: state.committedIndex.fields.userDefinedLinkHintCss.chunks.length,
      indexParts: local[store.KEYS.index].fields.userDefinedLinkHintCss.chunks.length,
      retry: {
        phase: retryState.phase,
        code: retryState.code,
        valuePreserved: retry.keyboard.userDefinedLinkHintCss === sample.css,
        readCode: globalThis.__browserToolboxRaceReader.lastReadCode,
      },
      parseTrace: globalThis.__browserToolboxParseTrace || [],
      loadTrace: globalThis.__browserToolboxLoadTrace || [],
    };
  });
}

async function writeAttempt(worker, action) {
  return await worker.evaluate(async (action) => {
    const original = BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    await original.read();
    const stored = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
    const beforeState = stored[store.KEYS.state];
    const beforeSync = await chrome.storage.sync.get(null);
    const missing = stored[store.KEYS.index].fields.keyMappings.chunks[0];
    const raw = chrome.storage.local;
    let reads = 0;
    const localProxy = {
      QUOTA_BYTES: raw.QUOTA_BYTES,
      async get(keys) {
        if (Array.isArray(keys) && keys.includes(missing)) {
          reads++;
          if (reads === (["incoming", "committed"].includes(action) ? 1 : 2)) {
            await raw.remove(missing);
          }
        }
        return await raw.get(keys);
      },
      set: (items) => raw.set(items),
      remove: (keys) => raw.remove(keys),
      getBytesInUse: (keys) => raw.getBytesInUse(keys),
    };
    const reader = new store.ConfigurationWriter({
      storage: { local: localProxy, sync: chrome.storage.sync, onChanged: { addListener() {} } },
      defaults: original.defaults,
      migrateLegacy: original.migrateLegacy,
      migrateToolbox: original.migrateToolbox,
      validateToolbox: original.validateToolbox,
    });
    let failure;
    try {
      if (action === "commit") await reader.commit({ legacyPatch: { scrollStepSize: 83 } });
      else if (action === "rollback") await reader.rollback();
      else await reader.resolve(action);
    } catch (error) {
      failure = error.code || error.name;
    }
    const afterState = (await raw.get(store.KEYS.state))[store.KEYS.state];
    const afterSync = await chrome.storage.sync.get(null);
    return {
      action,
      failure,
      fragmentReads: reads,
      stateUnchanged: JSON.stringify(beforeState) === JSON.stringify(afterState),
      syncUnchanged: JSON.stringify(beforeSync) === JSON.stringify(afterSync),
    };
  }, action);
}

async function prepareMissingRestart(worker) {
  return await worker.evaluate(async () => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    const saved = await writer.read();
    const local = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
    const name = local[store.KEYS.index].fields.keyMappings.chunks[0];
    const chunk = (await chrome.storage.local.get(name))[name];
    await chrome.storage.local.remove(name);
    const preview = await writer.preview();
    if (preview.code !== "INCOMPLETE_CONFIGURATION_GENERATION") {
      throw new Error("缺片预览未报告错误");
    }
    return { name, chunk, state: local[store.KEYS.state], revision: saved.revision };
  });
}

async function inspectMissingRestart(worker, fixture) {
  return await worker.evaluate(async ({ name, chunk, state, revision }) => {
    const writer = BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    const view = await writer.read();
    const preview = await writer.preview();
    let failure;
    try {
      await writer.commit({ legacyPatch: { scrollStepSize: 83 } });
    } catch (error) {
      failure = error.code || error.name;
    }
    const during = (await chrome.storage.local.get(store.KEYS.state))[store.KEYS.state];
    if (
      view.revision !== revision || preview.code !== "INCOMPLETE_CONFIGURATION_GENERATION" ||
      failure !== "INCOMPLETE_CONFIGURATION_GENERATION" ||
      JSON.stringify(during) !== JSON.stringify(state)
    ) {
      throw new Error("重启后缺片状态或写入保护不符");
    }
    await chrome.storage.local.set({ [name]: chunk });
    const restored = await writer.preview();
    const committed = await writer.commit({ legacyPatch: { scrollStepSize: 83 } });
    if (restored.code !== null || committed.keyboard.scrollStepSize !== 83) {
      throw new Error("恢复分片后不能继续提交");
    }
    return {
      codeBeforeRestore: preview.code,
      failure,
      stateUnchanged: true,
      codeAfterRestore: restored.code,
      committedRevision: committed.revision,
    };
  }, fixture);
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const build = path.join(output, "browser-toolbox");
  if (instrumented) await instrument(build);
  for (let index = 1; index <= 3; index++) {
    const { worker } = await open(build, `natural-${index}`);
    report.natural.push(await naturalAttempt(worker));
    await closeBrowser();
  }
  const { worker } = await open(build, "controlled");
  for (const page of await browser.pages()) {
    if (page.url().startsWith("chrome-extension://")) await page.close();
  }
  report.controlled = await controlledAttempt(worker);
  assert(
    report.natural.every((item) => item.phase === "COMMITTED" && item.valuePreserved) &&
      report.controlled.staleIndexFailure?.name === "SyntaxError" &&
      report.controlled.outcome.resolved && report.controlled.outcome.valuePreserved &&
      report.controlled.outcome.readCode === "CONFIGURATION_EXTERNAL_CONFLICT" &&
      report.controlled.outcome.dirty &&
      report.controlled.phase === "COMMITTED" && report.controlled.code === null &&
      report.controlled.stateParts === 1 && report.controlled.indexParts === 1 &&
      report.controlled.retry.phase === "COMMITTED" && report.controlled.retry.code === null &&
      report.controlled.retry.valuePreserved && report.controlled.retry.readCode === null &&
      (!instrumented ||
        report.controlled.parseTrace.some((entry) =>
          entry.field === "userDefinedLinkHintCss" && entry.name === "SyntaxError"
        )),
    "受控旧索引与新分片交错未得到预期证据",
  );
  report.chrome = await browser.version();
  await closeBrowser();
  for (const action of ["commit", "rollback", "incoming", "committed"]) {
    const { worker } = await open(build, `write-${action}`);
    for (const page of await browser.pages()) {
      if (page.url().startsWith("chrome-extension://")) await page.close();
    }
    const result = await writeAttempt(worker, action);
    report.writes.push(result);
    assert(
      result.failure === "INCOMPLETE_CONFIGURATION_GENERATION" && result.stateUnchanged &&
        result.syncUnchanged,
      `分片缺失时写入入口未安全停止：${action}`,
    );
    await closeBrowser();
  }
  const first = await open(build, "missing-restart");
  for (const page of await browser.pages()) {
    if (page.url().startsWith("chrome-extension://")) await page.close();
  }
  const fixture = await prepareMissingRestart(first.worker);
  await closeBrowser();
  const second = await open(build, "missing-restart");
  for (const page of await browser.pages()) {
    if (page.url().startsWith("chrome-extension://")) await page.close();
  }
  report.missingRestart = await inspectMissingRestart(second.worker, fixture);
  await closeBrowser();
  report.status = "passed";
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  throw error;
} finally {
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await closeBrowser();
  await Deno.remove(temporary, { recursive: true });
}
