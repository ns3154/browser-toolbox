// SPDX-License-Identifier: GPL-3.0-or-later
// 旧模块只作为测试预言机；产品新管线不委托旧排序、聚合或发送控制器。
import "../test_helper.js";
import "../../../lib/settings.js";
import "../../../lib/browser_toolbox/runtime_plan.js";
import * as oldRanking from "../../../background_scripts/completion/ranking.js";
import {
  BookmarkCompleter,
  DomainCompleter,
  HistoryCache,
  HistoryCompleter,
  MultiCompleter,
  SearchEngineCompleter,
  Suggestion,
  TabCompleter,
} from "../../../background_scripts/completion/completers.js";
import * as bgUtils from "../../../background_scripts/bg_utils.js";
import * as searchEngines from "../../../background_scripts/user_search_engines.js";
import * as model from "../../../lib/browser_toolbox/completion_model.js";
import {
  CompletionHub,
  CompletionSession,
} from "../../../background_scripts/browser_toolbox/completion_service.js";
import { Suggestions } from "../../../background_scripts/browser_toolbox/completion_suggestions.js";

context("默认搜索隐私边界", () => {
  should("Canary 完成器不会为默认 Google 输入发送联想请求", async () => {
    let calls = 0;
    const suggestions = new Suggestions({
      fetcher: () => {
        calls++;
        throw new Error("默认搜索不应请求在线联想");
      },
    });
    try {
      const url = Settings.defaultOptions.searchEngines.split(/\s+/)[1];
      assert.equal([], await suggestions.complete(url, ["synthetic", "query"]));
      assert.equal(0, calls);
    } finally {
      suggestions.destroy();
    }
  });
});

const event = () => {
  const listeners = new Set();
  return {
    listeners,
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    emit: (...args) => Promise.all([...listeners].map((fn) => fn(...args))),
  };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => resolve = done);
  return { promise, resolve };
};
const close = async (promise, code) => {
  try {
    await promise;
    assert.fail("应拒绝旧会话");
  } catch (error) {
    assert.equal(code, error.message);
  }
};
const apiFixture = () => ({
  runtime: { getURL: (path) => "chrome-extension://synthetic" + path },
  history: { search: async () => [], onVisited: event(), onVisitRemoved: event() },
  bookmarks: {
    getTree: async () => [],
    onCreated: event(),
    onChanged: event(),
    onMoved: event(),
    onRemoved: event(),
    onImportEnded: event(),
  },
  tabs: { query: async () => [], onRemoved: event() },
  webNavigation: { onCommitted: event() },
  windows: { getAll: async () => [], onRemoved: event() },
  storage: { onChanged: event() },
});
const settings = { get: () => "g: https://www.google.com/search?q=%s synthetic Google" };
const tabRecency = { init: async () => {}, recencyScore: (id) => 1 / (id + 1) };
const request = (query, completerName = "omni") => ({
  completerName,
  query,
  queryTerms: model.termsFor(query),
  seenTabToOpenCompletionList: false,
});

