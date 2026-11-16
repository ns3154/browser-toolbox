// SPDX-License-Identifier: GPL-3.0-or-later
// 使用本地合成页面和独立浏览器验证尺寸调整不会触发超级拖拽。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";

const root = path.resolve(path.dirname(path.fromFileUrl(import.meta.url)), "..");
const extension = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  path.join(root, "dist/browser-toolbox");
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const fixture = await Deno.readTextFile(path.join(root, "tests/fixtures/super-drag-resize.html"));
const pixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/pixel.png") {
    return new Response(pixel, { headers: { "content-type": "image/png" } });
  }
  return new Response(pathname === "/target" ? "本地链接目标" : fixture, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/`;
const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-resize-e2e-" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
let browser;
try {
  browser = await puppeteer.launch({
    executablePath,
    headless: Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") !== "false",
    userDataDir: profile,
    defaultViewport: { width: 1280, height: 1400 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const workerTarget = await browser.waitForTarget((target) =>
    target.type() === "service_worker" && target.url().endsWith("/background_scripts/main.js")
  );
  const worker = await workerTarget.worker();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(fixtureUrl, { waitUntil: "load" });
  assert(await page.title() === "超级拖拽与尺寸调整测试", "测试页面标题不正确");

  // 只拦截测试文本搜索以避免外网请求；链接和图片命令仍调用真实后台动作。
  const probe = async (operation) => {
    return await worker.evaluate(async ({ fixtureUrl, operation, cursorAsset }) => {
      const tab = (await chrome.tabs.query({})).find((item) => item.url === fixtureUrl);
      if (!tab) throw new Error("没有找到合成测试标签页");
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "ISOLATED",
        func: (operation, cursorAsset) => {
          const controller = globalThis.BrowserToolboxMouseControllerInstance;
          if (!controller?.settingsReady) return { ready: false };
          if (operation === "install") {
            if (!controller.settings.superDrag.enabled || !controller.effective("superDrag")) {
              throw new Error("超级拖拽未启用");
            }
            controller.resizeTestCalls = [];
            const original = controller.dispatchBinding;
            controller.dispatchBinding = function (binding, type, context, ...rest) {
              this.resizeTestCalls.push({
                command: binding.commandName,
                type,
                context: context.type,
              });
              if (context.type !== "SELECTED_TEXT") {
                return original.call(this, binding, type, context, ...rest);
              }
            };
          } else if (operation === "reset") {
            controller.resizeTestCalls = [];
          } else if (operation === "cursor-on") {
            if (
              !controller.cursor.apply({ enabled: true, hotspotX: 0, hotspotY: 0 }, cursorAsset)
            ) {
              throw new Error("无法启用合成自定义指针");
            }
          } else if (operation === "cursor-off") {
            controller.cursor.clear();
          }
          return {
            ready: true,
            calls: controller.resizeTestCalls,
            cursorActive: Boolean(
              controller.cursor.style && !controller.cursor.style.sheet.disabled,
            ),
          };
        },
        args: [operation, cursorAsset],
      });
      return results[0].result;
    }, {
      fixtureUrl,
      operation,
      cursorAsset: `data:image/png;base64,${btoa(String.fromCharCode(...pixel))}`,
    });
  };
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = (await probe("install"))?.ready === true;
    if (!ready) await delay(100);
  }
  assert(ready, "扩展输入控制器没有准备好");

  const select = async (selector) => {
    await page.evaluate((selector) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector));
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, selector);
  };

  const rectangle = async (selector) => {
    return await page.$eval(selector, (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  };

  const drag = async (selector, dx, dy, corner = "center", inset = 4) => {
    const box = await rectangle(selector);
    const x = corner === "bottom-right"
      ? box.x + box.width - inset
      : corner === "bottom-left"
      ? box.x + inset
      : box.x + box.width / 2;
    const y = corner.startsWith("bottom") ? box.y + box.height - inset : box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // macOS 的原生拖动可能等释放后才返回移动事件，两个 CDP 请求需要并行完成。
    const move = page.mouse.move(x + dx, y + dy);
    await delay(120);
    await Promise.all([move, page.mouse.up()]);
    await delay(200);
  };

  const verifyNoCommand = async (name, selected, action) => {
    await probe("reset");
    await select(selected);
    await action();
    const state = await probe("get");
    assert(state.calls.length === 0, `${name}误触发命令：${JSON.stringify(state.calls)}`);
    console.log(`通过：${name}`);
  };

  const resizeColumn = async (name) => {
    const before = await rectangle("#column");
    await page.evaluate(() => globalThis.resizeEvents = []);
    await drag("#column-handle-child", 80, 0);
    const after = await rectangle("#column");
    const events = await page.evaluate(() => globalThis.resizeEvents);
    assert(after.width >= before.width + 50, `${name}没有调整列宽`);
    assert(events.includes("move") && events.includes("up"), `${name}丢失网页指针事件`);
  };

  await verifyNoCommand("残留选区时调整表格列宽", "#selected-text", () => resizeColumn("表格列宽"));
  await page.$eval("#column", (element) => element.style.width = "190px");
  await verifyNoCommand("选区包含调整手柄时调整列宽", "#column", () => resizeColumn("表格列宽"));
  await page.$eval("#column", (element) => element.style.width = "190px");
  await verifyNoCommand("选区包含调整手柄时调整行高", "#row-cell", async () => {
    const before = await rectangle("#row-cell");
    await page.evaluate(() => globalThis.resizeEvents = []);
    await drag("#row-handle", 0, 70);
    const after = await rectangle("#row-cell");
    const events = await page.evaluate(() => globalThis.resizeEvents);
    assert(after.height >= before.height + 40, "表格行高没有变化");
    assert(events.includes("move") && events.includes("up"), "表格行高调整丢失网页指针事件");
  });
  await page.$eval("#row-cell", (element) => element.style.height = "");
  await probe("cursor-on");
  await verifyNoCommand("启用自定义指针时调整列宽", "#column", () => resizeColumn("自定义指针"));
  assert((await probe("get")).cursorActive, "调整尺寸后自定义指针没有恢复");
  await probe("cursor-off");

  for (
    const item of [
      {
        name: "普通区域右下角",
        box: "#resize-box",
        selected: "#resize-text",
        corner: "bottom-right",
        dx: 80,
      },
      {
        name: "从右到左区域左下角",
        box: "#resize-rtl",
        selected: "#rtl-text",
        corner: "bottom-left",
        dx: -80,
      },
      {
        name: "粗边框区域",
        box: "#resize-bordered",
        selected: "#bordered-text",
        corner: "bottom-right",
        dx: 80,
        inset: 20,
      },
      {
        name: "自定义角标样式",
        box: "#large-handle",
        selected: "#large-text",
        corner: "bottom-right",
        dx: 80,
        inset: 16,
      },
      {
        name: "文本框右下角",
        box: "#textarea",
        selected: "#selected-text",
        corner: "bottom-right",
        dx: 80,
      },
    ]
  ) {
    await verifyNoCommand(item.name, item.selected, async () => {
      const before = await rectangle(item.box);
      await drag(item.box, item.dx, 50, item.corner, item.inset || 4);
      const after = await rectangle(item.box);
      assert(
        after.width > before.width + 30 && after.height > before.height + 30,
        `${item.name}没有调整尺寸`,
      );
    });
  }
  await verifyNoCommand("输入滑块", "#selected-text", async () => {
    const before = await page.$eval("#slider", (element) => Number(element.value));
    const box = await rectangle("#slider");
    await page.mouse.move(box.x + 55, box.y + box.height / 2);
    await page.mouse.down();
    const move = page.mouse.move(box.x + 135, box.y + box.height / 2);
    await delay(120);
    await Promise.all([move, page.mouse.up()]);
    const after = await page.$eval("#slider", (element) => Number(element.value));
    assert(after > before + 10, "滑块没有响应拖动");
  });
  await verifyNoCommand(
    "残留选区时拖动其他区域",
    "#selected-text",
    () => drag("#unrelated", 80, 0),
  );

  await probe("reset");
  await select("#column-text");
  await drag("#column-text", 80, 0);
  let state = await probe("get");
  assert(
    state.calls.some((call) =>
      call.context === "SELECTED_TEXT" && call.command === "BrowserToolbox.searchSelection"
    ),
    "表格内选中文字无法使用超级拖拽",
  );
  console.log("通过：表格内选中文字超级拖拽");

  for (
    const item of [
      {
        selector: "#link",
        context: "LINK",
        command: "BrowserToolbox.openLinkForeground",
        suffix: "/target",
      },
      {
        selector: "#image",
        context: "IMAGE",
        command: "BrowserToolbox.openImageForeground",
        suffix: "/pixel.png",
      },
    ]
  ) {
    await probe("reset");
    const newTarget = browser.waitForTarget((target) => target.url().endsWith(item.suffix));
    await drag(item.selector, 80, 0);
    const opened = await newTarget;
    state = await probe("get");
    assert(
      state.calls.some((call) => call.context === item.context && call.command === item.command),
      `${item.context} 超级拖拽没有调用预期命令`,
    );
    await (await opened.page()).close();
    console.log(`通过：${item.context} 超级拖拽真实打开标签页`);
  }
  assert(pageErrors.length === 0, `合成页面错误：${pageErrors.join("；")}`);
  console.log(`超级拖拽尺寸调整 E2E 全部通过：${await browser.version()}`);
} finally {
  await browser?.close();
  await server.shutdown();
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
