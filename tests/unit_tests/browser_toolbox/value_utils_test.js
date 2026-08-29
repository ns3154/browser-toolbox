/**
 * 配置值工具的单元测试。
 * 测试输入为嵌套配置对象，输出为克隆、相等性和差异路径断言。
 */
import "../test_helper.js";
import "../../../lib/browser_toolbox/value_utils.js";

context("BrowserToolbox value utilities", () => {
  const api = () => globalThis.BrowserToolboxValueUtils;

  should("clone nested configuration values without sharing references", () => {
    const original = { nested: { values: [1, { enabled: true }] } };
    const copy = api().clone(original);
    copy.nested.values[1].enabled = false;

    assert.isTrue(original.nested.values[1].enabled);
    assert.isFalse(copy.nested.values[1].enabled);
  });

  should("compare plain values, arrays and cyclic pairs", () => {
    assert.isTrue(api().equalValues({ a: [1, { b: true }] }, { a: [1, { b: true }] }));
    assert.isFalse(api().equalValues({ a: 1 }, { a: 2 }));

    const left = { value: 1 };
    left.self = left;
    const right = { value: 1 };
    right.self = right;
    assert.isTrue(api().equalValues(left, right));
  });

  should("stop comparing after the configured node budget", () => {
    const left = Array.from({ length: api().MAX_COMPARISON_NODES + 1 }, () => 0);
    const right = Array.from({ length: api().MAX_COMPARISON_NODES + 1 }, () => 0);
    assert.isFalse(api().equalValues(left, right));
  });

  should("report nested fields with stable ids without exposing values", () => {
    const before = {
      siteRules: [
        { id: "rule-a", pattern: "https://a.example/*" },
        { id: "rule-b", pattern: "https://b.example/*" },
      ],
    };
    const after = {
      siteRules: [
        { id: "rule-b", pattern: "https://b.example/changed/*" },
        { id: "rule-a", pattern: "https://a.example/*" },
      ],
    };

    const result = api().diffPaths(before, after);
    assert.equal([
      "siteRules",
      'siteRules[id="rule-b"].pattern',
    ], result.paths);
    assert.isFalse(result.truncated);
    assert.isFalse(result.paths.some((path) => path.includes("changed")));
  });

  should("bound field conflict details and mark omitted paths", () => {
    const result = api().diffPaths(
      { a: 1, b: 2 },
      { a: 10, b: 20 },
      { maxPaths: 1 },
    );
    assert.equal(["a"], result.paths);
    assert.isTrue(result.truncated);
  });

  should("fall back to index paths for arrays without unique stable ids", () => {
    const missingId = api().diffPaths([{ value: 1 }], [{ value: 2 }]);
    assert.equal(["settings[0].value"], missingId.paths);

    const duplicateId = api().diffPaths(
      [{ id: "same", value: 1 }, { id: "same", value: 2 }],
      [{ id: "same", value: 1 }, { id: "same", value: 3 }],
    );
    assert.equal(["settings[1].value"], duplicateId.paths);
  });

  should("mark depth and node budgets without exposing values", () => {
    const byDepth = api().diffPaths({ nested: { value: 1 } }, { nested: { value: 2 } }, {
      maxDepth: 1,
    });
    assert.equal(["nested.value"], byDepth.paths);
    assert.isTrue(byDepth.truncated);

    const byNodes = api().diffPaths({ a: { b: 1 } }, { a: { b: 2 } }, { maxNodes: 1 });
    assert.equal(["a"], byNodes.paths);
    assert.isTrue(byNodes.truncated);
  });

  should("avoid revisiting cyclic pairs while diffing", () => {
    const left = { value: 1 };
    left.self = left;
    const right = { value: 1 };
    right.self = right;
    const result = api().diffPaths(left, right);
    assert.equal([], result.paths);
    assert.isFalse(result.truncated);
  });
});
