// SPDX-License-Identifier: GPL-3.0-or-later
// 旧构建正常落盘并完全退出后，固定路径和合成 profile 再启动新构建。
import * as path from "@std/path";
import { copy } from "@std/fs";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const oldBuild = Deno.env.get("BROWSER_TOOLBOX_BOUNDARY_OLD_BUILD");
const newBuild = Deno.env.get("BROWSER_TOOLBOX_BOUNDARY_NEW_BUILD");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_BOUNDARY_REPORT");
if (!executablePath || !oldBuild || !newBuild) throw new Error("缺少 CFT 或新旧构建路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-boundary-upgrade-" });
const extensionPath = path.join(temporary, "fixed-extension");
const report = { status: "running", source: "synthetic", checks: [], browsers: [] };
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hashFile = async (file) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(file)))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
let browser;
let expectedId;

async function installFiles(source, version) {
  try {
    await Deno.remove(extensionPath, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await copy(source, extensionPath);
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  manifest.version = version;
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

async function closeBrowser() {
  if (!browser) return;
  const current = browser;
  browser = null;
  const process = current.process();
  assert(process?.pid, "缺少本次合成浏览器进程身份");
  const exited = new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) resolve();
    else process.once("exit", resolve);
  });
  await current.close();
  let timer;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        timer = setTimeout(() => reject(new Error("合成浏览器未完全退出")), 5000)
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function disableOldExtension(id) {
  const page = await browser.newPage();
  try {
    await page.goto("chrome://extensions/");
    await page.waitForFunction(
      (extensionId) => {
        const list = document.querySelector("extensions-manager")?.shadowRoot
          ?.querySelector("extensions-item-list");
        const item = [...(list?.shadowRoot?.querySelectorAll("extensions-item") || [])]
          .find((entry) => entry.data?.id === extensionId);
        return item?.shadowRoot?.querySelector("#enableToggle")?.checked === true;
      },
      { polling: 50, timeout: 10000 },
      id,
    );
    await page.evaluate((extensionId) => {
      const list = document.querySelector("extensions-manager").shadowRoot.querySelector(
        "extensions-item-list",
      );
      const item = [...list.shadowRoot.querySelectorAll("extensions-item")]
        .find((entry) => entry.data?.id === extensionId);
      item.shadowRoot.querySelector("#enableToggle").click();
    }, id);
    await page.waitForFunction(
      (extensionId) => {
        const list = document.querySelector("extensions-manager")?.shadowRoot
          ?.querySelector("extensions-item-list");
        const item = [...(list?.shadowRoot?.querySelectorAll("extensions-item") || [])]
          .find((entry) => entry.data?.id === extensionId);
        return item?.data?.state === "DISABLED";
      },
      { polling: 50, timeout: 10000 },
      id,
    );
  } finally {
    await page.close();
  }
}

async function start(source, version, profile, label) {
  await installFiles(source, version);
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: profile,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
    ],
  });
  // 用原生安装接口更新同路径扩展，避免 Chrome 沿用上次后台脚本缓存。
  const client = await browser.target().createCDPSession();
  let installed;
  try {
    installed = await client.send("Extensions.loadUnpacked", { path: extensionPath });
  } finally {
    await client.detach();
  }
  const target = await browser.waitForTarget((item) =>
    item.type() === "service_worker" &&
    item.url() === `chrome-extension://${installed.id}/background_scripts/main.js`
  );
  const id = new URL(target.url()).host;
  assert(!expectedId || id === expectedId, "固定路径升级改变了扩展 ID");
  expectedId = id;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50, timeout: 15000 },
  );
  const worker = await target.worker();
  const info = await worker.evaluate(() => ({
    version: chrome.runtime.getManifest().version,
    sampleBytes: BrowserToolboxConfigurationStore.itemBytes("sample", "<"),
    writerReady: !!globalThis.BrowserToolboxConfigurationWriterInstance,
  }));
  report.browsers.push({
    label,
    version,
    extensionId: id,
    chrome: await browser.version(),
    ...info,
  });
  assert(info.version === version && info.writerReady, `${label} 后台版本未就绪`);
  assert(
    info.sampleBytes === (source === oldBuild ? 9 : 14),
    `${label} 使用了错误的计量实现：${info.sampleBytes}`,
  );
  return worker;
}

async function prepareOldBoundary(worker, { interrupted }) {
  return await worker.evaluate(async (interrupted) => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    const css = "/*" + "<".repeat(1200) + "*/";
    await writer.read();
    if (!interrupted) {
      const result = await writer.commit({
        legacyPatch: { userDefinedLinkHintCss: css, keyMappings: "", smoothScroll: false },
      });
      const local = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
      const index = local[store.KEYS.index];
      const names = index.fields.userDefinedLinkHintCss.chunks;
      const data = await chrome.storage.local.get(names);
      const bytes = await chrome.storage.local.getBytesInUse(names[0]);
      if (
        local[store.KEYS.state].phase !== "COMMITTED" || names.length !== 1 ||
        store.itemBytes(names[0], data[names[0]]) > store.MAX_CHUNK_BYTES ||
        bytes <= store.MAX_CHUNK_BYTES
      ) throw new Error("旧版未正常生成边界分片");
      return {
        revision: result.revision,
        phase: local[store.KEYS.state].phase,
        chunks: names.length,
        actualBytes: bytes,
      };
    }
    const before = await writer.read();
    writer.afterStep = (position, state) => {
      const step = state.steps[position];
      if (
        step.area === "local" &&
        Object.keys(step.cells).some((key) => key.startsWith(store.CHUNK_PREFIX))
      ) {
        globalThis.__browserToolboxBoundaryBarrier = { position, revision: state.revision };
        return new Promise(() => {});
      }
    };
    globalThis.__browserToolboxBoundaryPending = writer.commit({
      legacyPatch: { userDefinedLinkHintCss: css, keyMappings: "", smoothScroll: false },
    }).catch(() => {});
    return { previousRevision: before.revision, started: true };
  }, interrupted);
}

