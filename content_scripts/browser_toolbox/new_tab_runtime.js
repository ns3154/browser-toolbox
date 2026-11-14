// SPDX-License-Identifier: GPL-3.0-or-later
(function () {
  // 文档级状态跨 BFCache 保留，新的运行时代次不能让已触发的面板再次自动打开。
  let opened = false;

  async function openOnReady(host, epoch) {
    const target = Settings.vimiumNewTabPageUrl;
    const documentId = host.context.documentId;
    const vomnibar = globalThis.BrowserToolboxVomnibarControllerInstance;
    const canShow = () =>
      location.href === target && host.runtimeEpoch === epoch &&
      host.context.documentId === documentId &&
      host.plan.moduleImplementations.newTab === "browser-toolbox" &&
      vomnibar?.valid() && Settings.get("openVomnibarOnNewTabPage");
    if (opened || location.href !== target || host.context.frameId !== 0 || !vomnibar) return;
    await Settings.onLoaded();
    if (opened || !canShow()) return;
    await Utils.populateBrowserInfo();
    if (opened || !canShow()) return;
    DomUtils.injectUserCss();
    opened = true;
    await vomnibar.open(0, { completer: "omni" }, canShow);
  }

  globalThis.BrowserToolboxNewTabRuntime = Object.freeze({ openOnReady });
})();
