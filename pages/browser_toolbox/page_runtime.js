// SPDX-License-Identifier: GPL-3.0-or-later
// 隔离构建从既有页面依赖清单生成静态导入，页面只创建同一个 RuntimeHost。
export async function startPageRuntime() {
  if (!globalThis.BrowserToolboxRuntimeHostInstance) throw new Error("PAGE_RUNTIME_NOT_BUILT");
  await Settings.onLoaded();
  await checkIfEnabledForUrl();
  DomUtils.injectUserCss();
}
