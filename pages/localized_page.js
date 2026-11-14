// 扩展信息页共用本地化与主题入口，避免在 CSP 禁止的内联脚本中执行初始化。
document.addEventListener("DOMContentLoaded", () => {
  void BrowserToolboxI18n.applyStoredLocale(document);
  void globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
  globalThis.BrowserToolboxTheme?.watchTheme?.(document);
}, { once: true });
