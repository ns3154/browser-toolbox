// SPDX-License-Identifier: GPL-3.0-or-later
// 公开 iframe 在授权前只显示静态内容，不初始化键盘、设置和后台动作。
(function () {
  const component = globalThis.isVimiumUIComponent ||
    globalThis.location &&
      ["/pages/hud_page.html", "/pages/vomnibar_page.html", "/pages/help_dialog_page.html"]
        .includes(
          location.pathname,
        );
  let resolve;
  const ready = component && !globalThis.location?.protocol?.startsWith("moz-extension") &&
      !globalThis.isUnitTests && !globalThis.vimiumDomTestsAreRunning
    ? new Promise((done) => resolve = done)
    : Promise.resolve();
  globalThis.BrowserToolboxUIAuthorization = {
    ready,
    session: null,
    accept(session) {
      this.session = session;
      resolve?.(session);
      resolve = null;
    },
  };
})();
