#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys

// OpenKeyMouse 的隔离浏览器 E2E。脚本只使用本地 fixture 和临时 profile，不访问项目服务器。
import puppeteer from "npm:puppeteer";

const projectRoot = decodeURIComponent(new URL("../", import.meta.url).pathname).replace(/\/$/, "");
const extensionPath = `${projectRoot}/dist/vimium`;
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const headless = Deno.env.get("OPEN_KEY_MOUSE_E2E_HEADLESS") === "false" ? false : "new";
const settingsKey = "openKeyMouseSettings";
const pngBytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

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

function html(body, title = "OpenKeyMouse E2E") {
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
    <h1 id="heading">OpenKeyMouse fixture</h1>
    <div id="gesture-target" style="position:fixed;top:80px;left:50%;z-index:1;margin:0">Gesture target</div>
    <a id="link" href="${base127}/target.html">Example link text</a>
    <a id="second-link" href="${base127}/target-2.html">Second link text</a>
    <p id="selectable">Text selected for a local E2E clipboard check.</p>
    <img id="image" src="${base127}/pixel.png" alt="Local image">
    <div id="card" draggable="true">Native draggable card</div>
    <div id="editor" contenteditable="true">Protected editor</div>
    <input id="upload" type="file">
    <div id="scroll-box"><div>Scrollable inner content</div></div>
    <iframe id="frame" src="${baseLocal}/frame.html" title="E2E frame"></iframe>
  `);
}

function frameHtml(base127) {
  return html(
    `<a id="frame-link" href="${base127}/target.html">Frame link</a>`,
    "OpenKeyMouse frame",
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
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
    const url = new URL(request.url);
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
  base127 = `http://127.0.0.1:${port}`;
  baseLocal = `http://localhost:${port}`;
  return { server, base127, baseLocal };
}

async function getFreePort() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = listener.addr.port;
  listener.close();
  return port;
}

async function startChrome() {
  const port = await getFreePort();
  const userDataDir = await Deno.makeTempDir({ prefix: "open-key-mouse-e2e-profile-" });
  const process = new Deno.Command(executablePath, {
    args: [
      headless ? "--headless=new" : "--headless=false",
      "--no-sandbox",
      "--disable-gpu",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
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
  return { browser, process, userDataDir };
}

async function extensionId(browser) {
  return waitFor(() => {
    const target = browser.targets().find((item) =>
      item.type() === "service_worker" &&
      item.url().startsWith("chrome-extension://") &&
      item.url().includes("/background_scripts/main.js")
    );
    return target?.url().split("/")[2] || null;
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
    globalThis.__openKeyMouseE2eEvents = [];
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
        globalThis.__openKeyMouseE2eEvents.push({
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
        });
      }, true);
    }
  });
  return page;
}

async function clearEvents(page) {
  await page.evaluate(() => globalThis.__openKeyMouseE2eEvents.splice(0));
}

async function events(page) {
  return await page.evaluate(() => globalThis.__openKeyMouseE2eEvents.slice());
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
          const controller = globalThis.OpenKeyMouseMouseControllerInstance;
          return Boolean(
            controller?.initialized && !controller.initializing && controller.listeners?.length > 0,
          );
        },
      });
      return results[0]?.result === true;
    }, pageUrl)
  );
}

async function openOptions(browser, id, errors) {
  const page = await createPage(browser, errors);
  await page.goto(`chrome-extension://${id}/pages/mouse_options.html`, { waitUntil: "load" });
  await page.waitForSelector("#save-settings");
  await sleep(300);
  return page;
}

async function resetSettings(options) {
  await options.evaluate(async (key) => {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.sync.remove(key);
  }, settingsKey);
  await options.reload({ waitUntil: "load" });
  await options.waitForSelector("#save-settings");
  await sleep(300);
}

