// SPDX-License-Identifier: GPL-3.0-or-later
// 同一合成 profile、同一加载路径和固定 ID 连续升级；只报告版本、字段名、容量及结果。
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";
import { copy } from "@std/fs";
import { readManifest } from "./release_artifacts.js";

const root = path.resolve(path.dirname(path.fromFileUrl(import.meta.url)), "..");
const current = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  path.join(root, "dist/browser-toolbox");
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const folder = await Deno.makeTempDir({ prefix: "browser-toolbox-config-upgrade-" });
const legacy = path.join(folder, "legacy");
const extensionPath = path.join(folder, "fixed-extension");
const profile = path.join(folder, "synthetic-profile");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_CONFIGURATION_REPORT");
const report = {
  status: "running",
  startedAt: new Date().toISOString(),
  checks: [],
  versions: [],
  source: "synthetic",
};
const contracts = JSON.parse(
  await Deno.readTextFile(path.join(root, "tests/fixtures/runtime_compat_contracts.json")),
);
await Deno.mkdir(legacy);
async function run(command, args) {
  const result = await new Deno.Command(command, {
    args,
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(`基线准备失败：${command}`);
}
await run("git", [
  "archive",
  "--format=tar",
  `--output=${path.join(folder, "legacy.tar")}`,
  contracts.baselineCommit,
]);
await run("tar", ["-xf", path.join(folder, "legacy.tar"), "-C", legacy]);
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () =>
  new Response(
    '<!doctype html><html lang="zh-CN"><body style="min-height:10000px"><h1>配置迁移合成页</h1><input id="input"><a href="#target">合成链接</a></body></html>',
    { headers: { "content-type": "text/html; charset=utf-8" } },
  ));
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/fixture`;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settleWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => timer = setTimeout(() => resolve(false), timeoutMs)),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function closeSyntheticBrowser() {
  const process = browser.process();
  assert(process?.pid, "测试清理缺少本次启动的浏览器进程");
  const startedAt = performance.now();
  const exited = new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) resolve();
    else process.once("exit", resolve);
  });
  const closing = browser.close();
  const cleanup = { graceful: true, signals: [] };
  if (!await settleWithin(closing, 5000)) {
    // 断言已结束；仅终止本次 launch 返回的合成进程，避免退出挂起占用后续门禁。
    cleanup.graceful = false;
    if (process.exitCode === null && process.signalCode === null) {
      cleanup.signals.push("SIGTERM");
      process.kill("SIGTERM");
    }
    if (!await settleWithin(exited, 2000)) {
      cleanup.signals.push("SIGKILL");
      process.kill("SIGKILL");
      assert(await settleWithin(exited, 3000), "本次合成浏览器进程未能退出");
    }
    browser.disconnect();
    await settleWithin(closing, 2000);
  }
  assert(process.exitCode !== null || process.signalCode !== null, "合成浏览器退出未获证实");
  cleanup.elapsedMs = performance.now() - startedAt;
  console.log(`配置测试浏览器清理：${cleanup.graceful ? "正常退出" : cleanup.signals.join("/")}`);
  return cleanup;
}
async function until(test, message) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(25);
  }
  throw new Error(message);
}
const check = (name, detail = {}) => {
  report.checks.push({ name, status: "passed", ...detail });
  console.log(`配置验收通过：${name}`);
};
const trace = (step) => {
  report.currentStep = step;
  console.log(`配置验收步骤：${step}`);
};
let browser;
let options;
let fixture;
let id;
async function installFiles(source, version) {
  await copy(source, extensionPath, { overwrite: true });
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = await readManifest(extensionPath);
  manifest.version = version;
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
}
async function ready(version) {
  const target = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
  );
  const nextId = target.url().split("/")[2];
  assert(!id || id === nextId, "连续升级的扩展 ID 发生变化");
  id = nextId;
  options = await browser.newPage();
  await until(async () => {
    try {
      await options.goto(`chrome-extension://${id}/pages/mouse_options.html#general`, {
        waitUntil: "load",
      });
      return true;
    } catch (error) {
      if (!/ERR_BLOCKED_BY_CLIENT/.test(error.message)) throw error;
      return false;
    }
  }, "重载后的扩展页面持续被阻止");
  await options.bringToFront();
  try {
    await options.waitForFunction(
      () => document.querySelector("main")?.dataset.settingsReady === "true",
      { polling: 50 },
    );
  } catch (failure) {
    report.readiness = await options.evaluate(async () => {
      const local = await chrome.storage.local.get([
        "browserToolboxKeyboardMigrationState",
        "browserToolboxKeyboardSettings",
      ]);
      const state = local.browserToolboxKeyboardMigrationState;
      return {
        error: document.querySelector("#settings-error")?.textContent,
        hasSettings: Settings.isLoaded(),
        pageReady: document.querySelector("main")?.dataset.settingsReady,
        visibility: document.visibilityState,
        state: state?.phase,
        code: state?.code,
        revision: state?.committedIndex?.revision,
        formatVersion: local.browserToolboxKeyboardSettings?.formatVersion,
        repositoryLoaded: !!BrowserToolboxSettingsRepositoryInstance.settings,
        repositoryLoading: !!BrowserToolboxSettingsRepositoryInstance.loadingPromise,
        repositoryArea: BrowserToolboxSettingsRepositoryInstance.storageArea,
        minimumRevision: BrowserToolboxConfigurationClientInstance.minimumRevision,
      };
    });
    const rootClient = await browser.target().createCDPSession();
    const targets = (await rootClient.send("Target.getTargets")).targetInfos;
    const info = targets.find((item) => item.type === "service_worker" && item.url.includes(id));
    const target = browser.targets().find((item) => item._targetId === info?.targetId);
    if (target) {
      const client = await target.createCDPSession();
      const result = await client.send("Runtime.evaluate", {
        returnByValue: true,
        expression:
          "({busy:BrowserToolboxConfigurationWriterInstance.busy,dirty:BrowserToolboxConfigurationWriterInstance.dirty,revision:BrowserToolboxConfigurationWriterInstance.lastSnapshot?.revision,loaded:Settings.isLoaded(),repositoryLoaded:!!BrowserToolboxSettingsRepositoryInstance.settings,repositoryLoading:!!BrowserToolboxSettingsRepositoryInstance.loadingPromise})",
      });
      report.backgroundReadiness = result.result.value;
      await client.detach();
    }
    await rootClient.detach();
    throw failure;
  }
  const actual = await options.evaluate(() => chrome.runtime.getManifest().version);
  assert(actual === version, "加载版本与演练版本不符");
  report.versions.push({ version, extensionId: id });
}
async function upgrade(source, version) {
  await installFiles(source, version);
  await options.evaluate(() => chrome.runtime.reload()).catch((error) => {
    if (!/context|Target closed|Session closed/i.test(error.message)) throw error;
  });
  await sleep(250);
  await ready(version);
}
async function read() {
  return options.evaluate(() => BrowserToolboxConfigurationClientInstance.read());
}
async function request(action, input = {}) {
  return options.evaluate(
    ({ action, input }) => BrowserToolboxConfigurationClientInstance.request(action, input),
    { action, input },
  );
}
async function importFile(payload) {
  const file = path.join(folder, `fixture-${crypto.randomUUID()}.json`);
  await Deno.writeTextFile(file, JSON.stringify(payload));
  await options.$eval("button[data-section='backupAbout']", (element) => element.click());
  await options.waitForFunction(() =>
    !document.querySelector("#import-settings").disabled &&
    document.querySelector("main").getAttribute("aria-busy") !== "true"
  );
  await (await options.$("#import-settings")).uploadFile(file);
  try {
    await options.waitForSelector("#import-preview-dialog[open]");
  } catch (failure) {
    report.importFailure = await options.evaluate(() => ({
      error: document.querySelector("#settings-error")?.textContent,
      busy: document.querySelector("main")?.getAttribute("aria-busy"),
      inputDisabled: document.querySelector("#import-settings")?.disabled,
      fileCount: document.querySelector("#import-settings")?.files?.length,
    }));
    throw failure;
  }
  await options.click("#import-preview-confirm");
  await options.waitForFunction(() =>
    document.querySelector("main").getAttribute("aria-busy") !== "true"
  );
  const failure = await options.$eval("#settings-error", (element) => element.textContent);
  assert(!failure || /Ignored fields|忽略字段/.test(failure), "配置导入未成功");
}
try {
  await installFiles(legacy, "1.3.0");
  browser = await puppeteer.launch({
    executablePath,
    protocolTimeout: 20000,
    headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false",
    userDataDir: profile,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ],
  });
  report.browser = await browser.version();
  const extensionManager = await browser.newPage();
  await extensionManager.goto("chrome://extensions/");
  await extensionManager.waitForFunction(() =>
    document.querySelector("extensions-manager")?.shadowRoot
      ?.querySelector("extensions-toolbar")?.shadowRoot?.querySelector("#devMode")
  );
  report.developerModeInitiallyEnabled = await extensionManager.evaluate(() => {
    const toggle = document.querySelector("extensions-manager").shadowRoot
      .querySelector("extensions-toolbar").shadowRoot.querySelector("#devMode");
    const initial = toggle.checked;
    if (!initial) toggle.click();
    return initial;
  });
  await extensionManager.close();
  await ready("1.3.0");
  fixture = await browser.newPage();
  await fixture.goto(fixtureUrl);
  const css = `div > .vimiumHintMarker span { color: rgb(17, 34, 51); }/*${"合成".repeat(995)}*/`;
  await options.evaluate(async (css) => {
    const toolbox = BrowserToolboxSettingsSchema.mergeSettings();
    toolbox.keyboard.keyMappings = "陈旧副本";
    toolbox.searchEngines = "陈旧搜索";
    await chrome.storage.sync.set({
      settingsVersion: "2.4.2",
      keyMappings: "",
      searchEngines: "",
      exclusionRules: [],
      smoothScroll: false,
      userDefinedLinkHintCss: css,
      browserToolboxSettings: toolbox,
      unknownSecret: "合成秘密",
    });
    await chrome.storage.local.set({
      "vimiumGlobalMark|Q": { url: "https://example.invalid/synthetic", scrollX: 0, scrollY: 2 },
    });
  }, css);
  await upgrade(current, "1.3.1");
  let saved = await read();
  assert(
    saved.keyboard.keyMappings === "" && saved.keyboard.searchEngines === "" &&
      saved.keyboard.exclusionRules.length === 0,
    "旧有效空值被工具箱副本覆盖",
  );
  assert(saved.keyboard.userDefinedLinkHintCss === css, "迁移损失 CSS 原文");
  const bytes = await options.evaluate(async () => ({
    item: await chrome.storage.sync.getBytesInUse("browserToolboxSettings"),
    keyboard: await chrome.storage.sync.getBytesInUse("userDefinedLinkHintCss"),
  }));
  assert(bytes.item <= 8192 && bytes.keyboard <= 8192, "分域物理存储超过单项配额");
  const privateState = await options.evaluate(async () => {
    const local = await chrome.storage.local.get([
      "browserToolboxKeyboardMigrationBackup",
      "vimiumGlobalMark|Q",
    ]);
    return {
      markKept: !!local["vimiumGlobalMark|Q"],
      privateBackup:
        JSON.stringify(local.browserToolboxKeyboardMigrationBackup).includes("合成秘密") ||
        JSON.stringify(local.browserToolboxKeyboardMigrationBackup).includes("example.invalid"),
    };
  });
  assert(
    privateState.markKept && !privateState.privateBackup,
    "配置备份包含会话/Mark/未知同步正文",
  );
  check("固定 ID 旧版升级、有效空值、CSS 分域容量和配置白名单", bytes);

  await importFile({
    // Vimium 导出的备份包含 settingsVersion；无版本原始存储字符串采用另一套编码。
    settingsVersion: "2.4.2",
    keyMappings: "map x scrollDown",
    searchUrl: "https://example.invalid/search?q=",
    grabBackFocus: true,
    helpDialog_showAdvancedCommands: true,
    ignoreKeyboardLayout: false,
    unknownField: true,
  });
  saved = await read();
  assert(
    saved.keyboard.keyMappings === "map x scrollDown" && saved.keyboard.grabBackFocus &&
      saved.keyboard.helpDialog_showAdvancedCommands &&
      saved.keyboard.searchUrl.startsWith("https://example.invalid/"),
    "旧 Vimium JSON 字段丢失",
  );
  const logical = await options.evaluate(async () => {
    const view = await BrowserToolboxConfigurationClientInstance.read();
    const toolbox = BrowserToolboxSettingsApplicationService.composeSettings(
      view.toolboxSource.value,
      view.keyboard,
    );
    return BrowserToolboxSettingsMigrations.createExportPayload(toolbox, {
      keyboardSettings: view.keyboard,
    });
  });
  assert(
    Object.keys(logical.keyboardSettings.values).length === 21,
    "逻辑导出未包含全部键盘配置字段",
  );
  await request("commit", { legacyPatch: { keyMappings: "map y scrollUp", grabBackFocus: false } });
  await options.reload();
  await options.waitForFunction(() =>
    document.querySelector("main")?.dataset.settingsReady === "true"
  );
  await importFile(logical);
  const restored = await read();
  assert(
    restored.keyboard.keyMappings === saved.keyboard.keyMappings &&
      restored.keyboard.grabBackFocus === saved.keyboard.grabBackFocus,
    "新逻辑导出再导入丢失最新配置",
  );
  check("旧 Vimium JSON、21 字段逻辑导出和新配置 UI 往返");

  const stale = restored;
  const second = await browser.newPage();
  await second.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await second.waitForFunction(() =>
    document.querySelector("main")?.dataset.settingsReady === "true"
  );
  await second.evaluate(
    ({ baseline }) =>
      BrowserToolboxConfigurationClientInstance.commit({
        legacyPatch: { scrollStepSize: 83 },
        baseline,
      }),
    { baseline: { keyboard: stale.keyboard } },
  );
  const merged = await request("commit", {
    legacyPatch: { keyMappings: "map z scrollUp" },
    baseline: { keyboard: stale.keyboard },
  });
  assert(
    merged.keyboard.scrollStepSize === 83 && merged.keyboard.keyMappings === "map z scrollUp",
    "两页面修改不同字段未保留双方",
  );
  const conflict = await second.evaluate(async ({ baseline }) => {
    try {
      await BrowserToolboxConfigurationClientInstance.commit({
        legacyPatch: { keyMappings: "map z scrollDown" },
        baseline,
      });
      return false;
    } catch (error) {
      return error.code === "browser-toolbox-settings-conflict";
    }
  }, { baseline: { keyboard: stale.keyboard } });
  assert(conflict, "两个页面修改同一字段未提示冲突");
  await second.close();
  check("实际两个设置页面字段合并与同字段冲突");

  report.currentStep = "选择当前后台";
  const browserClient = await browser.target().createCDPSession();
  const active = (await browserClient.send("Target.getTargets")).targetInfos.filter((target) =>
    target.type === "service_worker" &&
    target.url === `chrome-extension://${id}/background_scripts/main.js`
  );
  const activeTarget = active.at(-1);
  assert(activeTarget, "当前版本没有活动后台");
  const workerTarget = browser.targets().find((target) =>
    target._targetId === activeTarget.targetId
  );
  const workerClient = await workerTarget.createCDPSession();
  report.currentStep = "安装合成中断点";
  await workerClient.send("Runtime.evaluate", {
    expression:
      "globalThis.BrowserToolboxConfigurationWriterInstance.afterStep = async (position) => { if (position === 0) await new Promise(() => {}); };",
  });
  const pending = request("commit", {
    legacyPatch: {
      keyMappings: "map latest scrollDown",
      searchEngines: "s: https://example.invalid/?q=%s 合成",
    },
  }).catch(() => null);
  report.currentStep = "等待业务落盘";
  await until(
    () =>
      options.evaluate(async () => {
        const state = (await chrome.storage.local.get("browserToolboxKeyboardMigrationState"))
          .browserToolboxKeyboardMigrationState;
        return state?.phase === "APPLYING" && state.completedSteps === 1;
      }),
    "未进入真实持久 APPLYING 状态",
  );
  const interrupted = await options.evaluate(async () => {
    const state = (await chrome.storage.local.get("browserToolboxKeyboardMigrationState"))
      .browserToolboxKeyboardMigrationState;
    return {
      revision: state.revision,
      operationId: state.operationId,
      completedSteps: state.completedSteps,
    };
  });
  assert(interrupted.completedSteps === 1, "后台中断不在已落盘步骤之后");
  report.currentStep = "终止已落盘后台";
  await workerClient.detach();
  assert(
    (await browserClient.send("Target.closeTarget", { targetId: activeTarget.targetId })).success,
    "未实际终止后台",
  );
  await browserClient.detach();
  report.currentStep = "全新后台恢复";
  saved = await read();
  assert(
    saved.revision === interrupted.revision &&
      saved.keyboard.keyMappings === "map latest scrollDown",
    "全新后台没有完成原持久提交",
  );
  const recovered = await request("preview");
  assert(recovered.phase === "COMMITTED" && !recovered.code, "后台恢复未完成或有冲突");
  await Promise.race([pending, sleep(2000)]);
  check("真实终止服务工作线程后完成原提交，不重复 revision", {
    revision: saved.revision,
    completedStepsAtStop: 1,
  });

  await request("rollback");
  await upgrade(legacy, "1.3.2");
  const downgraded = await options.evaluate(async () => {
    await Settings.load();
    return {
      keyMappings: Settings.get("keyMappings"),
      searchEngines: Settings.get("searchEngines"),
      userDefinedLinkHintCss: Settings.get("userDefinedLinkHintCss"),
    };
  });
  assert(
    downgraded.keyMappings === saved.keyboard.keyMappings &&
      downgraded.searchEngines === saved.keyboard.searchEngines &&
      downgraded.userDefinedLinkHintCss === css,
    "回退到旧代码后丢失迁移后的新增修改",
  );
  await fixture.focus("#input");
  await fixture.keyboard.type("native-input");
  assert(
    await fixture.$eval("#input", (element) => element.value) === "native-input",
    "保留旧页面时原生输入不可用",
  );
  await upgrade(current, "1.3.3");
  const reupgraded = await read();
  assert(
    reupgraded.keyboard.keyMappings === saved.keyboard.keyMappings &&
      reupgraded.keyboard.searchEngines === saved.keyboard.searchEngines &&
      reupgraded.keyboard.userDefinedLinkHintCss === css,
    "再次升级损失最新配置",
  );
  const toolbox = reupgraded.toolboxSource.value;
  toolbox.general.browserSyncEnabled = false;
  await request("commit", { toolbox });
  const switchState = await options.evaluate(async () => ({
    local:
      (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings?.general
        .browserSyncEnabled === false,
    syncAbsent: !(await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
    keyboardSync: (await chrome.storage.sync.get("keyMappings")).keyMappings,
  }));
  assert(
    switchState.local && switchState.syncAbsent &&
      switchState.keyboardSync === saved.keyboard.keyMappings,
    "工具箱同步开关改变键盘同步语义",
  );
  check("同 ID 递增版本回退、未刷新页面输入、重新升级和同步开关", {
    latestRevision: reupgraded.revision,
  });
  await fixture.reload();
  await fixture.bringToFront();
  await until(() =>
    options.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      const states = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: "ISOLATED",
        func: () => ({
          active:
            BrowserToolboxRuntimeHostInstance?.getDiagnostics().initializationState === "active",
          mode: Boolean(Mode.modes.find((mode) => mode.name === "normal")?.keyMapping?.m),
        }),
      });
      return states[0]?.result.active && states[0].result.mode;
    }, fixtureUrl), "Mark 验收页面运行时未完成初始化");
  await fixture.evaluate(() => scrollTo(0, 420));
  await fixture.keyboard.type("m");
  await fixture.keyboard.down("Shift");
  await fixture.keyboard.press("Q");
  await fixture.keyboard.up("Shift");
  await until(
    () =>
      options.evaluate(async () =>
        (await chrome.storage.local.get("vimiumGlobalMark|Q"))["vimiumGlobalMark|Q"]?.scrollY ===
          420
      ),
    "旧兼容引擎未实际创建合成 Mark",
  );
  const restartSnapshot = await read();
  await browser.close();
  browser = await puppeteer.launch({
    executablePath,
    protocolTimeout: 20000,
    headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false",
    userDataDir: profile,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ],
  });
  await ready("1.3.3");
  const restarted = await read();
  assert(
    JSON.stringify(restarted.keyboard) === JSON.stringify(restartSnapshot.keyboard),
    "浏览器重启丢失已提交配置",
  );
  const mark = await options.evaluate(async () =>
    (await chrome.storage.local.get("vimiumGlobalMark|Q"))["vimiumGlobalMark|Q"]
  );
  assert(mark?.url === fixtureUrl && mark.scrollY === 420, "浏览器重启丢失 Mark 位置");
  fixture = await browser.newPage();
  await fixture.goto(fixtureUrl);
  await fixture.bringToFront();
  await fixture.click("h1");
  await until(() =>
    options.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
      if (!tab?.id) return false;
      const states = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: "ISOLATED",
        func: () => {
          const diagnostics = BrowserToolboxRuntimeHostInstance?.getDiagnostics();
          // activation 后仍需等待 frame-handshake 应用键位映射，否则 normal 模式尚未绑定反引号命令。
          return diagnostics?.initializationState === "active" &&
            diagnostics?.initializationStage === "ready" &&
            Boolean(Mode.modes.find((mode) => mode.name === "normal")?.keyMapping?.["`"]);
        },
      });
      return states[0]?.result === true;
    }, fixtureUrl), "重启后的运行时未完成初始化");
  await fixture.keyboard.type("`");
  await fixture.keyboard.down("Shift");
  await fixture.keyboard.press("Q");
  await fixture.keyboard.up("Shift");
  await until(async () => {
    const pages = await browser.pages();
    for (const page of pages.filter((page) => page.url() === fixtureUrl)) {
      if (await page.evaluate(() => Math.abs(scrollY - 420) < 2)) return true;
    }
    return false;
  }, "重启后 Mark 未实际定位到合成页面");
  check("同 profile 浏览器重启保留配置，旧 Mark 实际定位");
  // 后续冲突场景故意保留阻塞状态；不能为了继续测试伪造解锁或改写事务记录。
  trace("读取已提交配置");
  const committedBeforeConflict = await read();
  trace("写入合成外部变化");
  await options.evaluate(() =>
    chrome.storage.sync.set({
      keyMappings: "map external scrollDown",
      syntheticUnrelated: "不应导出的合成值",
    })
  );
  const beforeResolution = await read();
  assert(
    beforeResolution.keyboard.keyMappings === committedBeforeConflict.keyboard.keyMappings,
    "外部旧设备写入立即覆盖了完整有效配置",
  );
  trace("重载维护页面");
  await options.reload();
  await options.bringToFront();
  await options.waitForFunction(() =>
    document.querySelector("main")?.dataset.settingsReady === "true"
  );
  await options.$eval("#runtime-maintenance", (element) => element.open = true);
  await options.$eval("button[data-section='general']", (element) => element.click());
  trace("检查配置冲突");
  await options.$eval(
    "#configuration-inspect",
    (element) => element.scrollIntoView({ block: "center" }),
  );
  await options.click("#configuration-inspect");
  await options.waitForFunction(() =>
    !document.querySelector("#configuration-inspect").disabled &&
    !document.querySelector("#configuration-export-conflict").hidden
  );
  assert(
    await options.$eval("#configuration-conflict-export-note", (element) => !element.hidden) &&
      !await options.$("#configuration-incoming") && !await options.$("#configuration-committed"),
    "存在冲突时仍显示不安全的写入选择或缺少导出范围说明",
  );
  const beforeConflictExport = await options.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
  }));
  trace("检查冲突选择被拒绝");
  const blocked = await options.evaluate(async () => {
    const result = [];
    for (const choice of ["incoming", "committed"]) {
      try {
        await BrowserToolboxConfigurationClientInstance.request("resolve", { choice });
        result.push("unexpected-success");
      } catch (failure) {
        result.push(failure.code);
      }
    }
    return result;
  });
  assert(
    blocked.every((code) => code === "CONFIGURATION_CONFLICT_REVIEW_REQUIRED"),
    "冲突选择没有停止写入",
  );
  const conflictClient = await options.target().createCDPSession();
  await conflictClient.send("Browser.setDownloadBehavior", { behavior: "deny" });
  await options.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      globalThis.syntheticConflictExport = blob.text();
      return create(blob);
    };
  });
  await options.$eval(
    "#configuration-export-conflict",
    (element) => element.scrollIntoView({ block: "center" }),
  );
  trace("导出冲突观察");
  await options.click("#configuration-export-conflict");
  await options.waitForFunction(() => !!globalThis.syntheticConflictExport);
  const observation = await options.evaluate(async () =>
    JSON.parse(await globalThis.syntheticConflictExport)
  );
  const afterConflictExport = await options.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
  }));
  assert(
    observation.committed.keyboard.keyMappings === committedBeforeConflict.keyboard.keyMappings &&
      observation.observed.sync.keyMappings === "map external scrollDown" &&
      observation.writeAllowed === false && observation.releaseAllowed === false &&
      observation.lineageVerified === false && observation.pointInTimeVerified === false &&
      observation.includesSeparateLocalCursorAssets === false &&
      observation.includesUnknownTopLevelSyncKeys === false &&
      observation.restorableAsSettings === false &&
      !JSON.stringify(observation).includes("不应导出的合成值"),
    "导出没有清楚保留双方已知配置及限制",
  );
  assert(
    JSON.stringify(beforeConflictExport) === JSON.stringify(afterConflictExport),
    "冲突选择或观察导出修改了原存储",
  );
  trace("复核首份本机观察并保存较新值");
  await options.evaluate(() => chrome.storage.sync.set({ keyMappings: "map newer scrollUp" }));
  const localBeforeHistory = await options.evaluate(() => chrome.storage.local.get(null));
  await options.$eval(
    "#conflict-observation-refresh",
    (element) => element.scrollIntoView({ block: "center" }),
  );
  await options.click("#conflict-observation-refresh");
  await options.waitForFunction(() =>
    !document.querySelector("#conflict-observation-export").disabled
  );
  await options.evaluate(() => globalThis.syntheticConflictExport = null);
  await options.click("#conflict-observation-export");
  await options.waitForFunction(() => !!globalThis.syntheticConflictExport);
  const savedObservation = await options.evaluate(async () =>
    JSON.parse(await globalThis.syntheticConflictExport)
  );
  const localAfterHistory = await options.evaluate(() => chrome.storage.local.get(null));
  assert(
    savedObservation.committed.keyboard.keyMappings ===
        committedBeforeConflict.keyboard.keyMappings &&
      savedObservation.observed.keyboard.keyMappings === "map external scrollDown" &&
      savedObservation.lineageVerified === false && savedObservation.releaseAllowed === false &&
      savedObservation.pointInTimeVerified === false &&
      JSON.stringify(localBeforeHistory) === JSON.stringify(localAfterHistory),
    "首份本机观察不完整或导出时改变了本机数据",
  );
  await options.click("#conflict-observation-capture");
  await options.waitForFunction(() =>
    !document.querySelector("#conflict-observation-capture").disabled &&
    document.querySelectorAll('#conflict-observation-select option[data-status="saved"]').length >=
      2
  );
  const capturedValues = await options.evaluate(async () => {
    const client = BrowserToolboxConfigurationClientInstance;
    const records = await client.request("list-conflict-observations");
    return await Promise.all(
      records.filter((item) => item.status === "saved").map(async (item) =>
        (await client.request("export-conflict-observation", { key: item.key })).observed.keyboard
          .keyMappings
      ),
    );
  });
  assert(
    capturedValues.includes("map external scrollDown") &&
      capturedValues.includes("map newer scrollUp") &&
      (await options.evaluate(async () =>
          (await chrome.storage.sync.get("keyMappings")).keyMappings
        )) ===
        "map newer scrollUp",
    "手动保存当前观察时未保留此前观察或外部较新值",
  );
  const beforeSelection = await options.evaluate(() => ({
    dirty: document.querySelector("#dirty-status").textContent,
    saveDisabled: document.querySelector("#save-settings").disabled,
  }));
  const choices = await options.$$eval(
    '#conflict-observation-select option[data-status="saved"]',
    (items) => items.map((item) => item.value),
  );
  await options.select("#conflict-observation-select", choices.at(-1));
  const afterSelection = await options.evaluate(() => ({
    dirty: document.querySelector("#dirty-status").textContent,
    saveDisabled: document.querySelector("#save-settings").disabled,
  }));
  assert(
    JSON.stringify(beforeSelection) === JSON.stringify(afterSelection),
    "选择观察记录意外改变了设置草稿状态",
  );
  const viewport = options.viewport();
  await options.setViewport({ width: 320, height: 720 });
  const narrow = await options.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    labelled: Boolean(document.querySelector('label[for="conflict-observation-select"]')),
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        id: element.id,
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      };
    }).filter((item) => item.right > innerWidth + 1).slice(0, 20),
  }));
  report.observationNarrow = narrow;
  assert(!narrow.overflow && narrow.labelled, "冲突观察在窄屏溢出或缺少标签");
  await options.setViewport(viewport);
  const keyboardPage = await browser.newPage();
  trace("检查冲突观察入口权限");
  await keyboardPage.goto(`chrome-extension://${id}/pages/options.html`);
  const denied = await keyboardPage.evaluate(async () =>
    await Promise.all([
      "export-conflict",
      "list-conflict-observations",
      "export-conflict-observation",
      "capture-conflict-observation",
    ].map((action) =>
      chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action,
        input: {},
      })
    ))
  );
  assert(
    denied.every((result) => result?.code === "PERMISSION_DENIED"),
    "非维护页面可以访问冲突记录",
  );
  await keyboardPage.close();
  await conflictClient.detach();
  check("外部冲突停止写入，维护页只读导出有限观察并保留数据");
  trace("后台不可用时导出");
  const beforeOfflineExport = await read();
  const storageBeforeExport = await options.evaluate(async () => ({
    state: (await chrome.storage.local.get("browserToolboxKeyboardMigrationState"))
      .browserToolboxKeyboardMigrationState,
    bytes: await chrome.storage.local.getBytesInUse(null),
  }));
  await options.evaluateOnNewDocument(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (request, ...rest) =>
      request?.handler === "browserToolbox.configuration"
        ? Promise.reject(new Error("合成后台配置入口不可用"))
        : send(request, ...rest);
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      globalThis.syntheticExport = blob.text();
      return create(blob);
    };
  });
  const downloadClient = await options.target().createCDPSession();
  await downloadClient.send("Browser.setDownloadBehavior", { behavior: "deny" });
  await options.reload();
  await options.bringToFront();
  await options.waitForFunction(() => document.querySelector("#settings-error").textContent, {
    polling: 50,
  });
  assert(
    await options.$eval("main", (element) => element.dataset.settingsReady !== "true"),
    "合成初始化失败未实际触发",
  );
  await options.$eval("#runtime-maintenance", (element) => element.open = true);
  await options.$eval(
    "#configuration-export",
    (element) => element.scrollIntoView({ block: "center" }),
  );
  assert(
    await options.$eval("#configuration-export", (element) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest(
        "button",
      ) === element;
    }),
    "独立导出按钮不可实际点击",
  );
  await options.click("#configuration-export");
  await options.waitForFunction(() => !!globalThis.syntheticExport, { polling: 50 });
  const offlineExport = await options.evaluate(async () =>
    JSON.parse(await globalThis.syntheticExport)
  );
  const storageAfterExport = await options.evaluate(async () => ({
    state: (await chrome.storage.local.get("browserToolboxKeyboardMigrationState"))
      .browserToolboxKeyboardMigrationState,
    bytes: await chrome.storage.local.getBytesInUse(null),
  }));
  assert(Object.keys(offlineExport.keyboardSettings.values).length === 21, "离线导出缺少键盘字段");
  for (const [field, value] of Object.entries(offlineExport.keyboardSettings.values)) {
    assert(
      JSON.stringify(value) === JSON.stringify(beforeOfflineExport.keyboard[field]),
      "离线导出未保持最新提交字段",
    );
  }
  assert(
    JSON.stringify(storageBeforeExport) === JSON.stringify(storageAfterExport),
    "离线导出写入了配置",
  );
  assert(
    !JSON.stringify(offlineExport).includes("unknownSecret") &&
      !JSON.stringify(offlineExport).includes("vimiumGlobalMark"),
    "恢复导出混入配置域以外的数据",
  );
  await downloadClient.detach();
  check("后台配置入口与设置页初始化失败时，实际维护按钮只读导出最新配置", {
    keyboardFields: 21,
    storageUnchanged: true,
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  if (browser) {
    report.syntheticRuntime = await options.evaluate(async (url) => {
      const tabs = (await chrome.tabs.query({})).filter((tab) => tab.url === url);
      return Promise.all(tabs.map(async (tab) => ({
        tabId: tab.id,
        content: (await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [0] },
          world: "ISOLATED",
          func: () => ({
            runtime: globalThis.BrowserToolboxRuntimeHostInstance?.getDiagnostics({
              includeIdentity: true,
            }),
            modes: globalThis.Mode?.modes?.map((mode) => mode.name),
            enabled: isEnabledForUrl,
            markMapping: normalMode?.keyMapping?.["`"],
            scrollY,
            focused: document.activeElement?.tagName,
          }),
        }))[0]?.result,
      })));
    }, fixtureUrl).catch(() => []);
    const diagnostics = await browser.newPage();
    await diagnostics.goto("chrome://extensions/").catch(() => {});
    report.extensionLoad = await diagnostics.evaluate(() => {
      const manager = document.querySelector("extensions-manager");
      const list = manager?.shadowRoot?.querySelector("extensions-item-list");
      return [...(list?.shadowRoot?.querySelectorAll("extensions-item") || [])].map((item) => ({
        id: item.data?.id,
        version: item.data?.version,
        state: item.data?.state,
        disableReasons: item.data?.disableReasons,
        errors: item.data?.manifestErrors?.map((error) => ({ message: error.message })),
      }));
    }).catch(() => []);
  }
  console.error(error);
  Deno.exitCode = 1;
} finally {
  report.assertionsFinishedAt = new Date().toISOString();
  try {
    if (browser) report.cleanup = await closeSyntheticBrowser();
    await server.shutdown();
    await Deno.remove(folder, { recursive: true });
  } catch (error) {
    report.status = "failed";
    report.cleanupError = String(error);
    console.error(error);
    Deno.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
console.log(`配置升级门禁：${report.status}；${report.checks.length} 组`);
