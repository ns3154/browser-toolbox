// SPDX-License-Identifier: GPL-3.0-or-later
// M2 期间保留旧标记键和无痕持久化契约；它们不属于配置、同步投影或配置备份。
(function () {
  const previous = ["`", "'"];
  const position = (value) =>
    value && Number.isFinite(value.scrollX) &&
    Number.isFinite(value.scrollY) &&
    (value.hash == null || typeof value.hash === "string");

  class PageStorage {
    constructor(page = globalThis) {
      this.page = page;
    }
    key(name) {
      return `vimiumMark|${this.page.location.href.split("#")[0]}|${name}`;
    }
    registers() {
      return this.page.Marks.localRegisters;
    }
    read(name) {
      const raw = this.registers()[name] ?? this.page.localStorage.getItem(this.key(name));
      if (raw == null) return null;
      const value = JSON.parse(raw);
      if (!position(value)) throw new Error("INVALID_MARK_POSITION");
      return value;
    }
    write(name, value) {
      this.page.localStorage.setItem(this.key(name), JSON.stringify(value));
    }
    remember(value) {
      const raw = JSON.stringify(value);
      for (const name of previous) this.registers()[name] = raw;
    }
  }

  class GlobalStorage {
    constructor(api) {
      this.api = api;
    }
    key(name) {
      return `vimiumGlobalMark|${name}`;
    }
    async read(name) {
      const value = (await this.api.storage.local.get(this.key(name)))[this.key(name)];
      if (value == null) return null;
      if (!position(value) || typeof value.url !== "string" || !value.url) {
        throw new Error("INVALID_MARK_POSITION");
      }
      return value;
    }
    async prepare(name, tab, value) {
      const { vimiumSecret } = await this.api.storage.session.get("vimiumSecret");
      return {
        vimiumSecret,
        markName: name,
        url: tab.url.split("#")[0],
        tabId: tab.id,
        scrollX: value.scrollX,
        scrollY: value.scrollY,
      };
    }
    write(name, value) {
      return this.api.storage.local.set({ [this.key(name)]: value });
    }
    async sameSession(value) {
      return value.vimiumSecret ===
        (await this.api.storage.session.get("vimiumSecret")).vimiumSecret;
    }
  }
  globalThis.BrowserToolboxMarksCompatStorage = Object.freeze({
    PageStorage,
    GlobalStorage,
    previous,
    position,
  });
})();
