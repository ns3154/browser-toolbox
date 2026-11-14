// SPDX-License-Identifier: GPL-3.0-or-later
// 仅使用 o 和 Escape 观察合成页面的导航面板焦点，不访问系统剪贴板。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
const extension = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_FOCUS_REPORT");
const plan = Number(Deno.env.get("BROWSER_TOOLBOX_FOCUS_PLAN") || 9);
if (!executablePath || !extension || !reportPath) throw new Error("缺少浏览器、构建或报告路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-focus-safe-" });
const report = { status: "running", source: "synthetic", plan, attempts: [] };
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () =>
  new Response(
    '<!doctype html><meta charset="utf-8"><title>焦点合成检查</title><h1 id="focus" tabindex="-1">合成焦点</h1><a href="#a">合成链接</a>',
    { headers: { "content-type": "text/html;charset=utf-8" } },
  ));
const fixture = `http://localhost:${server.addr.port}/focus`;
let browser;
async function passive(frame, callback) {
  const realm = frame.mainRealm();
  const result = await realm.client.send("Runtime.callFunctionOn", {
    functionDeclaration: callback.toString(),
    executionContextId: realm.context.id,
    userGesture: false,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("只读焦点观测失败");
  return result.result.value;
}
async function waitFor(probe, milliseconds = 10000) {
  const deadline = Date.now() + milliseconds;
  do {
    const result = await probe();
    if (result) return result;
    await sleep(20);
  } while (Date.now() < deadline);
  throw new Error("等待导航面板或焦点超时");
}

try {
  browser = await puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir: path.join(temporary, "profile"),
    defaultViewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      "--window-size=1280,900",
      "--window-position=1960,213",
    ],
  });
  report.chrome = await browser.version();
  const worker = await browser.waitForTarget((item) =>
    item.type() === "service_worker" && item.url().endsWith("/background_scripts/main.js")
  );
  const id = new URL(worker.url()).host;
  const options = await browser.newPage();
  await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
  await options.waitForFunction(
    () => document.querySelector("main")?.dataset.settingsReady === "true",
    { polling: 50, timeout: 15000 },
  );
  const configured = await options.evaluate(() =>
    chrome.runtime.sendMessage({
      handler: "browserToolbox.configuration",
      action: "commit",
      input: { legacyPatch: { keyMappings: "", grabBackFocus: false } },
    })
  );
  if (!configured.ok) throw new Error("合成设置失败");
  const page = await browser.newPage();
  await page.goto(fixture);
  const tabId = await options.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
    fixture,
  );
  if (!Number.isInteger(tabId)) throw new Error("未找到合成标签");
  await waitFor(() =>
    options.evaluate(async ({ tabId, plan }) => {
      const [row] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "ISOLATED",
        func: () => ({
          state: globalThis.BrowserToolboxRuntimeHostInstance?.state,
          plan: globalThis.BrowserToolboxRuntimeHostInstance?.plan?.planVersion,
        }),
      });
      return row?.result?.state === "active" && row.result.plan === plan;
    }, { tabId, plan })
  );
  for (let index = 0; index < 30; index++) {
    const entry = { iteration: index + 1, status: "running", samples: [] };
    try {
      await page.bringToFront();
      await page.click("#focus");
      await page.keyboard.press("o");
      const frame = await waitFor(() =>
        page.frames().find((item) =>
          item.url().split("?")[0] === `chrome-extension://${id}/pages/vomnibar_page.html`
        )
      );
      await frame.waitForSelector("input");
      await waitFor(
        () =>
          passive(
            frame,
            () => document.hasFocus() && document.activeElement === document.querySelector("input"),
          ),
        3000,
      );
      for (let sample = 0; sample < 12; sample++) {
        entry.samples.push(
          await passive(frame, () => ({
            documentFocused: document.hasFocus(),
            inputActive: document.activeElement === document.querySelector("input"),
            visibility: document.visibilityState,
          })),
        );
        await sleep(25);
      }
      entry.status = entry.samples.every((sample) => sample.documentFocused && sample.inputActive)
        ? "passed"
        : "focus-lost";
    } catch (failure) {
      entry.status = "failed";
      entry.error = failure.message;
      entry.windows = await passive(
        options.mainFrame(),
        async () =>
          (await chrome.windows.getAll()).map((window) => ({
            id: window.id,
            focused: window.focused,
          })),
      ).catch(() => []);
    } finally {
      await page.keyboard.press("Escape").catch(() => {});
      report.attempts.push(entry);
    }
  }
  report.status = report.attempts.every((entry) => entry.status === "passed") ? "passed" : "failed";
  if (report.status !== "passed") Deno.exitCode = 1;
  console.log(
    JSON.stringify(
      {
        status: report.status,
        attempts: report.attempts.length,
        passed: report.attempts.filter((entry) => entry.status === "passed").length,
      },
      null,
      2,
    ),
  );
} catch (failure) {
  report.status = "failed";
  report.error = failure.message;
  Deno.exitCode = 1;
  throw failure;
} finally {
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n", { createNew: true });
  if (browser) await browser.close();
  await server.shutdown();
  await Deno.remove(temporary, { recursive: true });
}
