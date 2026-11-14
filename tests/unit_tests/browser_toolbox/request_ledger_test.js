// SPDX-License-Identifier: GPL-3.0-or-later
// 以全新对象和共享 session 存储模拟后台重启，不能依靠原进程内存 Map 通过。
import "../test_helper.js";
import "../../../background_scripts/browser_toolbox/request_ledger.js";

context("危险命令持久去重", () => {
  function storage() {
    const values = {};
    return {
      values,
      async get(key) {
        return structuredClone({ [key]: values[key] });
      },
      async set(items) {
        Object.assign(values, structuredClone(items));
      },
    };
  }
  const invocation = { commandName: "removeTab", requestId: "synthetic-command-1" };
  const sender = { tab: { id: 7, incognito: false } };

  should("未完成动作跨后台恢复为结果未知，完成动作不能再次执行", async () => {
    const session = storage();
    const first = new BrowserToolboxRequestLedger(session);
    assert.equal(null, await first.begin(invocation, sender));
    const restarted = new BrowserToolboxRequestLedger(session);
    assert.equal("RESULT_UNKNOWN", await restarted.begin(invocation, sender));
    await restarted.complete(invocation, sender, { code: "OK" });
    assert.equal(
      "DUPLICATE_REQUEST",
      await new BrowserToolboxRequestLedger(session).begin(invocation, sender),
    );
  });

  should("普通无痕隔离、有限容量与过期清理不保存 URL/正文", async () => {
    const session = storage();
    let time = 1000;
    const ledger = new BrowserToolboxRequestLedger(session, () => time);
    assert.equal(null, await ledger.begin(invocation, sender));
    assert.equal(null, await ledger.begin(invocation, { tab: { id: 7, incognito: true } }));
    for (let index = 2; index < 256; index++) {
      assert.equal(
        null,
        await ledger.begin({ ...invocation, requestId: `synthetic-command-${index}` }, sender),
      );
    }
    assert.equal(
      "REQUEST_LEDGER_FULL",
      await ledger.begin({ ...invocation, requestId: "synthetic-overflow" }, sender),
    );
    const json = JSON.stringify(session.values);
    assert.isFalse(json.includes("http"));
    assert.isFalse(json.includes("selectedText"));
    time += 300001;
    assert.equal(null, await ledger.begin({ ...invocation, requestId: "synthetic-new" }, sender));
    assert.equal(1, session.values.browserToolboxCommandRequests.entries.length);
  });

  should("记录无法持久化时失败，不给调用者开始副作用的许可", async () => {
    const session = storage();
    session.set = async () => {
      throw new Error("合成 session 失败");
    };
    let failed = false;
    try {
      await new BrowserToolboxRequestLedger(session).begin(invocation, sender);
    } catch (_) {
      failed = true;
    }
    assert.isTrue(failed);
  });
});
