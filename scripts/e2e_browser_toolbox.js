#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys

/**
 * BrowserToolbox 隔离浏览器 E2E。
 *
 * @typedef {Object} BrowserToolboxE2eEnvironmentOptions
 * @property {string} [browserExecutablePath] 本地 Chrome 可执行文件路径。
 * @property {string} [browserUrl] 已启动的 Chrome DevTools Protocol 地址。
 * @property {string} [extensionPath] 扩展在被测浏览器所在环境中的目录路径。
 * @property {string} [fixtureHost] 本地 fixture 服务绑定的主机名。
 * @property {number} [fixturePort] 本地 fixture 服务使用的端口，0 表示自动分配。
 */
// BrowserToolbox 的隔离浏览器 E2E。脚本只使用本地 fixture 和临时 profile，不访问项目服务器。
import puppeteer from "npm:puppeteer";
import "../lib/browser_toolbox/module_registry.js";

const projectRoot = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/\/$/, "");
// 远程 CDP 浏览器无法读取宿主机路径；测试环境可提供来宾内的归档展开目录。
const extensionPath = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH") ||
  `${projectRoot}/dist/browser-toolbox`;
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const headless = Deno.env.get("BROWSER_TOOLBOX_E2E_HEADLESS") === "false" ? false : "new";
const settingsKey = "browserToolboxSettings";
const moduleRegistry = globalThis.BrowserToolboxModuleRegistry;
const pngBytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);
const designFixtureFiles = [
  "basic-links.html",
  "inputs.html",
  "scroll-containers.html",
  "iframes.html",
  "shadow-dom.html",
  "drag-drop-app.html",
  "contenteditable.html",
  "images.html",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, timeout = 8000, interval = 50) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error("等待 E2E 条件超时。");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}：实际为 ${JSON.stringify(actual)}，期望为 ${JSON.stringify(expected)}。`,
    );
  }
}

function html(body, title = "BrowserToolbox E2E") {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { min-height: 3600px; font: 16px sans-serif; padding: 32px; }
  a, img, p, div { margin: 24px; }
  #scroll-box { width: 320px; height: 100px; overflow: auto; border: 1px solid; }
  #scroll-box > div { height: 1000px; }
  #image { width: 240px; height: 120px; object-fit: contain; }
</style></head><body>${body}</body></html>`;
}

function fixtureHtml(base127, baseLocal) {
  return html(`
    <h1 id="heading">BrowserToolbox fixture</h1>
    <div id="gesture-target" style="position:fixed;top:80px;left:50%;z-index:1;margin:0">Gesture target</div>
    <a id="link" href="${base127}/target.html">Example link text</a>
    <a id="second-link" href="${base127}/target-2.html">Second link text</a>
    <p id="selectable">Text selected for a local E2E clipboard check.</p>
    <img id="image" src="${base127}/pixel.png" alt="Local image">
    <div id="shadow-host" style="width:220px;height:36px;border:1px solid #888;margin:24px">
      <span>Shadow host</span>
    </div>
    <div id="card" draggable="true">Native draggable card</div>
    <div id="editor" contenteditable="true">Protected editor</div>
    <input id="upload" type="file">
    <input id="text-input" type="text" value="Protected text input">
    <textarea id="textarea">Protected textarea</textarea>
    <div id="scroll-box"><div>Scrollable inner content</div></div>
    <iframe id="frame" src="${baseLocal}/frame.html" title="E2E frame"></iframe>
    <script>
      const shadowRoot = document.querySelector("#shadow-host").attachShadow({ mode: "open" });
      shadowRoot.innerHTML =
        '<a id="shadow-link" href="${base127}/target-2.html" style="display:block;padding:8px">Shadow link</a>';
    </script>
  `);
}

function frameHtml(base127) {
  return html(
    `<a id="frame-link" href="${base127}/target.html">Frame link</a>`,
    "BrowserToolbox frame",
  );
}

function targetHtml(label) {
  return html(`<h1 id="target">${label}</h1><a href="/fixture.html">Back to fixture</a>`, label);
}

function response(body, contentType = "text/html; charset=utf-8") {
  return new Response(body, { headers: { "content-type": contentType } });
}

async function startFixtureServer() {
  let base127 = "";
  let baseLocal = "";
  const fixtureHost = Deno.env.get("BROWSER_TOOLBOX_E2E_FIXTURE_HOST") || "127.0.0.1";
  const configuredPort = Number(Deno.env.get("BROWSER_TOOLBOX_E2E_FIXTURE_PORT") || 0);
  assert(
    Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65535,
    "BROWSER_TOOLBOX_E2E_FIXTURE_PORT 必须是 0 到 65535 之间的整数。",
  );
  const server = Deno.serve({
    hostname: fixtureHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0",
    port: configuredPort,
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/fixtures/")) {
      const fileName = url.pathname.slice("/fixtures/".length);
      if (designFixtureFiles.includes(fileName)) {
        let fixture = await Deno.readTextFile(`${projectRoot}/tests/fixtures/${fileName}`);
        fixture = fixture.replaceAll("https://example.com/image.png", `${base127}/pixel.png`);
        fixture = fixture.replaceAll("https://example.com/image", `${base127}/image`);
        return response(fixture);
      }
    }
    switch (url.pathname) {
      case "/fixture.html":
        return response(fixtureHtml(base127, baseLocal));
      case "/frame.html":
        return response(frameHtml(base127));
      case "/one.html":
        return response(targetHtml("one"), "text/html; charset=utf-8");
      case "/two.html":
        return response(targetHtml("two"), "text/html; charset=utf-8");
      case "/target.html":
        return response(targetHtml("target"), "text/html; charset=utf-8");
      case "/target-2.html":
        return response(targetHtml("target-2"), "text/html; charset=utf-8");
      case "/pixel.png":
        return new Response(pngBytes, { headers: { "content-type": "image/png" } });
      default:
        return new Response("Not found", { status: 404 });
    }
  });
  const port = server.addr.port;
  base127 = `http://${fixtureHost}:${port}`;
  baseLocal = fixtureHost === "127.0.0.1"
    ? `http://localhost:${port}`
    : `http://${fixtureHost}:${port}`;
  return { server, base127, baseLocal };
}

async function getFreePort() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  return port;
}

async function startChrome() {
  const remoteBrowserUrl = Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL");
  if (remoteBrowserUrl) {
    const browser = await puppeteer.connect({ browserURL: remoteBrowserUrl });
    const loadUnpackedViaCdp = Deno.env.get("BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP") === "true";
    if (loadUnpackedViaCdp && Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_PATH")) {
      // 远程浏览器在自己的文件系统中执行 Extensions.loadUnpacked。
      const browserSession = await browser.target().createCDPSession();
      try {
        const { id } = await browserSession.send("Extensions.loadUnpacked", {
          path: extensionPath,
        });
        console.log(`E2E: 通过远程 Extensions.loadUnpacked 加载扩展 ${id}`);
      } finally {
        await browserSession.detach().catch(() => {});
      }
    }
    return {
      browser,
      process: null,
      userDataDir: null,
    };
  }
  const port = await getFreePort();
  const userDataDir = await Deno.makeTempDir({ prefix: "browser-toolbox-e2e-profile-" });
  const loadUnpackedViaCdp = Deno.env.get("BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP") === "true";
  const extensionArgs = loadUnpackedViaCdp ? [] : [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ];
  const process = new Deno.Command(executablePath, {
    args: [
      headless ? "--headless=new" : "--headless=false",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      ...extensionArgs,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok;
    } catch (_) {
      return false;
    }
  }, 10000);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  if (loadUnpackedViaCdp) {
    // Google Chrome Stable 可能拒绝命令行 unpacked 开关；使用其官方 CDP 扩展域加载本地目录。
    const browserSession = await browser.target().createCDPSession();
    try {
      const { id } = await browserSession.send("Extensions.loadUnpacked", { path: extensionPath });
      console.log(`E2E: 通过 Extensions.loadUnpacked 加载扩展 ${id}`);
    } finally {
      await browserSession.detach().catch(() => {});
    }
  }
  return { browser, process, userDataDir };
}

async function hasExtensionPage(browser, id) {
  const probe = await browser.newPage();
  try {
    const response = await probe.goto(`chrome-extension://${id}/pages/mouse_options.html`, {
      waitUntil: "domcontentloaded",
      timeout: 2000,
    });
    return response?.status() === 200 && Boolean(await probe.$("#save-settings"));
  } catch (_) {
    return false;
  } finally {
    await probe.close().catch(() => {});
  }
}

async function extensionId(browser) {
  return waitFor(async () => {
    const configuredId = Deno.env.get("BROWSER_TOOLBOX_E2E_EXTENSION_ID");
    if (configuredId && await hasExtensionPage(browser, configuredId)) return configuredId;
    const targets = browser.targets().filter((item) => {
      if (item.type() !== "service_worker" || !item.url().startsWith("chrome-extension://")) {
        return false;
      }
      return item.url().includes("/background_scripts/main.js") ||
        item.url().endsWith("/service_worker.js");
    });
    for (const target of targets) {
      const id = target.url().split("/")[2];
      if (await hasExtensionPage(browser, id)) return id;
    }
    return null;
  });
}

