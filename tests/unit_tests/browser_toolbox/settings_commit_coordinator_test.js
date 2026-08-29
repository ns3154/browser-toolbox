/**
 * 设置提交协调器的单元测试。
 * 测试输入为可回滚的写入操作，输出为提交顺序和冲突处理断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";
import "../../../pages/settings_commit_coordinator.js";

context("Settings commit coordinator", () => {
  const api = () => globalThis.BrowserToolboxSettingsCommitCoordinator;

  should("skip unchanged storage domains", async () => {
    const writes = [];
    const result = await new (api().SettingsCommitCoordinator)().commit({
      operations: [{
        id: "browserToolbox",
        before: { value: 1 },
        next: { value: 1 },
        write: async () => writes.push("unexpected"),
      }],
    });
    assert.equal([], writes);
    assert.equal([], result.changed);
  });

  should("stop before writing when a conflict guard changes", async () => {
    const writes = [];
    let failed = false;
    try {
      await new (api().SettingsCommitCoordinator)().commit({
        guards: [{
          name: "browserToolbox",
          expected: { version: 1 },
          read: async () => ({ version: 2 }),
        }],
        operations: [{
          id: "browserToolbox",
          before: { value: 1 },
          next: { value: 2 },
          write: async () => writes.push("unexpected"),
        }],
      });
    } catch (error) {
      failed = error.code === "browser-toolbox-settings-conflict" &&
        error.conflicts[0].name === "browserToolbox" &&
        error.conflicts[0].paths[0] === "version" &&
        error.conflicts[0].truncated === false;
    }
    assert.isTrue(failed);
    assert.equal([], writes);
  });

  should("roll back attempted domains in reverse order", async () => {
    const writes = [];
    let failed = false;
    try {
      await new (api().SettingsCommitCoordinator)().commit({
        operations: [
          {
            id: "vimium",
            before: { value: "vimium-before" },
            next: { value: "vimium-after" },
            write: async (value) => writes.push(["vimium", value.value]),
          },
          {
            id: "browserToolbox",
            before: { value: "browser-before" },
            next: { value: "browser-after" },
            write: async (value) => {
              writes.push(["browserToolbox", value.value]);
              if (value.value === "browser-after") throw new Error("simulated write failure");
            },
          },
        ],
      });
    } catch (error) {
      failed = error.message === "simulated write failure";
    }
    assert.isTrue(failed);
    assert.equal([
      ["vimium", "vimium-after"],
      ["browserToolbox", "browser-after"],
      ["browserToolbox", "browser-before"],
      ["vimium", "vimium-before"],
    ], writes);
  });

  should("retain the primary error while reporting recovery failures", async () => {
    let failed = false;
    try {
      await new (api().SettingsCommitCoordinator)().commit({
        operations: [{
          id: "vimium",
          before: { value: 1 },
          next: { value: 2 },
          write: async (value) => {
            if (value.value === 2) throw new Error("primary failure");
            throw new Error("rollback failure");
          },
        }],
      });
    } catch (error) {
      failed = error.message === "primary failure" &&
        error.rollbackErrors?.[0]?.id === "vimium";
    }
    assert.isTrue(failed);
  });

  should("compare cyclic in-memory snapshots without recursing forever", () => {
    const left = { value: 1 };
    left.self = left;
    const right = { value: 1 };
    right.self = right;
    assert.isTrue(api().equalValues(left, right));
  });

  should("keep conflict details bounded and free of raw values", async () => {
    let failed = false;
    try {
      await new (api().SettingsCommitCoordinator)().commit({
        guards: [{
          name: "browserToolbox",
          expected: { general: { enabled: true }, secret: "before" },
          read: async () => ({ general: { enabled: false }, secret: "after" }),
          diffOptions: { maxPaths: 1 },
        }],
        operations: [{
          id: "browserToolbox",
          before: { value: 1 },
          next: { value: 2 },
          write: async () => {
            throw new Error("must not write");
          },
        }],
      });
    } catch (error) {
      failed = error.conflicts[0].paths[0] === "general.enabled" &&
        error.conflicts[0].truncated &&
        !JSON.stringify(error.conflicts).includes("before") &&
        !JSON.stringify(error.conflicts).includes("after");
    }
    assert.isTrue(failed);
  });
});
