// SPDX-License-Identifier: GPL-3.0-or-later
// 仅复用现有端点的URL/响应适配器；发送、取消、超时和会话缓存由这里拥有。
import { list as adapters } from "../completion/search_engines.js";

export class Suggestions {
  constructor({ fetcher = fetch, engines = adapters, now = Date.now, delay = null } = {}) {
    Object.assign(this, { fetcher, engines, now, delay });
    this.cache = new Map();
    this.controllers = new Set();
    this.waiters = new Set();
    this.revision = 0;
    this.closed = false;
  }
  cancel() {
    this.revision++;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.waiters.clear();
  }
  wait(ms) {
    if (this.delay) return this.delay(ms);
    return new Promise((resolve) => {
      const waiter = { resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        resolve();
      }, ms);
      this.waiters.add(waiter);
    });
  }
  destroy() {
    this.closed = true;
    this.cancel();
    this.cache.clear();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  async complete(searchUrl, terms) {
    if (this.closed) return [];
    const query = terms.join(" ").toLowerCase();
    if (
      query.length < 4 || UrlUtils.hasJavascriptProtocol(query) ||
      terms.length === 1 && await UrlUtils.isUrl(query)
    ) return [];
    const engine = this.engines.map((Adapter) => new Adapter()).find((adapter) =>
      adapter.match(searchUrl)
    );
    if (!engine) return [];
    const key = JSON.stringify([searchUrl, terms]);
    const previous = this.cache.get(key);
    if (previous && previous.expires > this.now()) return [...previous.values];
    this.cache.delete(key);
    const revision = ++this.revision;
    await this.wait(100);
    if (this.closed || revision !== this.revision) return [];
    let prefix = "", sent = terms;
    if (/=.+\+%s/.test(searchUrl)) {
      const value = searchUrl.replace(/\+%s.*/, "").replace(/.*=/, "").replace(/\+/g, " ");
      sent = [...value.split(" "), ...terms];
      prefix = value + " ";
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 2500);
    let values = [], failed = false;
    try {
      const response = await this.fetcher(engine.getUrl(sent), { signal: controller.signal });
      values = engine.parse(await response.text());
      if (prefix) {
        values = values.filter((value) => value.startsWith(prefix)).map((value) =>
          value.slice(prefix.length)
        );
      }
      values = values.map((value) => value.toLowerCase()).filter((value) => value !== query);
    } catch (_) {
      failed = true;
      values = [];
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
    // cancel只阻止等待发送，不取消在途请求；文档销毁则禁止缓存/发布迟到响应。
    if (this.closed) return [];
    while (this.cache.size >= 5000) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { values, expires: this.now() + (failed ? 30000 : 2 * 60 * 60 * 1000) });
    return [...values];
  }
}
