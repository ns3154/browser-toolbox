// SPDX-License-Identifier: GPL-3.0-or-later
// 仅验证合成 profile 的设置校验，不访问或修改系统剪贴板。
import * as path from "@std/path";
// 复用项目已有的 Puppeteer 依赖，不增加新的运行时依赖。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import { buildInputCanary } from "./build_runtime_canary.js";
import { buildArtifacts } from "./release_artifacts.js";
import { resolveCanaryExtensionId } from "./canary_browser_session.js";

const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
if (!executablePath) throw new Error("缺少 Chrome for Testing 路径");
const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-validation-e2e-" });
let canary;
const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function run(plan, extensionPath) {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(temporary, `profile-${plan}`),
    defaultViewport: { width: 900, height: 600 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  try {
    const id = await resolveCanaryExtensionId(browser);
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.on("dialog", (dialog) => void dialog.dismiss());
    await page.goto(`chrome-extension://${id}/pages/options.html`);
    await page.bringToFront();
    try {
      await page.waitForFunction(
        (expected) =>
          document.querySelector("[name=settingsVersion]")?.value === "2.4.2" &&
          globalThis.BrowserToolboxRuntimeHostInstance?.getDiagnostics().planVersion === expected &&
          (expected === 1 || !!document.querySelector("#browser-toolbox-options-status")) &&
          !document.querySelector("#settings-grid-container").inert,
        { timeout: 10000, polling: 50 },
        plan,
      );
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        version: document.querySelector("[name=settingsVersion]")?.value,
        host: globalThis.BrowserToolboxRuntimeHostInstance?.getDiagnostics(),
        status: document.querySelector("#browser-toolbox-options-status")?.textContent,
        inert: document.querySelector("#settings-grid-container")?.inert,
      }));
      throw new Error(`方案 ${plan} 设置页未就绪：${JSON.stringify(diagnostics)}`, {
        cause: error,
      });
    }
    const before = await page.evaluate(() => chrome.storage.sync.get(null));
    const mapping = '[name="keyMappings"]';
    const numbers = '[name="linkHintNumbers"]';
    const set = (selector, value) =>
      page.$eval(selector, (input, text) => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
    const visibleAndFocused = (selector) =>
      page.$eval(selector, (input) => {
        const rect = input.getBoundingClientRect();
        const footer = document.querySelector("footer").getBoundingClientRect();
        return document.activeElement === input && rect.top >= 0 && rect.bottom <= footer.top &&
          input.classList.contains("validation-error");
      });
    const clickSave = async () => {
      const point = await page.$eval("#save", (button) => {
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.mouse.click(point.x, point.y);
    };
    const original = await page.$eval(mapping, (input) => input.value);

    console.log(`方案 ${plan}：检查视口外错误`);
    await set(mapping, "invalid-mapping-statement");
    await page.evaluate(() => globalThis.scrollTo(0, document.documentElement.scrollHeight));
    await clickSave();
    assert(await visibleAndFocused(mapping), `方案 ${plan} 未定位键位错误`);
    assert(
      JSON.stringify(await page.evaluate(() => chrome.storage.sync.get(null))) ===
        JSON.stringify(before),
      `方案 ${plan} 校验失败时写入了同步设置`,
    );
    checks.push(`方案 ${plan}：视口外键位错误阻止保存并定位`);

    console.log(`方案 ${plan}：检查隐藏字段错误`);
    await set(mapping, original);
    await set(numbers, "1");
    assert(
      await page.$eval(
        "#link-hint-numbers-container",
        (el) => getComputedStyle(el).display === "none",
      ),
      `方案 ${plan} 的数字字段初始应隐藏`,
    );
    await page.evaluate(() => globalThis.scrollTo(0, document.documentElement.scrollHeight));
    await clickSave();
    assert(await visibleAndFocused(numbers), `方案 ${plan} 未先显示并定位数字错误`);
    assert(
      JSON.stringify(await page.evaluate(() => chrome.storage.sync.get(null))) ===
        JSON.stringify(before),
      `方案 ${plan} 隐藏字段校验失败时写入了同步设置`,
    );
    checks.push(`方案 ${plan}：隐藏字段显示后定位且不写配置`);

    console.log(`方案 ${plan}：检查修正后保存`);
    await set(numbers, "0123456789");
    await page.keyboard.down("Control");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Control");
    await page.waitForFunction(() => document.querySelector("#save").disabled, {
      timeout: 10000,
      polling: 50,
    });
    assert(
      await page.$$eval(".validation-error", (items) => items.length) === 0,
      `方案 ${plan} 修正后仍显示错误`,
    );
    checks.push(`方案 ${plan}：修正后快捷键保存`);
    return await browser.version();
  } finally {
    await browser.close();
  }
}

try {
  const release = path.join(temporary, "release");
  await buildArtifacts({ output: release });
  canary = await buildInputCanary(Deno.cwd(), Deno.cwd(), { pages: true });
  const versions = [
    await run(1, path.join(release, "browser-toolbox")),
    await run(9, canary.extensionPath),
  ];
  console.log(JSON.stringify({ checks, versions }, null, 2));
} finally {
  if (canary) await Deno.remove(path.dirname(canary.extensionPath), { recursive: true });
  await Deno.remove(temporary, { recursive: true });
}
