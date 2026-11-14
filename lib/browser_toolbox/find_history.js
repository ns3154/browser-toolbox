// SPDX-License-Identifier: GPL-3.0-or-later
// 查询只保存在既有 session 键；普通查询可进入无痕列表，无痕查询不能反向写入普通列表。
(function () {
  class FindHistory {
    constructor(api = chrome, incognito = api.extension.inIncognitoContext === true) {
      this.api = api;
      this.incognito = incognito;
      this.key = incognito ? "findModeRawQueryListIncognito" : "findModeRawQueryList";
      this.queries = [];
      this.generation = 0;
      this.queue = Promise.resolve();
      this.pending = [];
    }
    async init(initialSnapshot = null) {
      if (this.listener) return;
      const generation = this.generation;
      const stored = initialSnapshot && Object.hasOwn(initialSnapshot, this.key)
        ? initialSnapshot : await this.api.storage.session.get(this.key);
      let queries = stored[this.key];
      if (queries == null && this.incognito) {
        queries = initialSnapshot && Object.hasOwn(initialSnapshot, "findModeRawQueryList")
          ? initialSnapshot.findModeRawQueryList || []
          : (await this.api.storage.session.get("findModeRawQueryList")).findModeRawQueryList || [];
        if (generation !== this.generation) return;
        await this.api.storage.session.set({ [this.key]: queries });
      }
      if (generation !== this.generation) return;
      this.queries = this.normalize(queries);
      this.listener = (changes, area) => {
        if (area === "session" && changes[this.key]) {
          this.queries = this.withPending(changes[this.key].newValue);
        }
      };
      this.api.storage.onChanged.addListener(this.listener);
    }
    normalize(queries) {
      return Array.isArray(queries) ? queries.filter((query) => typeof query === "string") : [];
    }
    getQuery(index = 0) {
      return this.queries[index] || "";
    }
    append(query, previous) {
      return [query, ...this.normalize(previous).filter((value) => value !== query)].slice(0, 51);
    }
    withPending(previous) {
      return this.pending.reduce(
        (queries, entry) => this.append(entry.query, queries),
        this.normalize(previous),
      );
    }
    saveQuery(query) {
      if (typeof query !== "string" || !query.length) return Promise.resolve();
      const generation = this.generation;
      const pending = { query };
      this.pending.push(pending);
      this.queries = this.append(query, this.queries);
      const work = this.queue.then(async () => {
        if (generation !== this.generation) return;
        const previous = (await this.api.storage.session.get(this.key))[this.key] || this.queries;
        if (generation !== this.generation) return;
        const committed = this.append(query, previous);
        this.queries = this.withPending(committed);
        await this.api.storage.session.set({ [this.key]: committed });
        if (!this.incognito) {
          const key = "findModeRawQueryListIncognito";
          const privateQueries = (await this.api.storage.session.get(key))[key];
          if (privateQueries && generation === this.generation) {
            await this.api.storage.session.set({ [key]: this.append(query, privateQueries) });
          }
        }
      }).finally(() => this.pending = this.pending.filter((entry) => entry !== pending));
      this.queue = work.catch(() => {});
      return work;
    }
    destroy() {
      this.generation++;
      if (this.listener) this.api.storage.onChanged.removeListener(this.listener);
      this.listener = null;
      this.pending = [];
    }
  }
  globalThis.BrowserToolboxFindHistory = FindHistory;
})();
