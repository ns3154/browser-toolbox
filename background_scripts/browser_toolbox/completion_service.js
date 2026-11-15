// SPDX-License-Identifier: GPL-3.0-or-later
// 组件身份由调用边界提供；退出后的缓存仅由同一存活Native所有者重新租用。
import * as model from "../../lib/browser_toolbox/completion_model.js";
import { parseConfig } from "../user_search_engines.js";
import { Suggestions } from "./completion_suggestions.js";

export class CompletionSession {
  constructor(
    api,
    { settings, tabRecency, suggestions = new Suggestions(), firefox = false } = {},
  ) {
    Object.assign(this, { api, settings, tabRecency, suggestions, firefox });
    this.generation = this.historyRevision = this.bookmarkRevision = 0;
    this.disposals = [];
    this.engines = {};
    const listen = (event, callback) => {
      if (!event?.addListener) return;
      event.addListener(callback);
      this.disposals.push(() => event.removeListener(callback));
    };
    listen(api.history?.onVisited, (entry) => {
      this.historyRevision++;
      if (this.history) {
        this.history.set(entry.url, { ...entry, title: entry.title || "" });
        this.historyOrder = null;
      }
      if (this.domainIndex) this.addDomain(entry);
    });
    listen(api.history?.onVisitRemoved, (change) => {
      this.historyRevision++;
      if (change.allHistory) this.history = new Map();
      else for (const url of change.urls || []) this.history?.delete(url);
      this.historyOrder = null;
      if (this.domainIndex) {
        if (change.allHistory) this.domainIndex.clear();
        else {for (const url of change.urls || []) {
            const domain = this.domainFor(url), slot = this.domainIndex.get(domain);
            if (slot && --slot.references <= 0) this.domainIndex.delete(domain);
          }}
      }
    });
    for (
      const event of [
        api.bookmarks?.onCreated,
        api.bookmarks?.onChanged,
        api.bookmarks?.onMoved,
        api.bookmarks?.onRemoved,
        api.bookmarks?.onImportEnded,
      ]
    ) {
      listen(event, () => {
        this.bookmarkRevision++;
        this.bookmarkItems = null;
      });
    }
  }
  async read(kind) {
    const dataKey = kind === "history" ? "history" : "bookmarkItems";
    const revisionKey = kind + "Revision", loadingKey = kind + "Loading";
    if (this.closed) throw new Error("COMPLETIONS_CLOSED");
    if (this[dataKey]) return this[dataKey];
    if (this[loadingKey]) return this[loadingKey];
    const generation = this.generation;
    const loading = (async () => {
      for (;;) {
        const revision = this[revisionKey];
        const items = kind === "history"
          ? await this.api.history.search({ text: "", maxResults: 20000, startTime: 0 })
          : await this.api.bookmarks.getTree();
        if (this.closed || generation !== this.generation) throw new Error("STALE_COMPLETIONS");
        if (revision !== this[revisionKey]) continue;
        if (kind === "history") {
          this.history = new Map(
            [...items].sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0).map((
              item,
            ) => [item.url, { ...item, title: item.title || "" }]),
          );
          // read 时已按 url 排序构造 Map，直接复用顺序快照避免首次 orderedHistory 重复排序。
          this.historyOrder = [...this.history.values()];
          return this.history;
        }
        this.bookmarkItems = model.bookmarks(items);
        return this.bookmarkItems;
      }
    })().finally(() => {
      if (this[loadingKey] === loading) this[loadingKey] = null;
    });
    this[loadingKey] = loading;
    return loading;
  }
  async refresh(name) {
    this.engines = parseConfig(this.settings.get("searchEngines")).keywordToEngine;
    if (name === "omni" || name === "bookmarks") {
      this.bookmarkRevision++;
      this.bookmarkItems = null;
      await this.read("bookmark");
    }
  }
  cancel() {
    this.suggestions.cancel();
  }
  suspend() {
    this.suspended = true;
    this.generation++;
    this.cancel();
    this.historyLoading = this.bookmarkLoading = null;
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.suggestions.destroy();
    for (const dispose of this.disposals.splice(0)) dispose();
    this.history = this.bookmarkItems = null;
    this.historyOrder = this.domainIndex = null;
    this.engines = {};
  }
  engine(query) {
    const parts = query.trimStart().split(/\s+/);
    return parts.length > 1 && Object.hasOwn(this.engines, parts[0])
      ? this.engines[parts[0]]
      : null;
  }
  scoreBookmarks(items, terms, prepared) {
    const path = terms.some((term) => term.startsWith("/"));
    const candidates = [];
    for (const item of items) {
      const title = path ? item.pathAndTitle : item.title;
      const isJs = item.isJavascript ?? UrlUtils.hasJavascriptProtocol(item.url);
      const short = isJs ? "javascript:..." : undefined;
      const url = short ?? item.url;
      if (!prepared.matches(url, title)) continue;
      candidates.push(model.candidate({
        queryTerms: terms,
        description: "bookmark",
        url: item.url,
        title,
        shortUrl: short,
        deDuplicate: short == null,
        relevancy: prepared.wordScore(url, title),
      }));
    }
    return candidates;
  }
  async bookmarks(terms, prepared = model.prepareQuery(terms)) {
    return this.scoreBookmarks(await this.read("bookmark"), terms, prepared);
  }
  scoreHistories(ordered, terms, all, prepared) {
    const candidates = [];
    // 单次查询共用同一时间戳，避免遍历数千条历史记录时重复读取系统时钟。
    const now = Date.now();
    for (const item of ordered) {
      if (!(terms.length ? prepared.matches(item.url, item.title) : all)) continue;
      candidates.push(model.candidate({
        queryTerms: terms,
        description: "history",
        url: item.url,
        title: item.title,
        relevancyData: item,
        relevancy: prepared.historyScore(item.url, item.title, item.lastVisitTime, now),
      }));
    }
    return candidates;
  }
  async histories(terms, all, prepared = model.prepareQuery(terms)) {
    return this.scoreHistories(await this.orderedHistory(), terms, all, prepared);
  }
  async orderedHistory() {
    const history = await this.read("history");
    return this.historyOrder ||= [...history.values()].sort((a, b) =>
      a.url < b.url ? -1 : a.url > b.url ? 1 : 0
    );
  }
  domainFor(url) {
    return UrlUtils.urlHasProtocol(url) && !UrlUtils.hasChromeProtocol(url)
      ? url.split("/", 3).join("/")
      : null;
  }
  addDomain(item) {
    const domain = this.domainFor(item.url);
    if (!domain) return;
    const slot = this.domainIndex.get(domain) || { entry: item, references: 0 };
    if (slot.entry.lastVisitTime < item.lastVisitTime) slot.entry = item;
    slot.references++;
    this.domainIndex.set(domain, slot);
  }
  scoreDomains(index, terms, query, prepared) {
    if (!terms.length || /\S\s/.test(query)) return [];
    // 删除时保留仍被引用的旧最近访问分数，重复访问也增加引用计数，沿用冻结域名候选的语义。
    let bestDomain = null;
    let bestScore = -Infinity;
    const needle = terms[0];
    const now = Date.now();
    for (const [domain, slot] of index) {
      if (!domain.includes(needle)) continue;
      const score = prepared.historyScore(domain, null, slot.entry.lastVisitTime || 0, now);
      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    }
    return bestDomain
      ? [
        model.candidate({
          queryTerms: terms,
          description: "domain",
          url: bestDomain,
          relevancy: 2,
        }),
      ]
      : [];
  }
  async domains(terms, query, prepared = model.prepareQuery(terms)) {
    if (!terms.length || /\S\s/.test(query)) return [];
    if (!this.domainIndex) {
      const entries = await this.orderedHistory();
      this.domainIndex = new Map();
      for (const item of entries) this.addDomain(item);
    }
    return this.scoreDomains(this.domainIndex, terms, query, prepared);
  }
  async tabs(terms, prepared = model.prepareQuery(terms)) {
    // 若 tabRecency 已就绪则跳过额外微任务；否则与 tabs.query 并发初始化。
    const recencyReady = this.tabRecency.loaded ? null : this.tabRecency.init();
    const tabs = await this.api.tabs.query({});
    if (recencyReady) await recencyReady;
    const values = tabs.filter((tab) => prepared.matches(tab.url, tab.title)).map((tab) =>
      model.candidate({
        queryTerms: terms,
        description: "tab",
        url: tab.url,
        title: tab.title || "",
        tabId: tab.id,
        deDuplicate: false,
        relevancy: terms.length
          ? prepared.wordScore(tab.url, tab.title)
          : this.tabRecency.recencyScore(tab.id),
      })
    ).sort((a, b) => b.relevancy - a.relevancy);
    values.forEach((item, index) => item.relevancy *= 8 / (index / 4 + 1));
    return values;
  }
  async search(engine, terms) {
    const input = terms.slice(1), query = input.join(" ");
    const values = await this.suggestions.complete(engine.url, input);
    const common = {
      queryTerms: terms,
      description: engine.description,
      searchUrl: engine.url,
      highlightTerms: false,
      isCustomSearch: true,
    };
    const primary = model.candidate({
      ...common,
      title: query,
      url: UrlUtils.createSearchUrl(query, engine.url),
      relevancy: 2,
      autoSelect: true,
      isPrimarySuggestion: true,
    });
    return [
      primary,
      ...values.map((value, index) =>
        model.candidate({
          ...common,
          title: value,
          url: UrlUtils.createSearchUrl(value, engine.url),
          insertText: value,
          relevancy: index === 0
            ? 1
            : model.boostScore(.5, .7 * model.wordScore(terms, value, value)),
        })
      ),
    ];
  }
  async filter(
    { completerName: name, query, queryTerms: terms, seenTabToOpenCompletionList: all },
  ) {
    if (this.suspended) throw new Error("COMPLETIONS_SUSPENDED");
    if (
      this.closed || !["omni", "bookmarks", "tabs"].includes(name) || typeof query !== "string" ||
      !Array.isArray(terms) || terms.some((term) => typeof term !== "string" || !term.length)
    ) throw new Error("INVALID_COMPLETIONS_REQUEST");
    this.lastFilterWarm = false;
    if (!terms.length && name !== "tabs") return [];
    const enginesConfig = this.settings.get("searchEngines");
    if (this.enginesSource !== enginesConfig) {
      // 仅在搜索引擎配置变化时重新解析，避免高频补全查询重复分配正则和映射对象。
      this.engines = parseConfig(enginesConfig).keywordToEngine;
      this.enginesSource = enginesConfig;
    }
    const generation = this.generation;
    const prepared = model.prepareQuery(terms);
    const engine = name === "omni" ? this.engine(query) : null;
    let candidates;
    if (engine) {
      candidates = await this.search(engine, terms);
    } else if (name === "tabs") {
      candidates = await this.tabs(terms, prepared);
    } else if (name === "bookmarks") {
      candidates = await this.bookmarks(terms, prepared);
    } else {
      // 预先发起 tabs.query IPC，使其与内存中的书签/历史/域名扫描并行执行。
      const tabsPromise = this.tabs(terms, prepared);
      const warm = Boolean(
        this.bookmarkItems && this.history && this.historyOrder && this.domainIndex,
      );
      if (warm) {
        this.lastFilterWarm = true;
        const bookmarkCandidates = this.scoreBookmarks(this.bookmarkItems, terms, prepared);
        const historyCandidates = this.scoreHistories(this.historyOrder, terms, all, prepared);
        const domainCandidates = this.scoreDomains(this.domainIndex, terms, query, prepared);
        const tabCandidates = await tabsPromise;
        candidates = bookmarkCandidates.concat(historyCandidates, domainCandidates, tabCandidates);
      } else {
        const [bookmarkCandidates, historyCandidates, domainCandidates, tabCandidates] =
          await Promise.all([
            this.bookmarks(terms, prepared),
            this.histories(terms, all, prepared),
            this.domains(terms, query, prepared),
            tabsPromise,
          ]);
        candidates = bookmarkCandidates.concat(historyCandidates, domainCandidates, tabCandidates);
      }
    }
    if (this.closed || generation !== this.generation) throw new Error("STALE_COMPLETIONS");
    return model.finish(candidates, this.api, this.firefox);
  }
}

