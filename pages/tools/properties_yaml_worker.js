// SPDX-License-Identifier: GPL-3.0-or-later
// 解析隔离在可终止的本地 Worker 中，不把用户配置放入日志或 URL。
import { run } from "./properties_yaml_tool.js";

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: run(data.input, data.options) });
  } catch (error) {
    self.postMessage({
      error: {
        messageKey: error.messageKey || "toolConfigYamlSyntax",
        line: error.line || 0,
        column: error.column || 0,
      },
    });
  }
};
