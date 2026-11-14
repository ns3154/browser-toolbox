// SPDX-License-Identifier: GPL-3.0-or-later
// 只处理 Chromium 在 CDP 内部命令行中加入的一对空实验标记；OS 启动参数仍由调用方完整核验。
const begin = "--flag-switches-begin", end = "--flag-switches-end";
const difference = (left, right) => {
  const remaining = [...right];
  return left.filter((value) => {
    const index = remaining.indexOf(value);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
};

export function compareCanaryBrowserArguments(expected, actual) {
  const expectedArgs = [...expected], actualArgs = [...actual];
  const normalizedActualArgs = [...actual];
  const markers = actual.flatMap((value, index) =>
    value === begin || value === end ? [{ value, index }] : []
  );
  let valid = true;
  const normalization = { kind: "none", removed: [], reason: "未出现实验首尾标记" };
  if (expected.some((value) => value === begin || value === end)) {
    valid = false;
    normalization.reason = "原启动参数不得主动携带实验首尾标记";
  } else if (markers.length) {
    if (
      markers.length !== 2 || markers[0].value !== begin || markers[1].value !== end ||
      markers[0].index === 0 || markers[1].index !== markers[0].index + 1
    ) {
      valid = false;
      normalization.reason = "只允许唯一且相邻的空实验首尾标记；非空、重复、不完整或逆序均拒绝";
    } else {
      normalizedActualArgs.splice(markers[0].index, 2);
      normalization.kind = "single-adjacent-empty-flags-sentinels";
      normalization.removed = markers;
      normalization.reason = "Chromium flags 转换加入的唯一相邻空标记；未忽略任何实验参数";
    }
  }
  const missingExpectedArguments = difference(expectedArgs, normalizedActualArgs);
  const unexpectedActualArguments = difference(normalizedActualArgs, expectedArgs);
  return {
    equal: valid && !missingExpectedArguments.length && !unexpectedActualArguments.length,
    expectedArgs,
    actualArgs,
    normalizedActualArgs,
    normalization,
    missingExpectedArguments,
    unexpectedActualArguments,
  };
}
