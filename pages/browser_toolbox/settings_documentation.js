// SPDX-License-Identifier: GPL-3.0-or-later
import "../../lib/i18n.js";
import "../../lib/browser_toolbox/value_utils.js";
import "../../background_scripts/browser_toolbox/settings_storage.js";

export async function startDocumentation(page) {
  await BrowserToolboxI18n.applyStoredLocale(document);
  if (page === "command_listing.html") {
    const { renderCommandListing } = await import("../command_listing_view.js");
    const { commandToOptionsToKeys } = await chrome.storage.session.get("commandToOptionsToKeys")
      .catch(() => ({}));
    renderCommandListing(commandToOptionsToKeys || {});
  } else if (page === "doc_search_completion.html") {
    const { renderSearchCompletion } = await import("../search_completion_view.js");
    renderSearchCompletion();
  }
}
