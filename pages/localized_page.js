// 扩展信息页共用本地化入口，避免在 CSP 禁止的内联脚本中执行初始化。
document.addEventListener("DOMContentLoaded", () => {
  void BrowserToolboxI18n.applyStoredLocale(document);
}, { once: true });
