import "./all_content_scripts.js";
import "../lib/browser_toolbox/theme.js";
import { renderSearchCompletion as populatePage } from "./search_completion_view.js";

export { populatePage };

if (globalThis.window != null) {
  document.addEventListener("DOMContentLoaded", () => {
    void globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
    globalThis.BrowserToolboxTheme?.watchTheme?.(document);
    return populatePage();
  });
}