context("独立完成模型冻结对照", () => {
  should("默认构建不接受导航方案或任意完成器混合", () => {
    assert.isFalse(BrowserToolboxRuntimePlans.COMPILED_VOMNIBAR_CANARY);
    assert.equal(
      undefined,
      BrowserToolboxRuntimePlans.canonical(BrowserToolboxRuntimePlans.VOMNIBAR_CANARY_PLAN),
    );
    assert.equal(
      undefined,
      BrowserToolboxRuntimePlans.canonical({
        ...BrowserToolboxRuntimePlans.COMPAT_PLAN,
        moduleImplementations: {
          ...BrowserToolboxRuntimePlans.COMPAT_PLAN.moduleImplementations,
          completers: "browser-toolbox",
        },
      }),
    );
  });
  should("大小写、正则字面量、多词及评分与旧实现相同", () => {
    const now = Date.now();
    stub(Date, "now", () => now);
    for (
      const query of ["alpha", "Alpha", "a", "alpha a", "中文", "a.b", "[a]", "&", "alpha alpha"]
    ) {
      const terms = model.termsFor(query);
      for (
        const [url, title] of [["http://synthetic.alpha/a.b", "Alpha alpha"], [
          "synthetic.invalid/中文",
          "中文目标",
        ], ["[a]&/", "[a]&"]]
      ) {
        assert.equal(oldRanking.matches(terms, url, title), model.matches(terms, url, title));
        assert.isTrue(
          Math.abs(
            oldRanking.wordRelevancy(terms, url, title) - model.wordScore(terms, url, title),
          ) < 1e-12,
        );
      }
    }
    for (const time of [now, now - 86400000, now - 30 * 86400000, now + 1000]) {
      assert.isTrue(Math.abs(oldRanking.recencyScore(time) - model.recentScore(time)) < 1e-12);
    }
  });
  should("每次查询的正则复用保持旧评分并隔离并发查询和原始词数组修改", () => {
    const now = Date.now();
    for (const query of ["", "alpha", "Alpha", "alpha a", "中文", "a.b", "[a]", "alpha alpha"]) {
      const terms = model.termsFor(query), prepared = model.prepareQuery(terms);
      const other = model.prepareQuery(["unrelated"]);
      const frozen = [...terms];
      terms.splice(0, terms.length, "unrelated");
      for (let repeat = 0; repeat < 3; repeat++) {
        for (
          const [url, title] of [
            ["http://synthetic.alpha/a.b", "Alpha alpha"],
            ["synthetic.invalid/中文", "中文目标"],
            ["[a]&/", "[a]&"],
          ]
        ) {
          assert.equal(oldRanking.matches(frozen, url, title), prepared.matches(url, title));
          assert.equal(false, other.matches(url, title));
          // 旧聚合器的空查询只按最近访问排序，不调用空词wordRelevancy（其结果为NaN）。
          const score = frozen.length ? oldRanking.wordRelevancy(frozen, url, title) : 0;
          assert.isTrue(Math.abs(score - prepared.wordScore(url, title)) < 1e-12);
          const recent = model.recentScore(now - 86400000, now);
          const expected = frozen.length ? (score + Math.max(score, recent)) / 2 : recent;
          assert.isTrue(
            Math.abs(expected - prepared.historyScore(url, title, now - 86400000, now)) < 1e-12,
          );
        }
      }
    }
  });
  should("简化URL、重叠高亮与转义不改变旧显示含义", () => {
    for (
      const url of [
        "http://synthetic.invalid/%E4%B8%AD%E6%96%87///",
        "https://www.google.com/search?q=alpha&ei=123&sourceid=chrome",
        "https://www.google.co.uk/maps/place/Alpha/@10,20,3z",
        "javascript:void(0)",
      ]
    ) {
      assert.equal(new Suggestion({ url }).shortenUrl(), model.shortUrl(url));
    }
    for (const text of ["Alpha alpha", "<&a><script>alert(1)</script>", "中文目标中文", "abacab"]) {
      const terms = ["a", "alpha", "中文", "<&a>"];
      assert.equal(
        new Suggestion({ queryTerms: terms }).highlightQueryTerms(Utils.escapeHtml(text)),
        model.highlight(text, terms),
      );
    }
    const result = model.finish(
      [model.candidate({
        queryTerms: [],
        description: "<svg onload=bad>",
        title: "<script>bad</script>",
        url: "https://synthetic.invalid",
        relevancy: 1,
      })],
      apiFixture(),
      false,
    )[0];
    assert.isFalse(result.html.includes("<svg"));
    assert.isFalse(result.html.includes("<script"));
  });
  should("稳定排序、10项限制及标签重复保留与旧聚合相同", () => {
    const fields = Array.from(
      { length: 18 },
      (_, index) => ({
        queryTerms: ["alpha"],
        title: "alpha",
        description: index < 2 ? "tab" : "history",
        tabId: index,
        url: "https://synthetic.invalid/" + (index < 3 ? "same" : index),
        relevancy: 1,
        deDuplicate: index >= 2,
      }),
    );
    const legacy = new MultiCompleter([]);
    stub(chrome.runtime, "getURL", apiFixture().runtime.getURL);
    const old = legacy.postProcessSuggestions(
      {},
      ["alpha"],
      fields.map((value) => new Suggestion(value)),
    );
    const own = model.finish(fields.map(model.candidate), apiFixture(), false);
    assert.equal(
      old.map((value) => [value.url, value.description]),
      own.map((value) => [value.url, value.description]),
    );
    assert.equal(10, own.length);
  });
  should("书签路径及bookmarklet展示保留输入树不变", () => {
    const tree = [{
      title: "",
      children: [{
        title: "Bookmarks Bar",
        children: [{
          title: "文件夹",
          children: [{ title: "alpha", url: "https://synthetic.invalid" }, {
            title: "alpha JS",
            url: "javascript:void(0)",
          }],
        }],
      }],
    }];
    const snapshot = structuredClone(tree);
    const old = new BookmarkCompleter().traverseBookmarks(structuredClone(tree)).filter((item) =>
      item.url != null
    );
    assert.equal(
      old.map((item) => [item.url, item.pathAndTitle]),
      model.bookmarks(tree).map((item) => [item.url, item.pathAndTitle]),
    );
    assert.equal(snapshot, tree);
  });
});