async function patchSettings(options, patch) {
  await options.evaluate(async ({ key, patch }) => {
    const stored = (await chrome.storage.sync.get(key))[key] || {};
    const next = OpenKeyMouseSettingsSchema.mergeSettings(stored, patch);
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
  await waitFor(() =>
    options.evaluate(() => document.querySelector("#save-status").textContent === "Saved")
  );
}

async function testOptionsAndBackup(options, base127, tempDir) {
  console.log("E2E: 设置页保存");
  await options.select("#language", "en");
  console.log("E2E: 已选择语言");
  await options.$eval("#activation-distance", (element) => {
    element.value = "37";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  console.log("E2E: 已填写激活距离");
  await saveOptions(options);
  console.log("E2E: 首次保存完成");
  assertEqual((await readSettings(options)).mouse.activationDistancePx, 37, "设置页保存激活距离");

  const client = await options.createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: tempDir });
  await options.$eval("button[data-section='backup']", (element) => element.click());
  await options.$eval("#export-settings", (element) => element.click());
  console.log("E2E: 等待设置导出");
  const exportPath = `${tempDir}/open-key-mouse-settings.json`;
  await waitFor(async () => {
    try {
      const info = await Deno.stat(exportPath);
      return info.isFile;
    } catch (_) {
      return false;
    }
  });

  await options.$eval("button[data-section='mouse']", (element) => element.click());
  await options.$eval("#activation-distance", (element) => {
    element.value = "61";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await saveOptions(options);
  assertEqual((await readSettings(options)).mouse.activationDistancePx, 61, "导入前修改激活距离");

  console.log("E2E: 导入有效设置");
  await options.evaluate(() => globalThis.confirm = () => true);
  await options.$eval("#save-status", (element) => element.textContent = "");
  await (await options.$("#import-settings")).uploadFile(exportPath);
  await waitFor(async () => (await readSettings(options)).mouse.activationDistancePx === 37);
  assertEqual((await readSettings(options)).mouse.activationDistancePx, 37, "设置导入恢复激活距离");

  console.log("E2E: 拒绝非法设置");
  const invalidPath = `${tempDir}/invalid-open-key-mouse.json`;
  await Deno.writeTextFile(
    invalidPath,
    JSON.stringify({
      format: "open-key-mouse-settings",
      settings: { schemaVersion: 3, mouse: { activationDistancePx: 999 } },
    }),
  );
  await (await options.$("#import-settings")).uploadFile(invalidPath);
  await waitFor(() =>
    options.evaluate(() => document.querySelector("#settings-error").textContent.length > 0)
  );
  assertEqual(
    (await readSettings(options)).mouse.activationDistancePx,
    37,
    "非法导入不覆盖现有设置",
  );

  console.log("E2E: 保存站点规则");
  await options.$eval("button[data-section='siteRules']", (element) => element.click());
  await options.$eval("#add-site-rule", (element) => element.click());
  await options.$eval("#site-rules tr:first-child input", (element, pattern) => {
    element.value = pattern;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, `${base127}/*`);
  const firstRuleCheckboxes = await options.$$("#site-rules tr:first-child input[type=checkbox]");
  assert(firstRuleCheckboxes.length > 0, "站点规则应渲染模块复选框");
  await options.evaluate(() => {
    document.querySelectorAll("#site-rules tr:first-child input[type=checkbox]")[1]?.click();
  });
  await saveOptions(options);
  const savedRule = (await readSettings(options)).siteRules[0];
  assertEqual(savedRule.pattern, `${base127}/*`, "站点规则保存网址匹配式");
  assertEqual(savedRule.modules.mouse, false, "站点规则保存鼠标禁用状态");
}

async function testMouseGestures(page, base127, browser, options) {
  console.log("E2E: 鼠标轨迹");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await clearEvents(page);
  await sendDrag(page, await pointsFor(page, "#gesture-target", -5, 0), "right");
  assert(page.url().endsWith("/fixture.html"), "低于激活距离的右键输入不应触发历史命令");
  await page.evaluate(() => scrollTo(0, 1200));
  assertEqual(await page.evaluate(() => scrollY), 1200, "未达到手势方向绑定时页面滚动位置保持");

  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/two.html`, { waitUntil: "load" });
  await sleep(1000);
  console.log(
    "E2E: 历史起点",
    await page.evaluate(() => ({ url: location.href, length: history.length })),
  );
  await sendDrag(page, await pointsFor(page, "#target", -140, 0), "right");
  console.log(
    "E2E: 后退后",
    await page.evaluate(() => ({ url: location.href, length: history.length })),
  );
  await waitFor(() => page.url().endsWith("/one.html"));
  await waitForController(options, page.url());
  await sendDrag(page, await pointsFor(page, "#target", 140, 0), "right");
  await waitFor(() => page.url().endsWith("/two.html"));

  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.evaluate(() => scrollTo(0, 1000));
  await sendDrag(
    page,
    await turnPoints(page, "#gesture-target", 60, 0, 0, -50),
    "right",
  );
  await waitFor(() => page.evaluate(() => scrollY === 0));
  await page.evaluate(() => scrollTo(0, 0));
  await sendDrag(
    page,
    await turnPoints(page, "#gesture-target", 60, 0, 0, 120),
    "right",
  );
  await waitFor(() => page.evaluate(() => scrollY > 0));

  const temporary = await createPage(browser, []);
  await temporary.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  const pageCount = (await browser.pages()).length;
  await sendDrag(
    temporary,
    await turnPoints(temporary, "#gesture-target", 0, 60, 120, 0),
    "right",
  );
  await waitFor(() => temporary.isClosed());
  assertEqual((await browser.pages()).length, pageCount - 1, "关闭标签页手势关闭当前标签页");
}

async function testSuperDrag(page, base127, browser) {
  console.log("E2E: 超级拖拽");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.bringToFront();
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

  await page.evaluate(() => {
    const text = document.querySelector("#selectable");
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await sendDrag(page, await pointsFor(page, "#selectable", 0, 120), "left");
  const clipboard = await page.evaluate(async () => await navigator.clipboard?.readText?.() || "");
  assert(
    clipboard.includes("local E2E clipboard check"),
    "Super Drag 选择文本复制应写入本地剪贴板",
  );

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
}

async function testWheelRockerAndFrames(page, base127) {
  console.log("E2E: 滚轮摇杆跨 frame");
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  await page.evaluate(() => scrollTo(0, 1200));
  await clearEvents(page);
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

  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/two.html`, { waitUntil: "load" });
  await sleep(1000);
  await sendRocker(page, "right", "left");
  await waitFor(() => page.url().endsWith("/one.html"));
  await sendRocker(page, "left", "right");
  await waitFor(() => page.url().endsWith("/two.html"));

  await page.goto(`${base127}/one.html`, { waitUntil: "load" });
  await page.goto(`${base127}/fixture.html`, { waitUntil: "load" });
  await sleep(1000);
  const frame = page.frames().find((item) => item.url().includes("/frame.html"));
  assert(frame, "跨域 iframe 应加载本地 frame");
  const frameBox = await page.$eval("#frame", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await sendDrag(page, [
    { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 },
    { x: frameBox.x + frameBox.width / 2 - 80, y: frameBox.y + frameBox.height / 2 },
    { x: frameBox.x + frameBox.width / 2 - 150, y: frameBox.y + frameBox.height / 2 },
  ], "right");
  await waitFor(() => page.url().endsWith("/one.html"));
}

async function testSiteRule(page, options, base127) {
  console.log("E2E: 运行时站点规则");
  await patchSettings(options, {
    siteRules: [{
      id: "e2e-site-rule",
      pattern: `${base127}/*`,
      enabled: true,
      modules: { mouse: false },
    }],
  });
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

async function testServiceWorkerRestart(browser, id, page, options) {
  console.log("E2E: Service Worker 重启");
  const browserTarget = browser.target();
  const client = await browserTarget.createCDPSession();
  const targets = await client.send("Target.getTargets");
  const serviceWorker = targets.targetInfos.find((target) =>
    target.type === "service_worker" &&
    target.url.startsWith(`chrome-extension://${id}/`) &&
    target.url.includes("/background_scripts/main.js")
  );
  assert(serviceWorker, "应存在 OpenKeyMouse Service Worker");
  await client.send("Target.closeTarget", { targetId: serviceWorker.targetId });
  await waitFor(() =>
    browser.targets().some((target) =>
      target.type() === "service_worker" &&
      target.url().startsWith(`chrome-extension://${id}/`) &&
      target.url().includes("/background_scripts/main.js")
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
        const invocation = OpenKeyMouseCommandInvocation.createInvocation(
          "scrollToTop",
          {},
          { type: "ui" },
          { pageUrl: globalThis.location.href, topFrame: true },
        );
        return await chrome.runtime.sendMessage({ handler: "openKeyMouse.invoke", invocation });
      },
    });
    return results[0]?.result || null;
  }, pageUrl);
  if (result?.ok !== true) console.error("E2E: Service Worker 重启命令结果", result);
  assert(result?.ok === true, "Service Worker 重启后 Dispatcher 应继续执行命令");
  await waitFor(() => page.evaluate(() => scrollY === 0));
}

async function main() {
  assert(
    await Deno.stat(extensionPath).then((info) => info.isDirectory).catch(() => false),
    "请先运行 ./make.js package",
  );
  const errors = [];
  const { server, base127, baseLocal } = await startFixtureServer();
  const tempDir = await Deno.makeTempDir({ prefix: "open-key-mouse-e2e-download-" });
  let browser;
  let chromeProcess;
  let chromeUserDataDir;
  let options;
  let fixture;
  try {
    ({ browser, process: chromeProcess, userDataDir: chromeUserDataDir } = await startChrome());
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
    await resetSettings(options);
    await options.evaluate(() => navigator.clipboard?.writeText?.(""));
    await patchSettings(options, { general: { language: "en" } });
    fixture = await createPage(browser, errors);
    await browser.defaultBrowserContext().overridePermissions(base127, [
      "clipboard-read",
      "clipboard-write",
    ]);
    await testMouseGestures(fixture, base127, browser, options);
    await testSuperDrag(fixture, base127, browser);
    await testWheelRockerAndFrames(fixture, base127);
    await testSiteRule(fixture, options, base127);
    await testOptionsAndBackup(options, base127, tempDir);
    console.log("E2E: 设置闭环完成");
    await testServiceWorkerRestart(browser, id, fixture, options);
    assert(errors.length === 0, `E2E 页面错误：${errors.join("；")}`);
    console.log(
      "OpenKeyMouse E2E 通过：设置导入导出、站点规则、核心手势、超级拖拽、滚轮、摇杆、跨 frame 和 Service Worker 重启。",
    );
  } finally {
    await browser?.disconnect();
    chromeProcess?.kill("SIGTERM");
    if (chromeProcess) await chromeProcess.status.catch(() => {});
    await server.shutdown();
    await Deno.remove(chromeUserDataDir, { recursive: true }).catch(() => {});
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) await main();
