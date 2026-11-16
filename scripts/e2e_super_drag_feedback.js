// SPDX-License-Identifier: GPL-3.0-or-later
// 用独立浏览器核对超级拖拽与鼠标手势的提示、命令和取消行为。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";

const root = path.resolve(path.dirname(path.fromFileUrl(import.meta.url)), "..");
const extension = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  path.join(root, "dist/browser-toolbox");
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const evidenceDir = Deno.env.get("BROWSER_TOOLBOX_FEEDBACK_EVIDENCE_DIR");
const fixture = await Deno.readTextFile(path.join(root, "tests/fixtures/super-drag-feedback.html"));
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
  return new Response(pathname === "/target" ? "本地测试目标" : fixture, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});
const fixtureUrl = `http://127.0.0.1:${server.addr.port}/`;
const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-feedback-e2e-" });
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
    defaultViewport: { width: 1280, height: 900 },
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
  assert(await page.title() === "超级拖拽提示测试", "测试页面标题不正确");

  // 只记录合成命令，避免测试打开外部搜索或更改其他标签页。
  const probe = async (operation) =>
    await worker.evaluate(async ({ fixtureUrl, operation }) => {
      const tab = (await chrome.tabs.query({})).find((item) => item.url === fixtureUrl);
      if (!tab) throw new Error("没有找到测试标签页");
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "ISOLATED",
        func: (operation) => {
          const controller = globalThis.BrowserToolboxMouseControllerInstance;
          if (!controller?.settingsReady) return { ready: false };
          if (operation === "install") {
            controller.settings = structuredClone(controller.settings);
            controller.settings.general.showHud = true;
            controller.settings.mouse.showCommandHud = true;
            controller.settings.mouse.bindings = [{
              id: "feedback-mouse",
              pattern: ["L", "R", "L"],
              commandName: "reload",
              options: {},
            }];
            controller.settings.superDrag.bindings = [
              {
                id: "feedback-link",
                context: "LINK",
                pattern: ["L", "R", "L"],
                commandName: "BrowserToolbox.openLinkForeground",
                options: {},
              },
              {
                id: "feedback-image",
                context: "IMAGE",
                pattern: ["L", "R", "L"],
                commandName: "BrowserToolbox.openImageForeground",
                options: {},
              },
              {
                id: "feedback-text",
                context: "SELECTED_TEXT",
                pattern: ["L", "R", "L"],
                commandName: "BrowserToolbox.searchSelection",
                options: {},
              },
            ];
            controller.feedbackTestCalls = [];
            controller.dispatchBinding = function (binding, sourceType, context) {
              this.feedbackTestCalls.push({
                command: binding.commandName,
                sourceType,
                context: context.type,
              });
            };
          } else if (operation === "reset") {
            controller.feedbackTestCalls = [];
          } else if (operation === "hud-off") {
            controller.settings.general.showHud = false;
          } else if (operation === "hud-on") {
            controller.settings.general.showHud = true;
          }
          const overlay = controller.overlay;
          const hud = overlay?.hud;
          const cancel = overlay?.cancel;
          const rect = overlay?.cancelTarget?.getBoundingClientRect();
          const css = hud ? getComputedStyle(hud) : null;
          const commands = [
            "BrowserToolbox.openLinkForeground",
            "BrowserToolbox.openImageForeground",
            "BrowserToolbox.searchSelection",
            "reload",
          ];
          const labels = Object.fromEntries(commands.map((name) => {
            const key = `command_${name.replaceAll(".", "_")}`;
            return [
              name,
              globalThis.BrowserToolboxI18n?.hasMessage?.(key)
                ? BrowserToolboxI18n.message(key)
                : name,
            ];
          }));
          return {
            ready: true,
            dragActive: controller.drag?.active === true,
            gestureActive: controller.gesture?.isActive() === true,
            context: controller.drag?.context?.type || "",
            mode: hud?.dataset.mode || "",
            hudVisible: Boolean(hud && !hud.hidden && hud.style.visibility !== "hidden"),
            gestureVisible: overlay?.gestureBody?.hidden === false,
            directions: overlay?.directionTrack
              ? [...overlay.directionTrack.children].map((item) => item.dataset.direction)
              : [],
            current: overlay?.directionTrack?.querySelector(".is-current")?.dataset.direction || "",
            label: overlay?.statusLabel?.textContent || "",
            text: overlay?.textBody?.textContent || "",
            cancelVisible: cancel?.classList.contains("is-visible") === true,
            cancelHovered: cancel?.classList.contains("is-hovered") === true,
            cancelRect: rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null,
            hostVisible: overlay?.host?.style.display === "block",
            style: css
              ? {
                borderRadius: css.borderRadius,
                background: css.backgroundColor,
                border: css.borderColor,
              }
              : null,
            calls: controller.feedbackTestCalls,
            labels,
          };
        },
        args: [operation],
      });
      return results[0].result;
    }, { fixtureUrl, operation });

  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = (await probe("install"))?.ready === true;
    if (!ready) await delay(100);
  }
  assert(ready, "扩展输入控制器没有准备好");
  const client = await page.createCDPSession();
  let pending = [];
  let current = null;
  let button = "left";
  let buttons = 1;
  const start = async (selector, mouseButton = "left", selectText = false) => {
    await probe("reset");
    if (selectText) {
      await page.evaluate((selector) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(selector));
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }, selector);
    } else {
      await page.evaluate(() => getSelection().removeAllRanges());
    }
    current = await page.$eval(selector, (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    button = mouseButton;
    buttons = button === "right" ? 2 : 1;
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...current, buttons: 0 });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...current,
      button,
      buttons,
      clickCount: 1,
    });
  };
  const move = async (x, y) => {
    current = { x, y };
    pending.push(client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...current,
      button,
      buttons,
    }));
    // 截图让 Chrome 提交当前帧，确保检查的是按键仍按住时实际绘制的提示。
    await page.screenshot();
  };
  const end = async () => {
    pending.push(client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...current,
      button,
      buttons: 0,
      clickCount: 1,
    }));
    await Promise.all(pending);
    pending = [];
    await delay(100);
  };
  const trace = async (selector, mouseButton = "left", selectText = false) => {
    await start(selector, mouseButton, selectText);
    const origin = { ...current };
    await move(origin.x - 100, origin.y);
    const first = await probe("snapshot");
    await move(origin.x + 50, origin.y);
    const second = await probe("snapshot");
    await move(origin.x - 80, origin.y);
    const third = await probe("snapshot");
    return { first, second, third };
  };
  const checkGesture = (snapshot, directions, context, command) => {
    assert(
      snapshot.mode === "gesture" && snapshot.hudVisible && snapshot.gestureVisible,
      `${context} 没有使用手势提示：${JSON.stringify(snapshot)}`,
    );
    assert(
      JSON.stringify(snapshot.directions) === JSON.stringify(directions),
      `${context} 方向不正确：${JSON.stringify(snapshot)}`,
    );
    assert(snapshot.current === directions.at(-1), `${context} 当前方向没有高亮`);
    assert(snapshot.cancelVisible, `${context} 没有显示取消区域`);
    assert(
      snapshot.label === (command ? snapshot.labels[command] : ""),
      `${context} 的命令名称不正确：${JSON.stringify(snapshot)}`,
    );
  };
  const capture = async (name) => {
    if (!evidenceDir) return;
    await Deno.mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, `${name}.png`) });
  };

  const link = await trace("#link");
  checkGesture(link.first, ["L"], "LINK", "");
  checkGesture(link.second, ["L", "R"], "LINK", "");
  checkGesture(link.third, ["L", "R", "L"], "LINK", "BrowserToolbox.openLinkForeground");
  await capture("超级拖拽提示");
  assert(link.third.context === "LINK", "链接上下文不正确");
  const cancelPoint = link.third.cancelRect;
  await move(cancelPoint.x, cancelPoint.y);
  const hovered = await probe("snapshot");
  assert(hovered.cancelHovered, "拖到取消区域没有高亮");
  checkGesture(hovered, ["L", "R", "L"], "取消悬停", "BrowserToolbox.openLinkForeground");
  await end();
  let state = await probe("snapshot");
  assert(
    state.calls.length === 0 && !state.hostVisible && !state.dragActive,
    "取消超级拖拽后仍执行命令或浮层未关闭",
  );
  assert(
    await page.$eval("#link", (element) => !element.hasAttribute("draggable")),
    "取消后链接原生拖拽属性未恢复",
  );
  console.log("通过：多方向链接提示和取消");

  for (
    const item of [
      { selector: "#link", context: "LINK", command: "BrowserToolbox.openLinkForeground" },
      { selector: "#image", context: "IMAGE", command: "BrowserToolbox.openImageForeground" },
      {
        selector: "#text",
        context: "SELECTED_TEXT",
        command: "BrowserToolbox.searchSelection",
        select: true,
      },
    ]
  ) {
    const result = await trace(item.selector, "left", item.select);
    checkGesture(result.third, ["L", "R", "L"], item.context, item.command);
    assert(result.third.context === item.context, `${item.context} 上下文不正确`);
    await end();
    state = await probe("snapshot");
    assert(
      state.calls.length === 1 && state.calls[0].command === item.command &&
        state.calls[0].sourceType === "superDrag",
      `${item.context} 完成后执行的命令不正确`,
    );
    assert(!state.hostVisible && !state.dragActive, `${item.context} 完成后浮层没有关闭`);
    console.log(`通过：${item.context} 的提示和执行`);
  }

  const mouse = await trace("#gesture-target", "right");
  checkGesture(mouse.third, ["L", "R", "L"], "右键手势", "reload");
  assert(
    JSON.stringify(mouse.third.style) === JSON.stringify(link.third.style),
    "左右键提示胶囊样式不一致",
  );
  await capture("右键手势提示");
  await end();
  state = await probe("snapshot");
  assert(
    state.calls.some((call) => call.command === "reload" && call.sourceType === "mouseGesture"),
    "右键手势没有执行对应命令",
  );
  console.log("通过：与右键手势样式一致");

  await probe("hud-off");
  await start("#link");
  const origin = { ...current };
  await move(origin.x - 100, origin.y);
  state = await probe("snapshot");
  assert(
    !state.hudVisible && state.cancelVisible,
    "关闭命令提示后没有保持与鼠标手势一致的取消区域",
  );
  await move(state.cancelRect.x, state.cancelRect.y);
  await end();
  state = await probe("snapshot");
  assert(state.calls.length === 0 && !state.hostVisible, "关闭命令提示时取消失败");
  console.log("通过：关闭命令提示时仍可取消");
  assert(pageErrors.length === 0, `合成页面错误：${pageErrors.join("；")}`);
  console.log(`超级拖拽提示 E2E 全部通过：${await browser.version()}`);
} finally {
  await browser?.close();
  await server.shutdown();
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}