context("独立完成器数据管线", () => {
  let api, session;
  setup(() => {
    api = apiFixture();
    session = new CompletionSession(api, {
      settings,
      tabRecency,
      suggestions: { complete: async () => [], cancel() {}, destroy() {} },
    });
  });
  teardown(() => session.destroy());
  should("三组完成器和五来源的排序字段与冻结管线相同", async () => {
    const now = Date.now();
    stub(Date, "now", () => now);
    api.history.search = async () => [{
      url: "https://synthetic.alpha.invalid/z",
      title: "synthetic alpha",
      lastVisitTime: now - 1000,
    }, {
      url: "https://synthetic.alpha.invalid/a",
      title: "synthetic alpha",
      lastVisitTime: now - 5000,
    }];
    api.bookmarks.getTree = async () => [{
      title: "Folder",
      children: [{ title: "synthetic alpha", url: "https://synthetic.alpha.invalid/z" }, {
        title: "中文目标",
        url: "https://synthetic.invalid/中文",
      }, { title: "synthetic alpha JS", url: "javascript:void(0)" }],
    }];
    api.tabs.query =
      async () => [{ id: 1, title: "synthetic alpha", url: "https://synthetic.alpha.invalid/a" }, {
        id: 2,
        title: "synthetic alpha",
        url: "https://synthetic.alpha.invalid/a",
      }];
    stub(chrome, "history", api.history);
    stub(chrome.bookmarks, "getTree", api.bookmarks.getTree);
    stub(chrome.tabs, "query", api.tabs.query);
    stub(chrome.runtime, "getURL", api.runtime.getURL);
    stub(Settings, "get", settings.get);
    stub(bgUtils.tabRecency, "init", tabRecency.init);
    stub(bgUtils.tabRecency, "recencyScore", tabRecency.recencyScore);
    stub(globalThis, "fetch", async () => ({ text: async () => '["synthetic alpha",[]]' }));
    HistoryCache.reset();
    searchEngines.set(settings.get());
    const groups = {
      omni: new MultiCompleter([
        new BookmarkCompleter(),
        new HistoryCompleter(),
        new DomainCompleter(),
        new TabCompleter(),
        new SearchEngineCompleter(),
      ]),
      bookmarks: new MultiCompleter([new BookmarkCompleter()]),
      tabs: new MultiCompleter([new TabCompleter()]),
    };
    for (
      const [query, name] of [
        ["synthetic", "omni"],
        ["synthetic alpha", "omni"],
        ["/Folder alpha", "bookmarks"],
        ["中文", "bookmarks"],
        ["", "tabs"],
        ["synthetic alpha", "tabs"],
        ["", "omni"],
        ["g synthetic alpha", "omni"],
      ]
    ) {
      const req = request(query, name),
        old = await groups[name].filter(req),
        own = await session.filter(req);
      const fields = (values) =>
        values.map((
          item,
        ) => [
          item.url,
          item.title,
          item.shortUrl,
          item.description,
          item.tabId,
          item.autoSelect,
          item.deDuplicate,
          item.isPrimarySuggestion,
        ]);
      assert.equal(fields(old), fields(own));
      own.forEach((item, index) =>
        assert.isTrue(Math.abs(item.relevancy - old[index].relevancy) < 1e-12)
      );
    }
  });
  should("读取去重，历史更新使在途旧快照重新读取", async () => {
    const first = deferred();
    let calls = 0;
    api.history.search = async () =>
      ++calls === 1
        ? first.promise
        : [{ url: "https://synthetic.invalid/new", title: "new", lastVisitTime: Date.now() }];
    const a = session.read("history"), b = session.read("history");
    await api.history.onVisited.emit({ url: "https://synthetic.invalid/new", title: "new" });
    first.resolve([{ url: "https://synthetic.invalid/old" }]);
    assert.equal(["https://synthetic.invalid/new"], [...(await a).keys()]);
    assert.equal(["https://synthetic.invalid/new"], [...(await b).keys()]);
    assert.equal(2, calls);
  });
  should("显式空数据可缓存，读取失败可重试，销毁拒绝迟到结果", async () => {
    let calls = 0;
    api.bookmarks.getTree = async () => {
      if (++calls === 1) throw new Error("native-failure");
      return [];
    };
    await close(session.read("bookmark"), "native-failure");
    assert.equal([], await session.read("bookmark"));
    assert.equal([], await session.read("bookmark"));
    assert.equal(2, calls);
    const pending = deferred();
    api.history.search = () => pending.promise;
    const read = session.read("history");
    session.destroy();
    pending.resolve([]);
    await close(read, "STALE_COMPLETIONS");
    assert.equal(0, api.history.onVisited.listeners.size);
    assert.equal(0, api.bookmarks.onChanged.listeners.size);
  });
  should("历史访问排序及域名旧删除引用行为不被替换改写", async () => {
    api.history.search =
      async () => [{ url: "https://synthetic.invalid/z", title: "alpha", lastVisitTime: 30 }, {
        url: "https://synthetic.invalid/b",
        title: "alpha",
        lastVisitTime: 20,
      }];
    await session.domains(["synthetic"], "synthetic");
    await api.history.onVisited.emit({
      url: "https://synthetic.invalid/a",
      title: "alpha",
      lastVisitTime: 10,
    });
    assert.equal([
      "https://synthetic.invalid/a",
      "https://synthetic.invalid/b",
      "https://synthetic.invalid/z",
    ], (await session.orderedHistory()).map((item) => item.url));
    await api.history.onVisitRemoved.emit({ urls: ["https://synthetic.invalid/z"] });
    assert.equal(30, session.domainIndex.get("https://synthetic.invalid").entry.lastVisitTime);
    await api.history.onVisitRemoved.emit({ allHistory: true });
    assert.equal([], await session.domains(["synthetic"], "synthetic"));
  });
  should("读取新搜索设置、prototype关键词拒绝，书签变更立即失效", async () => {
    assert.equal(null, session.engine("constructor alpha"));
    const search = await session.filter(request("g 中文目标"));
    assert.equal(1, search.length);
    assert.isTrue(search[0].autoSelect);
    assert.equal("中文目标", search[0].title);
    api.bookmarks.getTree = async () => [{ url: "https://synthetic.invalid/old", title: "alpha" }];
    assert.equal(
      "https://synthetic.invalid/old",
      (await session.filter(request("alpha", "bookmarks")))[0].url,
    );
    api.bookmarks.getTree = async () => [{ url: "https://synthetic.invalid/new", title: "alpha" }];
    await api.bookmarks.onChanged.emit();
    assert.equal(
      "https://synthetic.invalid/new",
      (await session.filter(request("alpha", "bookmarks")))[0].url,
    );
  });
  should("非法组和空词项拒绝且不读取Native数据", async () => {
    api.history.search = () => assert.fail("非法请求不得读历史");
    await close(session.filter(request("alpha", "constructor")), "INVALID_COMPLETIONS_REQUEST");
    await close(
      session.filter({ ...request("alpha"), queryTerms: [""] }),
      "INVALID_COMPLETIONS_REQUEST",
    );
  });
});

