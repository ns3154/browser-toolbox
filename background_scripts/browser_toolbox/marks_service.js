// SPDX-License-Identifier: GPL-3.0-or-later
// 全局标记不缓存页面数据；每个存储或导航副作用前都重新核验源文档执行权。
import "../../lib/browser_toolbox/marks_compat_storage.js";

const fail = (code) => Object.assign(new Error(code), { code });
export class MarksService {
  constructor(
    {
      api,
      authority,
      ledger,
      allowsPlan,
      paused,
      relay,
      open,
      ready,
      store = new BrowserToolboxMarksCompatStorage.GlobalStorage(api),
    },
  ) {
    Object.assign(this, { api, authority, ledger, allowsPlan, paused, relay, open, ready, store });
  }
  async handle(request, sender) {
    const input = request.payload;
    if (!this.validInput(input)) return { ok: false, code: "INVALID_MARK_ACTION" };
    const guard = async () => {
      const record = await this.authority.verify(request.identity, sender);
      if (this.paused(sender.tab.id)) throw fail("STALE_RUNTIME");
      if (
        this.authority.role(sender) !== "content" || record.component ||
        !this.allowsPlan(record.planVersion)
      ) throw fail("PERMISSION_DENIED");
      return record;
    };
    await guard();
    const invocation = { requestId: request.requestId, commandName: `Marks.${input.operation}` };
    const duplicate = await this.ledger.begin(invocation, sender);
    if (duplicate) return { ok: false, code: duplicate };
    let result;
    try {
      await guard();
      result = input.operation === "create"
        ? await this.create(input, sender, guard)
        : await this.goto(input, sender, guard);
    } catch (error) {
      result = { ok: false, code: error.code || "MARK_UNAVAILABLE" };
    }
    await this.ledger.complete(invocation, sender, result);
    return result;
  }
  validInput(input) {
    if (
      !["create", "goto"].includes(input?.operation) || typeof input.name !== "string" ||
      input.name.length !== 1 || BrowserToolboxMarksCompatStorage.previous.includes(input.name)
    ) {
      return false;
    }
    const keys = input.position == null ? ["operation", "name"] : ["operation", "name", "position"];
    return Object.keys(input).every((key) => keys.includes(key)) &&
      (input.position == null || input.operation === "create" &&
          BrowserToolboxMarksCompatStorage.position(input.position) &&
          Object.keys(input.position).every((key) => ["scrollX", "scrollY", "hash"].includes(key)));
  }
  async create(input, sender, guard) {
    const source = await guard();
    const position = source.frameId === 0 && input.position
      ? input.position
      : await this.relay(sender.tab.id, 0, { handler: "getScrollPosition" }, source.planVersion);
    if (!BrowserToolboxMarksCompatStorage.position(position)) {
      throw fail("MARK_POSITION_UNAVAILABLE");
    }
    const tab = await this.api.tabs.get(sender.tab.id);
    const value = await this.store.prepare(input.name, tab, position);
    await guard();
    await this.store.write(input.name, value);
    return { ok: true };
  }
  async goto(input, sender, guard) {
    const value = await this.store.read(input.name);
    if (!value) return { ok: false, code: "MARK_NOT_SET" };
    let tab;
    if (await this.store.sameSession(value)) {
      try {
        tab = await this.api.tabs.get(value.tabId);
      } catch (_) { /* 旧 tabId 可以失效。 */ }
      if (tab?.url?.split("#")[0] !== value.url) tab = null;
    }
    if (!tab) {
      const scrolled = value.scrollX > 0 || value.scrollY > 0;
      const candidates = await this.api.tabs.query({ url: scrolled ? value.url : `${value.url}*` });
      const window = await this.api.windows.getCurrent();
      let preferred = candidates.filter((item) => item.windowId === window?.id);
      if (!preferred.length) preferred = candidates;
      if (preferred.length > 1) preferred = preferred.filter((item) => !item.active);
      tab = preferred.sort((a, b) => a.url.length - b.url.length)[0];
    }
    if (!tab) {
      await guard();
      tab = await this.open({
        url: value.url.split("#")[0],
        tab: sender.tab,
        executionGuard: guard,
      });
      // 等待实际顶层文档注册；监听器只存在于本次导航，完成/拒绝/超时后全部释放。
      await this.ready(tab.id);
    }
    await guard();
    tab = await this.api.tabs.update(tab.id, { active: true });
    await guard();
    await this.api.windows.update(tab.windowId, { focused: true });
    const source = await guard();
    const result = await this.relay(tab.id, 0, {
      handler: "setScrollPosition",
      scrollX: value.scrollX,
      scrollY: value.scrollY,
    }, source.planVersion);
    if (result?.ok === false || result === false) throw fail("STALE_MARK_TARGET");
    return { ok: true };
  }
}
globalThis.BrowserToolboxMarksService = MarksService;