async function waitForInterruptedChunk(worker) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await worker.evaluate(async () => {
      const barrier = globalThis.__browserToolboxBoundaryBarrier;
      if (!barrier) return null;
      const store = BrowserToolboxConfigurationStore;
      const local = await chrome.storage.local.get([store.KEYS.state, store.KEYS.index]);
      const state = local[store.KEYS.state];
      const names = state.afterIndex.fields.userDefinedLinkHintCss.chunks;
      const data = await chrome.storage.local.get(names);
      const bytes = await chrome.storage.local.getBytesInUse(names[0]);
      return {
        phase: state.phase,
        revision: state.revision,
        completedSteps: state.completedSteps,
        chunks: names.length,
        actualBytes: bytes,
        oldCalculatedBytes: store.itemBytes(names[0], data[names[0]]),
        oldLimit: store.MAX_CHUNK_BYTES,
        currentIndexIsBefore:
          JSON.stringify(local[store.KEYS.index]) === JSON.stringify(state.beforeIndex),
      };
    });
    if (result) {
      assert(
        result.phase === "APPLYING" && result.chunks === 1 && result.currentIndexIsBefore &&
          result.oldCalculatedBytes <= result.oldLimit && result.actualBytes > result.oldLimit,
        "旧版本中断位置或边界分片不符",
      );
      return result;
    }
    await wait(30);
  }
  throw new Error("旧版本未到达持久分片后的中断点");
}

async function inspectNew(worker, expectedRevision, scenario) {
  return await worker.evaluate(async ({ expectedRevision, scenario }) => {
    const writer = globalThis.BrowserToolboxConfigurationWriterInstance;
    const store = BrowserToolboxConfigurationStore;
    const css = "/*" + "<".repeat(1200) + "*/";
    const view = await writer.read();
    const local = await chrome.storage.local.get([
      store.KEYS.state,
      store.KEYS.index,
      store.KEYS.backup,
    ]);
    const state = local[store.KEYS.state];
    const index = local[store.KEYS.index];
    if (
      state.phase !== "COMMITTED" || state.code || view.revision !== expectedRevision ||
      view.keyboard.userDefinedLinkHintCss !== css || view.keyboard.keyMappings !== "" ||
      view.keyboard.smoothScroll !== false || !local[store.KEYS.backup]
    ) {
      throw new Error(`${scenario} 新版读取或持久恢复不符`);
    }
    const previousChunks = index.fields.userDefinedLinkHintCss.chunks.length;
    const plan = await writer.prepareKeyboardSyncMigration();
    if (previousChunks !== 1 || plan.index.fields.userDefinedLinkHintCss.chunks.length < 2) {
      throw new Error(`${scenario} 未兼容旧分片并按新规则重切`);
    }
    const next = await writer.commit({ legacyPatch: { scrollStepSize: 83 } });
    const rolled = await writer.rollback();
    const sync = await chrome.storage.sync.get([
      "scrollStepSize",
      "keyMappings",
      "smoothScroll",
      "userDefinedLinkHintCss",
    ]);
    if (
      rolled.revision <= next.revision || rolled.keyboard.scrollStepSize !== 83 ||
      rolled.keyboard.userDefinedLinkHintCss !== css || sync.scrollStepSize !== 83 ||
      sync.keyMappings !== "" || sync.smoothScroll !== false || sync.userDefinedLinkHintCss !== css
    ) {
      throw new Error(`${scenario} 新版修改或兼容回退丢失`);
    }
    return {
      phase: state.phase,
      recoveredRevision: view.revision,
      previousChunks,
      plannedChunks: plan.index.fields.userDefinedLinkHintCss.chunks.length,
      laterRevision: rolled.revision,
    };
  }, { expectedRevision, scenario });
}

try {
  const files = [
    "background_scripts/browser_toolbox/configuration_writer.js",
    "background_scripts/browser_toolbox/settings_storage.js",
  ];
  report.builds = [];
  for (const source of [oldBuild, newBuild]) {
    const hashes = {};
    for (const file of files) hashes[file] = await hashFile(path.join(source, file));
    report.builds.push({ role: source === oldBuild ? "old" : "new", hashes });
  }
  for (const file of files) {
    assert(
      report.builds[1].hashes[file] === await hashFile(path.join(Deno.cwd(), file)),
      `新版不是当前源码：${file}`,
    );
    assert(
      report.builds[0].hashes[file] !== report.builds[1].hashes[file],
      `新旧版本缺少目标差异：${file}`,
    );
  }
  for (const scenario of ["正常退出", "分片后中断"]) {
    const profile = path.join(
      temporary,
      scenario === "正常退出" ? "profile-clean" : "profile-interrupted",
    );
    const oldWorker = await start(oldBuild, "0.1.31", profile, `${scenario}旧版`);
    const seed = await prepareOldBoundary(oldWorker, { interrupted: scenario !== "正常退出" });
    const oldResult = scenario === "正常退出" ? seed : await waitForInterruptedChunk(oldWorker);
    await disableOldExtension(expectedId);
    await closeBrowser();
    const newWorker = await start(newBuild, "0.1.32", profile, `${scenario}新版`);
    const result = await inspectNew(newWorker, oldResult.revision, scenario);
    report.checks.push({ name: scenario, old: oldResult, current: result, status: "passed" });
    console.log(`旧分片升级通过：${scenario}`);
    await closeBrowser();
  }
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
