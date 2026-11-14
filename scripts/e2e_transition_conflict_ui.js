// SPDX-License-Identifier: GPL-3.0-or-later
// 在禁用同步和外网的独立合成 profile 中验证恢复页只读冲突分类及消息边界。
import * as path from "@std/path";
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildArtifacts } from "./release_artifacts.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_CONFLICT_UI_REPORT");
const screenshotPath = Deno.env.get("BROWSER_TOOLBOX_CONFLICT_UI_SCREENSHOT");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-conflict-ui-" });
const report = { status: "running", source: "synthetic", checks: [], pageErrors: [] };
let browser;

function assert(condition, reason) {
  if (!condition) throw new Error(reason);
}

async function start(extension, scenario) {
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(temporary, `profile-${scenario}`),
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
  const worker = await target.worker();
  const settings = await browser.newPage();
  await settings.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await settings.bringToFront();
  try {
    await settings.waitForFunction(
      () => document.querySelector("main")?.dataset.settingsReady === "true",
      { polling: 50, timeout: 20000 },
    );
  } catch (failure) {
    report.initialization = await settings.evaluate(() => ({
      ready: document.querySelector("main")?.dataset.settingsReady || null,
      hasError: Boolean(document.querySelector("#settings-error")?.textContent),
      visibility: document.visibilityState,
    }));
    throw failure;
  }
  return { id, worker, settings };
}

