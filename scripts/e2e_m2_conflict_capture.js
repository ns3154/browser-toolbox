// SPDX-License-Identifier: GPL-3.0-or-later
// 使用独立合成配置验证 M2 冲突观察的持久化和后台中断，不访问系统剪贴板。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_M2_CAPTURE_REPORT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-m2-observation-" });
const profile = path.join(temporary, "synthetic-profile");
const output = path.join(temporary, "build");
const extension = path.join(output, "browser-toolbox");
const report = { status: "running", source: "synthetic", checks: [] };
let browser;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, label) => {
  if (!condition) throw new Error(label);
};
const check = (label) => {
  report.checks.push({ name: label, status: "passed" });
  console.log(`冲突观察通过：${label}`);
};
const trace = (label) => {
  report.currentStep = label;
  console.log(`冲突观察步骤：${label}`);
};
async function until(predicate, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await wait(30);
  }
  throw new Error(label);
}
async function launch() {
  return await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 20000,
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
}
async function ready() {
  const workerTarget = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
  );
  const id = new URL(workerTarget.url()).host;
  const worker = await workerTarget.worker();
  await until(
    () => worker.evaluate(() => Boolean(globalThis.BrowserToolboxConfigurationWriterInstance)),
    "后台配置写入器未就绪",
  );
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await page.bringToFront();
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50 },
  );
  return { page, worker, workerTarget, id };
}
async function request(page, action, input = {}) {
  return await page.evaluate(({ action, input }) =>
    chrome.runtime.sendMessage({
      handler: "browserToolbox.configuration",
      action,
      input,
    }), { action, input });
}
try {
  trace("构建并启动独立浏览器");
  await buildArtifacts({ output });
  browser = await launch();
  report.chrome = await browser.version();
  let { page, worker, workerTarget, id } = await ready();
  const base = await request(page, "read");
  assert(base?.ok, "无法读取合成基线");
  const stateBefore = await page.evaluate(async () =>
    (await chrome.storage.local.get("browserToolboxKeyboardMigrationState"))
      .browserToolboxKeyboardMigrationState
  );
  trace("设置后台中断屏障");
  const serviceClient = await page.target().createCDPSession();
  const versions = [];
  serviceClient.on("ServiceWorker.workerVersionUpdated", (event) => {
    for (const version of event.versions) {
      if (version.scriptURL === `chrome-extension://${id}/background_scripts/main.js`) {
        versions.push({ versionId: version.versionId, runningStatus: version.runningStatus });
      }
    }
  });
  await serviceClient.send("ServiceWorker.enable");
  await until(
    () => versions.some((version) => version.runningStatus === "running"),
    "未观察到正在运行的合成后台",
  );
  const versionId = versions.find((version) => version.runningStatus === "running").versionId;
  const workerClient = await workerTarget.createCDPSession();
  await workerClient.send("Runtime.evaluate", {
    expression:
      "globalThis.BrowserToolboxConfigurationWriterInstance.afterStep = async (stage) => { if (stage === 'compatibility-conflict-observation') await new Promise(() => {}); };",
  });
  await page.evaluate(() =>
    chrome.storage.sync.set({
      keyMappings: "map first scrollUp",
      syntheticUnrelated: "synthetic-private-unrelated",
    })
  );
  trace("等待后台感知外部更新");
  await until(
    () => worker.evaluate(() => globalThis.BrowserToolboxConfigurationWriterInstance.dirty),
    "后台未观察到合成同步变化",
  );
  const pending = request(page, "read").catch(() => null);
  const prefix = "browserToolboxKeyboardTransition:m2-observation:";
  trace("等待观察落盘");
  await until(
    () =>
      page.evaluate(
        async (prefix) =>
          (await chrome.storage.local.getKeys()).some((key) => key.startsWith(prefix)),
        prefix,
      ),
    "冲突观察未实际落盘",
  );
  trace("终止合成后台");
  await workerClient.detach();
  const stopAt = versions.length;
  await serviceClient.send("ServiceWorker.stopWorker", { versionId });
  await until(
    () =>
      versions.slice(stopAt).some((version) =>
        version.versionId === versionId && version.runningStatus === "stopped"
      ),
    "未观察到合成后台停止",
  );
  report.backgroundStopped = true;
  trace("写入后到的外部值");
  await page.evaluate(() => chrome.storage.sync.set({ keyMappings: "map newer scrollDown" }));
  await serviceClient.detach();
  trace("重启独立浏览器并检查保护");
  const previousId = id;
  await browser.close();
  browser = await launch();
  ({ page, id } = await ready());
  assert(id === previousId, "重启后合成扩展 ID 变化");
  report.browserRestartedAfterStop = true;
  const preview = await request(page, "preview");
  trace("读取保存的观察");
  assert(
    preview?.ok && preview.value.code === "CONFIGURATION_EXTERNAL_CONFLICT" &&
      preview.value.captureStatus === "saved",
    "重启后台未继续保护已保存观察",
  );
  const listed = await request(page, "list-conflict-observations");
  assert(
    listed.ok && listed.value.length === 1 && listed.value[0].status === "saved",
    "重启后台未发现首份观察",
  );
  const saved = await request(page, "export-conflict-observation", { key: listed.value[0].key });
  assert(
    saved.ok && saved.value.committed.keyboard.keyMappings === base.value.keyboard.keyMappings &&
      saved.value.observed.keyboard.keyMappings === "map first scrollUp" &&
      !JSON.stringify(saved.value).includes("synthetic-private-unrelated") &&
      saved.value.lineageVerified === false && saved.value.pointInTimeVerified === false &&
      saved.value.releaseAllowed === false,
    "观察未保留两边或错误包含无关同步值",
  );
  const stateAfter = await page.evaluate(async () => ({
    state: (await chrome.storage.local.get("browserToolboxKeyboardMigrationState"))
      .browserToolboxKeyboardMigrationState,
    mapping: (await chrome.storage.sync.get("keyMappings")).keyMappings,
  }));
  trace("检查普通提交被阻止");
  assert(
    JSON.stringify(stateAfter.state) === JSON.stringify(stateBefore) &&
      stateAfter.mapping === "map newer scrollDown",
    "中断恢复改写原事务或外部新值",
  );
  assert(
    (await request(page, "commit", { legacyPatch: { smoothScroll: false } })).code ===
      "CONFIGURATION_EXTERNAL_CONFLICT",
    "未解决的观察允许普通提交",
  );
  await Promise.race([pending, wait(1000)]);
  check("观察落盘后停止后台并重启浏览器，保留首份值和后到的外部值");

  await browser.close();
  trace("重启整个浏览器");
  browser = await launch();
  ({ page, id } = await ready());
  const restarted = await request(page, "preview");
  assert(
    restarted.ok && restarted.value.code === "CONFIGURATION_EXTERNAL_CONFLICT" &&
      restarted.value.captureStatus === "saved",
    "浏览器重启丢失冲突保护",
  );
  assert(
    (await request(page, "list-conflict-observations")).value.length === 1,
    "浏览器重启丢失本机观察",
  );
  check("完整浏览器重启后仍可发现观察并阻止写入");

  trace("检查子页面权限");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "synthetic-recovery-frame";
    frame.src = chrome.runtime.getURL("pages/configuration_recovery.html");
    document.body.append(frame);
  });
  const frame = await (await page.$("#synthetic-recovery-frame")).contentFrame();
  await frame.waitForSelector("#recovery-inspect");
  const denied = await frame.evaluate(async () =>
    await Promise.all([
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
  assert(denied.every((item) => item?.code === "PERMISSION_DENIED"), "子页面可访问冲突观察正文");
  await page.$eval("#synthetic-recovery-frame", (element) => element.remove());
  check("扩展子页面不能列出、保存或导出冲突观察");

  trace("验证未知字段保留");
  await page.evaluate(() =>
    chrome.storage.sync.set({
      exclusionRules: [{
        pattern: "https://example.invalid/*",
        passKeys: "",
        future: "synthetic-private",
      }],
    })
  );
  const marker = await request(page, "capture-conflict-observation");
  assert(
    marker.ok && marker.value.status === "unsupported" && marker.value.writeAllowed === false,
    "未知字段未转成不含正文的标记",
  );
  const records = await request(page, "list-conflict-observations");
  assert(records.value.some((item) => item.status === "unsupported"), "未列出未知字段标记");
  const local = await page.evaluate(async (prefix) => {
    const keys = (await chrome.storage.local.getKeys()).filter((key) => key.startsWith(prefix));
    return await chrome.storage.local.get(keys);
  }, prefix);
  assert(!JSON.stringify(local).includes('synthetic-private"'), "未知字段正文被自动保存");
  const current = await page.evaluate(async () =>
    await chrome.storage.sync.get(["keyMappings", "exclusionRules"])
  );
  assert(
    current.keyMappings === "map newer scrollDown" &&
      current.exclusionRules[0].future === "synthetic-private",
    "未知字段或外部新值被改写",
  );
  check("未知字段只保存标记并保留同步原值");
  report.status = "passed";
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
  console.error(failure);
  Deno.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  if (reportPath) await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await Deno.remove(temporary, { recursive: true }).catch(() => {});
}
