// SPDX-License-Identifier: GPL-3.0-or-later
// 纯参数比较不启动浏览器，也不需要文件、网络、环境或进程权限。
import { assert, context, should } from "../../vendor/shoulda.js";
import { compareCanaryBrowserArguments as compare } from "../../../scripts/canary_browser_arguments.js";

const begin = "--flag-switches-begin", end = "--flag-switches-end";
const expected = [
  "/synthetic/CFT",
  "--no-first-run",
  "about:blank",
  "--no-first-run",
  "--load-extension=/synthetic/extension",
];
const withEmptyPair = [
  ...expected.filter((value) => value !== "about:blank"),
  begin,
  end,
  "about:blank",
];

context("CUA CFT 内部命令行的最小空标记归一化", () => {
  should("接受原参数及唯一相邻空标记，保留原始数组与重复次数", () => {
    assert.isTrue(compare(expected, expected).equal);
    const before = JSON.stringify(withEmptyPair);
    const result = compare(expected, withEmptyPair);
    assert.isTrue(result.equal);
    assert.equal(withEmptyPair, result.actualArgs);
    assert.equal(expected, result.expectedArgs);
    assert.equal(before, JSON.stringify(withEmptyPair));
    assert.equal("single-adjacent-empty-flags-sentinels", result.normalization.kind);
    assert.equal(2, result.normalization.removed.length);
  });

  should("拒绝非空标记区间，即使内部参数原本已经在预期列表中", () => {
    const actual = [...expected];
    actual.splice(1, 0, begin);
    actual.splice(3, 0, end);
    const result = compare(expected, actual);
    assert.isFalse(result.equal);
    assert.equal(actual, result.normalizedActualArgs);
    assert.equal("none", result.normalization.kind);
  });

  should("拒绝两对空标记、嵌套、逆序及单侧标记", () => {
    for (
      const markers of [[begin, end, begin, end], [begin, begin, end, end], [end, begin], [begin], [
        end,
      ]]
    ) {
      assert.isFalse(compare(expected, [...expected, ...markers]).equal);
    }
  });

  should("空标记不能掩盖缺失的扩展参数", () => {
    const actual = withEmptyPair.filter((value) => !value.startsWith("--load-extension="));
    const result = compare(expected, actual);
    assert.isFalse(result.equal);
    assert.equal(["--load-extension=/synthetic/extension"], result.missingExpectedArguments);
  });

  should("拒绝原参数重复次数减少或增加", () => {
    const missingDuplicate = [...withEmptyPair];
    missingDuplicate.splice(missingDuplicate.indexOf("--no-first-run"), 1);
    assert.isFalse(compare(expected, missingDuplicate).equal);
    assert.equal(["--no-first-run"], compare(expected, missingDuplicate).missingExpectedArguments);
    const extraDuplicate = [...withEmptyPair, "--no-first-run"];
    assert.isFalse(compare(expected, extraDuplicate).equal);
    assert.equal(["--no-first-run"], compare(expected, extraDuplicate).unexpectedActualArguments);
  });

  should("拒绝标记外新增参数、携带值的伪标记和改变程序路径", () => {
    assert.isFalse(compare(expected, [...withEmptyPair, "--unexpected-feature"]).equal);
    assert.isFalse(compare(expected, [...expected, begin + "=value", end]).equal);
    const wrongBinary = [...withEmptyPair];
    wrongBinary[0] = "/other/CFT";
    assert.isFalse(compare(expected, wrongBinary).equal);
  });

  should("拒绝预期启动参数主动携带标记，避免范围扩大", () => {
    assert.isFalse(compare(withEmptyPair, withEmptyPair).equal);
  });
});

if (import.meta.main) {
  const { run } = await import("../../vendor/shoulda.js");
  if (!await run()) Deno.exitCode = 1;
}
