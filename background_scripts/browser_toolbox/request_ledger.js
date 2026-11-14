// SPDX-License-Identifier: GPL-3.0-or-later
// 危险动作先记录接收状态，再执行；服务工作线程重启不能清掉去重证据。
(function () {
  const KEY = "browserToolboxCommandRequests";
  const TTL_MS = 5 * 60 * 1000;
  const LIMIT = 256;
  class RequestLedger {
    constructor(session, now = Date.now) {
      this.session = session;
      this.now = now;
      this.queue = Promise.resolve();
    }

    transact(action) {
      const result = this.queue.then(async () => {
        const stored = (await this.session.get(KEY))[KEY];
        if (stored && (stored.formatVersion !== 1 || !Array.isArray(stored.entries))) {
          throw new Error("REQUEST_LEDGER_UNAVAILABLE");
        }
        const entries = (stored?.entries || []).filter((item) => this.now() - item.time < TTL_MS);
        const value = action(entries);
        await this.session.set({ [KEY]: { formatVersion: 1, entries } });
        return value;
      });
      this.queue = result.catch(() => {});
      return result;
    }

    identity(invocation, sender) {
      return `${sender.incognito === true || sender.tab?.incognito === true ? 1 : 0}:${
        sender.tab?.id ?? "extension"
      }:${invocation.requestId}`;
    }

    begin(invocation, sender) {
      const key = this.identity(invocation, sender);
      return this.transact((entries) => {
        const existing = entries.find((item) => item.key === key);
        if (existing) {
          return existing.state === "completed" ? "DUPLICATE_REQUEST" : "RESULT_UNKNOWN";
        }
        // 仍在有效窗口内的证据不能为腾空间丢弃；容量耗尽时停止新危险动作。
        if (entries.length >= LIMIT) return "REQUEST_LEDGER_FULL";
        entries.push({ key, action: invocation.commandName, state: "executing", time: this.now() });
        return null;
      });
    }

    complete(invocation, sender, result) {
      const key = this.identity(invocation, sender);
      return this.transact((entries) => {
        const record = entries.find((item) => item.key === key);
        if (!record) throw new Error("REQUEST_LEDGER_UNAVAILABLE");
        record.state = result.code === "RESULT_UNKNOWN" ? "unknown" : "completed";
      });
    }
  }
  globalThis.BrowserToolboxRequestLedger = RequestLedger;
})();
