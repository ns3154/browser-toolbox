// SPDX-License-Identifier: GPL-3.0-or-later
// 合成动态编辑器回归：独立运行，不替代真实站点、系统输入法或完整门禁。
// deno-lint-ignore no-import-prefix no-unversioned-import
import puppeteer from "npm:puppeteer";
import * as path from "@std/path";

const root = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)));
const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();
const compatPath = Deno.env.get("BROWSER_TOOLBOX_DYNAMIC_COMPAT_PATH") ||
  path.join(root, "dist/browser-toolbox");
const canaryPath = Deno.env.get("BROWSER_TOOLBOX_DYNAMIC_CANARY_PATH");
const reportPath = Deno.env.get("BROWSER_TOOLBOX_DYNAMIC_REPORT");
if (!canaryPath || !reportPath) throw new Error("必须提供方案 9 加载目录及未使用的报告路径");
try {
  await Deno.lstat(reportPath);
  throw new Error(`报告路径已存在：${reportPath}`);
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}

const fixture =
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>动态编辑器输入</title>
<style>body{min-height:5000px;margin:16px;font:16px sans-serif}iframe{width:500px;height:300px;border:1px solid}input,textarea,[contenteditable]{display:block;width:300px;min-height:30px;margin:12px;border:1px solid}</style>
<body><h1>动态编辑器</h1><main id="editors"></main><div id="frames"></div><a href="#target">链接目标</a></body></html>`;
const serve = () =>
  Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    () => new Response(fixture, { headers: { "content-type": "text/html;charset=utf-8" } }),
  );
const mainServer = serve();
const childServer = serve();
const mainUrl = `http://127.0.0.1:${mainServer.addr.port}/main`;
const childUrl = `http://127.0.0.1:${childServer.addr.port}/child`;
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  fixture: "synthetic",
  origins: [mainUrl, childUrl],
  checks: [],
  browsers: [],
  manualSystemIme: "pending",
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate, description) {
  for (let index = 0; index < 300; index++) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error(`等待超时：${description}`);
}

