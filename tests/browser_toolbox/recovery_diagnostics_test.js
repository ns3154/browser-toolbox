// SPDX-License-Identifier: GPL-3.0-or-later
import "../../background_scripts/browser_toolbox/configuration_writer.js";
import "../../lib/browser_toolbox/recovery_diagnostics.js";

const store = globalThis.BrowserToolboxConfigurationStore;
const diagnostics = globalThis.BrowserToolboxRecoveryDiagnostics;
const equal = (actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`不符合预期：${JSON.stringify(actual)}`);
  }
};

Deno.test("诊断只读指定记录，且不输出配置正文、冲突字段或错误内容", async () => {
  const secret = "绝不导出的合成配置_密码_网址";
  const keys = [store.KEYS.state, store.ROLLBACK_JOURNAL_KEY, store.SYNC_PUBLISH_JOURNAL_KEY];
  let requested;
  const local = {
    get(values) {
      requested = values;
      return Promise.resolve({
        [store.KEYS.state]: {
          formatVersion: 1,
          phase: "COMMITTED",
          afterSnapshot: { keyMappings: secret },
          code: secret,
        },
        [store.ROLLBACK_JOURNAL_KEY]: {
          formatVersion: 1,
          kind: "legacy-rollback",
          phase: "ABORTED",
          conflicts: [secret],
          cells: { password: secret },
        },
      });
    },
  };
  const result = await diagnostics.inspect(local, "0.1.3");
  equal(requested, keys);
  equal(result, {
    formatVersion: 1,
    extensionVersion: "0.1.3",
    status: "available",
    records: {
      configuration: { status: "present", phase: "COMMITTED", hasConflicts: false },
      legacyRollback: { status: "present", phase: "ABORTED", hasConflicts: true },
      syncPublish: { status: "absent" },
    },
    compatibilityConflictCount: 0,
    transitionBlocksWrites: true,
  });
  if (JSON.stringify(result).includes(secret)) throw new Error("诊断包含用户数据");
});

Deno.test("未知格式、非法阶段和伪造版本不能作为可信状态或原文输出", async () => {
  const secret = "https://example.invalid/secret";
  const local = {
    get: () =>
      Promise.resolve({
        [store.KEYS.state]: { formatVersion: 99, phase: secret },
        [store.ROLLBACK_JOURNAL_KEY]: { formatVersion: 1, kind: "legacy-rollback", phase: secret },
        [store.SYNC_PUBLISH_JOURNAL_KEY]: { formatVersion: 1, kind: secret, phase: "COMMITTED" },
      }),
  };
  const result = await diagnostics.inspect(local, secret);
  equal(result.extensionVersion, null);
  equal(result.records.configuration, { status: "unsupported" });
  equal(result.records.legacyRollback, { status: "invalid" });
  equal(result.records.syncPublish, { status: "invalid" });
  equal(result.transitionBlocksWrites, true);
  if (JSON.stringify(result).includes(secret)) throw new Error("未知内容泄漏到报告");
});

Deno.test("存储不可用时显示不可用，不误报无记录也不包含异常正文", async () => {
  const result = await diagnostics.inspect({
    get: () => Promise.reject(new Error("私密异常内容")),
  }, "0.1.3");
  equal(result, {
    formatVersion: 1,
    extensionVersion: "0.1.3",
    status: "unavailable",
    records: null,
    compatibilityConflictCount: null,
    transitionBlocksWrites: null,
  });
});

Deno.test("冲突观察存在时独立诊断报告阻断，但不导出键名或内容", async () => {
  const key = `${store.M2_CONFLICT_CAPTURE_PREFIX}synthetic-secret-key`;
  const local = {
    getKeys: () => Promise.resolve([store.KEYS.state, key]),
    get: () =>
      Promise.resolve({
        [store.KEYS.state]: { formatVersion: 1, phase: "COMMITTED" },
      }),
  };
  const report = await diagnostics.inspect(local, "0.1.3");
  equal(report.compatibilityConflictCount, 1);
  equal(report.transitionBlocksWrites, true);
  if (JSON.stringify(report).includes("synthetic-secret-key")) throw new Error("诊断泄漏记录键名");
});

Deno.test("无法枚举观察记录时诊断不可用，不能声称没有阻断", async () => {
  const report = await diagnostics.inspect({
    getKeys: () => Promise.reject(new Error("合成私密错误")),
    get: () => Promise.resolve({}),
  }, "0.1.3");
  equal(report.status, "unavailable");
  equal(report.compatibilityConflictCount, null);
  equal(report.transitionBlocksWrites, null);
  if (JSON.stringify(report).includes("合成私密错误")) throw new Error("诊断泄漏异常正文");
});

Deno.test("旧版存储接口按键名统计观察，但不输出读取到的配置正文", async () => {
  const key = `${store.M2_CONFLICT_CAPTURE_PREFIX}synthetic`;
  const secret = "synthetic-private-configuration";
  const local = {
    get: (keys) => Promise.resolve(keys === null ? { [key]: { secret } } : {}),
  };
  const report = await diagnostics.inspect(local, "0.1.3");
  equal(report.status, "available");
  equal(report.compatibilityConflictCount, 1);
  equal(report.transitionBlocksWrites, true);
  if (JSON.stringify(report).includes(secret)) throw new Error("诊断泄漏了配置正文");
});

Deno.test("旧版中止冲突没有新观察记录时仍提示阻断与冲突", async () => {
  const local = {
    getKeys: () => Promise.resolve([store.KEYS.state]),
    get: () =>
      Promise.resolve({
        [store.KEYS.state]: {
          formatVersion: 1,
          phase: "ABORTED",
          code: "CONFIGURATION_EXTERNAL_CONFLICT",
          conflicts: [],
        },
      }),
  };
  const report = await diagnostics.inspect(local, "0.1.3");
  equal(report.compatibilityConflictCount, 0);
  equal(report.records.configuration.hasConflicts, true);
  equal(report.transitionBlocksWrites, true);
});