function addPageDiagnostics(page, errors) {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("error", (error) => errors.push(`error: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    if (failure?.errorText !== "net::ERR_ABORTED") {
      errors.push(`requestfailed: ${failure?.errorText || "unknown"} ${request.url()}`);
    }
  });
}

async function createPage(browser, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  addPageDiagnostics(page, errors);
  await page.evaluateOnNewDocument(() => {
    globalThis.__browserToolboxE2eEvents = [];
    for (
      const type of [
        "contextmenu",
        "dragstart",
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "mousedown",
        "mousemove",
        "mouseup",
        "click",
        "wheel",
        "blur",
        "visibilitychange",
      ]
    ) {
      addEventListener(type, (event) => {
        const record = {
          type,
          button: event.button,
          buttons: event.buttons,
          pointerType: event.pointerType,
          isTrusted: event.isTrusted,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaY: event.deltaY,
          defaultPrevented: event.defaultPrevented,
          targetId: event.target?.id || "",
        };
        globalThis.__browserToolboxE2eEvents.push(record);
        // 监听器位于 window 捕获阶段，需在事件传播结束后再读取最终阻止状态。
        setTimeout(() => record.defaultPrevented = event.defaultPrevented, 0);
      }, true);
    }
  });
  return page;
}

async function clearEvents(page) {
  await page.evaluate(() => globalThis.__browserToolboxE2eEvents.splice(0));
}

async function events(page) {
  return await page.evaluate(() => globalThis.__browserToolboxE2eEvents.slice());
}

async function dispatchMouse(page, payload) {
  const client = await page.createCDPSession();
  try {
    await client.send("Input.dispatchMouseEvent", payload);
  } finally {
    await client.detach().catch(() => {});
  }
}

async function moveMouse(page, point, buttons = 0, modifiers = 0) {
  await dispatchMouse(page, {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    buttons,
    modifiers,
  });
}

async function dispatchContextMenu(page, point) {
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    target?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: x,
        clientY: y,
      }),
    );
  }, point);
  await sleep(20);
}

async function sendDrag(page, points, button = "left", modifiers = 0) {
  if (modifiers) await page.keyboard.down("Alt");
  await page.mouse.move(points[0].x, points[0].y, { steps: 1 });
  try {
    await page.mouse.down({ button });
    await sleep(120);
    for (const point of points.slice(1)) {
      await page.mouse.move(point.x, point.y, { steps: 1 });
      await sleep(25);
    }
    await page.mouse.up({ button });
  } finally {
    if (modifiers) await page.keyboard.up("Alt");
  }
  await sleep(500);
}

async function sendRocker(page, firstButton, secondButton) {
  const point = { x: 500, y: 300 };
  const firstButtons = firstButton === "right" ? 2 : 1;
  const bothButtons = firstButtons | (secondButton === "right" ? 2 : 1);
  const client = await page.createCDPSession();
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: firstButton,
      buttons: firstButtons,
      clickCount: 1,
    });
    await sleep(80);
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: secondButton,
      buttons: bothButtons,
      clickCount: 1,
    });
    await sleep(80);
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: secondButton,
      buttons: firstButtons,
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: firstButton,
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await client.detach().catch(() => {});
  }
  await sleep(600);
}

function mouseButtonMask(button) {
  return button === "left" ? 1 : button === "right" ? 2 : button === "middle" ? 4 : 0;
}

async function runActiveGestureWhileHeld(page, point, button, holdMilliseconds, inspect) {
  const buttonMask = mouseButtonMask(button);
  assert(buttonMask, `不支持的测试鼠标按键：${button}`);
  const client = await page.createCDPSession();
  let result;
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button,
      buttons: buttonMask,
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x + 120,
      y: point.y,
      buttons: buttonMask,
    });
    await sleep(holdMilliseconds);
    result = await inspect();
  } finally {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + 120,
      y: point.y,
      button,
      buttons: 0,
      clickCount: 1,
    }).catch(() => {});
    await client.detach().catch(() => {});
  }
  await sleep(300);
  return result;
}

async function runTrustedRightGesture(
  page,
  point,
  inspect,
  { contextMenuWhileHeld = false } = {},
) {
  const client = await page.createCDPSession();
  let pending;
  let activatedWithoutDirection;
  let active;
  let afterContextMenu = null;
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "right",
      buttons: 2,
      clickCount: 1,
    });
    await sleep(80);
    pending = await inspect();
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x + 12,
      y: point.y,
      buttons: 2,
    });
    await sleep(80);
    activatedWithoutDirection = await inspect();
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x + 120,
      y: point.y,
      buttons: 2,
    });
    await sleep(100);
    active = await inspect();
    if (contextMenuWhileHeld) {
      // ACTIVE 后补发一次 trusted 右键按下，验证真实 contextmenu 会被 guard 阻止。
      await client.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: point.x + 120,
        y: point.y,
        button: "right",
        buttons: 2,
        clickCount: 1,
      });
      await sleep(100);
      afterContextMenu = await inspect();
    }
  } finally {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + 120,
      y: point.y,
      button: "right",
      buttons: 0,
      clickCount: 1,
    }).catch(() => {});
    await client.detach().catch(() => {});
  }
  await sleep(500);
  return {
    pending,
    activatedWithoutDirection,
    active,
    afterContextMenu,
    afterRelease: await inspect(),
  };
}

async function runGestureToCancelTarget(page, point, button, inspect) {
  const buttonMask = mouseButtonMask(button);
  assert(buttonMask, `不支持的测试鼠标按键：${button}`);
  const client = await page.createCDPSession();
  let matched;
  let hovered;
  let releasePoint = point;
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button,
      buttons: buttonMask,
      clickCount: 1,
    });
    for (const x of [point.x + 90, point.x - 30, point.x + 90]) {
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y: point.y,
        buttons: buttonMask,
      });
      await sleep(70);
    }
    matched = await inspect();
    assert(matched?.gestureCancelRect, "手势取消目标应提供可命中的屏幕区域");
    releasePoint = {
      x: (matched.gestureCancelRect.left + matched.gestureCancelRect.right) / 2,
      y: (matched.gestureCancelRect.top + matched.gestureCancelRect.bottom) / 2,
    };
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: releasePoint.x,
      y: releasePoint.y,
      buttons: buttonMask,
    });
    await sleep(100);
    hovered = await inspect();
  } finally {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: releasePoint.x,
      y: releasePoint.y,
      button,
      buttons: 0,
      clickCount: 1,
    }).catch(() => {});
    await client.detach().catch(() => {});
  }
  await sleep(300);
  return { matched, hovered, afterRelease: await inspect() };
}

async function runNativeMenuRetryThenMove(page, point, inspect) {
  await page.mouse.click(point.x, point.y, { button: "right" });
  await sleep(100);
  const afterFirstClick = await inspect();
  const client = await page.createCDPSession();
  let afterContextMenu;
  let afterMove;
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "right",
      buttons: 2,
      clickCount: 1,
    });
    await sleep(100);
    afterContextMenu = await inspect();
    await page.keyboard.press("Escape");
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x + 120,
      y: point.y,
      buttons: 2,
    });
    await sleep(100);
    afterMove = await inspect();
  } finally {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + 120,
      y: point.y,
      button: "right",
      buttons: 0,
      clickCount: 1,
    }).catch(() => {});
    await client.detach().catch(() => {});
  }
  await sleep(300);
  return { afterFirstClick, afterContextMenu, afterMove, afterRelease: await inspect() };
}

async function sendActiveGestureWithRocker(page, point, triggerButton = "right") {
  const firstButton = triggerButton === "right" ? "right" : "left";
  const secondButton = firstButton === "right" ? "left" : "right";
  const firstMask = mouseButtonMask(firstButton);
  const bothMasks = firstMask | mouseButtonMask(secondButton);
  const client = await page.createCDPSession();
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: firstButton,
      buttons: firstMask,
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x + 120,
      y: point.y,
      buttons: firstMask,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x + 120,
      y: point.y,
      button: secondButton,
      buttons: bothMasks,
      clickCount: 1,
    });
    await sleep(80);
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + 120,
      y: point.y,
      button: secondButton,
      buttons: firstMask,
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x + 120,
      y: point.y,
      button: firstButton,
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await client.detach().catch(() => {});
  }
  await sleep(600);
}

async function sendWheel(page, button, deltaY) {
  const point = { x: 500, y: 300 };
  const buttons = button === "right" ? 2 : button === "left" ? 1 : 4;
  const client = await page.createCDPSession();
  try {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button,
      buttons,
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: point.x,
      y: point.y,
      buttons,
      deltaX: 0,
      deltaY,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button,
      buttons: 0,
      clickCount: 1,
    });
  } finally {
    await client.detach().catch(() => {});
  }
  await sleep(500);
}

async function pointsFor(page, selector, dx, dy) {
  const box = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  return [
    box,
    { x: box.x + dx * 0.45, y: box.y + dy * 0.45 },
    { x: box.x + dx, y: box.y + dy },
  ];
}

async function turnPoints(page, selector, firstDx, firstDy, secondDx, secondDy) {
  const box = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  return [
    box,
    { x: box.x + firstDx, y: box.y + firstDy },
    { x: box.x + firstDx + secondDx, y: box.y + firstDy + secondDy },
  ];
}

async function gesturePoints(page, selector, deltas) {
  const box = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  return [box, ...deltas.map(({ x, y }) => ({ x: box.x + x, y: box.y + y }))];
}

async function centerFor(page, selector) {
  return await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function directoryFiles(directory) {
  const files = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile) files.push(entry.name);
  }
  return files;
}

async function waitForPageUrl(browser, predicate) {
  return await waitFor(async () => {
    const pages = await browser.pages();
    return pages.find((page) => predicate(page.url())) || null;
  });
}

async function waitForController(options, pageUrl) {
  await waitFor(() =>
    options.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      if (!tab?.id) return false;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "ISOLATED",
        func: () => {
          const controller = globalThis.BrowserToolboxMouseControllerInstance;
          return Boolean(
            controller?.initialized && !controller.initializing && controller.listeners?.length > 0,
          );
        },
      });
      return results[0]?.result === true;
    }, pageUrl)
  );
}

async function isolatedFrameControllers(options, pageUrl) {
  return await options.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return [];
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "ISOLATED",
      func: () => ({
        url: globalThis.location?.href || "",
        initialized: Boolean(
          globalThis.BrowserToolboxMouseControllerInstance?.initialized &&
            !globalThis.BrowserToolboxMouseControllerInstance?.initializing,
        ),
      }),
    });
    return results.map((item) => item.result).filter(Boolean);
  }, pageUrl);
}

async function isolatedRuntimeSettings(options, pageUrl) {
  return await options.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: () => ({
        controller: globalThis.BrowserToolboxMouseControllerInstance?.settings
          ?.effectiveModules,
        client: globalThis.BrowserToolboxSettingsRuntimeClientInstance?.getSettings?.()
          ?.effectiveModules,
      }),
    });
    return results[0]?.result || null;
  }, pageUrl);
}

async function isolatedControllerState(options, pageUrl) {
  return await options.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: "ISOLATED",
      func: () => {
        const controller = globalThis.BrowserToolboxMouseControllerInstance;
        const gestureHost = globalThis.document?.querySelector?.(
          ".browser-toolbox-gesture-host",
        );
        return {
          gestureState: controller?.gesture?.state || null,
          gestureTimeoutScheduled: controller?.gestureTimeoutId != null,
          gestureOverlayVisible: Boolean(
            gestureHost && globalThis.getComputedStyle?.(gestureHost).display !== "none",
          ),
          gestureHudVisible: Boolean(
            controller?.overlay?.hud && !controller.overlay.hud.hidden &&
              controller.overlay.hud.style.visibility !== "hidden",
          ),
          gestureDirectionCount: controller?.overlay?.directionTrack?.querySelectorAll?.(
            ".browser-toolbox-direction",
          )?.length || 0,
          gestureDirectionLabels: [
            ...(
              controller?.overlay?.directionTrack?.querySelectorAll?.(
                ".browser-toolbox-direction",
              ) || []
            ),
          ].map((element) => element.getAttribute("aria-label") || ""),
          gestureCommandLabel: controller?.overlay?.statusLabel?.textContent || "",
          gestureCancelLabel: controller?.overlay?.cancelLabel?.textContent || "",
          contentLocale: globalThis.BrowserToolboxI18n?.locale?.() || "",
          gestureCancelVisible:
            controller?.overlay?.cancel?.classList?.contains?.("is-visible") === true,
          gestureCancelHovered:
            controller?.overlay?.cancel?.classList?.contains?.("is-hovered") === true,
          gestureCancelRect: (() => {
            const rect = controller?.overlay?.cancelTarget?.getBoundingClientRect?.();
            return rect && rect.width > 0 && rect.height > 0
              ? {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              }
              : null;
          })(),
          bridgeActive: Boolean(
            controller?.bridge?.requestId || controller?.bridge?.port ||
              controller?.bridge?.readyTimer,
          ),
          guardActive: controller?.guard?.active === true,
          guardProvisional: controller?.guard?.provisional === true,
          guardPending: controller?.guard?.pending === true,
          nativeMenuRetryArmed: Boolean(
            controller?.guard?.nativeMenuRetryPoint &&
              controller.guard.nativeMenuRetryUntil >= Date.now(),
          ),
          commandCallCount: globalThis.__browserToolboxE2eCommandCalls?.scrollToTop || 0,
        };
      },
    });
    return results[0]?.result || null;
  }, pageUrl);
}

async function installIsolatedCommandCounter(options, pageUrl, commandName) {
  return await options.evaluate(async ({ url, command }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return false;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: "ISOLATED",
      args: [command],
      func: (name) => {
        const original = globalThis.NormalModeCommands?.[name];
        if (typeof original !== "function") return false;
        globalThis.__browserToolboxE2eCommandCalls = { [name]: 0 };
        globalThis.NormalModeCommands[name] = async function (...args) {
          globalThis.__browserToolboxE2eCommandCalls[name] += 1;
          return await original.apply(this, args);
        };
        return true;
      },
    });
    return results[0]?.result === true;
  }, { url: pageUrl, command: commandName });
}

async function closeRemotePages(browser) {
  if (!Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL")) return;
  for (const page of await browser.pages()) {
    await page.close().catch(() => {});
  }
}

async function openOptions(browser, id, errors) {
  const page = await createPage(browser, errors);
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`, { waitUntil: "load" });
  await waitForOptionsReady(page);
  return page;
}

async function waitForOptionsReady(options) {
  await options.waitForSelector("#save-settings");
  await waitFor(() =>
    options.$eval(
      ".browser-toolbox-main",
      (element) => element.dataset.settingsReady === "true",
    )
  );
  await sleep(100);
}

async function testActionRestrictedPage(browser, id, errors) {
  console.log("E2E: 动作页受限页面提示");
  const action = await createPage(browser, errors);
  await action.goto(`chrome-extension://${id}/pages/action.html`, { waitUntil: "load" });
  await action.bringToFront();
  await waitFor(() =>
    action.$eval("#not-enabled-error", (element) => getComputedStyle(element).display !== "none")
  );
  const state = await action.evaluate(() => ({
    restrictionVisible: getComputedStyle(document.querySelector("#not-enabled-error")).display !==
      "none",
    controlsHidden:
      getComputedStyle(document.querySelector("#browser-toolbox-controls")).display ===
        "none",
    restrictionText: document.querySelector("#not-enabled-error").textContent.trim(),
  }));
  assert(state.restrictionVisible, "动作页应显示受浏览器限制提示");
  assert(state.controlsHidden, "受限页面不应显示 BrowserToolbox 操作控件");
  assert(
    state.restrictionText.includes("browser") || state.restrictionText.includes("浏览器"),
    "受限页面提示应说明浏览器限制",
  );
  await action.close();
}

async function testInformationPages(browser, id, errors) {
  console.log("E2E: 扩展信息页与 CSP");
  const page = await createPage(browser, errors);
  try {
    for (
      const pagePath of [
        "pages/privacy.html",
        "pages/onboarding.html",
        "pages/project_charter.html",
        "pages/security.html",
        "pages/third_party_notices.html",
      ]
    ) {
      await page.goto(`chrome-extension://${id}/${pagePath}`, { waitUntil: "load" });
      await sleep(100);
      const state = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector("h1")?.textContent.trim() || "",
        markdownLinks: Array.from(document.querySelectorAll("a"))
          .map((link) => link.getAttribute("href") || "")
          .filter((href) => /\.md(?:[?#]|$)/i.test(href)),
      }));
      assert(state.title, `${pagePath} 应有页面标题`);
      assert(state.heading, `${pagePath} 应有一级标题`);
      assert(state.markdownLinks.length === 0, `${pagePath} 不应链接未打包的 Markdown 文件`);
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function testTabList(browser, id, base127, errors) {
  console.log("E2E: 标签页列表");
  const fixturePage = await createPage(browser, errors);
  const tabList = await createPage(browser, errors);
  try {
    await fixturePage.goto(`${base127}/one.html`, { waitUntil: "load" });
    await tabList.goto(`chrome-extension://${id}/pages/tab_list.html`, { waitUntil: "load" });
    await tabList.waitForSelector("#tabs button");
    const initial = await tabList.$$eval(
      "#tabs button",
      (buttons) => buttons.map((button) => button.textContent.trim()),
    );
    assert(initial.length >= 2, "标签页列表应显示当前隔离浏览器中的标签页");
    assert(
      await tabList.$eval("label span", (element) => element.textContent.trim()) === "Search",
      "标签页列表应应用当前英文语言设置",
    );

    await tabList.type("#query", "one");
    await waitFor(async () => {
      const matches = await tabList.$$eval(
        "#tabs button",
        (buttons) => buttons.map((button) => button.textContent.trim()),
      );
      return matches.length === 1 && matches[0].includes("one");
    });

    await tabList.$eval("#query", (input) => {
      input.value = "browser-toolbox-no-such-tab";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitFor(() => tabList.$$eval("#tabs button", (buttons) => buttons.length === 0));
  } finally {
    await tabList.close().catch(() => {});
    await fixturePage.close().catch(() => {});
  }
}

async function testVomnibar(page, base127, options) {
  console.log("E2E: B 键书签搜索浮层");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await waitForController(options, page.url());
  await page.bringToFront();
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyB");
  await page.keyboard.up("Shift");

  await waitFor(() =>
    page.evaluate(() =>
      [...document.querySelectorAll(".vimium-reset")].some((wrapper) =>
        wrapper.shadowRoot?.querySelector(
          "iframe.vomnibar-frame.vimium-ui-component-visible",
        ) != null
      )
    )
  );
  const frame = await waitFor(() =>
    page.frames().find((candidate) => candidate.url().includes("/pages/vomnibar_page.html"))
  );
  await frame.waitForSelector("#vomnibar-search");
  await waitFor(() =>
    frame.evaluate(() =>
      document.querySelector("#vomnibar-mode-label")?.textContent.trim() ===
        "Search bookmarks" &&
      document.activeElement === document.querySelector("#vomnibar-search") && innerWidth > 300
    )
  );
  const initial = await frame.evaluate(() => {
    const input = document.querySelector("#vomnibar-search");
    const panel = document.querySelector("#vomnibar");
    return {
      title: document.querySelector("#vomnibar-mode-label")?.textContent.trim() || "",
      placeholder: input?.placeholder || "",
      inputRole: input?.getAttribute("role") || "",
      controls: input?.getAttribute("aria-controls") || "",
      expanded: input?.getAttribute("aria-expanded") || "",
      inputFontSize: Number.parseFloat(getComputedStyle(input).fontSize),
      radius: Number.parseFloat(getComputedStyle(panel).borderRadius),
      focused: document.activeElement === input,
      newTabVisible: !document.querySelector("#vomnibar-disposition")?.hidden,
      frameWidth: innerWidth,
    };
  });
  assert(
    initial.title === "Search bookmarks" &&
      initial.placeholder === "Enter a bookmark title or URL" &&
      initial.inputRole === "combobox" &&
      initial.controls === "vomnibar-completions" &&
      initial.expanded === "false" &&
      initial.inputFontSize >= 18 &&
      initial.radius >= 12 &&
      initial.focused &&
      initial.newTabVisible &&
      initial.frameWidth <= 920,
    `B 键书签搜索浮层应具备本地化文案、紧凑宽度和可访问语义：${JSON.stringify(initial)}`,
  );

  await frame.type("#vomnibar-search", "browser toolbox");
  assertEqual(
    await frame.$eval("#vomnibar-search", (element) => element.value),
    "browser toolbox",
    "书签搜索输入应保持可编辑",
  );
  await page.keyboard.press("Escape");
  await waitFor(() =>
    page.evaluate(() =>
      ![...document.querySelectorAll(".vimium-reset")].some((wrapper) =>
        wrapper.shadowRoot?.querySelector(
          "iframe.vomnibar-frame.vimium-ui-component-visible",
        ) != null
      )
    )
  );

  await page.setViewport({ width: 620, height: 800 });
  await page.reload({ waitUntil: "load" });
  await waitForController(options, page.url());
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyB");
  await page.keyboard.up("Shift");
  await waitFor(() =>
    page.evaluate(() =>
      [...document.querySelectorAll(".vimium-reset")].some((wrapper) =>
        wrapper.shadowRoot?.querySelector(
          "iframe.vomnibar-frame.vimium-ui-component-visible",
        ) != null
      )
    )
  );
  const narrowFrame = await waitFor(() =>
    page.frames().find((candidate) => candidate.url().includes("/pages/vomnibar_page.html"))
  );
  await narrowFrame.waitForSelector("#vomnibar-search");
  await waitFor(() =>
    narrowFrame.evaluate(() =>
      document.activeElement === document.querySelector("#vomnibar-search") &&
      innerWidth > 300 && innerWidth <= 588
    )
  );
  const narrowState = await page.evaluate(() => {
    const iframe = [...document.querySelectorAll(".vimium-reset")]
      .map((wrapper) => wrapper.shadowRoot?.querySelector("iframe.vomnibar-frame"))
      .find(Boolean);
    return iframe
      ? { width: iframe.getBoundingClientRect().width, viewportWidth: innerWidth }
      : null;
  });
  const narrowInputFontSize = await narrowFrame.$eval(
    "#vomnibar-search",
    (element) => Number.parseFloat(getComputedStyle(element).fontSize),
  );
  assert(
    narrowState?.width <= narrowState?.viewportWidth - 32 && narrowInputFontSize >= 17,
    `窄屏搜索浮层应保留页面边距和可读输入字号：${
      JSON.stringify({
        narrowState,
        narrowInputFontSize,
      })
    }`,
  );
  await page.keyboard.press("Escape");
  await page.setViewport({ width: 1280, height: 800 });
}

async function testActionControls(browser, id, fixture, errors) {
  console.log("E2E: 动作页会话开关");
  let action = await createPage(browser, errors);
  let originalSettings;
  try {
    await fixture.bringToFront();
    await action.goto(`chrome-extension://${id}/pages/action.html`, { waitUntil: "load" });
    await waitFor(() =>
      action.$eval(
        "#browser-toolbox-controls",
        (element) => getComputedStyle(element).display !== "none",
      )
    );
    const initial = await action.evaluate(() => ({
      wheel: document.querySelector("#browser-toolbox-toggle-wheel").checked,
      label:
        document.querySelector("#browser-toolbox-toggle-wheel").labels?.[0]?.textContent.trim() ||
        document.querySelector("#browser-toolbox-toggle-wheel").getAttribute("aria-label") || "",
      help: document.querySelector("#browser-toolbox-open-help")?.textContent.trim() || "",
      title: document.title,
      lang: document.documentElement.lang,
      footerEntries: document.querySelectorAll(".browser-toolbox-action-footer > *").length,
      legacyDetails: Boolean(document.querySelector("#browser-toolbox-site-details")),
    }));
    assert(initial.wheel, "动作页应显示当前滚轮/摇杆会话状态");
    assert(/Wheel|滚轮/.test(initial.label), "动作页滚轮/摇杆开关应有可读标签");
    assert(/Open help|打开帮助/.test(initial.help), "动作页应提供打开帮助入口");
    assert(/Browser Toolbox|浏览器工具箱/.test(initial.title), "动作页标题应使用产品本地化文案");
    assert(["en", "zh-CN"].includes(initial.lang), `动作页应设置有效语言：${initial.lang}`);
    assert(
      initial.footerEntries === 3 && !initial.legacyDetails,
      "动作页不应显示旧版 Vimium 站点详情面板",
    );
    await action.evaluate(() => document.querySelector("#browser-toolbox-open-help").click()).catch(
      () => {},
    );
    await waitFor(() =>
      fixture.evaluate(() =>
        [...document.querySelectorAll(".vimium-reset")].some((wrapper) =>
          wrapper.shadowRoot?.querySelector(
            "iframe.vimium-help-dialog-frame.vimium-ui-component-visible",
          ) != null
        )
      )
    );
    const helpFrame = await waitFor(() =>
      fixture.frames().find((frame) => frame.url().includes("/pages/help_dialog_page.html"))
    );
    const helpSummary = await helpFrame.$eval("#browser-toolbox-help", (element) => ({
      text: element.textContent,
      status: element.querySelector("#browser-toolbox-help-status")?.textContent || "",
      title: element.querySelector("#browser-toolbox-help-title")?.textContent || "",
      dialogRole: element.closest("#dialog")?.getAttribute("role") || "",
      dialogLabelledBy: element.closest("#dialog")?.getAttribute("aria-labelledby") || "",
      dialogDescribedBy: element.closest("#dialog")?.getAttribute("aria-describedby") || "",
      statusRole: element.querySelector("#browser-toolbox-help-status")?.getAttribute("role") || "",
      statusLive:
        element.querySelector("#browser-toolbox-help-status")?.getAttribute("aria-live") || "",
      closeLabel: element.closest("#dialog")?.querySelector("#close")?.getAttribute("aria-label") ||
        "",
    }));
    assert(
      /Browser Toolbox Help|浏览器工具箱帮助/.test(helpSummary.title),
      "帮助页应显示浏览器工具箱帮助标题",
    );
    assert(
      /Disabled modules on this page|当前页面停用的模块/.test(helpSummary.status) &&
        /Custom pointer|自定义指针/.test(helpSummary.status),
      "帮助页应显示从顶层页面传入的当前模块状态",
    );
    assert(
      /Site Rules|站点规则/.test(helpSummary.text) &&
        /Privacy|隐私/.test(helpSummary.text),
      "帮助页应说明站点规则和隐私边界",
    );
    assert(
      helpSummary.dialogRole === "dialog" &&
        helpSummary.dialogLabelledBy === "browser-toolbox-help-dialog-title" &&
        helpSummary.dialogDescribedBy === "browser-toolbox-help-intro" &&
        helpSummary.statusRole === "status" &&
        helpSummary.statusLive === "polite" &&
        /Close|关闭/.test(helpSummary.closeLabel),
      `帮助页应提供完整对话框和状态无障碍语义：${JSON.stringify(helpSummary)}`,
    );
    await fixture.reload({ waitUntil: "load" });
    await sleep(600);
    // 真实动作弹窗在打开帮助后会关闭；重新建立一个动作页继续验证会话开关。
    action = await createPage(browser, errors);
    await fixture.bringToFront();
    await action.goto(`chrome-extension://${id}/pages/action.html`, { waitUntil: "load" });
    await waitFor(() =>
      action.$eval(
        "#browser-toolbox-controls",
        (element) => getComputedStyle(element).display !== "none",
      )
    );
    originalSettings = await action.evaluate(async () =>
      (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings
    );

    await action.$eval("#browser-toolbox-toggle-wheel", (element) => {
      element.checked = false;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(async () => {
      const stored = await action.evaluate(async () =>
        (await chrome.storage.session.get("browserToolboxSessionOverrides"))
          .browserToolboxSessionOverrides
      );
      return stored?.wheel === false && stored?.rocker === false &&
        await action.$eval("#browser-toolbox-toggle-wheel", (element) => !element.checked) &&
        await action.$eval(
          "#browser-toolbox-site-status",
          (element) => /Disabled modules|已停用模块/.test(element.textContent),
        );
    });

    await action.$eval("#browser-toolbox-toggle-wheel", (element) => {
      element.checked = true;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(async () => {
      const stored = await action.evaluate(async () =>
        (await chrome.storage.session.get("browserToolboxSessionOverrides"))
          .browserToolboxSessionOverrides
      );
      return stored?.wheel === true && stored?.rocker === true &&
        await action.$eval("#browser-toolbox-toggle-wheel", (element) => element.checked) &&
        await action.$eval(
          "#browser-toolbox-site-status",
          (element) =>
            /Disabled modules|已停用模块/.test(element.textContent) &&
            !/Wheel|滚轮|Rocker|摇杆/.test(element.textContent),
        );
    });

    await action.evaluate(() => chrome.storage.session.remove("browserToolboxSessionOverrides"));
    await waitFor(async () => {
      const state = await action.evaluate(() => ({
        session: BrowserToolboxSettingsRepositoryInstance.sessionOverrides,
        buttonDisabled: document.querySelector("#browser-toolbox-disable-session")?.disabled,
      }));
      return Object.keys(state.session || {}).length === 0 && state.buttonDisabled === false;
    });
    await action.$eval("#browser-toolbox-disable-session", (element) => element.click());
    await waitFor(async () => {
      const state = await action.evaluate(async () => ({
        session: (await chrome.storage.session.get("browserToolboxSessionOverrides"))
          .browserToolboxSessionOverrides,
        badge: document.querySelector("#browser-toolbox-site-badge")?.textContent.trim(),
        badgeDisabled: document.querySelector("#browser-toolbox-site-badge")?.classList.contains(
          "is-disabled",
        ),
        button: document.querySelector("#browser-toolbox-disable-session"),
        status: document.querySelector("#browser-toolbox-site-status")?.textContent.trim(),
        disabledStatusColors: [...document.querySelectorAll(
          ".browser-toolbox-module-status.is-disabled",
        )].map((element) => getComputedStyle(element).color),
        toggles: [...document.querySelectorAll("#browser-toolbox-enhancement-summary input")]
          .map((element) => element.checked),
      }));
      return state.session?.enabled === false &&
        /Inactive|已停用/.test(state.badge) &&
        state.badgeDisabled === true &&
        /Disabled for this session|本次会话已停用/.test(state.button?.textContent || "") &&
        state.button?.disabled === true && state.toggles.every((checked) => !checked) &&
        state.disabledStatusColors.length > 0 &&
        state.disabledStatusColors.every((color) =>
          color === "rgb(190, 18, 60)" || color === "rgb(251, 113, 133)"
        ) &&
        /Disabled modules|当前页面停用的模块/.test(state.status || "");
    });

    await action.evaluate(() => chrome.storage.session.remove("browserToolboxSessionOverrides"));
    await action.evaluate(async (pattern) => {
      const key = "browserToolboxSettings";
      const values = await chrome.storage.sync.get(key);
      const settings = BrowserToolboxSettingsSchema.mergeSettings(values[key], {
        siteRules: [{
          id: "e2e-action-rocker-only",
          matchType: "regex",
          pattern,
          enabled: true,
          modules: { rocker: false },
        }],
      });
      await chrome.storage.sync.set({ [key]: settings });
    }, originRegexPattern(fixture.url()));
    await waitFor(async () => {
      const state = await action.evaluate(() => ({
        checked: document.querySelector("#browser-toolbox-toggle-wheel").checked,
        status: document.querySelector("#browser-toolbox-site-status").textContent,
      }));
      return !state.checked && /Rocker|摇杆/.test(state.status) && !/Wheel|滚轮/.test(state.status);
    });
  } finally {
    if (originalSettings) {
      await action.evaluate(
        (settings) => chrome.storage.sync.set({ browserToolboxSettings: settings }),
        originalSettings,
      ).catch(() => {});
    }
    await action.evaluate(() => chrome.storage.session.remove("browserToolboxSessionOverrides"))
      .catch(() => {});
    await action.close().catch(() => {});
  }
}

async function testDesignFixtures(page, options, base127) {
  console.log("E2E: 设计文档 fixtures");
  for (const fileName of designFixtureFiles) {
    const url = `${base127}/fixtures/${fileName}`;
    await page.goto(url, { waitUntil: "load" });
    await sleep(300);
    await waitForController(options, page.url());
    const state = await page.evaluate(() => ({
      links: document.querySelectorAll("a").length,
      inputs: document.querySelectorAll("input").length,
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      scrollContainers: [...document.querySelectorAll("*")].filter((element) => {
        const style = getComputedStyle(element);
        return ["auto", "scroll"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight;
      }).length,
      frames: document.querySelectorAll("iframe").length,
      shadowLink: Boolean(document.querySelector("#host")?.shadowRoot?.querySelector("a")),
      draggable: document.querySelectorAll("[draggable=true]").length,
      contenteditable: document.querySelectorAll("[contenteditable=true]").length,
      images: document.querySelectorAll("img").length,
    }));
    const checks = {
      "basic-links.html": state.links >= 2,
      "inputs.html": state.inputs >= 3 && state.fileInputs >= 1,
      "scroll-containers.html": state.scrollContainers >= 1,
      "iframes.html": state.frames >= 1,
      "shadow-dom.html": state.shadowLink,
      "drag-drop-app.html": state.draggable >= 1 && state.fileInputs >= 1,
      "contenteditable.html": state.contenteditable >= 1,
      "images.html": state.images >= 1,
    };
    assert(
      checks[fileName],
      `设计文档 fixture 未满足结构断言：${fileName} ${JSON.stringify(state)}`,
    );
    if (fileName === "iframes.html") {
      await waitFor(async () => {
        const frameStates = await isolatedFrameControllers(options, page.url());
        const frameUrls = frameStates.map((item) => item.url);
        return frameUrls.includes("about:srcdoc") && frameUrls.includes("about:blank") &&
          frameStates.filter((item) => item.initialized).length >= 3;
      });
    }
  }
}

async function resetSettings(options) {
  await options.evaluate(async (key) => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.sync.remove(key);
  }, settingsKey);
  await options.$eval("#discard-changes", (element) => {
    if (!element.disabled) element.click();
  }).catch(() => {});
  await options.reload({ waitUntil: "load" });
  await waitForOptionsReady(options);
}

async function patchSettings(options, patch) {
  await options.evaluate(async ({ key, patch }) => {
    const stored = (await chrome.storage.sync.get(key))[key] || {};
    const next = BrowserToolboxSettingsSchema.mergeSettings(stored, patch);
    await chrome.storage.sync.set({ [key]: next });
  }, { key: settingsKey, patch });
  await sleep(300);
}

async function readSettings(options) {
  return await options.evaluate(
    async (key) => (await chrome.storage.sync.get(key))[key],
    settingsKey,
  );
}

async function saveOptions(options) {
  await options.$eval("#save-status", (element) => element.textContent = "");
  await options.$eval("#save-settings", (element) => element.click());
  let result;
  try {
    result = await waitFor(() =>
      options.evaluate(() => {
        const status = document.querySelector("#save-status").textContent;
        const error = document.querySelector("#settings-error").textContent;
        if (error) return `error:${error}`;
        return ["Saved", "已保存"].includes(status);
      })
    );
  } catch (error) {
    const state = await options.evaluate(() => ({
      status: document.querySelector("#save-status")?.textContent || "",
      error: document.querySelector("#settings-error")?.textContent || "",
    }));
    console.error("E2E: 设置保存等待失败", state);
    throw error;
  }
  if (result !== true) throw new Error(`设置保存失败：${result}`);
}

async function uploadFileForBrowser(page, selector, filePath, remotePath = "") {
  const input = await page.$(selector);
  if (!Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL") || remotePath) {
    await input.uploadFile(remotePath || filePath);
    return;
  }
  const bytes = await Deno.readFile(filePath);
  const fileName = filePath.split(/[\\/]/).pop() || "browser-toolbox-fixture.bin";
  const type = fileName.endsWith(".json") ? "application/json" : "image/png";
  await page.$eval(selector, (element, payload) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(payload.bytes)], payload.fileName, {
        type: payload.type,
      }),
    );
    element.files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { bytes: [...bytes], fileName, type });
}

async function importSettingsFile(
  options,
  filePath,
  { confirm = true, remotePath = "", checkFocus = false } = {},
) {
  await uploadFileForBrowser(options, "#import-settings", filePath, remotePath);
  await waitFor(() => options.$eval("#import-preview-dialog", (element) => element.open));
  const preview = await options.$eval("#import-preview-dialog", (element) => ({
    text: element.textContent,
    changed: element.querySelector("#import-preview-changed")?.textContent || "",
  }));
  await options.$eval(
    confirm ? "#import-preview-confirm" : "#import-preview-cancel",
    (element) => element.click(),
  );
  await waitFor(() => options.$eval("#import-preview-dialog", (element) => !element.open));
  if (checkFocus) {
    try {
      await waitFor(() =>
        options.$eval(
          "#import-settings",
          (element) =>
            !document.querySelector("#import-preview-dialog")?.open &&
            document.activeElement?.id === "import-settings",
        )
      );
    } catch (error) {
      const state = await options.evaluate(() => ({
        activeElement: document.activeElement?.id || "",
        importDisabled: document.querySelector("#import-settings")?.disabled,
        importConnected: document.querySelector("#import-settings")?.isConnected,
        mainBusy: document.querySelector(".browser-toolbox-main")?.getAttribute("aria-busy"),
        mainInert: document.querySelector(".browser-toolbox-main")?.hasAttribute("inert"),
        dialogOpen: document.querySelector("#import-preview-dialog")?.open,
        error: document.querySelector("#settings-error")?.textContent || "",
      }));
      throw new Error(error.message + " " + JSON.stringify(state));
    }
  }
  return preview;
}

function originRegexPattern(baseUrl) {
  const escapedOrigin = new URL(baseUrl).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escapedOrigin}/.*$`;
}

async function testOptionsAccessibility(options) {
  console.log("E2E: 设置页键盘和无障碍语义");
  await waitFor(() =>
    options.$eval(".browser-toolbox-nav-item", (element) => element.getAttribute("role") === "tab")
  );
  const semantics = await options.evaluate(() => {
    const controls = [...document.querySelectorAll("input, select, textarea")];
    const unnamed = controls.filter((control) => {
      if (control.type === "hidden") return false;
      return !control.getAttribute("aria-label") && !control.labels?.length;
    });
    const categories = [...document.querySelectorAll("[data-nav-category]")];
    const tablists = [...document.querySelectorAll("[role=tablist]")];
    const tabs = [...document.querySelectorAll("[role=tab]")];
    const panels = [...document.querySelectorAll("[role=tabpanel]")];
    return {
      tablists: tablists.length,
      verticalTablists: tablists.every(
        (tablist) => tablist.getAttribute("aria-orientation") === "vertical",
      ),
      categories: categories.length,
      validCategories: categories.every(
        (category) =>
          category.getAttribute("aria-controls") &&
          category.getAttribute("aria-expanded") !== null,
      ),
      tabs: tabs.length,
      validTabs: tabs.every((tab) => tab.getAttribute("aria-controls") && tab.id),
      panels: panels.length,
      validPanels: panels.every((panel) => panel.getAttribute("aria-labelledby")),
      unnamed: unnamed.map((control) => control.id || control.outerHTML.slice(0, 80)),
      navCategoryFontSize: Number.parseFloat(
        getComputedStyle(document.querySelector(".browser-toolbox-nav-category")).fontSize,
      ),
      navItemFontSize: Number.parseFloat(
        getComputedStyle(document.querySelector(".browser-toolbox-nav-item")).fontSize,
      ),
      searchLabelFontSize: Number.parseFloat(
        getComputedStyle(document.querySelector(".browser-toolbox-settings-search")).fontSize,
      ),
    };
  });
  assert(
    semantics.tablists === 3 && semantics.verticalTablists,
    `设置页二级导航应声明垂直标签组：${JSON.stringify(semantics)}`,
  );
  assert(
    semantics.categories === 3 && semantics.validCategories,
    `设置页一级导航应具备展开语义：${JSON.stringify(semantics)}`,
  );
  assert(
    semantics.tabs === 15 && semantics.validTabs,
    `设置页导航按钮应具备完整 tab 语义：${JSON.stringify(semantics)}`,
  );
  assert(
    semantics.panels === 15 && semantics.validPanels,
    `设置页面板应具备完整 tabpanel 语义：${JSON.stringify(semantics)}`,
  );
  assertEqual(
    semantics.unnamed.length,
    0,
    `设置页表单控件应有可访问名称：${JSON.stringify(semantics)}`,
  );
  assert(
    semantics.navCategoryFontSize >= 15 && semantics.navItemFontSize >= 15 &&
      semantics.searchLabelFontSize >= 13,
    `设置页侧栏文字应保持清晰可读：${JSON.stringify(semantics)}`,
  );
  const settingsTitle = await options.title();
  assert(
    ["Browser Toolbox", "浏览器工具箱"].includes(settingsTitle),
    `设置页标题应使用本地化 Browser Toolbox 标识：实际为 ${JSON.stringify(settingsTitle)}`,
  );

  await options.focus("#settings-section-search");
  await options.keyboard.type("site");
  await waitFor(() =>
    options.$eval(
      ".browser-toolbox-nav-item:not([hidden])",
      (element) => element.dataset.section === "siteRules",
    )
  );
  const searchState = await options.evaluate(() => ({
    visibleSections: [...document.querySelectorAll(".browser-toolbox-nav-item:not([hidden])")]
      .map((element) => element.dataset.section),
    hiddenGroups: [...document.querySelectorAll(".browser-toolbox-nav-group")]
      .filter((element) => element.hidden)
      .map((element) => element.dataset.navGroup),
    status: document.querySelector("#settings-search-status")?.textContent || "",
  }));
  assertEqual(
    searchState.visibleSections.join("|"),
    "siteRules",
    `设置分区搜索应只保留匹配的站点分区：${JSON.stringify(searchState)}`,
  );
  assert(searchState.status.length > 0, "设置分区搜索应提供可访问结果状态");
  assertEqual(
    await options.$eval(
      "#settings-section-search",
      (element) => element.getAttribute("aria-controls"),
    ),
    "browser-toolbox-settings-nav",
    "设置搜索应显式关联多级导航",
  );
  await options.keyboard.press("Escape");
  await waitFor(() =>
    options.$eval(
      ".browser-toolbox-nav-item:not([hidden])",
      (element) =>
        [...document.querySelectorAll(".browser-toolbox-nav-item:not([hidden])")].length === 15,
    )
  );
  await options.focus("#settings-section-search");
  const fieldSearchQuery = await options.$eval(
    "html",
    (element) =>
      element.lang.toLocaleLowerCase().startsWith("zh") ? "激活距离" : "activation distance",
  );
  await options.keyboard.type(fieldSearchQuery);
  await waitFor(() =>
    options.$eval(
      ".browser-toolbox-nav-item:not([hidden])",
      (element) => element.dataset.section === "mouse",
    )
  );
  assertEqual(
    await options.$$eval(
      ".browser-toolbox-nav-item:not([hidden])",
      (elements) => elements.map((element) => element.dataset.section).join("|"),
    ),
    "mouse",
    "设置搜索应能通过字段标签定位对应分区",
  );
  await options.keyboard.press("Escape");
  await waitFor(() =>
    options.$$eval(
      ".browser-toolbox-nav-item:not([hidden])",
      (elements) => elements.length === 15,
    )
  );

  await options.focus(".browser-toolbox-nav-item");
  await options.keyboard.press("End");
  await waitFor(() =>
    options.$eval(
      ".browser-toolbox-nav-item[data-section='backupAbout']",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  await options.keyboard.press("Home");
  await waitFor(() =>
    options.$eval(
      ".browser-toolbox-nav-item:first-child",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  await waitFor(() =>
    options.$eval(
      "button[data-section='mouse']",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  assert(
    await options.$eval(
      "[data-nav-category='browsingEnhancement']",
      (element) => element.getAttribute("aria-expanded") === "true",
    ),
    "切换二级导航时应自动展开所属一级分类",
  );
  assert(
    await options.$eval(
      "#browser-toolbox-subnav-system",
      (element) => !element.hidden,
    ),
    "设置页应同时展示三个稳定的一级分类",
  );
  await options.keyboard.press("ArrowDown");
  await waitFor(() =>
    options.$eval(
      "button[data-section='superDrag']",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  await options.keyboard.press("ArrowUp");
  await waitFor(() =>
    options.$eval(
      "button[data-section='mouse']",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  await options.$eval("button[data-section='keyboard']", (element) => element.click());
  assert(
    await options.$eval(
      "#keyboard-enabled",
      (element) => element.type === "checkbox" && element.checked,
    ),
    "键盘分区应提供可编辑的全局启用开关",
  );
  await options.$eval("button[data-section='siteRules']", (element) => element.click());
  await waitFor(() =>
    options.$eval(
      "button[data-section='siteRules']",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  assert(
    await options.$eval(
      "[data-nav-category='system']",
      (element) => element.getAttribute("aria-expanded") === "true",
    ),
    "点击一级分类时应展开该分类并选中第一个二级页面",
  );
  await options.$eval("button[data-section='mouse']", (element) => element.click());
  await waitFor(() =>
    options.$eval(
      "button[data-section='mouse']",
      (element) => element.getAttribute("aria-selected") === "true",
    )
  );
  await options.click("#mouse-advanced-settings summary");

  await options.focus("#gesture-pattern-input");
  await options.keyboard.type("L>R");
  assertEqual(
    await options.$eval("#gesture-preview", (element) => element.textContent),
    "← · →",
    "旧字母轨迹输入应更新为箭头预览",
  );
  await options.focus("#add-gesture-binding");
  assertEqual(
    await options.$eval("#gesture-pattern-input", (element) => element.value),
    "← · →",
    "轨迹输入失焦后应规范化为箭头",
  );
  await options.keyboard.press("Enter");
  assert(
    await options.$eval(
      "#mouse-bindings",
      (element) =>
        [...element.querySelectorAll("input.browser-toolbox-binding-pattern")].some((input) =>
          input.value === "← · →" && input.dataset.pattern === "L>R"
        ),
    ),
    "键盘轨迹输入应以箭头添加绑定并保留内部方向 token",
  );

  const mediaClient = await options.createCDPSession();
  await mediaClient.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "forced-colors", value: "active" },
      { name: "prefers-contrast", value: "more" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await options.setViewport({ width: 480, height: 800 });
  const responsive = await options.evaluate(() => ({
    forcedColors: matchMedia("(forced-colors: active)").matches,
    highContrast: matchMedia("(prefers-contrast: more)").matches,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    transitionDuration:
      getComputedStyle(document.querySelector(".browser-toolbox-nav-chevron")).transitionDuration,
    transitionMilliseconds: (() => {
      const value =
        getComputedStyle(document.querySelector(".browser-toolbox-nav-chevron")).transitionDuration;
      const number = Number.parseFloat(value);
      return value.endsWith("s") && !value.endsWith("ms") ? number * 1000 : number;
    })(),
    layout: getComputedStyle(document.querySelector(".browser-toolbox-layout")).display,
  }));
  assert(
    responsive.forcedColors && responsive.highContrast && responsive.reducedMotion,
    "设置页应响应高对比度和低动效媒体特征",
  );
  assert(
    responsive.transitionMilliseconds <= 0.1,
    `设置页低动效模式应关闭过渡动画：${JSON.stringify(responsive)}`,
  );
  assertEqual(responsive.layout, "block", "设置页窄视口应切换为单列布局");
  await mediaClient.send("Emulation.setEmulatedMedia", { features: [] });
  await mediaClient.detach();
  await options.setViewport({ width: 1280, height: 800 });
}

async function testOptionsAndBackup(
  options,
  base127,
  tempDir,
  page,
  browser,
  remoteDownloadPath = "",
) {
  await options.$eval("button[data-section='general']", (element) => element.click());
  const generalUi = await options.evaluate(() => ({
    globalShowHud: document.querySelector("#global-show-hud")?.checked,
    browserSyncEnabled: document.querySelector("#browser-sync-enabled")?.checked,
    browserSyncNote: document.querySelector("[data-i18n='browserSyncNote']")?.textContent.trim(),
  }));
  assert(generalUi.globalShowHud, "常规设置应显示已启用的工具箱命令提示开关");
  assert(generalUi.browserSyncEnabled, "常规设置应默认启用浏览器同步设置");
  assert(generalUi.browserSyncNote, "常规设置应说明关闭同步后的本地存储行为");
  await options.$eval("#global-show-hud", (element) => {
    element.checked = false;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await options.$eval("#browser-sync-enabled", (element) => {
    element.checked = false;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await saveOptions(options);
  const localSettingsState = await options.evaluate(async () => ({
    sync: (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
    local: (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
  }));
  assertEqual(localSettingsState.sync, undefined, "关闭浏览器同步后不应保留同步配置副本");
  assertEqual(
    localSettingsState.local.general.browserSyncEnabled,
    false,
    "关闭浏览器同步后应写入本地配置",
  );
  assertEqual(localSettingsState.local.general.showHud, false, "全局命令提示开关应写入本地配置");
  await options.$eval("#global-show-hud", (element) => {
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await options.$eval("#browser-sync-enabled", (element) => {
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await saveOptions(options);
  const syncSettingsState = await options.evaluate(async () => ({
    sync: (await chrome.storage.sync.get("browserToolboxSettings")).browserToolboxSettings,
    local: (await chrome.storage.local.get("browserToolboxSettings")).browserToolboxSettings,
  }));
  assertEqual(syncSettingsState.local, undefined, "恢复浏览器同步后不应保留本地配置副本");
  assertEqual(
    syncSettingsState.sync.general.browserSyncEnabled,
    true,
    "恢复浏览器同步后应写入同步配置",
  );
  assertEqual(syncSettingsState.sync.general.showHud, true, "恢复全局命令提示开关应写入同步配置");

  await options.$eval("button[data-section='keyboard']", (element) => element.click());
  await options.$eval("#keyboard-enabled", (element) => {
    element.checked = false;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await saveOptions(options);
  assertEqual(
    (await readSettings(options)).keyboard.enabled,
    false,
    "设置页应保存键盘模块全局开关",
  );
  await options.$eval("#keyboard-enabled", (element) => {
    element.checked = true;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await saveOptions(options);
  assertEqual(
    (await readSettings(options)).keyboard.enabled,
    true,
    "设置页应恢复键盘模块全局开关",
  );
  console.log("E2E: 设置页保存");
  await options.$eval("button[data-section='mouse']", (element) => element.click());
  const bindingUi = await options.evaluate(() => ({
    dangerousWarnings: document.querySelectorAll(".browser-toolbox-dangerous-warning").length,
    optionEditors: document.querySelectorAll(".browser-toolbox-options-json").length,
    linkCommandsInMouse: [...document.querySelectorAll("#mouse-bindings option")]
      .some((option) => option.value === "BrowserToolbox.openLinkForeground"),
    reloadOptions: [...document.querySelectorAll("#mouse-bindings tr")]
      .map((row) =>
        row.querySelector("select")?.value === "reload"
          ? row.querySelector(".browser-toolbox-options-json")?.value
          : null
      )
      .filter(Boolean),
  }));
  assert(
    bindingUi.dangerousWarnings > 0,
    `设置页应显示危险命令警告：${JSON.stringify(bindingUi)}`,
  );
  assert(bindingUi.optionEditors > 0, "设置页应为绑定提供 options 编辑器");
  assert(!bindingUi.linkCommandsInMouse, "鼠标轨迹不应展示需要链接上下文的命令");
  assertEqual(
    bindingUi.reloadOptions.some((value) => JSON.parse(value).hard === true),
    true,
    "设置页应保留默认刷新命令 options",
  );
  await options.$eval("button[data-section='superDrag']", (element) => element.click());
  assert(
    await options.$eval(
      "#native-bypass-modifier",
      (element) => element.tagName === "SELECT" && element.value === "Alt",
    ),
    "超级拖拽应提供原生拖拽旁路修饰键选择器",
  );
  await options.select("#native-bypass-modifier", "Control");
  await saveOptions(options);
  assertEqual(
    (await readSettings(options)).superDrag.nativeBypassModifier,
    "Control",
    "超级拖拽旁路修饰键应可保存",
  );
  await options.select("#native-bypass-modifier", "Alt");
  await saveOptions(options);
  const superDragBefore = await options.$$eval(
    "#super-drag-bindings tr",
    (rows) => rows.length,
  );
  assert(
    await options.$eval(
      "#super-drag-bindings tr input.browser-toolbox-binding-pattern",
      (element) => Boolean(element),
    ),
    "超级拖拽绑定应可编辑轨迹",
  );
  await options.$eval("#add-super-drag-binding", (element) => element.click());
  assertEqual(
    await options.$$eval("#super-drag-bindings tr", (rows) => rows.length),
    superDragBefore + 1,
    "超级拖拽应支持新增绑定",
  );
  await options.$eval("#super-drag-bindings tr:last-child button", (element) => element.click());
  await options.$eval("button[data-section='wheel']", (element) => element.click());
  const wheelBefore = await options.$$eval("#wheel-bindings tr", (rows) => rows.length);
  await options.$eval("#add-wheel-binding", (element) => element.click());
  assertEqual(
    await options.$$eval("#wheel-bindings tr", (rows) => rows.length),
    wheelBefore + 1,
    "滚轮应支持新增绑定",
  );
  await options.$eval("#wheel-bindings tr:last-child button", (element) => element.click());
  await options.$eval("button[data-section='general']", (element) => element.click());
  await options.select("#language", "en");
  await options.select("#trigger-button", "1");
  console.log("E2E: 已选择语言");
  await options.$eval("#activation-distance", (element) => {
    element.value = "37";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  console.log("E2E: 已填写激活距离");
  await saveOptions(options);
  console.log("E2E: 首次保存完成");
  const savedMouseSettings = (await readSettings(options)).mouse;
  assertEqual(savedMouseSettings.activationDistancePx, 37, "设置页保存激活距离");
  assertEqual(savedMouseSettings.triggerButton, 1, "设置页保存手势触发按键");

  await options.$eval("#activation-distance", (element) => {
    element.value = "53";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert(
    await options.$eval("#save-settings", (element) => !element.disabled),
    "修改表单后保存按钮应启用",
  );
  await options.$eval("#discard-changes", (element) => element.click());
  assertEqual(
    await options.$eval("#activation-distance", (element) => element.value),
    "37",
    "放弃修改应恢复已保存草稿",
  );

  // 模拟另一个页面/设备在 storage.onChanged 通知尚未到达前修改 Vimium 的无关字段；
  // 本页保存 BrowserToolbox 设置时不得把该字段覆盖回旧快照。
  await options.evaluate(async () => {
    await chrome.storage.sync.set({ scrollStepSize: 123 });
  });
  await options.$eval("#activation-distance", (element) => {
    element.value = "38";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await saveOptions(options);
  assertEqual(
    await options.evaluate(async () =>
      (await chrome.storage.sync.get("scrollStepSize"))
        .scrollStepSize
    ),
    123,
    "保存 BrowserToolbox 设置不得覆盖外部刚修改的 Vimium 无关字段",
  );

  const client = await options.createCDPSession();
  const remoteBrowserDownloadClient = remoteDownloadPath
    ? await browser.target().createCDPSession()
    : null;
  let remoteExportCompleted = false;
  if (remoteBrowserDownloadClient) {
    remoteBrowserDownloadClient.on("Browser.downloadProgress", (event) => {
      if (event.state === "completed") remoteExportCompleted = true;
    });
    await remoteBrowserDownloadClient.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: remoteDownloadPath,
      eventsEnabled: true,
    });
  } else {
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: tempDir });
  }
  await options.$eval("button[data-section='backupAbout']", (element) => element.click());
  await options.$eval("#export-settings", (element) => element.click());
  console.log("E2E: 等待设置导出");
  const exportPath = `${tempDir}/browser-toolbox-settings.json`;
  const remoteExportPath = remoteDownloadPath
    ? `${remoteDownloadPath}\\browser-toolbox-settings.json`
    : "";
  if (remoteBrowserDownloadClient) {
    await waitFor(() => remoteExportCompleted, 10000);
  } else {
    await waitFor(async () => {
      try {
        const info = await Deno.stat(exportPath);
        return info.isFile;
      } catch (_) {
        return false;
      }
    });
  }

  await options.$eval("button[data-section='mouse']", (element) => element.click());
  await options.$$eval("#mouse-bindings tr", (rows) => {
    const row = rows.find((candidate) => candidate.querySelector("select")?.value === "reload");
    const options = row?.querySelector(".browser-toolbox-options-json");
    if (!options) throw new Error("reload binding options editor missing");
    options.value = '{"hard":false}';
    options.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await options.$eval("#activation-distance", (element) => {
    element.value = "61";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await saveOptions(options);
  const optionsSavedSettings = await readSettings(options);
  assertEqual(optionsSavedSettings.mouse.activationDistancePx, 61, "导入前修改激活距离");
  const reloadBinding = optionsSavedSettings.mouse.bindings.find((binding) =>
    binding.commandName === "reload"
  );
  assertEqual(reloadBinding.options.hard, false, "绑定 options 编辑应写入配置");

  console.log("E2E: 导入有效设置");
  await options.evaluate(() => globalThis.confirm = () => true);
  await options.$eval("#save-status", (element) => element.textContent = "");
  await options.$eval("button[data-section='backupAbout']", (element) => element.click());
  const cancelledImportPreview = await importSettingsFile(options, exportPath, {
    confirm: false,
    remotePath: remoteExportPath,
    checkFocus: true,
  });
  assert(
    /activationDistancePx|激活距离/.test(cancelledImportPreview.text),
    "导入预览应显示设置变更",
  );
  assertEqual(
    await options.$eval("#import-settings", (element) => document.activeElement?.id),
    "import-settings",
    "取消导入后焦点应返回文件选择控件",
  );
  assertEqual((await readSettings(options)).mouse.activationDistancePx, 61, "取消导入不应写入设置");
  const confirmedImportPreview = await importSettingsFile(options, exportPath, {
    remotePath: remoteExportPath,
  });
  assert(
    /activationDistancePx|激活距离/.test(confirmedImportPreview.changed),
    "导入预览应显示修改项",
  );
  await waitFor(async () => (await readSettings(options)).mouse.activationDistancePx === 38);
  assertEqual((await readSettings(options)).mouse.activationDistancePx, 38, "设置导入恢复激活距离");

  console.log("E2E: 拒绝非法设置");
  const invalidPath = `${tempDir}/invalid-browser-toolbox.json`;
  await Deno.writeTextFile(
    invalidPath,
    JSON.stringify({
      format: "browser-toolbox-settings",
      settings: { schemaVersion: 4, mouse: { activationDistancePx: 999 } },
    }),
  );
  await uploadFileForBrowser(options, "#import-settings", invalidPath);
  await waitFor(() =>
    options.evaluate(() => document.querySelector("#settings-error").textContent.length > 0)
  );
  assertEqual(
    (await readSettings(options)).mouse.activationDistancePx,
    38,
    "非法导入不覆盖现有设置",
  );

  console.log("E2E: 报告规范导出中的未知字段");
  const unknownExportPath = `${tempDir}/browser-toolbox-unknown-fields.json`;
  await Deno.writeTextFile(
    unknownExportPath,
    JSON.stringify({
      format: "browser-toolbox-settings",
      formatVersion: 1,
      settings: {
        schemaVersion: 4,
        general: { futureGeneralOption: true },
        mouse: { activationDistancePx: 38 },
        futureSection: { enabled: true },
      },
      localAssets: [{ id: "local-only", data: "not-imported" }],
      futureWrapperField: true,
    }),
  );
  const unknownPreview = await importSettingsFile(options, unknownExportPath, { confirm: false });
  assert(
    /futureWrapperField|futureSection|localAssets/.test(unknownPreview.text),
    "规范导入预览应列出未知字段和本地资源",
  );
  assertEqual(
    (await readSettings(options)).mouse.activationDistancePx,
    38,
    "取消未知字段导入不写入",
  );
  await importSettingsFile(options, unknownExportPath);
  await waitFor(() =>
    options.$eval(
      "#settings-error",
      (element) => /Ignored fields|已忽略字段/.test(element.textContent),
    )
  );
  assertEqual(
    (await readSettings(options)).mouse.activationDistancePx,
    38,
    "确认未知字段导入不应改变未携带的现有设置",
  );
  const importedUnknownSettings = await readSettings(options);
  assertEqual(
    importedUnknownSettings.futureSection?.enabled,
    true,
    "确认导入应保留未知设置分区",
  );
  assertEqual(
    importedUnknownSettings.general?.futureGeneralOption,
    true,
    "确认导入应保留未知设置字段",
  );

  console.log("E2E: 旧版导出格式迁移");
  const legacyExportPath = `${tempDir}/open-key-mouse-settings.json`;
  await Deno.writeTextFile(
    legacyExportPath,
    JSON.stringify({
      format: "open-key-mouse-settings",
      formatVersion: 1,
      exportedAt: "2026-08-23T00:00:00.000Z",
      extensionVersion: "0.0.0",
      source: "OpenKeyMouse",
      settings: {
        schemaVersion: 0,
        gestureBindings: [{
          id: "legacy-new-window",
          enabled: true,
          pattern: ["R"],
          commandName: "OpenKeyMouse.newWindow",
          options: {},
        }],
      },
      localAssets: [],
    }),
  );
  await importSettingsFile(options, legacyExportPath);
  await waitFor(async () => {
    const migrated = await readSettings(options);
    return migrated?.schemaVersion === 5 &&
      migrated.mouse?.bindings?.[0]?.pattern?.join(",") === "R";
  });
  const importedLegacy = await readSettings(options);
  assertEqual(
    importedLegacy.mouse.bindings[0].commandName,
    "BrowserToolbox.newWindow",
    "旧版导出中的命令名应迁移到 BrowserToolbox 命名空间",
  );

  console.log("E2E: 旧版存储键与指针资源迁移");
  const legacyCursorAssetId = "openKeyMouseCursor-legacy-asset";
  const legacyStoredSettings = {
    schemaVersion: 0,
    gestureBindings: [{
      id: "legacy-back",
      enabled: true,
      pattern: ["L"],
      commandName: "OpenKeyMouse.newWindow",
      options: {},
    }],
    cursor: { enabled: true, localAssetId: legacyCursorAssetId, hotspotX: 0, hotspotY: 0 },
  };
  await options.evaluate(async ({ assetId, asset, settings }) => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set({ [assetId]: asset });
    await chrome.storage.sync.set({ openKeyMouseSettings: settings });
    // 先写入旧键再移除规范键，避免清空事件触发默认配置迁移并与旧键写入竞态。
    await chrome.storage.sync.remove("browserToolboxSettings");
    await chrome.storage.session.set({ openKeyMouseSessionOverrides: { mouse: false } });
  }, {
    assetId: legacyCursorAssetId,
    asset: `data:image/png;base64,${btoa(String.fromCharCode(...pngBytes))}`,
    settings: legacyStoredSettings,
  });
  await options.reload({ waitUntil: "load" });
  await waitForOptionsReady(options);
  await waitFor(async () =>
    options.evaluate(async () => {
      const settings = (await chrome.storage.sync.get("browserToolboxSettings"))
        .browserToolboxSettings;
      return settings?.schemaVersion === 5 &&
        settings.mouse?.bindings?.[0]?.pattern?.join(",") === "L" &&
        settings.mouse?.bindings?.[0]?.commandName === "BrowserToolbox.newWindow";
    })
  );
  const migratedLegacyStorage = await readSettings(options);
  assertEqual(
    migratedLegacyStorage.mouse.bindings[0].commandName,
    "BrowserToolbox.newWindow",
    "旧版存储键中的命令名应迁移到 BrowserToolbox 命名空间",
  );
  assertEqual(
    migratedLegacyStorage.cursor.localAssetId,
    legacyCursorAssetId,
    "旧版本地指针资源键应继续可读取",
  );
  const storageMigrationState = await options.evaluate(async () => ({
    sync: await chrome.storage.sync.get(["browserToolboxSettings", "openKeyMouseSettings"]),
    session: await chrome.storage.session.get([
      "browserToolboxSessionOverrides",
      "openKeyMouseSessionOverrides",
    ]),
    backup: (await chrome.storage.local.get("browserToolboxSettingsMigrationBackup"))
      .browserToolboxSettingsMigrationBackup,
  }));
  assert(storageMigrationState.sync.browserToolboxSettings, "旧版存储键应写入规范设置键");
  assert(storageMigrationState.sync.openKeyMouseSettings, "旧版设置键应保留以支持回滚");
  assert(storageMigrationState.session.browserToolboxSessionOverrides, "旧版会话覆盖应写入规范键");
  assert(storageMigrationState.session.openKeyMouseSessionOverrides, "旧版会话覆盖键应保留");
  assertEqual(storageMigrationState.backup.schemaVersion, 0, "迁移前设置应保存本地备份");
  await page.reload({ waitUntil: "load" });
  await sleep(500);
  assert(
    await page.evaluate(() =>
      Boolean(document.querySelector("style[data-browser-toolbox-cursor]"))
    ),
    "旧版本地 PNG 指针资源应在真实页面中继续生效",
  );

  console.log("E2E: 保存站点规则");
  await options.$eval("button[data-section='siteRules']", (element) => element.click());
  const defaultSiteRules = await options.evaluate(() => ({
    patterns: [...document.querySelectorAll("#site-rules tr input[data-field='pattern']")]
      .map((element) => element.value),
    disabledMouse: document.querySelector(
      "#site-rules tr[data-rule-id='builtin-google-docs'] input[data-module='mouse']",
    )?.checked,
  }));
  assert(
    defaultSiteRules.patterns.includes("https://docs.google.com/*"),
    `新安装默认应提供高冲突站点规则：${JSON.stringify(defaultSiteRules)}`,
  );
  assertEqual(defaultSiteRules.disabledMouse, true, "默认高冲突规则应停用鼠标模块");
  await options.$eval(
    "#site-rules tr[data-rule-id='builtin-google-docs'] button[data-action='removeRule']",
    (element) => element.click(),
  );
  await saveOptions(options);
  const afterDefaultRemoval = await readSettings(options);
  assert(
    !afterDefaultRemoval.siteRules.some((rule) => rule.id === "builtin-google-docs"),
    "默认高冲突站点规则应可以删除并保存",
  );
  await patchSettings(options, { siteRules: [] });
  await options.reload({ waitUntil: "load" });
  await waitForOptionsReady(options);
  await options.$eval("button[data-section='siteRules']", (element) => element.click());
  await options.$eval("#add-site-rule", (element) => element.click());
  const siteRuleUi = await options.evaluate(() => ({
    actionHeader: document.querySelector("section[data-panel='siteRules'] thead th:last-child")
      ?.textContent.trim(),
    addRuleLabel: document.querySelector("#add-site-rule")?.textContent.trim(),
    order: document.querySelector(".browser-toolbox-rule-priority")?.textContent.trim(),
  }));
  assert(
    /Actions|操作/.test(siteRuleUi.actionHeader),
    `网站规则末列表头应明确表示操作列：${siteRuleUi.actionHeader}`,
  );
  assert(
    /Add rule|添加规则/.test(siteRuleUi.addRuleLabel),
    `网站规则按钮应使用规则语义文案：${siteRuleUi.addRuleLabel}`,
  );
  assert(
    /Configuration order: 1|配置顺序: 1/.test(siteRuleUi.order),
    `网站规则应显示配置顺序：${siteRuleUi.order}`,
  );
  const siteRulePattern = originRegexPattern(base127);
  await options.$eval("#site-rules tr:last-child input", (element, pattern) => {
    element.value = pattern;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, siteRulePattern);
  await options.$eval("#site-rules tr:last-child select[data-field='matchType']", (element) => {
    element.value = "regex";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await options.$eval("#site-rules tr:last-child input[data-field='pattern']", (element) => {
    element.value = "^chrome-extension://.*$";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await options.$eval("#site-rule-test-url", (element, url) => {
    element.value = url;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, `${base127}/fixture.html`);
  await options.$eval("#test-site-rules", (element) => element.click());
  assert(
    await options.$eval(
      "#site-rule-test-result",
      (element) => /does not match|没有匹配/.test(element.textContent),
    ),
    "网站规则测试应报告输入网址未命中正则",
  );
  await options.$eval(
    "#site-rules tr:last-child input[data-field='pattern']",
    (element, pattern) => {
      element.value = pattern;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    siteRulePattern,
  );
  await options.$eval("#test-site-rules", (element) => element.click());
  const fixtureHostname = new URL(base127).hostname;
  assert(
    await options.$eval(
      "#site-rule-test-result",
      (element, hostname) =>
        /matches|匹配到/.test(element.textContent) &&
        /Effective modules|最终模块状态/.test(element.textContent) &&
        /All modules|所有模块/.test(element.textContent) &&
        element.title.includes(hostname),
      fixtureHostname,
    ),
    "网站规则测试应报告输入网址命中正则、最终模块状态并显示测试网址",
  );
  const ruleExplanation = await options.evaluate(() => ({
    hidden: document.querySelector("#site-rule-test-explanation")?.hidden,
    matchedRules: [...document.querySelectorAll("#site-rule-test-matches li")]
      .map((element) => element.textContent),
    effective: document.querySelector("#site-rule-test-effective")?.textContent || "",
  }));
  assert(
    !ruleExplanation.hidden && ruleExplanation.matchedRules.length === 1 &&
      /Regular expression|正则表达式/.test(ruleExplanation.matchedRules[0]) &&
      /Effective modules|最终模块状态/.test(ruleExplanation.effective),
    `网站规则测试应展示完整命中解释：${JSON.stringify(ruleExplanation)}`,
  );
  await options.$eval(
    "#site-rules tr:last-child button[data-action='duplicateRule']",
    (element) => element.click(),
  );
  assertEqual(
    await options.$$eval("#site-rules tr", (rows) => rows.length),
    2,
    "网站规则应支持复制",
  );
  await options.$eval(
    "#site-rules tr:last-child button[data-action='moveUp']",
    (element) => element.click(),
  );
  await options.$eval(
    "#site-rules tr:last-child button[data-action='removeRule']",
    (element) => element.click(),
  );
  const firstRuleCheckboxes = await options.$$("#site-rules tr:last-child input[type=checkbox]");
  assert(firstRuleCheckboxes.length > 0, "站点规则应渲染模块复选框");
  await options.evaluate(() => {
    document.querySelector("#site-rules tr:last-child input[data-module='mouse']")?.click();
  });
  await options.$eval("#test-site-rules", (element) => element.click());
  assert(
    await options.$eval(
      "#site-rule-test-result",
      (element) => /Disabled modules|已停用模块/.test(element.textContent),
    ),
    "网站规则测试应解释被停用的模块",
  );
  await saveOptions(options);
  const savedRule = (await readSettings(options)).siteRules.find((rule) =>
    rule.pattern === siteRulePattern
  );
  assertEqual(savedRule.matchType, "regex", "站点规则保存正则匹配方式");
  assertEqual(savedRule.pattern, siteRulePattern, "站点规则保存正则表达式");
  assertEqual(savedRule.modules.mouse, false, "站点规则保存鼠标禁用状态");

  console.log("E2E: Vimium 备份迁移");
  const vimiumBackupPath = `${tempDir}/vimium-backup.json`;
  await Deno.writeTextFile(
    vimiumBackupPath,
    JSON.stringify({
      keyMappings: "map x scrollDown",
      searchEngines: "l: http://127.0.0.1/search?q=%s Local",
      unknownField: "must be ignored",
    }),
  );
  await options.evaluate(() => globalThis.confirm = () => true);
  await importSettingsFile(options, vimiumBackupPath);
  await waitFor(() => options.evaluate(() => Settings.get("keyMappings") === "map x scrollDown"));
  const vimiumImportStatus = await options.$eval(
    "#settings-error",
    (element) => element.textContent,
  );
  assert(
    /Ignored fields|忽略字段/.test(vimiumImportStatus),
    `Vimium 备份中的未知字段应被报告并忽略：${vimiumImportStatus}`,
  );

  console.log("E2E: 配置逐级迁移");
  await options.evaluate(async (key) => {
    await chrome.storage.sync.set({
      [key]: { schemaVersion: 0, gestureBindings: [{ pattern: ["L"], commandName: "goBack" }] },
    });
  }, settingsKey);
  await options.reload({ waitUntil: "load" });
  await waitForOptionsReady(options);
  await waitFor(() =>
    options.evaluate(
      (key) => chrome.storage.sync.get(key).then((items) => items[key]?.schemaVersion === 5),
      settingsKey,
    )
  );
  const migrated = await readSettings(options);
  assert(
    migrated.mouse.bindings[0].pattern.join(",") === "L",
    "旧版 gestureBindings 应迁移到 mouse.bindings",
  );
  const migrationBackup = await options.evaluate(async () =>
    (await chrome.storage.local.get("browserToolboxSettingsMigrationBackup"))
      .browserToolboxSettingsMigrationBackup
  );
  assertEqual(migrationBackup.schemaVersion, 0, "迁移前配置应保存在本地备份");

  console.log("E2E: 本地 PNG 指针");
  await options.$eval("button[data-section='appearance']", (element) => element.click());
  await uploadFileForBrowser(options, "#cursor-file", `${projectRoot}/icons/icon16.png`);
  await waitFor(() => options.$eval("#cursor-preview", (element) => !element.hidden));
  await saveOptions(options);
  const cursorSettings = await readSettings(options);
  assert(
    cursorSettings.cursor.enabled &&
      /^browserToolboxCursor-/.test(cursorSettings.cursor.localAssetId),
    "保存本地 PNG 后应只生成本地指针资源引用",
  );
  await page.reload({ waitUntil: "load" });
  await sleep(500);
  assert(
    await page.evaluate(() =>
      Boolean(document.querySelector("style[data-browser-toolbox-cursor]"))
    ),
    "内容页应应用本地 PNG 指针样式",
  );

  console.log("E2E: 恢复浏览器工具箱默认值");
  await options.$eval("button[data-section='backupAbout']", (element) => element.click());
  await options.evaluate(() => globalThis.confirm = () => true);
  await options.$eval("#restore-defaults", (element) => element.click());
  await waitFor(() =>
    options.evaluate(async (key) => {
      const defaultSiteRuleCount = BrowserToolboxSettingsSchema.DEFAULT_SITE_RULES.length;
      return chrome.storage.sync.get(key).then((items) => {
        const settings = items[key];
        return settings?.mouse?.activationDistancePx === 10 &&
          settings?.cursor?.enabled === false &&
          settings?.siteRules?.length === defaultSiteRuleCount;
      });
    }, settingsKey)
  );
  await client.detach().catch(() => {});
  await remoteBrowserDownloadClient?.detach().catch(() => {});
}

async function testMouseGestures(page, base127, browser, options) {
  console.log("E2E: 鼠标轨迹");
  console.log("E2E: 首次页面打开后的冷启动右键手势");
  await resetSettings(options);
  await patchSettings(options, {
    mouse: {
      triggerButton: 2,
      bindings: [{
        id: "e2e-cold-start-right-gesture",
        enabled: true,
        pattern: ["R", "U"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  const extensionIdForColdStart = await extensionId(browser);
  assert(
    await closeServiceWorker(browser, extensionIdForColdStart),
    "冷启动手势测试应能停止已有 Service Worker",
  );
  await page.bringToFront();
  await page.goto(`${base127}/fixture.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => scrollTo(0, 1200));
  await clearEvents(page);
  await sendDrag(
    page,
    [{ x: 500, y: 300 }, { x: 620, y: 300 }, { x: 620, y: 180 }],
    "right",
  );
  await waitFor(() => page.evaluate(() => scrollY === 0));
  const coldStartContextMenu = (await events(page)).find((event) => event.type === "contextmenu");
  assert(coldStartContextMenu?.defaultPrevented, "冷启动首个右键手势应阻止原生菜单");

  await resetSettings(options);
  await page.bringToFront();
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await waitForController(options, page.url());

  console.log("E2E: 轨迹超时与摇杆冲突优先级");
  await patchSettings(options, { mouse: { maxDurationMs: 100, triggerButton: 0 } });
  await page.reload({ waitUntil: "load" });
  await sleep(500);
  await waitForController(options, page.url());
  const timeoutState = await runActiveGestureWhileHeld(
    page,
    await centerFor(page, "#gesture-target"),
    "left",
    180,
    () => isolatedControllerState(options, page.url()),
  );
  assertEqual(timeoutState?.gestureState, null, "轨迹超时后不应保留输入会话");
  assertEqual(timeoutState?.gestureTimeoutScheduled, false, "轨迹超时后应清理定时器");

  await resetSettings(options);
  const defaultMouseSettings = (await readSettings(options)).mouse;
  assertEqual(defaultMouseSettings.directionMode, "4-way", "默认手势应启用四方向识别");
  const actualDefaultBindings = defaultMouseSettings.bindings.map((binding) =>
    `${binding.pattern.join(">")}:${binding.commandName}${binding.options.hard ? ":hard" : ""}`
  );
  const expectedDefaultBindings = [
    "L:goBack",
    "R:goForward",
    "U:scrollFullPageUp",
    "D:scrollFullPageDown",
    "D>R:removeTab",
    "L>U:restoreTab",
    "R>D:scrollToBottom",
    "R>U:scrollToTop",
    "U>D:reload",
    "U>D>U:reload:hard",
    "U>L:previousTab",
    "U>R:nextTab",
    "D>R>U:BrowserToolbox.newWindow",
    "U>R>D:BrowserToolbox.closeWindow",
    "R>D>L>U:BrowserToolbox.openSettings",
  ];
  assertEqual(
    JSON.stringify(actualDefaultBindings),
    JSON.stringify(expectedDefaultBindings),
    "恢复默认后应写入参考图对应的完整手势集合",
  );
  await patchSettings(options, { mouse: { triggerButton: 0 } });
  await page.reload({ waitUntil: "load" });
  await sleep(500);
  await waitForController(options, page.url());
  const settingsTargetCount =
    browser.targets().filter((target) => target.url().includes("/pages/mouse_options.html")).length;
  await sendDrag(
    page,
    await gesturePoints(page, "#gesture-target", [
      { x: 80, y: 0 },
      { x: 80, y: 80 },
      { x: 0, y: 80 },
      { x: 0, y: 0 },
    ]),
    "left",
  );
  const openedSettingsTarget = await waitFor(() => {
    const targets = browser.targets().filter((target) =>
      target.url().includes("/pages/mouse_options.html")
    );
    return targets.length > settingsTargetCount ? targets.at(-1) : null;
  });
  assert(openedSettingsTarget, "默认 R>D>L>U 手势应打开浏览器工具箱设置页");
  await (await openedSettingsTarget.page())?.close();
  await page.bringToFront();
  await patchSettings(options, {
    mouse: {
      triggerButton: 0,
      bindings: [{
        id: "e2e-active-trajectory",
        enabled: true,
        pattern: ["R"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/two.html`, { waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  await page.evaluate(() => scrollTo(0, 1200));
  await sendActiveGestureWithRocker(page, { x: 500, y: 300 }, "left");
  assert(page.url().endsWith("/two.html"), "ACTIVE 轨迹应优先于摇杆，不应触发后退");
  await waitFor(() => page.evaluate(() => scrollY === 0));

  await resetSettings(options);
  console.log("E2E: 自定义跨 Service Worker 手势时长");
  await patchSettings(options, {
    mouse: {
      triggerButton: 0,
      maxDurationMs: 3000,
      bindings: [{
        id: "e2e-long-gesture",
        enabled: true,
        pattern: ["R"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  await page.evaluate(() => scrollTo(0, 1200));
  const longGestureState = await runActiveGestureWhileHeld(
    page,
    await centerFor(page, "#gesture-target"),
    "left",
    2700,
    () => isolatedControllerState(options, page.url()),
  );
  assertEqual(longGestureState?.gestureState, "ACTIVE", "3000ms 轨迹在 2500ms 后仍应保持激活");
  assertEqual(
    longGestureState?.gestureTimeoutScheduled,
    true,
    "3000ms 轨迹在 2500ms 后仍应保留定时器",
  );
  await waitFor(() => page.evaluate(() => scrollY === 0));

  await resetSettings(options);
  console.log("E2E: 自定义触发按键");
  await patchSettings(options, {
    mouse: {
      triggerButton: 1,
      bindings: [{
        id: "e2e-middle-gesture",
        enabled: true,
        pattern: ["R"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  await page.evaluate(() => scrollTo(0, 1200));
  await sendDrag(page, await pointsFor(page, "#gesture-target", 120, 0), "middle");
  await waitFor(() => page.evaluate(() => scrollY === 0));
  const middleGestureState = await isolatedControllerState(options, page.url());
  assertEqual(middleGestureState?.gestureState, null, "自定义中键轨迹完成后应清理会话");
  assertEqual(
    middleGestureState?.gestureTimeoutScheduled,
    false,
    "自定义中键轨迹完成后应清理定时器",
  );

  await resetSettings(options);
  console.log("E2E: 自定义左键触发按键");
  await patchSettings(options, {
    mouse: {
      triggerButton: 0,
      bindings: [{
        id: "e2e-left-gesture",
        enabled: true,
        pattern: ["R"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  await page.evaluate(() => scrollTo(0, 1200));
  await sendDrag(page, await pointsFor(page, "#gesture-target", 120, 0), "left");
  await waitFor(() => page.evaluate(() => scrollY === 0));
  const leftGestureState = await isolatedControllerState(options, page.url());
  assertEqual(leftGestureState?.gestureState, null, "自定义左键轨迹完成后应清理会话");
  assertEqual(
    leftGestureState?.gestureTimeoutScheduled,
    false,
    "自定义左键轨迹完成后应清理定时器",
  );

  console.log("E2E: 方向图标、命中命令与拖入取消目标");
  await patchSettings(options, {
    mouse: {
      triggerButton: 0,
      bindings: [{
        id: "e2e-cancel-gesture",
        enabled: true,
        pattern: ["R", "L", "R"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  assert(
    await installIsolatedCommandCounter(options, page.url(), "scrollToTop"),
    "应能安装取消手势命令计数器",
  );
  await page.evaluate(() => scrollTo(0, 1200));
  const cancelRun = await runGestureToCancelTarget(
    page,
    await centerFor(page, "#gesture-target"),
    "left",
    () => isolatedControllerState(options, page.url()),
  );
  assertEqual(cancelRun.matched?.gestureState, "ACTIVE", "R-L-R 应保持 ACTIVE 等待抬键");
  assertEqual(cancelRun.matched?.gestureHudVisible, true, "形成方向后应显示图标 HUD");
  assertEqual(cancelRun.matched?.gestureDirectionCount, 3, "R-L-R 应显示三个方向图标");
  assert(
    cancelRun.matched?.gestureCommandLabel.length > 0,
    "命中 R-L-R 绑定后应显示命令文字",
  );
  assertEqual(cancelRun.hovered?.gestureCancelHovered, true, "光标进入目标后应显示取消悬停态");
  assertEqual(
    cancelRun.hovered?.gestureDirectionCount,
    3,
    "拖向取消目标时应保留最后命中的方向图示",
  );
  assertEqual(cancelRun.afterRelease?.gestureState, null, "取消后应清理手势会话");
  assertEqual(cancelRun.afterRelease?.gestureOverlayVisible, false, "取消后应隐藏覆盖层");
  assertEqual(cancelRun.afterRelease?.commandCallCount, 0, "拖入取消目标不得执行命令");
  assertEqual(await page.evaluate(() => scrollY), 1200, "取消手势后页面状态应保持不变");

  await resetSettings(options);
  // Chrome for Testing 的 headless CDP 会在右键首次移动前先派发原生菜单；用左键验证激活后的通用轨迹链路。
  await patchSettings(options, { mouse: { triggerButton: 0 } });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await waitForController(options, page.url());
  await clearEvents(page);
  await sendDrag(page, await pointsFor(page, "#gesture-target", -5, 0), "left");
  assert(page.url().endsWith("/fixture.html"), "低于激活距离的触发按键输入不应触发历史命令");
  await page.evaluate(() => scrollTo(0, 1200));
  assertEqual(await page.evaluate(() => scrollY), 1200, "未达到手势方向绑定时页面滚动位置保持");

  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/two.html`, { waitUntil: "load" });
  await sleep(1000);
  await waitForController(options, page.url());
  console.log(
    "E2E: 历史起点",
    await page.evaluate(() => ({ url: location.href, length: history.length })),
  );
  await sendDrag(page, await pointsFor(page, "#target", -140, 0), "left");
  console.log(
    "E2E: 后退后",
    await page.evaluate(() => ({ url: location.href, length: history.length })),
  );
  await waitFor(() => page.url().endsWith("/one.html"));
  await waitForController(options, page.url());
  await sendDrag(page, await pointsFor(page, "#target", 140, 0), "left");
  await waitFor(() => page.url().endsWith("/two.html"));

  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.evaluate(() => scrollTo(0, 1000));
  await sendDrag(
    page,
    await turnPoints(page, "#gesture-target", 60, 0, 0, -50),
    "left",
  );
  await waitFor(() => page.evaluate(() => scrollY === 0));
  await page.evaluate(() => scrollTo(0, 0));
  await sendDrag(
    page,
    await turnPoints(page, "#gesture-target", 60, 0, 0, 120),
    "left",
  );
  await waitFor(() => page.evaluate(() => scrollY > 0));

  const temporary = await createPage(browser, []);
  await temporary.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  const pageCount = (await browser.pages()).length;
  await sendDrag(
    temporary,
    await turnPoints(temporary, "#gesture-target", 0, 60, 120, 0),
    "left",
  );
  await waitFor(() => temporary.isClosed());
  assertEqual((await browser.pages()).length, pageCount - 1, "关闭标签页手势关闭当前标签页");

  console.log("E2E: 斜向轨迹归入四方向");
  await patchSettings(options, {
    mouse: {
      triggerButton: 0,
      directionMode: "4-way",
      bindings: [
        {
          id: "e2e-diagonal-right",
          enabled: true,
          pattern: ["R"],
          commandName: "scrollToTop",
          options: {},
        },
        {
          id: "e2e-diagonal-left",
          enabled: true,
          pattern: ["L"],
          commandName: "scrollToBottom",
          options: {},
        },
      ],
    },
  });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await waitForController(options, page.url());
  await page.evaluate(() => scrollTo(0, 1200));
  await sendDrag(page, await pointsFor(page, "#gesture-target", 110, -110), "left");
  await waitFor(() => page.evaluate(() => scrollY === 0));
  await sendDrag(page, await pointsFor(page, "#gesture-target", -110, -110), "left");
  await waitFor(() => page.evaluate(() => scrollY > 0));
  await resetSettings(options);
  await patchSettings(options, { general: { language: "en" } });
  // 外部写入后重新加载设置页，建立下一次保存的真实基线。
  await options.reload({ waitUntil: "load" });
  await waitForOptionsReady(options);
  await page.reload({ waitUntil: "load" });
  await sleep(500);
}

async function testSuperDrag(
  page,
  base127,
  browser,
  tempDir,
  options,
  { clipboardAvailable = true, remoteDownloadPath = "" } = {},
) {
  console.log("E2E: 超级拖拽");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.bringToFront();
  const downloadClient = await page.createCDPSession();
  const browserDownloadClient = remoteDownloadPath
    ? await browser.target().createCDPSession()
    : null;
  let remoteDownloadCompleted = false;
  if (remoteDownloadPath) {
    browserDownloadClient.on("Browser.downloadProgress", (event) => {
      if (event.state === "completed") {
        remoteDownloadCompleted = true;
        console.log("E2E: 远程下载完成");
      }
    });
    await browserDownloadClient.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: remoteDownloadPath,
      eventsEnabled: true,
    });
  }
  await downloadClient.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: remoteDownloadPath || tempDir,
  });

  console.log("E2E: 超级拖拽自定义搜索引擎");
  const customSearchText = "中文 query";
  const customSearchKeyword = "local";
  const customSearchUrl = `${base127}/search?q=%s`;
  await options.$eval("button[data-section='search']", (element) => element.click());
  await options.$eval("#search-engines", (element, config) => {
    element.value = config;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, `${customSearchKeyword}: ${customSearchUrl} Local`);
  await saveOptions(options);
  await options.$eval("button[data-section='superDrag']", (element) => element.click());
  const customSearchRow = "#super-drag-bindings tr:nth-child(5)";
  await options.$eval(
    `${customSearchRow} .browser-toolbox-command-control select`,
    (element, commandName) => {
      element.value = commandName;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    "BrowserToolbox.searchSelection",
  );
  await options.$eval(
    `${customSearchRow} input.browser-toolbox-binding-pattern`,
    (element) => {
      element.value = "R";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
  );
  await options.$eval(
    `${customSearchRow} select[data-option-name='disposition']`,
    (element) => {
      element.value = "foreground";
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
  );
  const customSearchBindingUi = await options.$eval(
    `${customSearchRow} input[data-option-name='keyword']`,
    (element, keyword) => {
      element.value = keyword;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      const row = element.closest("tr");
      return {
        command: row?.querySelector(".browser-toolbox-command-control select")?.value || "",
        disposition: row?.querySelector("select[data-option-name='disposition']")?.value || "",
        keyword: element.value,
      };
    },
    customSearchKeyword,
  );
  assertEqual(
    customSearchBindingUi.command,
    "BrowserToolbox.searchSelection",
    "设置页绑定编辑器应能选择自定义搜索命令",
  );
  assertEqual(
    customSearchBindingUi.disposition,
    "foreground",
    "设置页绑定编辑器应能配置搜索打开位置",
  );
  assertEqual(
    customSearchBindingUi.keyword,
    customSearchKeyword,
    "设置页绑定编辑器应能配置自定义搜索引擎 keyword",
  );
  await saveOptions(options);
  await page.reload({ waitUntil: "load" });
  await sleep(800);
  await page.evaluate((value) => {
    const element = document.querySelector("#selectable");
    element.textContent = value;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, customSearchText);
  await sendDrag(page, await pointsFor(page, "#selectable", 150, 0), "left");
  const customSearchPage = await waitForPageUrl(
    browser,
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === new URL(base127).origin &&
          parsed.pathname === "/search" &&
          parsed.searchParams.get("q") === customSearchText;
      } catch (_) {
        return false;
      }
    },
  );
  assert(customSearchPage != null, "Super Drag 应使用绑定指定的自定义搜索引擎");
  await customSearchPage.close();
  await resetSettings(options);
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(800);

  let pageCount = (await browser.pages()).length;
  await sendDrag(page, await pointsFor(page, "#link", 150, 0), "left");
  const foreground = await waitForPageUrl(browser, (url) => url.endsWith("/target.html"));
  assert(foreground != null, "Super Drag LINK 右向应打开前台标签");
  assert(page.url().endsWith("/fixture.html"), "Super Drag 原页面不应导航");
  await foreground.close();
  assertEqual((await browser.pages()).length, pageCount, "关闭前台 Super Drag 标签后页数恢复");

  await sendDrag(page, await pointsFor(page, "#link", -150, 0), "left");
  const background = await waitForPageUrl(browser, (url) => url.endsWith("/target.html"));
  assert(background != null, "Super Drag LINK 左向应打开后台标签");
  assert(page.url().endsWith("/fixture.html"), "后台 Super Drag 不应切换原页面");
  await background.close();

  await sendDrag(page, await pointsFor(page, "#image", 150, 0), "left");
  const imagePage = await waitForPageUrl(browser, (url) => url.endsWith("/pixel.png"));
  assert(imagePage != null, "Super Drag IMAGE 右向应打开图片");
  await imagePage.close();

  const clipboardGestures = [
    {
      points: [{ x: -110, y: 0 }, { x: -110, y: 80 }, { x: 20, y: 80 }],
      expected: (value) => value.includes("Example link text"),
      message: "Super Drag LINK 左下右应复制链接文字",
    },
    {
      points: [{ x: 110, y: 0 }, { x: 110, y: 80 }, { x: 0, y: 80 }],
      expected: (value) => value.endsWith("/target.html"),
      message: "Super Drag LINK 右下左应复制链接 URL",
    },
  ];
  for (const gesture of clipboardGestures) {
    await sendDrag(page, await gesturePoints(page, "#link", gesture.points), "left");
    if (clipboardAvailable) {
      const clipboard = await page.evaluate(() => navigator.clipboard?.readText?.() || "");
      assert(clipboard.length > 0 && gesture.expected(clipboard), gesture.message);
    }
  }

  await sendDrag(page, await pointsFor(page, "#image", 0, 120), "left");
  if (clipboardAvailable) {
    assert(
      (await page.evaluate(() => navigator.clipboard?.readText?.() || "")).endsWith("/pixel.png"),
      "Super Drag IMAGE 下应复制图片 URL",
    );
  }

  const beforeDownloads = remoteDownloadPath ? [] : await directoryFiles(tempDir);
  await sendDrag(
    page,
    await gesturePoints(page, "#image", [{ x: 0, y: 100 }, { x: 100, y: 100 }]),
    "left",
  );
  if (remoteDownloadPath) {
    await waitFor(() => remoteDownloadCompleted, 10000);
  } else {
    const downloaded = await waitFor(async () => {
      const files = await directoryFiles(tempDir);
      return files.find((file) =>
        !beforeDownloads.includes(file) && file !== "browser-toolbox-settings.json"
      );
    });
    assert(downloaded, "Super Drag IMAGE 下右应触发本地下载");
  }

  const shadowPageCount = (await browser.pages()).length;
  await sendDrag(page, await pointsFor(page, "#shadow-host", 150, 0), "left");
  const shadowTarget = await waitForPageUrl(browser, (url) => url.endsWith("/target-2.html"));
  assert(shadowTarget != null, "Shadow DOM 内的链接应支持 Super Drag");
  assertEqual(
    (await browser.pages()).length,
    shadowPageCount + 1,
    "Shadow DOM 拖拽只打开一个标签页",
  );
  await shadowTarget.close();

  for (const selector of ["#upload", "#text-input", "#textarea", "#editor"]) {
    const protectedPageCount = (await browser.pages()).length;
    await clearEvents(page);
    await sendDrag(page, await pointsFor(page, selector, 150, 0), "left");
    assertEqual(
      (await browser.pages()).length,
      protectedPageCount,
      `${selector} 不应被 Super Drag 接管`,
    );
    const protectedEvents = await events(page);
    assert(
      protectedEvents.every((event) => event.defaultPrevented !== true),
      `${selector} 的原生拖拽事件不应被阻止`,
    );
  }

  await page.evaluate(() => {
    const text = document.querySelector("#selectable");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await sendDrag(page, await pointsFor(page, "#selectable", 0, 120), "left");
  if (clipboardAvailable) {
    const clipboard = await page.evaluate(async () =>
      await navigator.clipboard?.readText?.() || ""
    );
    assert(
      clipboard.includes("local E2E clipboard check"),
      "Super Drag 选择文本复制应写入本地剪贴板",
    );
  }

  pageCount = (await browser.pages()).length;
  await clearEvents(page);
  await sendDrag(page, await pointsFor(page, "#card", 150, 0), "left");
  assertEqual((await browser.pages()).length, pageCount, "draggable 控件不应被 Super Drag 接管");
  const cardDrag = (await events(page)).find((event) => event.type === "dragstart");
  assert(cardDrag && !cardDrag.defaultPrevented, "draggable 控件的原生 dragstart 不应被阻止");

  await clearEvents(page);
  await sendDrag(page, await pointsFor(page, "#link", 150, 0), "left", 1);
  const altEvents = await events(page);
  assert(altEvents.some((event) => event.type === "pointerdown"), "Alt 旁路应收到原生指针输入");
  assert(
    altEvents.every((event) => event.defaultPrevented !== true),
    "Alt 旁路不应阻止原生输入",
  );
  for (const item of await browser.pages()) {
    if (item !== page && item.url().endsWith("/target.html")) await item.close();
  }
  await downloadClient.detach().catch(() => {});
  await browserDownloadClient?.detach().catch(() => {});
}

async function testWheelRockerAndFrames(page, base127, options) {
  console.log("E2E: 滚轮摇杆跨 frame");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.evaluate(() => scrollTo(0, 1200));
  await clearEvents(page);
  await sendWheel(page, "right", 40);
  const firstSubThresholdEvents = await events(page);
  const firstSubThresholdWheelEvents = firstSubThresholdEvents.filter((event) =>
    event.type === "wheel"
  );
  assert(
    firstSubThresholdWheelEvents.length > 0 &&
      firstSubThresholdWheelEvents.every((event) => event.defaultPrevented !== true),
    "释放右键后未达阈值的滚轮输入不应被阻止",
  );
  await page.evaluate(() => scrollTo(0, 0));
  await clearEvents(page);
  await sendWheel(page, "right", 40);
  const secondSubThresholdEvents = await events(page);
  const secondSubThresholdWheelEvents = secondSubThresholdEvents.filter((event) =>
    event.type === "wheel"
  );
  assert(
    secondSubThresholdWheelEvents.length > 0 &&
      secondSubThresholdWheelEvents.every((event) => event.defaultPrevented !== true),
    "两个独立的未达阈值滚轮会话不应合并触发命令",
  );
  await clearEvents(page);
  await page.evaluate(() => scrollTo(0, 1200));
  await sendWheel(page, "right", -100);
  await waitFor(() => page.evaluate(() => scrollY === 0));
  const wheelUp = (await events(page)).find((event) => event.type === "wheel");
  assert(
    wheelUp?.buttons === 2 && await page.evaluate(() => scrollY === 0),
    "右键上滚应路由滚动到顶命令",
  );

  await page.evaluate(() => scrollTo(0, 0));
  await sendWheel(page, "right", 100);
  await waitFor(() => page.evaluate(() => scrollY > 0));

  await patchSettings(options, {
    wheel: {
      bindings: [
        {
          id: "e2e-left-wheel-up",
          enabled: true,
          button: "LEFT_BUTTON",
          direction: "UP",
          commandName: "scrollToTop",
          options: {},
        },
        {
          id: "e2e-left-wheel-down",
          enabled: true,
          button: "LEFT_BUTTON",
          direction: "DOWN",
          commandName: "scrollToBottom",
          options: {},
        },
      ],
    },
  });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.evaluate(() => scrollTo(0, 1200));
  await sendWheel(page, "left", -100);
  await waitFor(() => page.evaluate(() => scrollY === 0));
  await sendWheel(page, "left", 100);
  await waitFor(() => page.evaluate(() => scrollY > 0));
  await clearEvents(page);
  await sendWheel(page, "middle", -100);
  const unboundMiddleWheel = await events(page);
  assert(
    unboundMiddleWheel.every((event) => event.defaultPrevented !== true),
    "没有启用绑定的中键滚轮不应被接管",
  );
  await patchSettings(options, {
    wheel: {
      bindings: [
        {
          id: "wheel-right-up",
          enabled: true,
          button: "RIGHT_BUTTON",
          direction: "UP",
          commandName: "scrollToTop",
          options: {},
        },
        {
          id: "wheel-right-down",
          enabled: true,
          button: "RIGHT_BUTTON",
          direction: "DOWN",
          commandName: "scrollToBottom",
          options: {},
        },
        {
          id: "wheel-left-up",
          enabled: true,
          button: "LEFT_BUTTON",
          direction: "UP",
          commandName: "previousTab",
          options: {},
        },
        {
          id: "wheel-left-down",
          enabled: true,
          button: "LEFT_BUTTON",
          direction: "DOWN",
          commandName: "nextTab",
          options: {},
        },
      ],
    },
  });

  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/two.html`, { waitUntil: "load" });
  await sleep(1000);
  await sendRocker(page, "right", "left");
  await waitFor(() => page.url().endsWith("/one.html"));
  await sendRocker(page, "left", "right");
  await waitFor(() => page.url().endsWith("/two.html"));

  // Chrome for Testing 的 headless CDP 会提前派发右键菜单；切换为左键只隔离验证跨 frame 手势链路。
  await patchSettings(options, { mouse: { triggerButton: 0 } });
  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await waitForController(options, page.url());
  await waitFor(async () => {
    const frameStates = await isolatedFrameControllers(options, page.url());
    return frameStates.some((item) => item.url.includes("/frame.html") && item.initialized);
  });
  const frame = page.frames().find((item) => item.url().includes("/frame.html"));
  assert(frame, "跨域 iframe 应加载本地 frame");
  await page.$eval("#frame", (element) => element.scrollIntoView({ block: "center" }));
  const frameBox = await page.$eval("#frame", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await sendDrag(page, [
    { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 },
    { x: frameBox.x + frameBox.width / 2 - 80, y: frameBox.y + frameBox.height / 2 },
    { x: frameBox.x + frameBox.width / 2 - 150, y: frameBox.y + frameBox.height / 2 },
  ], "left");
  await waitFor(() => page.url().endsWith("/one.html"));
  await patchSettings(options, { mouse: { triggerButton: 2 } });
}

async function testNativeSafety(page, base127, options) {
  console.log("E2E: 右键菜单策略、内层滚动和普通输入");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await patchSettings(options, {
    general: { language: "zh_CN" },
    mouse: {
      triggerButton: 2,
      suppressContextMenuAfterActivation: true,
      bindings: [{
        id: "e2e-default-right-gesture",
        enabled: true,
        pattern: ["R"],
        commandName: "scrollToTop",
        options: {},
      }],
    },
  });
  await page.reload({ waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  assert(
    await installIsolatedCommandCounter(options, page.url(), "scrollToTop"),
    "应能安装右键手势命令计数器",
  );

  console.log("E2E: 默认右键 ACTIVE 与 trusted contextmenu");
  await clearEvents(page);
  await page.evaluate(() => scrollTo(0, 1200));
  const activePoint = await centerFor(page, "#gesture-target");
  const activeRun = await runTrustedRightGesture(
    page,
    activePoint,
    () => isolatedControllerState(options, page.url()),
    { contextMenuWhileHeld: true },
  );
  console.log(
    "E2E: headed 默认右键 ACTIVE 事件顺序",
    (await events(page))
      .filter((event) =>
        ["pointerdown", "mousedown", "contextmenu", "pointermove", "pointerup", "mouseup"].includes(
          event.type,
        )
      )
      .map((event) =>
        `${event.type}(button=${event.button},buttons=${event.buttons},trusted=${event.isTrusted},prevented=${event.defaultPrevented})`
      )
      .join(" -> "),
  );
  assertEqual(activeRun.pending?.gestureState, "PENDING", "右键刚按下时应保持手势候选状态");
  assertEqual(activeRun.pending?.gestureCancelVisible, true, "第一次右键按下应只显示取消目标");
  assertEqual(activeRun.pending?.gestureHudVisible, false, "尚未形成方向时不应显示 HUD");
  assertEqual(activeRun.pending?.gestureDirectionCount, 0, "候选阶段不应提前生成方向图标");
  assertEqual(
    activeRun.activatedWithoutDirection?.gestureState,
    "ACTIVE",
    "越过激活距离后应进入 ACTIVE",
  );
  assertEqual(
    activeRun.activatedWithoutDirection?.gestureCancelVisible,
    true,
    "尚未形成方向时取消目标仍应持续显示",
  );
  assertEqual(
    activeRun.activatedWithoutDirection?.gestureHudVisible,
    false,
    "只有方向真正形成后才能展开 HUD",
  );
  assertEqual(
    activeRun.activatedWithoutDirection?.gestureDirectionCount,
    0,
    "激活但未达到分段阈值时不应生成方向图标",
  );
  assertEqual(activeRun.active?.gestureState, "ACTIVE", "默认右键移动超过阈值后应进入 ACTIVE");
  assertEqual(activeRun.active?.gestureTimeoutScheduled, true, "ACTIVE 右键应保留会话定时器");
  assertEqual(activeRun.active?.gestureOverlayVisible, true, "轨迹和 HUD 只应在 ACTIVE 后显示");
  assertEqual(activeRun.active?.gestureCancelVisible, true, "ACTIVE 期间取消目标应持续显示");
  assertEqual(activeRun.active?.gestureHudVisible, true, "形成首个方向后应展开 HUD");
  assertEqual(activeRun.active?.gestureDirectionCount, 1, "单段右移应显示一个方向图标");
  assertEqual(activeRun.active?.contentLocale, "zh_CN", "网页内容脚本应应用简体中文设置");
  assertEqual(activeRun.active?.gestureDirectionLabels?.[0], "向右", "右移图标应提供中文方向名");
  assertEqual(activeRun.active?.gestureCommandLabel, "回到顶部", "HUD 应显示中文命令名");
  assertEqual(activeRun.active?.gestureCancelLabel, "取消", "取消目标应显示中文文案");
  assertEqual(activeRun.active?.bridgeActive, true, "ACTIVE 右键应保持 frame bridge");
  assertEqual(activeRun.active?.guardActive, true, "ACTIVE 右键应启用菜单保护");
  assertEqual(activeRun.active?.commandCallCount, 0, "右键释放前不应执行手势命令");
  const activeEvents = await events(page);
  const activeContextMenus = activeEvents.filter((event) =>
    event.type === "contextmenu" && event.isTrusted === true
  );
  const activeContextMenu = activeContextMenus.at(-1);
  assertEqual(activeContextMenus.length, 2, "默认右键测试应记录提前菜单和 ACTIVE 后菜单");
  assert(
    Math.abs(activeContextMenu.clientX - (activePoint.x + 120)) < 1,
    "ACTIVE 后的 trusted contextmenu 应位于移动后的坐标",
  );
  assert(activeContextMenu.defaultPrevented, "已激活的默认右键轨迹应阻止原生菜单");
  await waitFor(() => page.evaluate(() => scrollY === 0));
  assertEqual(activeRun.afterRelease?.gestureState, null, "右键命令完成后应清理 gesture");
  assertEqual(activeRun.afterRelease?.gestureTimeoutScheduled, false, "右键命令完成后应清理定时器");
  assertEqual(activeRun.afterRelease?.gestureOverlayVisible, false, "右键命令完成后应隐藏 overlay");
  assertEqual(activeRun.afterRelease?.gestureCancelVisible, false, "右键命令完成后应隐藏取消目标");
  assertEqual(activeRun.afterRelease?.bridgeActive, false, "右键命令完成后应关闭 bridge");
  assertEqual(activeRun.afterRelease?.guardActive, false, "右键命令完成后不应残留 active guard");
  assertEqual(activeRun.afterRelease?.guardPending, false, "已处理菜单后不应残留 delayed guard");
  assertEqual(activeRun.afterRelease?.commandCallCount, 1, "默认右键手势命令应只执行一次");

  await patchSettings(options, { general: { language: "en" } });
  await waitFor(async () =>
    (await isolatedControllerState(options, page.url()))?.contentLocale === "en"
  );
  assertEqual(
    (await isolatedControllerState(options, page.url()))?.contentLocale,
    "en",
    "网页不刷新也应热更新内容脚本语言",
  );

  console.log("E2E: pointerup 后延迟 contextmenu 一次性保护");
  await page.reload({ waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  assert(
    await installIsolatedCommandCounter(options, page.url(), "scrollToTop"),
    "应能重新安装右键手势命令计数器",
  );
  await clearEvents(page);
  await page.evaluate(() => scrollTo(0, 1200));
  const delayedPoint = await centerFor(page, "#gesture-target");
  const delayedRun = await runTrustedRightGesture(
    page,
    delayedPoint,
    () => isolatedControllerState(options, page.url()),
  );
  assertEqual(delayedRun.active?.contentLocale, "en", "后续右键手势应使用英文设置");
  assertEqual(delayedRun.active?.gestureDirectionLabels?.[0], "Right", "右移图标应提供英文方向名");
  assertEqual(delayedRun.active?.gestureCommandLabel, "Scroll to top", "HUD 应显示英文命令名");
  assertEqual(delayedRun.active?.gestureCancelLabel, "Cancel", "取消目标应显示英文文案");
  await waitFor(() => page.evaluate(() => scrollY === 0));
  assertEqual(delayedRun.afterRelease?.commandCallCount, 1, "延迟菜单场景的命令应只执行一次");
  assertEqual(delayedRun.afterRelease?.guardPending, true, "pointerup 后应暂存一次菜单保护");
  await dispatchContextMenu(page, { x: delayedPoint.x + 120, y: delayedPoint.y });
  const delayedContextMenu = (await events(page)).find((event) =>
    event.type === "contextmenu" && event.isTrusted === false
  );
  assert(delayedContextMenu?.defaultPrevented, "pointerup 后的延迟 contextmenu 应被阻止");
  const delayedCleanState = await isolatedControllerState(options, page.url());
  assertEqual(delayedCleanState?.guardPending, false, "延迟 contextmenu 后应消费一次性 guard");
  assertEqual(delayedCleanState?.bridgeActive, false, "延迟 contextmenu 后不应残留 bridge");
  assertEqual(delayedCleanState?.commandCallCount, 1, "延迟菜单不得重复执行手势命令");

  console.log("E2E: 首次右键候选与第二次右键原生菜单");
  await page.reload({ waitUntil: "load" });
  await sleep(800);
  await waitForController(options, page.url());
  assert(
    await installIsolatedCommandCounter(options, page.url(), "scrollToTop"),
    "应能为普通右键安装命令计数器",
  );
  const heading = await centerFor(page, "#heading");
  await clearEvents(page);
  const nativeMenuRun = await runNativeMenuRetryThenMove(
    page,
    heading,
    () => isolatedControllerState(options, page.url()),
  );
  const nativeClickEvents = await events(page);
  const contextMenus = nativeClickEvents.filter((event) => event.type === "contextmenu");
  console.log(
    "E2E: headed 普通右键事件顺序",
    nativeClickEvents
      .filter((event) =>
        ["pointerdown", "mousedown", "contextmenu", "pointerup", "mouseup"].includes(event.type)
      )
      .map((event) =>
        `${event.type}(button=${event.button},buttons=${event.buttons},trusted=${event.isTrusted},prevented=${event.defaultPrevented})`
      )
      .join(" -> "),
  );
  assertEqual(contextMenus.length, 2, "双击右键应产生两次可信 contextmenu");
  assert(contextMenus[0].defaultPrevented, "第一次右键候选应阻止提前的原生菜单");
  assert(!contextMenus[1].defaultPrevented, "第二次近距离右键应放行原生菜单");
  assertEqual(nativeMenuRun.afterFirstClick?.gestureState, null, "第一次轻点后应清理 gesture");
  assertEqual(
    nativeMenuRun.afterFirstClick?.gestureTimeoutScheduled,
    false,
    "第一次轻点后应清理定时器",
  );
  assertEqual(
    nativeMenuRun.afterFirstClick?.gestureOverlayVisible,
    false,
    "第一次轻点不应显示轨迹或 HUD",
  );
  assertEqual(nativeMenuRun.afterFirstClick?.bridgeActive, false, "第一次轻点后应关闭 bridge");
  assertEqual(
    nativeMenuRun.afterFirstClick?.guardActive,
    false,
    "第一次轻点后不应残留 active guard",
  );
  assertEqual(
    nativeMenuRun.afterFirstClick?.guardProvisional,
    false,
    "第一次轻点后不应残留候选菜单保护",
  );
  assertEqual(
    nativeMenuRun.afterFirstClick?.nativeMenuRetryArmed,
    true,
    "第一次轻点后应短暂等待第二次原生右键",
  );
  assertEqual(nativeMenuRun.afterContextMenu?.gestureState, null, "原生菜单出现后不应保留 gesture");
  assertEqual(
    nativeMenuRun.afterContextMenu?.gestureCancelVisible,
    false,
    "快速第二次右键放行原生菜单时不应显示取消目标",
  );
  assertEqual(
    nativeMenuRun.afterContextMenu?.gestureHudVisible,
    false,
    "快速第二次右键放行原生菜单时不应显示 HUD",
  );
  assertEqual(
    nativeMenuRun.afterContextMenu?.nativeMenuRetryArmed,
    false,
    "第二次右键应消费原生菜单候选",
  );
  assertEqual(nativeMenuRun.afterMove?.gestureState, null, "原生菜单后的移动不应延迟激活");
  assertEqual(
    nativeMenuRun.afterMove?.gestureOverlayVisible,
    false,
    "原生菜单后的移动不应显示 overlay",
  );
  assertEqual(
    nativeMenuRun.afterRelease?.gestureTimeoutScheduled,
    false,
    "原生菜单场景应清理定时器",
  );
  assertEqual(nativeMenuRun.afterRelease?.bridgeActive, false, "原生菜单场景应关闭 bridge");
  assertEqual(nativeMenuRun.afterRelease?.guardActive, false, "原生菜单场景应清理 active guard");
  assertEqual(nativeMenuRun.afterRelease?.guardPending, false, "原生菜单场景应清理 delayed guard");
  assertEqual(nativeMenuRun.afterRelease?.commandCallCount, 0, "双击右键菜单不得执行命令");

  await resetSettings(options);
  await options.evaluate(async () => {
    const key = "browserToolboxSettings";
    const current = (await chrome.storage.sync.get(key))[key];
    await chrome.storage.sync.set({
      [key]: BrowserToolboxSettingsSchema.mergeSettings(current, {
        mouse: { triggerButton: 2, suppressContextMenuAfterActivation: false },
      }),
    });
  });
  await page.reload({ waitUntil: "load" });
  await sleep(1000);
  await clearEvents(page);
  const nativeModeHeading = await centerFor(page, "#heading");
  await page.mouse.click(nativeModeHeading.x, nativeModeHeading.y, { button: "right" });
  await sleep(300);
  const nativeModeContextMenu = (await events(page)).find((event) => event.type === "contextmenu");
  assert(nativeModeContextMenu, "关闭菜单抑制后仍应产生 contextmenu 事件");
  assert(!nativeModeContextMenu.defaultPrevented, "关闭菜单抑制后应保留原生右键菜单");
  await options.evaluate(async () => {
    const key = "browserToolboxSettings";
    const current = (await chrome.storage.sync.get(key))[key];
    await chrome.storage.sync.set({
      [key]: BrowserToolboxSettingsSchema.mergeSettings(current, {
        mouse: { suppressContextMenuAfterActivation: true },
      }),
    });
  });

  await page.evaluate(() =>
    document.querySelector("#scroll-box").scrollIntoView({ block: "center" })
  );
  const scrollBox = await centerFor(page, "#scroll-box");
  await clearEvents(page);
  await dispatchMouse(page, {
    type: "mouseWheel",
    x: scrollBox.x,
    y: scrollBox.y,
    buttons: 0,
    deltaX: 0,
    deltaY: 240,
  });
  await waitFor(() => page.evaluate(() => document.querySelector("#scroll-box").scrollTop > 0));
  const nativeWheel = (await events(page)).find((event) => event.type === "wheel");
  assert(nativeWheel && !nativeWheel.defaultPrevented, "无按键的内层滚动不应被滚轮手势接管");
}

async function testSiteRule(page, options, base127) {
  console.log("E2E: 运行时站点规则");
  const siteRulePattern = originRegexPattern(base127);
  await patchSettings(options, {
    siteRules: [{
      id: "e2e-site-rule",
      matchType: "regex",
      pattern: siteRulePattern,
      enabled: true,
      modules: {
        keyboard: false,
        mouse: false,
        superDrag: false,
        wheel: false,
        rocker: false,
        cursor: false,
        documentFormatter: false,
      },
    }],
  });
  const effectiveModules = await options.evaluate(
    (url) => BrowserToolboxSettingsRepositoryInstance.getEffectiveSettings(url).effectiveModules,
    `${base127}/fixture.html`,
  );
  for (const moduleName of moduleRegistry.ids({ siteRule: true })) {
    assert(
      effectiveModules[moduleName] === false,
      `站点规则应能独立关闭 ${moduleName} 模块：${JSON.stringify(effectiveModules)}`,
    );
  }
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await clearEvents(page);
  await sendDrag(page, await pointsFor(page, "#heading", -150, 0), "right");
  const prevented = (await events(page)).some((event) =>
    ["pointermove", "contextmenu"].includes(event.type) && event.defaultPrevented
  );
  assert(!prevented, "站点规则关闭鼠标模块后不应阻止页面输入");
  await patchSettings(options, { siteRules: [] });
  await page.reload({ waitUntil: "load" });
}

async function testGlobalDisable(page, options, base127) {
  console.log("E2E: 全局模块开关");
  await patchSettings(options, { general: { enabled: false } });
  await waitFor(async () => {
    const state = await isolatedRuntimeSettings(options, page.url());
    return state?.controller?.enabled === false;
  });
  const disabledModules = await options.evaluate(
    (url) => BrowserToolboxSettingsRepositoryInstance.getEffectiveSettings(url).effectiveModules,
    `${base127}/fixture.html`,
  );
  assert(
    moduleRegistry.ids({ siteRule: true }).every((name) => disabledModules[name] === false),
    `全局停用应覆盖所有模块：${JSON.stringify(disabledModules)}`,
  );
  await patchSettings(options, { general: { enabled: true } });
  await page.reload({ waitUntil: "load" });
}

async function testServiceWorkerRestart(browser, id, page, options) {
  console.log("E2E: Service Worker 重启");
  assert(await closeServiceWorker(browser, id), "应存在 BrowserToolbox Service Worker");
  await waitFor(() =>
    browser.targets().some((target) =>
      target.type() === "service_worker" &&
      target.url().startsWith(`chrome-extension://${id}/`) &&
      (target.url().includes("/background_scripts/main.js") ||
        target.url().endsWith("/service_worker.js"))
    )
  );

  await page.bringToFront();
  await page.evaluate(() => scrollTo(0, 1200));
  const pageUrl = page.url();
  const result = await options.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url === url);
    if (!tab?.id) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: "ISOLATED",
      func: async () => {
        const invocation = BrowserToolboxCommandInvocation.createInvocation(
          "scrollToTop",
          {},
          { type: "ui" },
          { pageUrl: globalThis.location.href, topFrame: true },
        );
        return await chrome.runtime.sendMessage({ handler: "browserToolbox.invoke", invocation });
      },
    });
    return results[0]?.result || null;
  }, pageUrl);
  if (result?.ok !== true) console.error("E2E: Service Worker 重启命令结果", result);
  assert(result?.ok === true, "Service Worker 重启后 Dispatcher 应继续执行命令");
  await waitFor(() => page.evaluate(() => scrollY === 0));
}

async function closeServiceWorker(browser, id) {
  const client = await browser.target().createCDPSession();
  try {
    const targets = await client.send("Target.getTargets");
    const serviceWorker = targets.targetInfos.find((target) =>
      target.type === "service_worker" &&
      target.url.startsWith(`chrome-extension://${id}/`) &&
      (target.url.includes("/background_scripts/main.js") ||
        target.url.endsWith("/service_worker.js"))
    );
    if (!serviceWorker) return false;
    await client.send("Target.closeTarget", { targetId: serviceWorker.targetId });
    return true;
  } finally {
    await client.detach().catch(() => {});
  }
}

async function main() {
  // 远程浏览器的扩展目录位于来宾环境，宿主机不应尝试 stat 该路径。
  if (!Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL")) {
    assert(
      await Deno.stat(extensionPath).then((info) => info.isDirectory).catch(() => false),
      "请先运行 ./make.js package",
    );
  }
  const errors = [];
  const { server, base127, baseLocal } = await startFixtureServer();
  const tempDir = await Deno.makeTempDir({ prefix: "browser-toolbox-e2e-download-" });
  let browser;
  let chromeProcess;
  let chromeUserDataDir;
  let options;
  let fixture;
  try {
    ({ browser, process: chromeProcess, userDataDir: chromeUserDataDir } = await startChrome());
    await closeRemotePages(browser);
    let id;
    try {
      id = await extensionId(browser);
    } catch (error) {
      console.error(
        "未发现扩展 Service Worker；当前浏览器目标：",
        browser.targets().map((target) => `${target.type()} ${target.url()}`).join(" | "),
      );
      throw error;
    }
    options = await openOptions(browser, id, errors);
    console.log("E2E: 扩展页面已加载");
    await testActionRestrictedPage(browser, id, errors);
    await resetSettings(options);
    await testOptionsAccessibility(options);
    await resetSettings(options);
    await options.evaluate(() => navigator.clipboard?.writeText?.(""));
    await patchSettings(options, { general: { language: "en" } });
    await testInformationPages(browser, id, errors);
    await testTabList(browser, id, base127, errors);
    fixture = await createPage(browser, errors);
    let clipboardAvailable = true;
    try {
      await browser.defaultBrowserContext().overridePermissions(base127, [
        "clipboard-read",
        "clipboard-write",
      ]);
    } catch (error) {
      if (!Deno.env.get("BROWSER_TOOLBOX_E2E_BROWSER_URL")) throw error;
      clipboardAvailable = false;
      console.warn(`E2E: 远程 CDP 无法代授剪贴板权限：${error.message}`);
    }
    if (!clipboardAvailable) console.warn("E2E: 远程 fixture 跳过剪贴板断言。");
    await testVomnibar(fixture, base127, options);
    await testMouseGestures(fixture, base127, browser, options);
    await testActionControls(browser, id, fixture, errors);
    await testSuperDrag(fixture, base127, browser, tempDir, options, {
      clipboardAvailable,
      remoteDownloadPath: Deno.env.get("BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH") || "",
    });
    await testWheelRockerAndFrames(fixture, base127, options);
    await testNativeSafety(fixture, base127, options);
    await testSiteRule(fixture, options, base127);
    await testGlobalDisable(fixture, options, base127);
    // 前面的场景通过另一个页面修改了设置；重载后再继续编辑，符合并发冲突保护的真实使用方式。
    await options.reload({ waitUntil: "load" });
    await waitForOptionsReady(options);
    await testOptionsAndBackup(
      options,
      base127,
      tempDir,
      fixture,
      browser,
      Deno.env.get("BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH") || "",
    );
    console.log("E2E: 设置闭环完成");
    await testServiceWorkerRestart(browser, id, fixture, options);
    await testDesignFixtures(fixture, options, base127);
    assert(errors.length === 0, `E2E 页面错误：${errors.join("；")}`);
    console.log(
      "BrowserToolbox E2E 通过：Vomnibar、标签页列表、设置导入导出、站点规则、核心手势、超级拖拽、滚轮、摇杆、跨 frame、设计文档 fixtures 和 Service Worker 重启。",
    );
  } finally {
    await browser?.disconnect();
    chromeProcess?.kill("SIGTERM");
    if (chromeProcess) await chromeProcess.status.catch(() => {});
    await server.shutdown();
    if (chromeUserDataDir) {
      await Deno.remove(chromeUserDataDir, { recursive: true }).catch(() => {});
    }
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) await main();
