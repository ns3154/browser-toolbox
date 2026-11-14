// SPDX-License-Identifier: GPL-3.0-or-later
// 检验冻结的用户语法与隐私方向；断言来自契约，不通过复制另一个实现推导期望。
import "../test_helper.js";
import "../../../lib/handler_stack.js";
import "../../../content_scripts/mode.js";
import "../../../lib/browser_toolbox/find_history.js";
import "../../../content_scripts/browser_toolbox/find_runtime.js";

const { parse, Controller, FindMode } = BrowserToolboxFindRuntime;
context("独立 Find 查询语法", () => {
  should("字面特殊字符被转义，中文和小写使用智能忽略大小写", () => {
    assert.equal({
      rawQuery: "a.b[中文]",
      parsedQuery: "a.b[中文]",
      ignoreCase: true,
      isRegex: false,
      pattern: "a\\.b\\[中文\\]",
    }, parse("a.b[中文]"));
  });
  should("大写与 Unicode 大写均保留智能大小写", () => {
    assert.isFalse(parse("Alpha").ignoreCase);
    assert.isFalse(parse("Ä").ignoreCase);
  });
  should("r/R 开关按出现顺序生效，I 标志沿用旧解析语义", () => {
    assert.isFalse(parse("\\rA.+\\R").isRegex);
    assert.isTrue(parse("\\R\\rA.+").isRegex);
    assert.equal("a", parse("\\Ia").parsedQuery);
    assert.isTrue(parse("a", true).isRegex);
  });
  should("双反斜线保留为字面而不会开启正则", () => {
    const query = parse("\\\\r");
    assert.equal("\\\\r", query.parsedQuery);
    assert.isFalse(query.isRegex);
  });
  should("新查找模式直接继承共享 Mode，游标按分组环绕", () => {
    assert.isTrue(FindMode.prototype instanceof Mode);
    const controller = new Controller({}, {});
    controller.groups = [{ values: ["一", "二"] }, { values: ["三"] }];
    controller.query = { activeRegexIndices: [0, 0] };
    assert.equal("二", controller.getNextQueryFromRegexMatches(false));
    assert.equal("三", controller.getNextQueryFromRegexMatches(false));
    assert.equal("一", controller.getNextQueryFromRegexMatches(false));
    assert.equal("三", controller.getNextQueryFromRegexMatches(true));
  });
});

function historyApi(stored = {}) {
  const values = structuredClone(stored);
  const listeners = new Set();
  const writes = [];
  const api = {
    extension: { inIncognitoContext: false },
    storage: {
      session: {
        get: async (key) =>
          Object.hasOwn(values, key) ? { [key]: structuredClone(values[key]) } : {},
        async set(items) {
          writes.push(structuredClone(items));
          Object.assign(values, structuredClone(items));
          for (const listener of listeners) {
            listener(
              Object.fromEntries(
                Object.entries(items).map(([key, newValue]) => [key, { newValue }]),
              ),
              "session",
            );
          }
        },
      },
      onChanged: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
  };
  return { api, values, writes, listeners };
}
context("独立 session 查找历史", () => {
  should("预读的显式空列表不再串行读取，后续 session 更新仍生效", async () => {
    const h = historyApi({ findModeRawQueryList: ["不得回退"] });
    h.api.storage.session.get = () => { throw new Error("不得重复读取"); };
    const history = new BrowserToolboxFindHistory(h.api);
    await history.init({ findModeRawQueryList: [] });
    assert.equal("", history.getQuery());
    await h.api.storage.session.set({ findModeRawQueryList: ["新合成查询"] });
    assert.equal("新合成查询", history.getQuery());
    history.destroy();
    assert.equal(0, h.listeners.size);
  });
  should("无痕预读保留已有空列表，不复制普通查询也不产生写入", async () => {
    const h = historyApi();
    h.api.storage.session.get = () => { throw new Error("不得重复读取"); };
    const history = new BrowserToolboxFindHistory(h.api, true);
    await history.init({ findModeRawQueryList: ["普通合成查询"], findModeRawQueryListIncognito: [] });
    assert.equal("", history.getQuery());
    assert.equal(0, h.writes.length);
    history.destroy();
  });
  should("首次无痕预读缺省时仅复制普通快照到既有私有键", async () => {
    const h = historyApi();
    h.api.storage.session.get = () => { throw new Error("不得重复读取"); };
    const history = new BrowserToolboxFindHistory(h.api, true);
    await history.init({ findModeRawQueryList: ["普通合成查询"], findModeRawQueryListIncognito: undefined });
    assert.equal("普通合成查询", history.getQuery());
    assert.equal([{ findModeRawQueryListIncognito: ["普通合成查询"] }], h.writes);
    assert.equal(undefined, h.values.findModeRawQueryList);
    history.destroy();
  });
  should("空查询无写入，去重且沿用冻结的 51 条上限", async () => {
    const h = historyApi({
      findModeRawQueryList: Array.from({ length: 51 }, (_, index) => String(index)),
    });
    const history = new BrowserToolboxFindHistory(h.api);
    await history.init();
    await history.saveQuery("");
    assert.equal(0, h.writes.length);
    await history.saveQuery("20");
    assert.equal("20", history.getQuery());
    assert.equal(51, h.values.findModeRawQueryList.length);
    assert.equal(1, h.values.findModeRawQueryList.filter((query) => query === "20").length);
    history.destroy();
    assert.equal(0, h.listeners.size);
  });
  should("Enter 后立即可用新查询，连续保存不会丢掉排队的查询", async () => {
    const h = historyApi();
    const history = new BrowserToolboxFindHistory(h.api);
    await history.init();
    const first = history.saveQuery("甲");
    const second = history.saveQuery("乙");
    assert.equal("乙", history.getQuery());
    await Promise.all([first, second]);
    assert.equal(["乙", "甲"], h.values.findModeRawQueryList);
    history.destroy();
  });
  should("已有无痕列表重新初始化不被普通列表覆盖，无痕新增不反写", async () => {
    const h = historyApi({
      findModeRawQueryList: ["普通"],
      findModeRawQueryListIncognito: ["私有"],
    });
    const history = new BrowserToolboxFindHistory(h.api, true);
    await history.init();
    assert.equal("私有", history.getQuery());
    await history.saveQuery("无痕新增");
    assert.equal(["普通"], h.values.findModeRawQueryList);
    assert.equal(["无痕新增", "私有"], h.values.findModeRawQueryListIncognito);
    history.destroy();
  });
  should("首次无痕复制普通列表，普通新增仅进入已存在的无痕列表", async () => {
    const h = historyApi({ findModeRawQueryList: ["普通"] });
    const privateHistory = new BrowserToolboxFindHistory(h.api, true);
    await privateHistory.init();
    assert.equal(["普通"], h.values.findModeRawQueryListIncognito);
    const history = new BrowserToolboxFindHistory(h.api);
    await history.init();
    await history.saveQuery("普通新增");
    assert.equal(["普通新增", "普通"], h.values.findModeRawQueryListIncognito);
    privateHistory.destroy();
    history.destroy();
  });
  should("仅接收 session 通知，销毁会取消尚未开始的写入", async () => {
    const h = historyApi({ findModeRawQueryList: ["原查询"] });
    const history = new BrowserToolboxFindHistory(h.api);
    await history.init();
    for (const listener of h.listeners) {
      listener({ findModeRawQueryList: { newValue: ["不能接受"] } }, "sync");
    }
    assert.equal("原查询", history.getQuery());
    const saved = history.saveQuery("取消查询");
    history.destroy();
    await saved;
    assert.equal(0, h.writes.length);
  });
});
