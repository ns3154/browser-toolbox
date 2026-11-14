import "./all_content_scripts.js";
import "../lib/browser_toolbox/theme.js";
import "../background_scripts/browser_toolbox/settings_storage.js";
import { renderCommandListing } from "./command_listing_view.js";

export async function populatePage() {
  await BrowserToolboxI18n.applyStoredLocale(document);
  await globalThis.BrowserToolboxTheme?.applyStoredTheme?.(document);
  globalThis.BrowserToolboxTheme?.watchTheme?.(document);
  const { commandToOptionsToKeys } = await chrome.storage.session.get("commandToOptionsToKeys");
  renderCommandListing(commandToOptionsToKeys || {});
}

export async function startCommandListingPage() {
  await Settings.onLoaded();
  DomUtils.injectUserCss();
  await populatePage();
}

if (globalThis.window != null) {
  document.addEventListener("DOMContentLoaded", startCommandListingPage);
}