try {
  const output = path.join(temporary, "build");
  await buildArtifacts({ output });
  const extension = path.join(output, "browser-toolbox");
  await Deno.writeTextFile(
    path.join(extension, "background_scripts/main.js"),
    `
import { LegacyRollbackTransaction as TestRollback } from "./browser_toolbox/legacy_rollback_transaction.js";
import { KeyboardSyncPublisher as TestPublisher } from "./browser_toolbox/keyboard_sync_publisher.js";
globalThis.__testTransitionConstructors = { TestRollback, TestPublisher };
`,
    { append: true },
  );

  for (const scenario of ["rollback", "sync"]) {
    const { id, worker, settings } = await start(extension, scenario);
    report.chrome = await browser.version();
    const fixture = await worker.evaluate(async (kind) => {
      const writer = BrowserToolboxConfigurationWriterInstance;
      const store = BrowserToolboxConfigurationStore;
      const secret = "synthetic-private-conflict-value";
      await writer.read();
      await writer.commit({
        legacyPatch: { keyMappings: "map x scrollDown", smoothScroll: false },
      });
      if (kind === "rollback") {
        const transaction = new __testTransitionConstructors.TestRollback({
          writer,
          authorize: () => true,
          afterStep: async (step) => {
            if (step === "sync") {
              await chrome.storage.sync.set({ keyMappings: `map ${secret} scrollUp` });
            }
          },
        });
        const result = await transaction.execute(await transaction.preview());
        if (!["ABORTED", "COMMITTED"].includes(result.phase)) throw new Error("回退终态未建立");
      } else {
        const publisher = new __testTransitionConstructors.TestPublisher({
          writer,
          authorize: () => true,
        });
        const result = await publisher.execute(await publisher.preview());
        if (result.phase !== "COMMITTED") throw new Error("同步终态未建立");
        await chrome.storage.sync.set({ [store.KEYS.index]: { formatVersion: 99, secret } });
      }
      return { secret };
    }, scenario);

    const page = await browser.newPage();
    page.on("pageerror", (failure) => report.pageErrors.push(failure.message));
    await page.goto(`chrome-extension://${id}/pages/configuration_recovery.html`);
    const button = scenario === "rollback"
      ? "#recovery-inspect-rollback-conflict"
      : "#recovery-inspect-sync-conflict";
    await page.waitForFunction(
      (selector) => {
        const element = document.querySelector(selector);
        return element && !element.disabled;
      },
      { timeout: 10000 },
      button,
    );
    const before = await page.evaluate(async () => ({
      local: await BrowserToolboxConfigurationStore.digest(await chrome.storage.local.get(null)),
      sync: await BrowserToolboxConfigurationStore.digest(await chrome.storage.sync.get(null)),
    }));
    await page.click(button);
    await page.waitForFunction(() =>
      document.querySelector("#recovery-conflict-result")?.dataset.status === "ready"
    );
    const observed = await page.evaluate(async ({ secret, kind }) => {
      const result = document.querySelector("#recovery-conflict-result");
      const response = await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "inspect-transition-conflict",
        input: { kind },
      });
      return {
        text: result.textContent,
        response,
        redacted: !document.body.textContent.includes(secret) &&
          !JSON.stringify(response).includes(secret),
        local: await BrowserToolboxConfigurationStore.digest(await chrome.storage.local.get(null)),
        sync: await BrowserToolboxConfigurationStore.digest(await chrome.storage.sync.get(null)),
      };
    }, {
      secret: fixture.secret,
      kind: scenario === "rollback" ? "legacy-rollback" : "keyboard-sync-publish",
    });
    assert(
      observed.redacted && observed.local === before.local && observed.sync === before.sync,
      "只读分类泄漏正文或更改了存储",
    );
    assert(
      observed.response.ok && observed.response.value.writeAllowed === false &&
        observed.response.value.releaseAllowed === false &&
        observed.response.value.lineageVerified === false,
      "分类结果没有保持写入、解锁和来源限制",
    );
    if (scenario === "rollback") {
      assert(
        observed.response.value.fields.keyMappings === "external" &&
          observed.text.includes("keyMappings"),
        "回退字段未正确分类",
      );
    } else {
      assert(
        observed.response.value.index === "external" && observed.text.length > 0,
        "同步索引未正确分类",
      );
    }
    const locked = await worker.evaluate(() => BrowserToolboxConfigurationWriterInstance.preview());
    assert(locked.code === "CONFIGURATION_TRANSITION_PENDING", "分类后普通写保护未保留");
    report.checks.push({ name: `${scenario} 冲突只读分类，原存储与写保护保留`, status: "passed" });

    const denied = await settings.evaluate(async () => {
      const request = {
        handler: "browserToolbox.configuration",
        action: "inspect-transition-conflict",
        input: { kind: "legacy-rollback" },
      };
      return await chrome.runtime.sendMessage(request);
    });
    assert(denied?.code === "PERMISSION_DENIED", "非恢复页意外获得分类入口");
    const action = await browser.newPage();
    await action.goto(`chrome-extension://${id}/pages/action.html`);
    const deniedAction = await action.evaluate(async () =>
      await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "inspect-transition-conflict",
        input: { kind: "legacy-rollback" },
      })
    );
    assert(deniedAction?.code === "PERMISSION_DENIED", "动作页意外获得分类入口");
    await settings.evaluate((extensionId) => {
      const frame = document.createElement("iframe");
      frame.id = "synthetic-recovery-frame";
      frame.src = `chrome-extension://${extensionId}/pages/configuration_recovery.html`;
      document.body.append(frame);
    }, id);
    const frameElement = await settings.waitForSelector("#synthetic-recovery-frame");
    const frame = await frameElement.contentFrame();
    await frame.waitForSelector("#recovery-inspect");
    const deniedFrame = await frame.evaluate(async () =>
      await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "inspect-transition-conflict",
        input: { kind: "legacy-rollback" },
      })
    );
    assert(deniedFrame?.code === "PERMISSION_DENIED", "嵌入的恢复页意外获得分类入口");
    await settings.evaluate(() => document.querySelector("#synthetic-recovery-frame").remove());
    const invalid = await page.evaluate(async () =>
      await chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "inspect-transition-conflict",
        input: { kind: "unknown" },
      })
    );
    assert(!invalid.ok && invalid.code === "INVALID_CONFIGURATION_ACTION", "未知事务类型没有拒绝");
    report.checks.push({
      name: `${scenario} 页面、子 frame 入口限制和未知类型拒绝`,
      status: "passed",
    });

    await page.setViewport({ width: 320, height: 700 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!overflow, "窄屏出现横向溢出");
    if (screenshotPath && scenario === "rollback") {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    report.checks.push({ name: `${scenario} 窄屏无横向溢出`, status: "passed" });
    await browser.close();
    browser = null;
  }
  assert(report.pageErrors.length === 0, "恢复页存在脚本异常");
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