async function run(name, extensionPath, expectedPlan) {
  const profile = await Deno.makeTempDir({ prefix: "browser-toolbox-dynamic-input-" });
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir: profile,
      defaultViewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
    report.browsers.push({ implementation: name, version: await browser.version(), extensionPath });
    const target = await browser.waitForTarget((item) =>
      item.type() === "service_worker" &&
      item.url().startsWith("chrome-extension://")
    );
    const id = new URL(target.url()).host;
    const options = await browser.newPage();
    await options.goto(`chrome-extension://${id}/pages/mouse_options.html`);
    await options.waitForSelector("#save-settings");
    const config = await options.evaluate(() =>
      chrome.runtime.sendMessage({
        handler: "browserToolbox.configuration",
        action: "commit",
        input: { legacyPatch: { smoothScroll: false, scrollStepSize: 60, grabBackFocus: false } },
      })
    );
    assert(config.ok, `配置保存失败：${config.code}`);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(mainUrl);
    await page.bringToFront();
    const states = () => {
      return options.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
        if (!tab) return [];
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          world: "ISOLATED",
          func: () => {
            if (!["http:", "https:"].includes(location.protocol)) return null;
            const host = globalThis.BrowserToolboxRuntimeHostInstance;
            const normal = Mode.modes.find((mode) => mode.name === "normal");
            return {
              url: location.href,
              active: host?.state,
              plan: host?.plan?.planVersion,
              documentId: host?.context?.documentId,
              ready: Boolean(normal?.keyMapping && Settings.isLoaded()),
              modes: Mode.modes.map((mode) => mode.name),
              vomnibarShowing: Boolean(
                (typeof Vomnibar !== "undefined" && Vomnibar.vomnibarUI?.showing) ||
                  globalThis.BrowserToolboxVomnibarControllerInstance?.ui?.showing,
              ),
            };
          },
        });
        return results.map((item) => item.result).filter(Boolean);
      }, mainUrl);
    };
    const ready = async (count) => {
      await wait(async () => {
        const current = await states();
        return current.length === count &&
          current.every((state) =>
            state.ready && state.active === "active" && state.plan === expectedPlan
          );
      }, `${name} ${count} 个文档就绪`);
    };
    const check = async (label, task) => {
      const started = performance.now();
      try {
        const details = await task();
        report.checks.push({
          implementation: name,
          name: label,
          status: "passed",
          durationMs: Math.round(performance.now() - started),
          details,
        });
        console.log(`${name}：${label} 通过`);
      } catch (error) {
        report.checks.push({
          implementation: name,
          name: label,
          status: "failed",
          durationMs: Math.round(performance.now() - started),
          error: error.stack || String(error),
        });
        console.error(`${name}：${label} 失败：${error.message}`);
      }
    };
    const createEditor = async (frame, kind, generation) => {
      await frame.evaluate(({ kind, generation }) => {
        const container = document.getElementById("editors");
        container.replaceChildren();
        const editor = document.createElement(kind === "editable" ? "div" : kind);
        editor.id = "dynamic-editor";
        if (kind === "editable") editor.contentEditable = "true";
        editor.dataset.generation = String(generation);
        editor.addEventListener("keydown", (event) => {
          globalThis.trustedKeys ||= [];
          globalThis.trustedKeys.push({ key: event.key, trusted: event.isTrusted });
        });
        globalThis.trustedKeys = [];
        container.append(editor);
      }, { kind, generation });
    };
    const verifyInput = async (frame, kind, generation) => {
      await createEditor(frame, kind, generation);
      await frame.click("#dynamic-editor");
      const before = await Promise.all([
        page.evaluate(() => scrollY),
        frame.evaluate(() => scrollY),
      ]);
      const frameCount = page.frames().length;
      await page.keyboard.type("jkof");
      const result = await frame.evaluate(() => {
        const editor = document.getElementById("dynamic-editor");
        return {
          value: "value" in editor ? editor.value : editor.textContent,
          active: document.activeElement === editor,
          generation: editor.dataset.generation,
          keys: globalThis.trustedKeys,
          markers: document.querySelectorAll(".vimiumHintMarker").length,
        };
      });
      const after = await Promise.all([
        page.evaluate(() => scrollY),
        frame.evaluate(() => scrollY),
      ]);
      const current = await states();
      assert(
        current.some((state) =>
          state.url === frame.url() && state.ready &&
          state.active === "active" && state.plan === expectedPlan
        ),
        "编辑文档的运行时观测缺失",
      );
      assert(result.value === "jkof", `输入内容异常：${JSON.stringify(result)}`);
      assert(result.active && result.generation === String(generation), "动态编辑器或焦点异常");
      assert(
        result.keys.length === 4 &&
          result.keys.every((item, i) => item.trusted && item.key === "jkof"[i]),
        "按键不是逐字可信事件",
      );
      assert(before.every((value, i) => value === after[i]), "编辑时页面发生滚动");
      assert(
        result.markers === 0 && page.frames().length === frameCount &&
          current.every((state) =>
            !state.vomnibarShowing && !state.modes.some((mode) => mode.startsWith("hint/"))
          ),
        "编辑时触发提示或导航面板",
      );
      await page.keyboard.press("Escape");
      assert(
        await frame.evaluate(() => document.activeElement?.id !== "dynamic-editor"),
        "Escape 未释放编辑器焦点",
      );
      const scrollBefore = await frame.evaluate(() => scrollY);
      await page.keyboard.press("j");
      const scrollAfter = await frame.evaluate(() => scrollY);
      assert(
        scrollAfter === scrollBefore + 60,
        `退出编辑后 j 未恢复：${scrollBefore} → ${scrollAfter}`,
      );
      return {
        value: result.value,
        trustedKeys: result.keys.length,
        before,
        after,
        scrollAfterEscape: [scrollBefore, scrollAfter],
        frameStates: current,
      };
    };
    const verifyFocusedReplacement = async (frame, kind) => {
      await createEditor(frame, kind, 3);
      await frame.click("#dynamic-editor");
      await page.keyboard.type("jk");
      await frame.evaluate(() => {
        globalThis.replacedEditor = document.getElementById("dynamic-editor");
        if (document.activeElement !== globalThis.replacedEditor) throw new Error("旧编辑器未聚焦");
      });
      await createEditor(frame, kind, 4);
      await frame.click("#dynamic-editor");
      const before = await Promise.all([
        page.evaluate(() => scrollY),
        frame.evaluate(() => scrollY),
      ]);
      const frameCount = page.frames().length;
      await page.keyboard.type("of");
      const result = await frame.evaluate(() => {
        const editor = document.getElementById("dynamic-editor");
        const value = (node) => "value" in node ? node.value : node.textContent;
        return {
          oldDetached: !globalThis.replacedEditor.isConnected,
          oldValue: value(globalThis.replacedEditor),
          newValue: value(editor),
          active: document.activeElement === editor,
          keys: globalThis.trustedKeys,
          markers: document.querySelectorAll(".vimiumHintMarker").length,
        };
      });
      const after = await Promise.all([
        page.evaluate(() => scrollY),
        frame.evaluate(() => scrollY),
      ]);
      const current = await states();
      assert(
        current.some((state) =>
          state.url === frame.url() && state.ready &&
          state.active === "active" && state.plan === expectedPlan
        ),
        "替换后编辑文档的运行时观测缺失",
      );
      assert(
        result.oldDetached && result.oldValue === "jk" && result.newValue === "of" && result.active,
        `聚焦时替换后的输入异常：${JSON.stringify(result)}`,
      );
      assert(
        result.keys.length === 2 &&
          result.keys.every((item, i) => item.trusted && item.key === "of"[i]),
        "替换后的按键不是逐字可信事件",
      );
      assert(before.every((value, i) => value === after[i]), "替换后编辑时页面发生滚动");
      assert(
        result.markers === 0 && page.frames().length === frameCount &&
          current.every((state) =>
            !state.vomnibarShowing && !state.modes.some((mode) => mode.startsWith("hint/"))
          ),
        "替换后编辑时触发提示或导航面板",
      );
      return {
        oldValue: result.oldValue,
        newValue: result.newValue,
        trustedKeys: 2,
        frameStates: current,
      };
    };
    await ready(1);
    for (const kind of ["input", "textarea", "editable"]) {
      await check(`主文档动态 ${kind} 插入及替换`, async () => {
        await page.evaluate(() => scrollTo(0, 0));
        const first = await verifyInput(page.mainFrame(), kind, 1);
        await page.evaluate(() => scrollTo(0, 0));
        const second = await verifyInput(page.mainFrame(), kind, 2);
        await page.evaluate(() => scrollTo(0, 0));
        const focusedReplacement = await verifyFocusedReplacement(page.mainFrame(), kind);
        return { first, second, focusedReplacement };
      });
    }
    await check("跨源子 frame 动态编辑器与重建后的输入", async () => {
      const samples = [];
      const documentIds = [];
      for (let generation = 1; generation <= 2; generation++) {
        await page.evaluate((url) => {
          scrollTo(0, 0);
          const holder = document.getElementById("frames");
          holder.replaceChildren();
          const iframe = document.createElement("iframe");
          iframe.id = "dynamic-frame";
          iframe.src = url;
          holder.append(iframe);
        }, childUrl);
        await wait(
          () => Promise.resolve(page.frames().some((frame) => frame.url() === childUrl)),
          "异源子 frame 加载",
        );
        await ready(2);
        const frame = page.frames().find((item) => item.url() === childUrl);
        assert(
          frame && new URL(mainUrl).origin !== new URL(frame.url()).origin,
          "子 frame 必须跨源",
        );
        const childState = (await states()).find((state) => state.url === childUrl);
        assert(
          childState?.documentId && !documentIds.includes(childState.documentId),
          "重建后的子 frame 未获得新文档身份",
        );
        documentIds.push(childState.documentId);
        for (const kind of ["input", "textarea", "editable"]) {
          await frame.evaluate(() => scrollTo(0, 0));
          const input = await verifyInput(frame, kind, generation);
          await frame.evaluate(() => scrollTo(0, 0));
          const focusedReplacement = await verifyFocusedReplacement(frame, kind);
          samples.push({ generation, kind, ...input, focusedReplacement });
        }
      }
      return { childOrigin: new URL(childUrl).origin, documentIds, samples };
    });
    await check("开放 Shadow 编辑状态切换与移除后恢复", async () => {
      await page.goto(mainUrl);
      await ready(1);
      await page.evaluate(() => {
        const host = document.createElement("div");
        document.getElementById("editors").append(host);
        const root = host.attachShadow({ mode: "open" });
        const editor = document.createElement("div");
        editor.contentEditable = "true";
        editor.tabIndex = 0;
        editor.style.cssText = "display:block;min-height:50px;width:300px;border:1px solid";
        root.append(editor);
        const keys = [];
        editor.addEventListener("keydown", (event) => {
          keys.push({ key: event.key, trusted: event.isTrusted });
        });
        editor.focus();
        globalThis.dynamicShadow = {
          setEditable: (editable) => {
            editor.contentEditable = String(editable);
            if (editable) {
              const selection = getSelection();
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          },
          remove: () => host.remove(),
          inspect: () => ({
            value: editor.textContent,
            keys: [...keys],
            active: document.activeElement === host && root.activeElement === editor,
            editable: editor.isContentEditable,
            connected: host.isConnected,
            scroll: scrollY,
          }),
        };
      });
      const inspect = () => page.evaluate(() => globalThis.dynamicShadow.inspect());
      const initial = await inspect();
      assert(initial.active && initial.editable, "开放根编辑器未聚焦");
      await page.keyboard.type("jk");
      const first = await inspect();
      assert(first.value === "jk" && first.scroll === initial.scroll, "开放根首次输入异常");
      assert(
        first.keys.length === 2 &&
          first.keys.every((item, index) => item.trusted && item.key === "jk"[index]),
        "开放根首次输入不是逐字可信按键",
      );
      await page.evaluate(() => globalThis.dynamicShadow.setEditable(false));
      const disabled = await inspect();
      assert(disabled.active && !disabled.editable, "切换后焦点或编辑状态异常");
      await page.keyboard.press("j");
      const afterDisabled = await inspect();
      assert(
        afterDisabled.value === "jk" && afterDisabled.scroll === disabled.scroll + 60,
        "编辑状态关闭后页面快捷键未恢复",
      );
      await page.evaluate(() => globalThis.dynamicShadow.setEditable(true));
      const enabled = await inspect();
      assert(enabled.active && enabled.editable, "重新启用后焦点或编辑状态异常");
      await page.keyboard.type("of");
      const second = await inspect();
      assert(
        second.value === "jkof" && second.scroll === enabled.scroll,
        "重新启用后的输入异常",
      );
      assert(
        second.keys.slice(-2).every((item, index) => item.trusted && item.key === "of"[index]),
        "开放根重新启用后未收到逐字可信按键",
      );
      await page.evaluate(() => globalThis.dynamicShadow.remove());
      const removed = await inspect();
      assert(!removed.connected && !removed.active, "聚焦的开放根未移除");
      await page.keyboard.press("j");
      const afterRemoval = await inspect();
      assert(afterRemoval.scroll === removed.scroll + 60, "移除编辑器后页面快捷键未恢复");
      const current = await states();
      assert(
        current.length === 1 && current[0].active === "active" &&
          current[0].plan === expectedPlan &&
          !current[0].vomnibarShowing && !current[0].modes.some((mode) => mode.startsWith("hint/")),
        "开放根输入触发导航或提示",
      );
      return { initial, first, disabled, afterDisabled, enabled, second, removed, afterRemoval };
    });
    await check("跨源 designMode 富文本输入与关闭后恢复", async () => {
      await page.goto(mainUrl);
      await ready(1);
      await page.evaluate((url) => {
        const iframe = document.createElement("iframe");
        iframe.id = "rich-frame";
        iframe.src = url;
        document.getElementById("frames").append(iframe);
      }, childUrl);
      await wait(
        () => Promise.resolve(page.frames().some((frame) => frame.url() === childUrl)),
        "富文本子 frame 加载",
      );
      await ready(2);
      const frame = page.frames().find((item) => item.url() === childUrl);
      assert(
        frame && new URL(frame.url()).origin !== new URL(mainUrl).origin,
        "富文本 frame 必须跨源",
      );
      await frame.evaluate(() => {
        document.body.replaceChildren();
        const editor = document.createElement("p");
        editor.id = "rich-editor";
        editor.style.cssText = "min-height:80px;border:1px solid";
        document.body.append(editor);
        document.designMode = "on";
        globalThis.richKeys = [];
        document.addEventListener("keydown", (event) => {
          globalThis.richKeys.push({ key: event.key, trusted: event.isTrusted });
        });
      });
      await frame.click("#rich-editor");
      const before = await frame.evaluate(() => ({
        designMode: document.designMode,
        editable: document.body.isContentEditable,
        focused: document.hasFocus(),
        scroll: scrollY,
      }));
      assert(before.designMode === "on" && before.editable && before.focused, "富文本编辑器未就绪");
      await page.keyboard.type("jkof");
      const typed = await frame.evaluate(() => ({
        value: document.getElementById("rich-editor").textContent,
        keys: globalThis.richKeys,
        scroll: scrollY,
        markers: document.querySelectorAll(".vimiumHintMarker").length,
      }));
      assert(
        typed.value === "jkof" && typed.scroll === before.scroll,
        "富文本输入触发快捷键或滚动",
      );
      assert(
        typed.keys.length === 4 &&
          typed.keys.every((item, index) => item.trusted && item.key === "jkof"[index]),
        "富文本编辑器未收到逐字可信按键",
      );
      const current = await states();
      assert(
        typed.markers === 0 && current.length === 2 &&
          current.every((state) =>
            state.active === "active" && state.plan === expectedPlan && !state.vomnibarShowing &&
            !state.modes.some((mode) => mode.startsWith("hint/"))
          ),
        "富文本输入触发导航或提示",
      );
      await frame.evaluate(() => {
        document.designMode = "off";
        document.activeElement?.blur();
      });
      const off = await frame.evaluate(() => ({
        designMode: document.designMode,
        scroll: scrollY,
      }));
      await page.keyboard.press("j");
      const after = await frame.evaluate(() => scrollY);
      assert(
        off.designMode === "off" && after === off.scroll + 60,
        "关闭 designMode 后快捷键未恢复",
      );
      return { before, typed, off, after, frameStates: current };
    });
    if (expectedPlan === 9) {
      await check("封闭 Shadow 编辑器保护输入，普通按钮保留快捷键", async () => {
        await page.goto(mainUrl);
        await ready(1);
        await page.evaluate(() => {
          const host = document.createElement("div");
          document.getElementById("editors").append(host);
          const closed = host.attachShadow({ mode: "closed" });
          const nested = document.createElement("div");
          closed.append(nested);
          const open = nested.attachShadow({ mode: "open" });
          const editor = document.createElement("textarea");
          const button = document.createElement("button");
          button.textContent = "普通按钮";
          button.contentEditable = "false";
          open.append(editor, button);
          const keys = [];
          editor.addEventListener("keydown", (event) => {
            keys.push({ key: event.key, trusted: event.isTrusted });
          });
          editor.focus();
          // 仅测试页面保有编辑器引用，扩展无需读取闭根中的文本。
          globalThis.closedFixture = {
            focusButton: () => {
              host.contentEditable = "true";
              button.focus();
            },
            inspect: () => ({
              value: editor.value,
              keys: [...keys],
              editorActive: open.activeElement === editor,
              buttonActive: open.activeElement === button,
              hostActive: document.activeElement === host,
              hostEditable: host.isContentEditable,
              buttonEditable: button.isContentEditable,
              rootHidden: host.shadowRoot === null,
              scroll: scrollY,
            }),
          };
        });
        const inspect = () => page.evaluate(() => globalThis.closedFixture.inspect());
        const before = await inspect();
        assert(before.editorActive && before.hostActive && before.rootHidden, "封闭编辑器未就绪");
        await page.keyboard.type("j");
        const afterJ = await inspect();
        await page.keyboard.type("kof");
        const typed = await inspect();
        assert(
          typed.editorActive && typed.value === "jkof",
          `闭根输入异常：${JSON.stringify({ afterJ, typed })}`,
        );
        assert(
          typed.keys.length === 4 &&
            typed.keys.every((item, i) => item.trusted && item.key === "jkof"[i]),
          "闭根编辑器未收到四个可信按键",
        );
        assert(
          afterJ.scroll === before.scroll && typed.scroll === before.scroll,
          "闭根输入触发滚动",
        );
        const current = await states();
        assert(
          current.length === 1 && page.frames().length === 1 && current[0].active === "active" &&
            current[0].plan === expectedPlan && !current[0].vomnibarShowing &&
            !current[0].modes.some((mode) => mode.startsWith("hint/")),
          "闭根输入触发导航或提示",
        );
        await page.keyboard.press("Escape");
        assert(!(await inspect()).editorActive, "Escape 未退出闭根编辑器");
        await page.keyboard.press("j");
        const restored = await inspect();
        assert(restored.scroll === before.scroll + 60, "退出编辑器后 j 未恢复");
        await page.evaluate(() => globalThis.closedFixture.focusButton());
        const onButton = await inspect();
        assert(
          onButton.hostEditable && !onButton.buttonEditable && onButton.hostActive &&
            onButton.buttonActive,
          "可编辑宿主内的普通按钮未聚焦",
        );
        await page.keyboard.press("j");
        const buttonResult = await inspect();
        assert(buttonResult.scroll === onButton.scroll + 60, "闭根普通按钮错误屏蔽了 j");
        const formScroll = await page.evaluate(() => {
          const form = document.createElement("form");
          form.tabIndex = 0;
          const field = document.createElement("input");
          field.name = "matches";
          form.append(field);
          document.getElementById("editors").append(form);
          form.focus();
          if (document.activeElement !== form || form.matches !== field) {
            throw new Error("同名表单控件未遮蔽实例方法");
          }
          return scrollY;
        });
        await page.keyboard.press("j");
        const formAfter = await page.evaluate(() => scrollY);
        assert(formAfter === formScroll + 60, "聚焦含同名字段的表单时 j 未滚动");
        return { before, afterJ, typed, restored, onButton, buttonResult, formScroll, formAfter };
      });
    }
    assert(errors.length === 0, `页面脚本错误：${errors.join("；")}`);
  } catch (error) {
    report.checks.push({
      implementation: name,
      name: "测试准备与运行",
      status: "failed",
      error: error.stack || String(error),
    });
    console.error(`${name}：测试准备与运行失败：${error.message}`);
  } finally {
    if (browser) await browser.close();
    await Deno.remove(profile, { recursive: true });
  }
}

try {
  await run("方案1", compatPath, 1);
  await run("方案9", canaryPath, 9);
} finally {
  mainServer.shutdown();
  childServer.shutdown();
  report.finishedAt = new Date().toISOString();
  report.status = report.checks.length === 13 && report.checks.every((check) =>
      check.status === "passed"
    )
    ? "passed"
    : "failed";
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n", { createNew: true });
}
if (report.status !== "passed") Deno.exit(1);