export class CompletionHub {
  constructor(api, options) {
    Object.assign(this, { api, options });
    this.sessions = new Map();
    this.idle = new Map();
    this.disposals = [];
    const listen = (event, listener) => {
      if (!event?.addListener) return;
      event.addListener(listener);
      this.disposals.push(() => event.removeListener(listener));
    };
    listen(api.tabs.onRemoved, (tabId) => this.clearTab(tabId));
    listen(api.webNavigation.onCommitted, (details) => {
      if (details.frameId === 0) this.clearTab(details.tabId);
    });
    listen(api.storage?.onChanged, (changes, area) => {
      if (area !== "session" || !Object.hasOwn(changes, "browserToolboxRuntimeDocuments")) return;
      const snapshot = changes.browserToolboxRuntimeDocuments.newValue;
      const records = snapshot?.formatVersion === 1 && Array.isArray(snapshot.documents)
        ? snapshot.documents
        : [];
      // 这里只撤销已持有的缓存，不能从存储记录授予数据访问或创建会话。
      for (const [key, entry] of this.sessions) {
        const identity = entry.record;
        const present = records.some((record) =>
          record.role === "component" &&
          [
            "documentId",
            "componentId",
            "ownerDocumentId",
            "ownerEpoch",
            "tabId",
            "frameId",
            "planVersion",
            "incognito",
          ].every((field) => record[field] === identity[field])
        );
        if (!present) {
          if (this.ownerPresent(identity, records)) this.park(key);
          else this.remove(key);
        }
      }
      for (const [key, entry] of this.idle) {
        if (!this.ownerPresent(entry.record, records)) this.removeIdle(key);
      }
    });
    listen(api.windows.onRemoved, async () => {
      try {
        const windows = await api.windows.getAll({});
        if (!windows.some((window) => window.incognito)) this.clearIncognito();
      } catch (_) { /* 读取失败不当作无痕窗口已全部关闭，后续身份撤销仍会清理。 */ }
    });
  }
  ownerKey(record) {
    return JSON.stringify([
      record.incognito === true, record.tabId, record.ownerDocumentId, record.ownerEpoch,
      record.planVersion, record.component,
    ]);
  }
  ownerPresent(identity, records) {
    return records.some((record) =>
      ["content", "ownedUi"].includes(record.role) && record.documentId === identity.ownerDocumentId &&
      record.tabId === identity.tabId && record.runtimeEpoch === identity.ownerEpoch &&
      record.planVersion === identity.planVersion && record.incognito === identity.incognito
    );
  }
  park(key) {
    const entry = this.sessions.get(key);
    this.sessions.delete(key);
    entry.session.suspend();
    const owner = this.ownerKey(entry.record);
    this.removeIdle(owner);
    // 空闲缓存不持有组件执行权；仅同一Native所有者、代次和无痕身份的新授权组件可以重新租用。
    this.idle.set(owner, entry);
  }
  get(record) {
    const key = JSON.stringify([
      record.incognito === true,
      record.documentId,
      record.componentId,
      record.ownerEpoch,
    ]);
    let entry = this.sessions.get(key);
    if (!entry) {
      const owner = this.ownerKey(record), parked = this.idle.get(owner);
      this.idle.delete(owner);
      while (this.sessions.size + this.idle.size >= 64) {
        if (this.idle.size) this.removeIdle(this.idle.keys().next().value);
        else this.remove(this.sessions.keys().next().value);
      }
      entry = {
        record: structuredClone(record),
        session: parked?.session || new CompletionSession(this.api, this.options),
      };
      entry.session.suspended = false;
    }
    this.sessions.delete(key);
    this.sessions.set(key, entry);
    return entry.session;
  }
  warmSession(sender, records) {
    // 仅复用同一活动会话中已完成一次完整 IPC 校验且上次走热过滤的记录，避免高频键入重复查询 Chrome。
    if (!Array.isArray(records) || !sender?.documentId || sender.tab?.id == null) return null;
    if (sender.documentLifecycle === "prerendering") return null;
    const incognito = sender.tab.incognito === true;
    for (const entry of this.sessions.values()) {
      const target = entry.record;
      if (
        target.component !== "vomnibar" ||
        target.documentId !== sender.documentId ||
        target.tabId !== sender.tab.id ||
        target.frameId !== sender.frameId ||
        target.incognito !== incognito ||
        entry.session.closed ||
        entry.session.suspended ||
        !entry.session.lastFilterWarm
      ) continue;
      const current = records.find((record) =>
        record.role === "component" &&
        record.component === "vomnibar" &&
        ["documentId", "componentId", "ownerDocumentId", "ownerEpoch", "tabId", "frameId", "planVersion", "incognito"]
          .every((field) => record[field] === target[field])
      );
      if (!current || !this.ownerPresent(target, records)) return null;
      return { record: target, session: entry.session };
    }
    return null;
  }
  remove(key) {
    this.sessions.get(key)?.session.destroy();
    this.sessions.delete(key);
  }
  removeIdle(key) {
    this.idle.get(key)?.session.destroy();
    this.idle.delete(key);
  }
  clearTab(tabId) {
    for (const [key, entry] of this.sessions) if (entry.record.tabId === tabId) this.remove(key);
    for (const [key, entry] of this.idle) if (entry.record.tabId === tabId) this.removeIdle(key);
  }
  clearIncognito() {
    for (const [key, entry] of this.sessions) if (entry.record.incognito) this.remove(key);
    for (const [key, entry] of this.idle) if (entry.record.incognito) this.removeIdle(key);
  }
  destroy() {
    for (const key of [...this.sessions.keys()]) this.remove(key);
    for (const key of [...this.idle.keys()]) this.removeIdle(key);
    for (const dispose of this.disposals.splice(0)) dispose();
  }
}
globalThis.BrowserToolboxCompletions = Object.freeze({ CompletionSession, CompletionHub });
