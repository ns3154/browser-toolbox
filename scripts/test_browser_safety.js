// SPDX-License-Identifier: GPL-3.0-or-later
// 有头和外部浏览器可能抢占用户焦点，只能在用户明确授权后启用。
export function assertSafeTestBrowser({ headless = true, external = false } = {}) {
  if ((!headless || external) && Deno.env.get("BROWSER_TOOLBOX_ALLOW_HEADED_TESTS") !== "true") {
    throw new Error("有头测试或外部浏览器连接须先获得用户明确授权；常规测试使用独立无头浏览器。");
  }
}