context("完成器会话隔离和销毁", () => {
  let api, hub;
  const identity = (id, incognito = false) => ({
    role: "component",
    component: "vomnibar",
    componentId: "component-" + id,
    documentId: "document-" + id,
    ownerDocumentId: "owner-" + id,
    ownerEpoch: 1,
    tabId: id,
    frameId: 2,
    planVersion: 6,
    incognito,
  });
  setup(() => {
    api = apiFixture();
    hub = new CompletionHub(api, { settings, tabRecency });
  });
  teardown(() => hub.destroy());
  should("普通和无痕缓存分离，存储记录只能撤销，不能授予新会话", async () => {
    const regular = identity(1), privateRecord = identity(2, true);
    const a = hub.get(regular), b = hub.get(privateRecord);
    a.suggestions.cache.set("synthetic regular", { values: ["regular"] });
    b.suggestions.cache.set("synthetic private", { values: ["private"] });
    assert.isFalse(a === b);
    await api.storage.onChanged.emit({
      browserToolboxRuntimeDocuments: {
        newValue: { formatVersion: 1, documents: [regular, identity(99)] },
      },
    }, "session");
    assert.equal(1, hub.sessions.size);
    assert.isTrue(b.closed);
    assert.equal(0, b.suggestions.cache.size);
    assert.isFalse(a.closed);
    await api.storage.onChanged.emit({
      browserToolboxRuntimeDocuments: { newValue: { formatVersion: 1, documents: [] } },
    }, "sync");
    assert.equal(1, hub.sessions.size);
  });
  should("100次代次撤销不累积后台数据监听器", async () => {
    for (let index = 1; index <= 100; index++) {
      const record = identity(index), own = hub.get(record);
      await api.storage.onChanged.emit({
        browserToolboxRuntimeDocuments: {
          newValue: { formatVersion: 1, documents: [{ ...record, ownerEpoch: 2 }] },
        },
      }, "session");
      assert.isTrue(own.closed);
      assert.equal(0, api.history.onVisited.listeners.size);
      assert.equal(0, api.bookmarks.onChanged.listeners.size);
    }
    assert.equal(0, hub.sessions.size);
  });
  const owner = (record) => ({
    role: "content", documentId: record.ownerDocumentId, tabId: record.tabId,
    runtimeEpoch: record.ownerEpoch, planVersion: record.planVersion, incognito: record.incognito,
  });
  const recordsChanged = (records) => api.storage.onChanged.emit({
    browserToolboxRuntimeDocuments: { newValue: { formatVersion: 1, documents: records } },
  }, "session");
  should("组件退出保留所有者缓存，旧会话暂停，重新授权不累积订阅", async () => {
    const record = identity(1), own = hub.get(record);
    own.suggestions.cache.set("synthetic", { values: ["cached"] });
    for (let index = 0; index < 100; index++) {
      await recordsChanged([owner(record)]);
      assert.equal(0, hub.sessions.size);
      assert.equal(1, hub.idle.size);
      await close(own.filter(request("alpha")), "COMPLETIONS_SUSPENDED");
      const next = { ...record, documentId: "new-component-" + index, componentId: "new-id-" + index };
      assert.equal(own, hub.get(next));
      assert.equal(["cached"], own.suggestions.cache.get("synthetic").values);
      assert.equal(1, api.history.onVisited.listeners.size);
    }
    await recordsChanged([{ ...owner(record), runtimeEpoch: 2 }]);
    assert.isTrue(own.closed);
    assert.equal(0, own.suggestions.cache.size);
    assert.equal(0, hub.sessions.size + hub.idle.size);
    assert.equal(0, api.history.onVisited.listeners.size);
  });
  should("空闲缓存不跨文档代次、方案或无痕身份复用，撤销所有者清空", async () => {
    const record = identity(1), own = hub.get(record);
    own.suggestions.cache.set("synthetic private", { values: ["secret"] });
    await recordsChanged([owner(record)]);
    for (const patch of [{ ownerEpoch: 2 }, { ownerDocumentId: "other" }, { planVersion: 5 }, { incognito: true }]) {
      const next = hub.get({ ...record, documentId: JSON.stringify(patch), ...patch });
      assert.isFalse(own === next);
      assert.equal(0, next.suggestions.cache.size);
    }
    await recordsChanged([]);
    assert.isTrue(own.closed);
    assert.equal(0, hub.sessions.size + hub.idle.size);
  });
  should("空闲期间取消读取和迟到回包，恢复后的新读取不继承旧Promise", async () => {
    const record = identity(1), own = hub.get(record), pending = deferred();
    api.bookmarks.getTree = () => pending.promise;
    const first = own.filter(request("alpha", "bookmarks"));
    await recordsChanged([owner(record)]);
    pending.resolve([{ title: "alpha", url: "https://synthetic.invalid/old" }]);
    await close(first, "STALE_COMPLETIONS");
    api.bookmarks.getTree = async () => [{ title: "alpha", url: "https://synthetic.invalid/new" }];
    const next = hub.get({ ...record, documentId: "new" });
    assert.equal("https://synthetic.invalid/new", (await next.filter(request("alpha", "bookmarks")))[0].url);
  });
  should("扩展自有页面可保留自己的缓存，组件角色不能冒充所有者", async () => {
    const record = identity(1), own = hub.get(record);
    await recordsChanged([{ ...owner(record), role: "ownedUi" }]);
    assert.equal(1, hub.idle.size);
    assert.equal(own, hub.get({ ...record, documentId: "new" }));
    await recordsChanged([{ ...owner(record), role: "component" }]);
    assert.isTrue(own.closed);
    assert.equal(0, hub.sessions.size + hub.idle.size);
  });
  should("空闲缓存参与64会话上限，导航和最后无痕窗口关闭仍释放", async () => {
    const privateRecord = identity(1, true), first = hub.get(privateRecord);
    await recordsChanged([owner(privateRecord)]);
    for (let index = 2; index <= 65; index++) hub.get(identity(index));
    assert.isTrue(first.closed);
    assert.equal(64, hub.sessions.size + hub.idle.size);
    const lastRecord = identity(65), last = hub.get(lastRecord);
    await recordsChanged([owner(lastRecord)]);
    await api.webNavigation.onCommitted.emit({ tabId: 65, frameId: 0 });
    assert.isTrue(last.closed);
    const privateSession = hub.get(privateRecord);
    await recordsChanged([owner(privateRecord)]);
    api.windows.getAll = async () => [];
    await api.windows.onRemoved.emit(1);
    assert.isTrue(privateSession.closed);
    assert.equal(0, hub.sessions.size + hub.idle.size);
  });
  should("标签导航、关闭、最后无痕窗口及64会话界限实际注销", async () => {
    const regular = hub.get(identity(1)), privateRecord = hub.get(identity(2, true));
    api.windows.getAll = async () => [{ incognito: true }];
    await api.windows.onRemoved.emit(3);
    assert.isFalse(privateRecord.closed);
    api.windows.getAll = async () => [{ incognito: false }];
    await api.windows.onRemoved.emit(3);
    assert.isTrue(privateRecord.closed);
    assert.isFalse(regular.closed);
    await api.webNavigation.onCommitted.emit({ tabId: 1, frameId: 2 });
    assert.isFalse(regular.closed);
    await api.webNavigation.onCommitted.emit({ tabId: 1, frameId: 0 });
    assert.isTrue(regular.closed);
    const first = hub.get(identity(3));
    for (let index = 4; index <= 67; index++) hub.get(identity(index));
    assert.isTrue(first.closed);
    assert.equal(64, hub.sessions.size);
    const last = hub.get(identity(67));
    await api.tabs.onRemoved.emit(67);
    assert.isTrue(last.closed);
    hub.destroy();
    assert.equal(0, api.storage.onChanged.listeners.size);
    assert.equal(0, api.history.onVisited.listeners.size);
  });
});

