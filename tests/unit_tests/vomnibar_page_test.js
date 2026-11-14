import * as testHelper from "./test_helper.js";
import "../../lib/settings.js";
import "../../tests/unit_tests/test_chrome_stubs.js";
import { Suggestion } from "../../background_scripts/completion/completers.js";
import * as vomnibarPage from "../../pages/vomnibar_page.js";

function newKeyEvent(properties) {
  return Object.assign(
    {
      type: "keydown",
      key: "a",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      stopImmediatePropagation: function () {},
      preventDefault: function () {},
    },
    properties,
  );
}

context("vomnibar page", () => {
  let ui;
  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    stub(chrome.runtime, "sendMessage", async (message) => {
      if (message.handler == "filterCompletions") {
        return [];
      }
    });
    vomnibarPage.reset();
    await vomnibarPage.activate();
    ui = vomnibarPage.ui;
  });

  should("hide when escape is pressed", async () => {
    ui.setQuery("www.example.com");
    // Here we assert that the dialog has been reset when esc is pressed, which happens as part of
    // hiding the dialog. It would be better to check more directly that the dialog was hidden, but
    // jacking into the channels for this are not worthwhile for this test.
    await ui.onKeyEvent(newKeyEvent({ key: "Escape" }));
    assert.equal("", ui.input.value);
  });

  should("expose localized mode copy and combobox semantics", () => {
    ui.setCompleterName("bookmarks");
    ui.setForceNewTab(true);

    assert.equal(
      BrowserToolboxI18n.message("vomnibarSearchBookmarks"),
      ui.modeLabel.textContent,
    );
    assert.equal(
      BrowserToolboxI18n.message("vomnibarPlaceholderBookmarks"),
      ui.input.placeholder,
    );
    assert.equal("combobox", ui.input.getAttribute("role"));
    assert.equal("vomnibar-completions", ui.input.getAttribute("aria-controls"));
    assert.equal("false", ui.input.getAttribute("aria-expanded"));
    assert.equal(false, ui.dispositionLabel.hidden);
  });

  should("edit a completion's URL when ctrl-enter is pressed", async () => {
    stub(chrome.runtime, "sendMessage", async (message) => {
      if (message.handler == "filterCompletions") {
        const s = new Suggestion({ url: "http://hello.com" });
        return [s];
      }
    });
    await ui.update();
    await ui.onKeyEvent(newKeyEvent({ type: "keydown", key: "up" }));
    // TODO(philc): Why does this need to be lowercase enter?
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", ctrlKey: true, key: "enter" }));
    assert.equal("http://hello.com", ui.input.value);
  });

  should("open a URL-like query when enter is pressed", async () => {
    ui.setQuery("www.example.com");
    let handler = null;
    let url = null;
    stub(chrome.runtime, "sendMessage", async (message) => {
      handler = message.handler;
      url = message.url;
    });
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    ui.onHidden();
    assert.equal("openUrlInCurrentTab", handler);
    assert.equal("www.example.com", url);
  });

  should("search for a non-URL query when enter is pressed", async () => {
    ui.setQuery("example");
    let handler = null;
    let query = null;
    stub(chrome.runtime, "sendMessage", async (message) => {
      handler = message.handler;
      query = message.query;
    });
    await ui.onKeyEvent(newKeyEvent({ type: "keypress", key: "Enter" }));
    ui.onHidden();
    assert.equal("launchSearchQuery", handler);
    assert.equal("example", query);
  });

  // This test covers #4396.
  should("not treat javascript keywords as user-defined search engines", async () => {
    ui.setQuery("constructor "); // "constructor" is a built-in JS property
    ui.onInput();
    // The query should not be treated as a user search engine.
    assert.equal("constructor ", ui.input.value);
  });
});

context("独立查找栏初次准备", () => {
  let settingsReady, localeReady, counts;
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => resolve = done);
    return { promise, resolve };
  };
  setup(async () => {
    await testHelper.jsdomStub("pages/vomnibar_page.html");
    // 延迟onLoaded只模拟准备时序；配置本身必须显式加载，不能依赖前一个测试的残留。
    await Settings.onLoaded();
    vomnibarPage.reset();
    counts = { settings: 0, locale: 0, css: 0 };
    settingsReady = deferred(); localeReady = deferred();
    stub(globalThis, "BrowserToolboxUIAuthorization", { ready: Promise.resolve({ planVersion: 6 }) });
    stub(globalThis, "BrowserToolboxRuntimePlans", {
      allowed: [{ planVersion: 6, moduleImplementations: { vomnibar: "browser-toolbox" } }],
    });
    stub(Settings, "onLoaded", () => { counts.settings++; return settingsReady.promise; });
    stub(globalThis, "BrowserToolboxI18n", {
      ...BrowserToolboxI18n,
      applyStoredLocale() { counts.locale++; return localeReady.promise; },
    });
    stub(DomUtils, "injectUserCss", () => { counts.css++; });
    stub(chrome.runtime, "sendMessage", async (message) => message.handler === "filterCompletions" ? [] : undefined);
  });
  teardown(() => vomnibarPage.reset());
  should("并发激活只读取一次设置和语言，两者均就绪后才注入CSS并激活最新交互", async () => {
    const first = vomnibarPage.activate({ interactionId: "first" });
    const second = vomnibarPage.activate({ interactionId: "second" });
    await Promise.resolve();
    assert.equal({ settings: 1, locale: 1, css: 0 }, counts);
    settingsReady.resolve();
    await Promise.resolve();
    assert.equal(null, vomnibarPage.ui);
    localeReady.resolve();
    await Promise.all([first, second]);
    assert.equal({ settings: 1, locale: 1, css: 1 }, counts);
    assert.equal("second", vomnibarPage.ui.interactionId);
    assert.isTrue(vomnibarPage.ui.active);
  });
  should("控制器创建前收到hidden，准备完成后也不会激活或夺回焦点", async () => {
    const opening = vomnibarPage.activate({ interactionId: "cancelled" });
    await Promise.resolve();
    vomnibarPage.onHidden({ interactionId: "cancelled" });
    settingsReady.resolve(); localeReady.resolve();
    await opening;
    assert.equal(null, vomnibarPage.ui);
    assert.isFalse(document.activeElement?.tagName === "INPUT");
  });
});