context("独立建议发送边界", () => {
  let own, calls, time;
  class Adapter {
    match(url) {
      return url.includes("synthetic.invalid");
    }
    getUrl(terms) {
      return "http://127.0.0.1/synthetic?q=" + encodeURIComponent(terms.join(" "));
    }
    parse(text) {
      return JSON.parse(text);
    }
  }
  const url = "https://synthetic.invalid/?q=%s";
  setup(() => {
    calls = [];
    time = 1000;
    stub(UrlUtils, "isUrl", async (value) => value.includes(".") || value.includes("://"));
    own = new Suggestions({
      engines: [Adapter],
      now: () => time,
      delay: async (ms) => assert.equal(100, ms),
      fetcher: async (target, options) => {
        calls.push({ target, options });
        return { text: async () => '["alpha","ALPHA first","beta"]' };
      },
    });
  });
  teardown(() => own.destroy());
  should("短词、URL、javascript和未知端点不发请求", async () => {
    for (const terms of [["abc"], ["https://synthetic.invalid"], ["javascript:void(0)"]]) {
      assert.equal([], await own.complete(url, terms));
    }
    assert.equal([], await own.complete("https://unknown.invalid", ["alpha"]));
    assert.equal(0, calls.length);
  });
  should("100ms等待后发送、过滤自身和小写，缓存副本两小时到期", async () => {
    assert.equal(["alpha first", "beta"], await own.complete(url, ["alpha"]));
    const copy = await own.complete(url, ["alpha"]);
    copy.push("mutated");
    assert.equal(["alpha first", "beta"], await own.complete(url, ["alpha"]));
    assert.equal(1, calls.length);
    time += 2 * 60 * 60 * 1000;
    await own.complete(url, ["alpha"]);
    assert.equal(2, calls.length);
    assert.isTrue(calls[0].options.signal instanceof AbortSignal);
  });
  should("固定搜索前缀只去除同前缀结果，保留旧端点协议", async () => {
    own.fetcher = async (target) => {
      calls.push({ target });
      return { text: async () => '["prefix ALPHA first","other beta"]' };
    };
    assert.equal(
      ["alpha first"],
      await own.complete("https://synthetic.invalid/?q=prefix+%s", ["alpha"]),
    );
    assert.isTrue(calls[0].target.endsWith("prefix%20alpha"));
  });
  should("错误响应缓存30秒，取消未发送等待不触发远端", async () => {
    own.fetcher = async () => {
      calls.push({});
      return { text: async () => "invalid" };
    };
    assert.equal([], await own.complete(url, ["alpha"]));
    time += 29999;
    await own.complete(url, ["alpha"]);
    assert.equal(1, calls.length);
    time++;
    await own.complete(url, ["alpha"]);
    assert.equal(2, calls.length);
    const delayed = deferred();
    own.delay = () => delayed.promise;
    const pending = own.complete(url, ["new query"]);
    await Promise.resolve();
    await Promise.resolve();
    own.cancel();
    delayed.resolve();
    assert.equal([], await pending);
    assert.equal(2, calls.length);
  });
  should("取消在途仍符合旧行为，销毁中断在途且不缓存迟到数据", async () => {
    const response = deferred();
    own.fetcher = async (_, options) => {
      calls.push(options);
      return response.promise;
    };
    const pending = own.complete(url, ["alpha"]);
    while (!calls.length) await Promise.resolve();
    own.cancel();
    assert.isFalse(calls[0].signal.aborted);
    own.destroy();
    assert.isTrue(calls[0].signal.aborted);
    response.resolve({ text: async () => '["late result"]' });
    assert.equal([], await pending);
    assert.equal(0, own.cache.size);
    assert.equal(0, own.controllers.size);
    assert.equal(0, own.waiters.size);
  });
  should("5000项上界淘汰旧缓存且不复用其他会话", async () => {
    for (let index = 0; index < 5000; index++) {
      own.cache.set("old-" + index, { values: [], expires: Infinity });
    }
    await own.complete(url, ["alpha"]);
    assert.equal(5000, own.cache.size);
    assert.isFalse(own.cache.has("old-0"));
    const other = new Suggestions({
      engines: [Adapter],
      delay: async () => {},
      fetcher: async () => ({ text: async () => "[]" }),
    });
    assert.equal(0, other.cache.size);
    other.destroy();
  });
});
